/* Tower Horizon - optional same-origin, separate-window terrain recovery.
 * Runs only after the user clicks the recovery button in the main calculator.
 * Maximum 5 minutes, one USGS request at a time, only transient failures.
 */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const MAX_MS = 5 * 60 * 1000, REQUEST_MS = 35000, REST_MS = 5000;
  const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
  let session = null, closed = false, activeAbort = null, clock = null;
  let stopReason = null;
  const now = () => Date.now();
  const parentAvailable = () => window.opener && !window.opener.closed;
  function announce(message) { $("status").textContent = message; }
  function log(message) {
    const item = document.createElement("li");
    item.textContent = new Date().toLocaleTimeString() + "  " + message;
    $("log").append(item);
    $("log").scrollTop = $("log").scrollHeight;
  }
  function parentMessage(data) {
    if (parentAvailable()) window.opener.postMessage(data, window.location.origin);
  }
  function validPoint(p) {
    return p && typeof p === "object" && Number.isFinite(p.lat) &&
      Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
  }
  function validData(payload, count) {
    if (payload?.sampleMethod !== "multipoint" || payload.requestedCount !== count ||
        !Array.isArray(payload.samples) || payload.samples.length !== count)
      return false;
    return payload.samples.every((p, i) => p && p.index === i &&
      p.value !== null && p.value !== "" &&
      Number.isFinite(Number(p.value)) &&
      Number(p.value) >= -1500 && Number(p.value) <= 9000 &&
      p.location && Number.isFinite(Number(p.location.x)) &&
      Number.isFinite(Number(p.location.y)));
  }
  const transient = error => TRANSIENT_STATUSES.has(error?.httpStatus) ||
    error?.name === "AbortError" || error?.name === "TimeoutError" ||
    error instanceof TypeError;
  const delay = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
  function updateDisplay() {
    if (!session) return;
    const remainingMs = Math.max(0, session.deadline - now());
    const seconds = Math.ceil(remainingMs / 1000);
    $("timeLeft").textContent = Math.floor(seconds / 60) + ":" +
      String(seconds % 60).padStart(2, "0");
    $("recovered").textContent = String(session.success.size);
    $("outstanding").textContent = String(session.pending.length);
    const percent = session.total ? Math.round(100 * session.success.size / session.total) : 0;
    $("progress").setAttribute("aria-valuenow", String(percent));
    $("progressFill").style.width = percent + "%";
  }
  function stop(reason = "stopped") {
    if (closed) return;
    closed = true;
    stopReason = reason;
    if (activeAbort) activeAbort.abort();
    if (clock) clearInterval(clock);
    $("stopRecovery").disabled = true;
    updateDisplay();
    const finalMessage = reason === "recovered" ? "All requested bearings recovered." :
      reason === "timeout" ? "The five-minute recovery limit has elapsed." :
      reason === "partial" ? "All eligible requests were attempted; some returned non-retryable missing data." :
      reason === "parent-closed" ? "Original calculator is no longer available." :
      reason === "invalid-data" ? "Recovery configuration was invalid." :
      "Recovery stopped.";
    announce(finalMessage + " Results received by the original calculator are retained.");
    log(finalMessage);
    if (session) parentMessage({
      type: "tower-terrain-recovery-finished",
      token: session.token,
      reason, recoveredBearings: [...session.success],
      remainingBearings: session.pending.map(item => item.bearingDeg),
      unrecoverableBearings: [...session.unrecoverable]
    });
  }
  function validateSetup(data) {
    if (!data || typeof data.token !== "string" || data.token.length < 12 ||
        data.maxDurationMs !== MAX_MS || !validPoint(data.tx) ||
        !Number.isInteger(data.samples) || data.samples !== 48 ||
        !Array.isArray(data.bearings) || !data.bearings.length ||
        data.bearings.length > 36) return false;
    try {
      const u = new URL(data.workerUrl);
      if (u.protocol !== "https:" || u.pathname !== "/" ||
          !["tower-terrain-staging.mac1584.workers.dev",
            "tower-data-api.mac1584.workers.dev"].includes(u.hostname)) return false;
    } catch { return false; }
    return data.bearings.every(p => Number.isFinite(p?.bearingDeg) &&
      p.bearingDeg >= 0 && p.bearingDeg < 360 && validPoint(p.rx));
  }
  async function makeRequest(task) {
    const remaining = session.deadline - now();
    if (remaining < 500) throw Object.assign(new Error("Five-minute limit reached"), { name: "TimeoutError" });
    const controller = new AbortController();
    activeAbort = controller;
    const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_MS, remaining));
    try {
      const response = await fetch(session.workerUrl + "/terrain/multipoint", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({tx: session.tx, rx: task.rx, samples: session.samples}),
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        const e = new Error(data?.error?.message || data?.error ||
          ("USGS request returned HTTP " + response.status));
        e.httpStatus = response.status;
        throw e;
      }
      if (!validData(data, session.samples))
        throw new Error("USGS returned missing or invalid terrain samples");
      return data;
    } finally {
      clearTimeout(timer);
      if (activeAbort === controller) activeAbort = null;
    }
  }
  async function recover() {
    while (!closed && session.pending.length && now() < session.deadline) {
      // Sequential, bounded requests avoid creating excessive load on USGS.
      const cycle = [...session.pending];
      for (const task of cycle) {
        if (closed || now() >= session.deadline) break;
        if (!parentAvailable()) { stop("parent-closed"); return; }
        task.attempts = (task.attempts || 0) + 1;
        announce("Requesting " + task.bearingDeg + "° (attempt " +
          task.attempts + "). One request at a time.");
        log("Bearing " + task.bearingDeg + "°: request " + task.attempts);
        try {
          const data = await makeRequest(task);
          if (closed || now() >= session.deadline) break;
          // Parent rechecks coordinates, completeness, and session identity
          // before adding any recovered result to its existing terrain cache.
          parentMessage({
            type: "tower-terrain-recovery-sample",
            token: session.token, bearingDeg: task.bearingDeg,
            tx: session.tx, rx: task.rx, samples: data
          });
          session.pending = session.pending.filter(p => p !== task);
          session.success.add(task.bearingDeg);
          log("Bearing " + task.bearingDeg + "°: received 48 complete elevations.");
        } catch (error) {
          if (closed) return;
          task.lastError = String(error?.message || error);
          if (!transient(error)) {
            // An actual gap or invalid payload is not a temporary outage.
            session.pending = session.pending.filter(p => p !== task);
            session.unrecoverable.add(task.bearingDeg);
            log("Bearing " + task.bearingDeg + "°: not retryable (" +
              task.lastError + "). This sector remains unknown.");
          } else {
            log("Bearing " + task.bearingDeg + "°: temporary failure (" +
              task.lastError + "). Will retry if time remains.");
          }
        }
        updateDisplay();
        if (!closed && session.pending.length && now() < session.deadline)
          await delay(Math.min(1000, session.deadline - now()));
      }
      if (closed || !session.pending.length || now() >= session.deadline) break;
      announce("Pausing five seconds before retrying remaining transient failures…");
      await delay(Math.min(REST_MS, session.deadline - now()));
    }
    if (!closed) stop(now() >= session.deadline ? "timeout" :
      session.success.size === session.total ? "recovered" :
      session.unrecoverable.size ? "partial" : "stopped");
  }
  window.addEventListener("message", event => {
    if (event.origin !== window.location.origin ||
        event.source !== window.opener) return;
    const data = event.data;
    if (data?.type === "tower-terrain-recovery-cancel") {
      if (session && data.token === session.token) stop("stopped");
      return;
    }
    if (session || data?.type !== "tower-terrain-recovery-start") return;
    if (!validateSetup(data)) {
      announce("Invalid or unsupported recovery session. Return to the calculator.");
      $("stopRecovery").disabled = true;
      return;
    }
    session = {
      token: data.token, workerUrl: data.workerUrl, tx: data.tx,
      samples: data.samples, pending: data.bearings.map(p => ({...p, attempts: 0})),
      total: data.bearings.length, success: new Set(),
      unrecoverable: new Set(),
      deadline: now() + MAX_MS
    };
    $("stopRecovery").disabled = false;
    clock = setInterval(() => {
      updateDisplay();
      if (!closed && session && now() >= session.deadline) stop("timeout");
    }, 1000);
    updateDisplay();
    log("Recovery session started: " + session.total + " temporarily failed bearings.");
    recover().catch(error => {
      console.error("Recovery stopped unexpectedly:", error);
      if (!closed) stop("stopped");
    });
  });
  $("stopRecovery").addEventListener("click", () => stop("stopped"));
  window.addEventListener("pagehide", () => {
    if (!closed && session) stop("stopped");
  });
  $("stopRecovery").disabled = true;
  if (!parentAvailable()) {
    announce("Open this window using the Recover button in Tower Horizon.");
  } else {
    parentMessage({ type: "tower-terrain-recovery-ready" });
  }
})();
