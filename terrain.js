/* Tower Horizon Calculator v2.0 BETA — terrain-aware analysis. */
(function terrainMain() {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const R = 6371000, FT = 3.280839895, MI = 1609.344, RAD = Math.PI / 180;
  const ELEVATION_API = "https://epqs.nationalmap.gov/v1/json";
  const SAMPLES_API = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples";
  const TOWER_API = "https://tower-data-api.mac1584.workers.dev";
  const fmt = (n, d = 1) => Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: d }) : "—";
  let map = null, towerMarker = null, receiverMarker = null, horizonCircle = null;
  let visibilityLayer = null, lastTxElevation = null, currentProfile = null, coverageRun = 0, analysisCounter = 0;
  let coverageSnapshot = null;
  let recoverySession = null;
  const profileCache = new Map();
  const deg = (n) => n * RAD;
  const rad = (n) => n / RAD;
  const validLatLon = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180;
  const point = (latId, lonId) => ({ lat: Number($(latId).value), lon: Number($(lonId).value) });
  function status(id, message, error = false) {
    $(id).textContent = message;
    $(id).classList.toggle("error", error);
  }
  function distance(a, b) {
    const dLat = deg(b.lat - a.lat), dLon = deg(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(deg(a.lat)) * Math.cos(deg(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function destination(p, bearingDeg, meters) {
    const ang = meters / R, theta = deg(bearingDeg), phi = deg(p.lat), lam = deg(p.lon);
    const lat = Math.asin(Math.sin(phi) * Math.cos(ang) + Math.cos(phi) * Math.sin(ang) * Math.cos(theta));
    const lon = lam + Math.atan2(Math.sin(theta) * Math.sin(ang) * Math.cos(phi), Math.cos(ang) - Math.sin(phi) * Math.sin(lat));
    return { lat: rad(lat), lon: ((rad(lon) + 540) % 360) - 180 };
  }
  function interpolate(a, b, f) {
    const d = distance(a, b) / R;
    if (d < 1e-8) return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
    const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(deg(a.lat)) * Math.cos(deg(a.lon)) + B * Math.cos(deg(b.lat)) * Math.cos(deg(b.lon));
    const y = A * Math.cos(deg(a.lat)) * Math.sin(deg(a.lon)) + B * Math.cos(deg(b.lat)) * Math.sin(deg(b.lon));
    const z = A * Math.sin(deg(a.lat)) + B * Math.sin(deg(b.lat));
    return { lat: rad(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: rad(Math.atan2(y, x)) };
  }
  async function fetchJSON(url, options = {}, timeoutMs = 25000) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const data = await response.json();
      if (!response.ok || data.error) {
        const error = new Error((data.error && (data.error.message || data.error)) || "HTTP " + response.status);
        error.httpStatus = response.status;
        throw error;
      }
      return data;
    } finally { clearTimeout(timer); }
  }
  async function withProxy(relative, options, direct, timeoutMs = 12000) {
    try {
      return await fetchJSON(TOWER_API + relative, options, timeoutMs);
    } catch (error) {
      // A missing endpoint can use the public USGS fallback. Timeouts and
      // temporary service errors must not disable the proxy for other rays.
      if (error.httpStatus !== 404 && error.httpStatus !== 405) throw error;
      console.info("Terrain route unavailable on Worker; trying USGS directly:", relative);
      return direct();
    }
  }
  async function queryElevation(p) {
    const qs = new URLSearchParams({ lat: String(p.lat), lon: String(p.lon) });
    const data = await withProxy("/terrain/elevation?" + qs, {}, () =>
      fetchJSON(ELEVATION_API + "?" + new URLSearchParams({
        x: String(p.lon), y: String(p.lat), wkid: "4326", units: "Meters", includeDate: "false"
      }), {}, 25000)
    );
    const raw = data.elevationMeters ?? data.value;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < -1500 || n > 9000) throw new Error("USGS returned no usable elevation at these coordinates.");
    return n;
  }
  function geometryForLine(tx, rx) {
    const path = Array.from({ length: 17 }, (_, i) => {
      const p = interpolate(tx, rx, i / 16);
      return [Number(p.lon.toFixed(7)), Number(p.lat.toFixed(7))];
    });
    return JSON.stringify({ paths: [path], spatialReference: { wkid: 4326 } });
  }
  async function getRawProfile(tx, rx, n) {
    const payload = { tx, rx, samples: n };
    return withProxy("/terrain/profile", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    }, () => fetchJSON(SAMPLES_API + "?" + new URLSearchParams({
      geometryType: "esriGeometryPolyline", geometry: geometryForLine(tx, rx),
      sampleCount: String(n), f: "json"
    }), {}, 35000), 27000);
  }
  function samplePoint(location) {
    if (!location) return null;
    const x = Number(location.x), y = Number(location.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const wkid = Number(location.spatialReference && (location.spatialReference.wkid || location.spatialReference.latestWkid));
    if (wkid === 3857 || wkid === 102100 || Math.abs(x) > 180 || Math.abs(y) > 90)
      return { lon: rad(x / 6378137), lat: rad(2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) };
    return { lat: y, lon: x };
  }
  function normalizeSamples(raw, tx, rx, requested) {
    const entries = Array.isArray(raw.samples) ? raw.samples : [];
    const total = distance(tx, rx);
    let samples = entries.map((s, i) => {
      const geo = samplePoint(s.location);
      const elev = Number(s.value);
      if (!Number.isFinite(elev) || elev < -1500 || elev > 9000 || !geo) return null;
      return { lat: geo.lat, lon: geo.lon, d: Math.min(total, distance(tx, geo)), elev };
    }).filter(Boolean);
    samples.sort((a, b) => a.d - b.d);
    samples = samples.filter((s, i) => i === 0 || s.d - samples[i - 1].d > 0.01);
    if (samples.length < Math.max(8, requested * 0.75)) throw new Error("USGS returned an incomplete terrain profile.");
    const expected = total / Math.max(1, requested - 1);
    if (samples[0].d > expected * 1.6 || (total - samples[samples.length - 1].d) > expected * 1.6)
      throw new Error("USGS omitted an endpoint; terrain clearance cannot be confirmed.");
    if (samples.some((s, i) => i && s.d - samples[i - 1].d > expected * 3))
      throw new Error("USGS returned large elevation gaps along this path.");
    return samples;
  }
  function profileKey(tx, rx, n) {
    return [tx.lat, tx.lon, rx.lat, rx.lon, n].map(v => Number(v).toFixed(5)).join("|");
  }
  async function getProfile(tx, rx, n = 72) {
    const cacheKey = profileKey(tx, rx, n);
    if (profileCache.has(cacheKey)) return profileCache.get(cacheKey);
    const p = normalizeSamples(await getRawProfile(tx, rx, n), tx, rx, n);
    if (profileCache.size > 80) profileCache.clear();
    profileCache.set(cacheKey, p);
    return p;
  }
  // USGS getSamples does not always include the exact receiver endpoint.
  // Repair that specific gap with an independent USGS EPQS lookup; never
  // extrapolate a missing elevation or assume unknown terrain is clear.
  async function recoverRadialEndpoint(samples, tx, rx, n) {
    const total = distance(tx, rx), last = samples[samples.length - 1];
    const missingMeters = total - last.d;
    if (missingMeters <= 1) return { samples, recovered: false };
    const expectedSpacing = total / Math.max(1, n - 1);
    if (missingMeters > expectedSpacing * 1.6)
      throw new Error("Too much terrain missing near radial endpoint for safe recovery");
    const elevation = await queryElevation(rx);
    if (!Number.isFinite(elevation))
      throw new Error("USGS could not verify the radial endpoint elevation");
    const completed = [...samples.filter(s => s.d < total - 0.01),
      { lat: rx.lat, lon: rx.lon, d: total, elev: elevation }];
    profileCache.set(profileKey(tx, rx, n), completed);
    return { samples: completed, recovered: true };
  }
  // Only retry temporary network/service errors. Bad inputs and absent
  // elevation measurements must remain unknown, not trigger repeated calls.
  function isTransientTerrainError(error) {
    const status = Number(error?.httpStatus);
    return [408, 429, 500, 502, 503, 504].includes(status) ||
      error?.name === "AbortError" || error?.name === "TimeoutError" ||
      error instanceof TypeError;
  }

  function validateMultipoint(data, tx, rx, n) {
    if (data?.sampleMethod !== "multipoint" || data.requestedCount !== n ||
        !Array.isArray(data.samples) || data.samples.length !== n)
      throw new Error("Invalid multipoint response from the terrain Worker");
    const missing = [], total = distance(tx, rx);
    const samples = data.samples.map((entry, i) => {
      if (!entry || entry.index !== i || entry.value == null ||
          entry.value === "" || !Number.isFinite(Number(entry.value))) {
        missing.push(i);
        return null;
      }
      const elevation = Number(entry.value);
      if (elevation < -1500 || elevation > 9000) {
        missing.push(i);
        return null;
      }
      const location = samplePoint(entry.location);
      const expected = interpolate(tx, rx, i / (n - 1));
      if (!validLatLon(location) || distance(location, expected) > 25) {
        missing.push(i);
        return null;
      }
      // This source metadata is descriptive only; missing/unknown source
      // fields never alter the elevation or inferred geometric clearance.
      const sourceId = Number(entry.rasterId), sourceResolution = Number(entry.resolution);
      return {
        lat: location.lat, lon: location.lon, d: total * i / (n - 1),
        elev: elevation,
        rasterId: Number.isSafeInteger(sourceId) && sourceId > 0 ? sourceId : null,
        resolution: entry.resolution != null && Number.isFinite(sourceResolution) &&
          sourceResolution > 0 ? sourceResolution : null,
        sourceDetails: entry.sourceDetails && typeof entry.sourceDetails === "object" ?
          entry.sourceDetails : null
      };
    });
    if (missing.length)
      throw new Error("USGS has no valid elevation at " + missing.length + " of " + n +
        " requested points (indices: " + missing.slice(0, 6).join(", ") +
        (missing.length > 6 ? ", ..." : "") + ")");
    samples[samples.length - 1].d = total;
    return samples;
  }

  function cacheMultipoint(tx, rx, n, data) {
    const samples = validateMultipoint(data, tx, rx, n);
    if (profileCache.size > 100) profileCache.clear();
    profileCache.set("multipoint|" + profileKey(tx, rx, n), samples);
    return samples;
  }

  // Request explicit, equally spaced geographic samples for 360-degree radials.
  // The staging Worker needs the /terrain/multipoint handler to activate this.
  // Until deployed, a 404 uses the existing (legacy) polyline route.
  async function getRadialProfile(tx, rx, n = 48, cacheOnly = false) {
    const key = "multipoint|" + profileKey(tx, rx, n);
    if (profileCache.has(key)) return { samples: profileCache.get(key), method: "multipoint" };
    if (cacheOnly) {
      const legacy = profileCache.get(profileKey(tx, rx, n));
      if (legacy) return { samples: legacy, method: "polyline" };
      throw new Error("Not available in the verified terrain cache");
    }
    let data;
    try {
      data = await fetchJSON(TOWER_API + "/terrain/multipoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tx, rx, samples: n })
      }, 35000);
    } catch (error) {
      if (error.httpStatus !== 404 && error.httpStatus !== 405) throw error;
      // Only unavailable routes use the legacy polyline method; a temporary
      // 502 must remain a retryable error rather than silently switching data.
      return { samples: await getProfile(tx, rx, n), method: "polyline" };
    }
    return { samples: cacheMultipoint(tx, rx, n, data), method: "multipoint" };
  }

  function analyze(samples, txAgl, rxAgl, k) {
    const D = samples[samples.length - 1].d;
    if (D <= 0 || k <= 0) throw new Error("A positive path distance and Earth-radius factor are required.");
    const txH = samples[0].elev + txAgl, rxH = samples[samples.length - 1].elev + rxAgl;
    let minimum = Infinity, worst = null, requiredRx = 0, requiredTx = 0;
    const data = samples.map((s, i) => {
      const t = s.d / D;
      const bulge = s.d * (D - s.d) / (2 * k * R);
      const apparentTerrain = s.elev + bulge;
      const rayH = txH + t * (rxH - txH);
      const clearance = rayH - apparentTerrain;
      if (i > 0 && i < samples.length - 1) {
        if (clearance < minimum) { minimum = clearance; worst = { ...s, clearance }; }
        if (clearance < 0) {
          requiredRx = Math.max(requiredRx, -clearance / t);
          requiredTx = Math.max(requiredTx, -clearance / (1 - t));
        }
      }
      return { ...s, t, bulge, apparentTerrain, rayH, clearance };
    });
    if (!Number.isFinite(minimum)) minimum = Math.min(txAgl, rxAgl);
    return { data, minimum, worst, requiredRx, requiredTx, clear: minimum >= 0, distanceM: D, txH, rxH };
  }
  function svgNode(tag, attrs = {}, label = "") {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) e.setAttribute(key, String(value));
    if (label) e.textContent = label;
    return e;
  }
  function drawProfile(result) {
    const svg = $("terrainChart");
    svg.replaceChildren();
    const points = result.data, W = 900, H = 295, left = 66, right = 17, top = 22, bottom = 40;
    const minY = Math.min(...points.map(p => Math.min(p.apparentTerrain, p.rayH))) - 25;
    const maxY = Math.max(...points.map(p => Math.max(p.apparentTerrain, p.rayH))) + 25;
    const x = (p) => left + p.t * (W - left - right);
    const y = (m) => H - bottom - (m - minY) / (maxY - minY || 1) * (H - top - bottom);
    const txX = x(points[0]), farX = x(points[points.length - 1]), baseY = H - bottom;
    for (let i = 0; i <= 4; i++) {
      const h = minY + (maxY - minY) * i / 4, yy = y(h);
      svg.append(svgNode("line", { x1: left, y1: yy, x2: W - right, y2: yy, stroke: "#d9e1e5", "stroke-width": 1 }));
      svg.append(svgNode("text", { x: left - 7, y: yy + 4, "text-anchor": "end", fill: "#405464", "font-size": 11 }, fmt(h * FT, 0)));
    }
    for (let i = 0; i <= 4; i++) {
      const xx = left + (W - left - right) * i / 4;
      svg.append(svgNode("text", { x: xx, y: H - 13, "text-anchor": "middle", fill: "#405464", "font-size": 11 }, fmt(result.distanceM / MI * i / 4, 1) + " mi"));
    }
    const coords = points.map(p => x(p).toFixed(1) + "," + y(p.apparentTerrain).toFixed(1)).join(" ");
    svg.append(svgNode("polygon", { points: txX + "," + baseY + " " + coords + " " + farX + "," + baseY, fill: "#c2d4c3", opacity: ".85" }));
    svg.append(svgNode("polyline", { points: coords, fill: "none", stroke: "#477c57", "stroke-width": 2.1 }));
    svg.append(svgNode("line", { x1: txX, y1: y(result.txH), x2: farX, y2: y(result.rxH), stroke: result.clear ? "#1d5a8a" : "#b04538", "stroke-width": 2.5, "stroke-dasharray": "8 4" }));
    svg.append(svgNode("line", { x1: txX, y1: y(points[0].elev), x2: txX, y2: y(result.txH), stroke: "#1d5a8a", "stroke-width": 3 }));
    svg.append(svgNode("line", { x1: farX, y1: y(points[points.length - 1].elev), x2: farX, y2: y(result.rxH), stroke: "#1d5a8a", "stroke-width": 3 }));
    if (result.worst && result.worst.clearance < 0) {
      svg.append(svgNode("circle", { cx: x(result.worst), cy: y(result.worst.apparentTerrain), r: 5, fill: "#b04538", stroke: "white", "stroke-width": 1 }));
    }
    svg.append(svgNode("text", { x: 12, y: 14, fill: "#34495d", "font-size": 11 }, "Elevation (ft AMSL), terrain includes effective-Earth bulge"));
    svg.setAttribute("aria-label", "Terrain profile with elevation and radio line of sight");
  }
  async function fetchAndDisplayElevation() {
    const tx = point("terrainTxLat", "terrainTxLon");
    if (!validLatLon(tx)) return status("terrainElevationStatus", "Enter valid transmitter latitude and longitude.", true);
    status("terrainElevationStatus", "Retrieving ground elevation from USGS 3DEP…");
    $("loadElevation").disabled = true;
    const runId = ++analysisCounter;
    try {
      const elevationM = await queryElevation(tx);
      if (runId !== analysisCounter) return;
      lastTxElevation = { ...tx, elevationM };
      $("terrainGround").textContent = fmt(elevationM * FT) + " ft AMSL";
      updateAntennaDisplay();
      status("terrainElevationStatus", "USGS elevation loaded. This is an interpolated bare-earth estimate, not surveyed data.");
    } catch (error) {
      if (runId !== analysisCounter) return;
      lastTxElevation = null;
      $("terrainGround").textContent = "Unavailable";
      $("terrainAMSL").textContent = "—";
      status("terrainElevationStatus", "Elevation lookup failed: " + error.message, true);
    } finally { $("loadElevation").disabled = false; }
  }
  function updateAntennaDisplay() {
    const height = Number($("radCenter").value);
    if (lastTxElevation && Number.isFinite(height) && height >= 0)
      $("terrainAMSL").textContent = fmt(lastTxElevation.elevationM * FT + height) + " ft AMSL";
    else $("terrainAMSL").textContent = "—";
  }
  function invalidateTerrain() {
    stopTerrainRecovery("Inputs changed; recovery session cancelled.");
    currentProfile = null;
    window.dispatchEvent(new Event("towerPathCleared"));
    coverageSnapshot = null;
    window.dispatchEvent(new Event("towerCoverageCleared"));
    coverageRun++;
    $("analyzeCoverage").disabled = false;
    if (visibilityLayer) visibilityLayer.clearLayers();
    if (horizonCircle && map) { map.removeLayer(horizonCircle); horizonCircle = null; }
    ["terrainResult", "pathClearance", "requiredHeight", "terrainArea"].forEach(id => $(id).textContent = "—");
    $("terrainChart").replaceChildren();
    status("terrainPathStatus", "Inputs changed. Run a new path analysis.");
    status("terrainCoverageStatus", "Run the 360° analysis to update the map.");
    updateAntennaDisplay();
  }
  function updateTowerPosition(lat, lon) {
    $("terrainTxLat").value = Number(lat).toFixed(6);
    $("terrainTxLon").value = Number(lon).toFixed(6);
    lastTxElevation = null;
    $("terrainGround").textContent = "Not loaded";
    $("terrainAMSL").textContent = "—";
    invalidateTerrain();
    if (towerMarker && map) { towerMarker.setLatLng([lat, lon]); map.setView([lat, lon], 9); }
  }
  async function geocodeReceiver() {
    const address = $("terrainRxAddress").value.trim();
    if (address.length < 7) return status("terrainPathStatus", "Enter a complete U.S. street address, city, and state.", true);
    status("terrainPathStatus", "Geocoding address with the U.S. Census Bureau…");
    $("geocodeReceiver").disabled = true;
    try {
      const data = await withProxy("/terrain/geocode?" + new URLSearchParams({ address }), {},
        () => {
          if (!window.towerCensusGeocode)
            throw new Error("Address lookup is unavailable. Enter receiver coordinates manually.");
          return window.towerCensusGeocode(address);
        });
      const match = data.result?.addressMatches?.[0] || data;
      const coords = match.coordinates || { x: match.lon, y: match.lat };
      if (!Number.isFinite(Number(coords.x)) || !Number.isFinite(Number(coords.y))) throw new Error("No matching Census address was found.");
      setReceiver({ lat: Number(coords.y), lon: Number(coords.x) });
      status("terrainPathStatus", "Receiver located: " + (match.matchedAddress || address) + ". Click Analyze Path.");
    } catch (error) { status("terrainPathStatus", "Geocoding failed: " + error.message + ". Enter coordinates instead.", true); }
    finally { $("geocodeReceiver").disabled = false; }
  }
  function setReceiver(p) {
    $("terrainRxLat").value = p.lat.toFixed(6);
    $("terrainRxLon").value = p.lon.toFixed(6);
    invalidateTerrain();
    if (receiverMarker && map) receiverMarker.setLatLng([p.lat, p.lon]);
    else if (map) receiverMarker = window.L.marker([p.lat, p.lon]).addTo(map).bindPopup("Receiver — select another point by clicking the map");
  }
  // Confirm the two physical endpoints used in an individual link study.
  // USGS polyline sampling can omit the final requested point; using that
  // truncated profile as the remote antenna location would be misleading.
  // Point-to-point paths demand an explicitly verified elevation at EVERY
  // requested coordinate. The legacy USGS polyline service can omit interior
  // IDs near the receiver; adding its endpoint does not repair those gaps.
  // Reuse the 360-degree multipoint validator, which rejects missing samples.
  async function verifiedLinkProfile(tx, rx, count) {
    if (!Number.isInteger(count) || count < 2 || count > 120)
      throw new Error("Select a valid point-to-point sample count (2-120).");
    const verified = await getRadialProfile(tx, rx, count);
    if (verified.method !== "multipoint")
      throw new Error("Point-to-point analysis requires the terrain Worker's multipoint endpoint.");
    const samples = verified.samples, total = distance(tx, rx);
    if (!Array.isArray(samples) || samples.length !== count ||
        distance(samples[0], tx) > 1 ||
        distance(samples[samples.length - 1], rx) > 1 ||
        samples.some((p, i) => !validLatLon(p) ||
          !Number.isFinite(p.elev) || !Number.isFinite(p.d) ||
          (i > 0 && p.d <= samples[i - 1].d) ||
          Math.abs(p.d - total * i / (count - 1)) > 1))
      throw new Error("USGS did not verify every point-to-point terrain sample.");
    return { samples, repairedEndpoints: 0, sampleMethod: "multipoint" };
  }

  async function analyzeSelectedPath() {
    const tx = point("terrainTxLat", "terrainTxLon"), rx = point("terrainRxLat", "terrainRxLon");
    const txAgl = Number($("radCenter").value) / FT, rxAgl = Number($("receiverHeight").value) / FT;
    const k = Number($("terrainK").value);
    if (!validLatLon(tx) || !validLatLon(rx) || distance(tx, rx) < 100)
      return status("terrainPathStatus", "Provide valid, distinct transmitter and receiver coordinates (at least 100 m apart).", true);
    if (![txAgl, rxAgl].every(v => Number.isFinite(v) && v >= 0))
      return status("terrainPathStatus", "Enter valid nonnegative antenna and receiver heights in the main calculator.", true);
    $("analyzePath").disabled = true;
    currentProfile = null;
    window.dispatchEvent(new Event("towerPathCleared"));
    status("terrainPathStatus", "Sampling the USGS terrain profile…");
    const runId = ++analysisCounter;
    try {
      const verified = await verifiedLinkProfile(tx, rx, Number($("terrainSamples").value));
      const samples = verified.samples;
      if (runId !== analysisCounter) return;
      const result = {
        ...analyze(samples, txAgl, rxAgl, k),
        tx: { ...tx }, rx: { ...rx },
        txAglFt: txAgl * FT, rxAglFt: rxAgl * FT,
        k, samplesRequested: Number($("terrainSamples").value),
        endpointRepairs: verified.repairedEndpoints,
        sampleMethod: verified.sampleMethod,
        sampledAt: new Date().toISOString()
      };
      currentProfile = result;
      drawProfile(result);
      window.dispatchEvent(new Event("towerPathUpdated"));
      $("terrainResult").textContent = result.clear ? "TERRAIN CLEAR" : "OBSTRUCTED";
      $("terrainResult").className = result.clear ? "terrain-ok" : "terrain-blocked";
      $("pathClearance").textContent = fmt(result.minimum * FT) + " ft";
      $("requiredHeight").textContent = result.clear ? "No additional height required" :
        "+" + fmt(result.requiredRx * FT, 0) + " ft receiver / +" + fmt(result.requiredTx * FT, 0) + " ft transmitter";
      if (map) {
        map.fitBounds([[tx.lat, tx.lon], [rx.lat, rx.lon]], { padding: [35, 35], maxZoom: 11 });
        if (!receiverMarker) setReceiver(rx);
      }
      status("terrainPathStatus", fmt(result.distanceM / MI) + " mi path analyzed (" + samples.length +
        " verified USGS multipoint elevations, including both endpoints). Clearance is geometric only; terrain obstructions may lie between samples.");
    } catch (error) { status("terrainPathStatus", "Terrain analysis failed: " + error.message, true); }
    finally { $("analyzePath").disabled = false; }
  }
  function sampleAt(samples, meters) {
    if (!samples || !samples.length) return null;
    const end = samples[samples.length - 1];
    // Floating point roundoff can put the horizon-ring distance a fraction
    // of a meter beyond a valid last sample. This is NOT a terrain-data gap.
    if (meters > end.d + 0.5) return null;
    if (meters >= end.d) return end.elev;
    if (meters <= samples[0].d) return samples[0].elev;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].d >= meters) {
        const a = samples[i - 1], b = samples[i];
        return a.elev + (b.elev - a.elev) * (meters - a.d) / (b.d - a.d);
      }
    }
    return null;
  }
  function radialVisibility(samples, rings, maxMeters, txAgl, rxAgl, k) {
    const elevations = Array.from({ length: rings + 1 }, (_, i) => sampleAt(samples, maxMeters * i / rings));
    if (elevations.some(v => v === null || !Number.isFinite(v))) return null;
    const txH = elevations[0] + txAgl, visible = [true];
    for (let i = 1; i <= rings; i++) {
      const total = maxMeters * i / rings, rxH = elevations[i] + rxAgl;
      let clear = true;
      for (let j = 1; j < i; j++) {
        const mid = maxMeters * j / rings, t = mid / total;
        const bulge = mid * (total - mid) / (2 * k * R);
        if (txH + t * (rxH - txH) - elevations[j] - bulge < 0) { clear = false; break; }
      }
      visible.push(clear);
    }
    return visible;
  }
  // Two bounded automatic retries for transient HTTP failures and timeouts.
  // Retry delays are deliberately small but nonzero, and no new terrain
  // requests are scheduled once the current scan is invalidated.
  async function radialWithRetries(tx, rx, n, angle, runId, cacheOnly, onRetry) {
    const waits = [1500, 3500];
    for (let attempt = 0; attempt <= waits.length; attempt++) {
      if (runId !== coverageRun) throw new Error("Terrain scan was cancelled");
      try {
        return { ...(await getRadialProfile(tx, rx, n, cacheOnly)), attempts: attempt + 1 };
      } catch (error) {
        if (cacheOnly || !isTransientTerrainError(error) || attempt === waits.length)
          throw error;
        onRetry(attempt + 1, error);
        await new Promise(resolve => setTimeout(resolve,
          waits[attempt] + Math.round(Math.random() * 350)));
      }
    }
    throw new Error("Unable to recover terrain bearing " + angle);
  }

  async function analyzeCoverage(options = {}) {
    const cacheOnly = options.cacheOnly === true;
    const previousSnapshot = cacheOnly ? coverageSnapshot : null;
    if (!cacheOnly) stopTerrainRecovery("A new terrain scan has started.");
    const tx = point("terrainTxLat", "terrainTxLon");
    const txFt = Number($("radCenter").value), rxFt = Number($("receiverHeight").value), k = Number($("terrainK").value);
    if (!validLatLon(tx) || !Number.isFinite(txFt) || !Number.isFinite(rxFt) || txFt < 0 || rxFt < 0 || !Number.isFinite(k) || k <= 0)
      return status("terrainCoverageStatus", "Enter valid coordinates, antenna heights and an Earth-radius factor.", true);
    const bearings = Number($("terrainBearings").value), rings = 40, samplesPerBearing = 48;
    const chunks = 4, maxConcurrent = 3;
    if (!Number.isInteger(bearings) || bearings < 4 || bearings % chunks !== 0)
      return status("terrainCoverageStatus", "Choose a compass-bearing count divisible into four equal chunks.", true);
    const bearingsPerChunk = bearings / chunks;
    const endpoint = (hFeet) => Math.sqrt(2 * k * R * hFeet / FT);
    const radiusM = Math.min(120 * MI, endpoint(txFt) + endpoint(rxFt));
    if (!Number.isFinite(radiusM) || radiusM < 50)
      return status("terrainCoverageStatus", "Radio-horizon radius is too small for this sampling mode.", true);

    const runId = ++coverageRun;
    coverageSnapshot = null;
    window.dispatchEvent(new Event("towerCoverageCleared"));
    $("analyzeCoverage").disabled = true;
    if (visibilityLayer) visibilityLayer.clearLayers();
    $("terrainArea").textContent = "Calculating...";
    const rays = Array(bearings).fill(null);
    const radialProfiles = Array(bearings).fill(null);
    const radialMethods = Array(bearings).fill(null);
    const errors = [];
    let completed = 0, stoppedEarly = false, endpointsRecovered = 0;
    let multipointCount = 0, legacyCount = 0, retryCount = 0, cacheHitCount = 0;

    try {
      // Complete four sequential chunks. Within each chunk, fetch at most
      // three profiles at once to avoid flooding the USGS terrain service.
      for (let chunk = 0; chunk < chunks; chunk++) {
        if (runId !== coverageRun) return;
        const start = chunk * bearingsPerChunk;
        const end = start + bearingsPerChunk;
        status("terrainCoverageStatus", "Chunk " + (chunk + 1) + " / " + chunks +
          ": checking bearings " + (start + 1) + "–" + end + " of " + bearings + "…");
        for (let offset = start; offset < end; offset += maxConcurrent) {
          const tasks = Array.from({ length: Math.min(maxConcurrent, end - offset) }, (_, j) => {
            const index = offset + j;
            const angle = 360 * index / bearings;
            return (async () => {
              try {
                const rx = destination(tx, angle, radiusM);
                const key = "multipoint|" + profileKey(tx, rx, samplesPerBearing);
                const wasCached = profileCache.has(key) ||
                  profileCache.has(profileKey(tx, rx, samplesPerBearing));
                const radial = await radialWithRetries(tx, rx, samplesPerBearing,
                  angle, runId, cacheOnly, (attempt, error) => {
                    retryCount++;
                    if (runId === coverageRun) status("terrainCoverageStatus",
                      "Temporary USGS error at " + angle + "° (" +
                      (error.httpStatus ? "HTTP " + error.httpStatus : error.name) +
                      "). Automatic retry " + attempt + " of 2…");
                  });
                if (runId !== coverageRun) return;
                if (wasCached) cacheHitCount++;
                // During a recovery refresh, use only profiles already
                // verified in memory. Never issue new USGS/EPQS requests.
                const repaired = radial.method === "multipoint" || cacheOnly
                  ? { samples: radial.samples, recovered: false }
                  : await recoverRadialEndpoint(radial.samples, tx, rx, samplesPerBearing);
                if (runId !== coverageRun) return;
                const visibility = radialVisibility(repaired.samples, rings, radiusM, txFt / FT, rxFt / FT, k);
                if (!visibility) throw new Error("Missing valid elevation samples at distance rings");
                if (radial.method === "multipoint") multipointCount++;
                else legacyCount++;
                if (repaired.recovered) endpointsRecovered++;
                rays[index] = visibility;
                // Preserve verified DEM provenance across the 360-degree
                // scan snapshot. Elevation and clearance remain unchanged.
                // Do not conflate sampled raster resolution with spacing.
                radialProfiles[index] = repaired.samples.map(p => ({
                  lat: p.lat, lon: p.lon, distanceM: p.d, elevationM: p.elev,
                  rasterId: p.rasterId ?? null,
                  resolution: p.resolution ?? null,
                  sourceDetails: p.sourceDetails ?? null
                }));
                radialMethods[index] = radial.method;
              } catch (error) {
                if (runId !== coverageRun) return;
                const reason = error.name === "AbortError" ? "Worker request timed out" :
                  String(error.message || error);
                const original = cacheOnly
                  ? previousSnapshot?.radialData?.[index] : null;
                errors.push({
                  angle,
                  reason: original?.error || reason,
                  retryable: !cacheOnly && isTransientTerrainError(error),
                  httpStatus: error.httpStatus || null
                });
                console.warn("Terrain bearing " + angle + "° failed:", error);
              } finally {
                if (runId === coverageRun) completed++;
              }
            })();
          });
          await Promise.all(tasks);
          if (runId !== coverageRun) return;
          status("terrainCoverageStatus", "Chunk " + (chunk + 1) + " / " + chunks +
            ": " + completed + " / " + bearings + " bearings checked (" +
            errors.length + " failed; " + multipointCount +
            " multipoint, " + legacyCount + " legacy, " +
            endpointsRecovered + " endpoints recovered; " +
            cacheHitCount + " cached; " + retryCount + " automatic retries)");
        }
        // If every request in the first chunk fails, continuing with nine
        // more expensive requests cannot produce a complete area estimate.
        if (!cacheOnly && chunk === 0 &&
            rays.slice(0, bearingsPerChunk).every(ray => !ray)) {
          stoppedEarly = true;
          break;
        }
      }

      if (runId !== coverageRun) return;
      const missing = rays.filter(x => !x).length;
      let mappedArea = 0, unknownSectors = 0;
      const cells = [];
      // Use curved annular-sector edges for faithful KML/vector exports.
      const sectorVertices = (startDeg, endDeg, innerM, outerM) => {
        const angles = Array.from({ length: 7 }, (_, i) =>
          startDeg + (endDeg - startDeg) * i / 6);
        return [
          ...angles.map(angle => destination(tx, angle, outerM)),
          ...angles.reverse().map(angle => destination(tx, angle, innerM))
        ];
      };
      for (let b = 0; b < bearings; b++) {
        const nextB = (b + 1) % bearings, a0 = b * 360 / bearings, a1 = (b + 1) * 360 / bearings;
        // Both bounding radials must have valid terrain samples for a sector
        // to be classified. Otherwise shade it gray, never red or green.
        if (!rays[b] || !rays[nextB]) {
          unknownSectors++;
          for (let ring = 0; ring < rings; ring++) {
            cells.push({
              bearingStartDeg: a0, bearingEndDeg: a1, ringIndex: ring + 1,
              innerMeters: radiusM * ring / rings,
              outerMeters: radiusM * (ring + 1) / rings,
              status: "unknown", visibleFraction: null,
              vertices: sectorVertices(a0, a1, radiusM * ring / rings,
                radiusM * (ring + 1) / rings)
            });
          }
          if (visibilityLayer && map) {
            const outerArc = Array.from({ length: 7 }, (_, step) =>
              destination(tx, a0 + (a1 - a0) * step / 6, radiusM));
            const coords = [[tx.lat, tx.lon], ...outerArc.map(p => [p.lat, p.lon])];
            window.L.polygon(coords, {
              color: "#626b75", weight: 1, opacity: 0.75, dashArray: "4 4",
              fill: true, fillColor: "#626b75", fillOpacity: 0.54, interactive: false
            }).addTo(visibilityLayer);
          }
          continue;
        }
        for (let ring = 0; ring < rings; ring++) {
          const count = [rays[b][ring], rays[b][ring + 1], rays[nextB][ring], rays[nextB][ring + 1]].filter(Boolean).length;
          const inner = radiusM * ring / rings, outer = radiusM * (ring + 1) / rings;
          mappedArea += ((count / 4) * Math.PI * (outer * outer - inner * inner) / bearings);
          const classification = count >= 2 ? "terrain_clear" : "terrain_blocked";
          cells.push({
            bearingStartDeg: a0, bearingEndDeg: a1, ringIndex: ring + 1,
            innerMeters: inner, outerMeters: outer,
            status: classification, visibleFraction: count / 4,
            vertices: sectorVertices(a0, a1, inner, outer)
          });
          if (visibilityLayer && map) {
            const coords = [destination(tx, a0, inner), destination(tx, a0, outer),
              destination(tx, a1, outer), destination(tx, a1, inner)].map(p => [p.lat, p.lon]);
            window.L.polygon(coords, {
              stroke: false, fill: true, fillColor: count >= 2 ? "#126e42" : "#aa2d30",
              fillOpacity: count >= 2 ? 0.60 : 0.58, interactive: false
            }).addTo(visibilityLayer);
          }
        }
      }
      if (horizonCircle && map) horizonCircle.setLatLng([tx.lat, tx.lon]).setRadius(radiusM);
      else if (map) horizonCircle = window.L.circle([tx.lat, tx.lon], {
        radius: radiusM, color: "#184c83", weight: 2.5, fill: false, dashArray: "7 5"
      }).addTo(map);
      if (map) map.fitBounds(horizonCircle.getBounds(), { padding: [15, 15] });

      // Preserve complete/partial results for CSV, KML, and report exports.
      // The summary never treats unknown sectors as confirmed terrain clearance.
      coverageSnapshot = {
        generatedAt: new Date().toISOString(),
        tx, txHeightFt: txFt, rxHeightFt: rxFt, k,
        bearings, rings, samplesPerBearing, radiusM,
        complete: missing === 0, failedBearings: missing, unknownSectors,
        terrainVisibleAreaSqMi: missing === 0 ? mappedArea / (MI * MI) : null,
        radialData: rays.map((vis, i) => {
          const angle = 360 * i / bearings;
          const failure = errors.find(error => error.angle === angle);
          return {
            bearingDeg: angle,
            status: vis ? "complete" : "missing",
            queryMethod: radialMethods[i],
            samples: radialProfiles[i], visibility: vis,
            error: failure ? failure.reason : null,
            retryable: failure ? failure.retryable : false,
            httpStatus: failure ? failure.httpStatus : null
          };
        }),
        cells
      };
      window.dispatchEvent(new Event("towerCoverageUpdated"));

      if (missing) {
        $("terrainArea").textContent = "Incomplete";
        const examples = errors.slice(0, 2).map(e => e.angle + "°: " + e.reason).join("; ");
        const summary = stoppedEarly
          ? "Stopped after the first chunk: all " + bearingsPerChunk + " tested bearings failed. "
          : missing + " of " + bearings + " terrain bearings failed across 4 chunks. ";
        status("terrainCoverageStatus", summary +
          unknownSectors + " sectors are shaded gray because one or both boundary radials lack data. " +
          endpointsRecovered + " radial endpoints were recovered with USGS EPQS. " +
          "No reliable total area is reported. " +
          (legacyCount ? legacyCount + " successful radials used legacy polyline queries; " +
            "multipoint requires the staging Worker update. " : "") +
          (examples ? " First errors: " + examples : "") +
          (retryCount ? " Automatic retries attempted: " + retryCount + "." : ""), true);
        if (!cacheOnly && errors.some(error => error.retryable)) {
          $("terrainRecoveryOption").hidden = false;
          $("openTerrainRecovery").disabled = false;
          status("terrainRecoveryStatus",
            "Automatic retries finished. " + errors.filter(error => error.retryable).length +
            " temporary failures remain; open the optional five-minute recovery window.");
        }
      } else {
        $("terrainArea").textContent = fmt(mappedArea / (MI * MI), 0) + " mi²";
        status("terrainCoverageStatus", "Completed all 4 chunks: " + bearings + " bearings × " +
          samplesPerBearing + " terrain samples (plus " + endpointsRecovered +
          " verified endpoint repairs), " + rings + " distance rings. " +
          multipointCount + " multipoint / " + legacyCount + " legacy radial queries. Restricted to a smooth-Earth horizon (" +
          fmt(radiusM / MI) + " mi). Buildings, diffraction and field strength are not modeled." +
          (cacheHitCount ? " Cached profiles: " + cacheHitCount + "." : "") +
          (retryCount ? " Automatic retries: " + retryCount + "." : "") +
          (cacheOnly ? " Updated after the recovery window." : ""));
      }
    } catch (error) {
      if (runId === coverageRun)
        status("terrainCoverageStatus", "Coverage calculation stopped: " + (error.message || String(error)), true);
    } finally {
      if (runId === coverageRun) $("analyzeCoverage").disabled = false;
    }
  }
  // The recovery window never invents elevations and cannot write directly
  // to this document. Only validated messages from the specific child window
  // in the current scan can update the shared verified terrain cache.
  function stopTerrainRecovery(note = "") {
    const old = recoverySession;
    recoverySession = null;
    if (old?.popup && !old.popup.closed) {
      old.popup.postMessage({
        type: "tower-terrain-recovery-cancel", token: old.token
      }, window.location.origin);
    }
    $("terrainRecoveryOption").hidden = true;
    $("openTerrainRecovery").disabled = false;
    if (note) status("terrainRecoveryStatus", note);
  }

  function openTerrainRecovery() {
    const scan = coverageSnapshot;
    if (!scan || scan.complete || recoverySession) return;
    const failed = scan.radialData.filter(radial =>
      radial.status === "missing" && radial.retryable === true);
    if (!failed.length) {
      status("terrainRecoveryStatus", "No temporary errors are eligible for automatic recovery.");
      return;
    }
    const token = (window.crypto?.randomUUID?.() ||
      (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) +
        "-" + Math.random().toString(36).slice(2)));
    // This call must happen inside a user click. Browsers can block an
    // unsolicited popup; nothing is attempted if permission is denied.
    const popup = window.open("./recovery.html", "tower-recovery-" + token,
      "popup,width=640,height=720,resizable=yes,scrollbars=yes");
    if (!popup) {
      status("terrainRecoveryStatus", "Your browser blocked the recovery window. Allow pop-ups for this site, then click again.", true);
      return;
    }
    recoverySession = {
      token, popup, runId: coverageRun, tx: { ...scan.tx },
      samples: scan.samplesPerBearing,
      bearings: failed.map(radial => ({
        bearingDeg: radial.bearingDeg,
        rx: destination(scan.tx, radial.bearingDeg, scan.radiusM)
      })),
      accepted: new Set(),
      started: false
    };
    $("openTerrainRecovery").disabled = true;
    status("terrainRecoveryStatus", "Recovery window opened. Keep this calculator open while it retries " +
      failed.length + " temporarily failed bearing(s).");
    popup.focus();
  }

  function onTerrainRecoveryMessage(event) {
    const session = recoverySession;
    if (!session || event.origin !== window.location.origin ||
        event.source !== session.popup) return;
    if (session.runId !== coverageRun) {
      stopTerrainRecovery("The terrain inputs or scan changed. The previous recovery has been cancelled.");
      return;
    }
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "tower-terrain-recovery-ready") {
      if (session.started) return;
      session.started = true;
      session.popup.postMessage({
        type: "tower-terrain-recovery-start",
        token: session.token,
        workerUrl: TOWER_API,
        tx: session.tx, samples: session.samples,
        bearings: session.bearings,
        maxDurationMs: 5 * 60 * 1000
      }, event.origin);
      return;
    }
    if (data.token !== session.token) return;
    if (data.type === "tower-terrain-recovery-sample") {
      const bearing = session.bearings.find(item => item.bearingDeg === data.bearingDeg);
      if (!bearing || session.accepted.has(bearing.bearingDeg)) return;
      try {
        if (!validLatLon(data.tx) || !validLatLon(data.rx) ||
            distance(data.tx, session.tx) > 1 ||
            distance(data.rx, bearing.rx) > 1)
          throw new Error("Unexpected coordinates in recovered terrain");
        cacheMultipoint(session.tx, bearing.rx, session.samples, data.samples);
        session.accepted.add(bearing.bearingDeg);
        status("terrainRecoveryStatus",
          "Recovery window verified " + session.accepted.size + " of " +
          session.bearings.length + " previously failed bearings.");
      } catch (error) {
        console.warn("Rejected invalid popup recovery data", error);
        status("terrainRecoveryStatus",
          "A recovery response was rejected because its terrain data could not be verified.", true);
      }
    } else if (data.type === "tower-terrain-recovery-finished") {
      const accepted = session.accepted.size;
      recoverySession = null;
      $("openTerrainRecovery").disabled = false;
      $("terrainRecoveryOption").hidden = true;
      if (accepted) {
        // Recompute using only cached, validated profiles. This path must
        // never make fresh calls to USGS or re-trigger automatic retries.
        analyzeCoverage({ cacheOnly: true }).catch(error =>
          status("terrainCoverageStatus",
            "Recovery data loaded but map refresh failed: " + error.message, true));
      } else {
        const reason = data.reason === "timeout" ? "The five-minute recovery period expired" :
          data.reason === "partial" ? "USGS returned non-retryable missing terrain" :
          data.reason === "stopped" ? "Recovery was stopped" :
          "The recovery window finished";
        status("terrainCoverageStatus", reason +
          " without verified new terrain data. Gray unknown sectors remain. " +
          "You may run a new analysis later.", true);
      }
    }
  }

  function initializeMap() {
    if (!window.L) {
      $("terrainMap").textContent = "Map tiles unavailable. Enter receiver coordinates manually. Terrain analysis remains available.";
      return;
    }
    const tx = point("terrainTxLat", "terrainTxLon"), rx = point("terrainRxLat", "terrainRxLon");
    map = window.L.map("terrainMap", { scrollWheelZoom: false }).setView([tx.lat, tx.lon], 9);
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, crossOrigin: "anonymous",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).addTo(map);
    visibilityLayer = window.L.layerGroup().addTo(map);
    towerMarker = window.L.marker([tx.lat, tx.lon]).addTo(map).bindPopup("Transmitter");
    receiverMarker = window.L.marker([rx.lat, rx.lon]).addTo(map).bindPopup("Receiver");
    map.on("click", e => {
      setReceiver({ lat: e.latlng.lat, lon: e.latlng.lng });
      status("terrainPathStatus", "Receiver selected on the map. Click Analyze Path.");
    });
  }
  function wire() {
    $("loadElevation").addEventListener("click", fetchAndDisplayElevation);
    $("useTerrainElevation").addEventListener("click", () => {
      if (!lastTxElevation) return status("terrainElevationStatus", "Load a USGS ground elevation first.", true);
      $("baseElevation").value = String(Number((lastTxElevation.elevationM * FT).toFixed(2)));
      $("baseElevation").dispatchEvent(new Event("input", { bubbles: true }));
      status("terrainElevationStatus", "USGS elevation copied into the original base-elevation field.");
    });
    $("geocodeReceiver").addEventListener("click", geocodeReceiver);
    $("analyzePath").addEventListener("click", analyzeSelectedPath);
    $("analyzeCoverage").addEventListener("click", () => analyzeCoverage());
    $("openTerrainRecovery").addEventListener("click", openTerrainRecovery);
    window.addEventListener("message", onTerrainRecoveryMessage);
    window.addEventListener("pagehide", () => stopTerrainRecovery("Page closed."));
    $("terrainBasemap").addEventListener("change", () => {
      $("terrainMap").classList.toggle("terrain-map-muted", $("terrainBasemap").value === "muted");
    });
    // Mirror receiver height between the original calculator and terrain panel.
    const terrainHeight = $("terrainReceiverHeight");
    const mainHeight = $("receiverHeight");
    terrainHeight.value = mainHeight.value;
    terrainHeight.addEventListener("input", () => {
      mainHeight.value = terrainHeight.value;
      mainHeight.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mainHeight.addEventListener("input", () => {
      terrainHeight.value = mainHeight.value;
    });
    $("radCenter").addEventListener("input", invalidateTerrain);
    $("towerHeight").addEventListener("input", invalidateTerrain);
    $("receiverHeight").addEventListener("input", invalidateTerrain);
    ["terrainRxLat", "terrainRxLon", "terrainTxLat", "terrainTxLon", "terrainK", "terrainBearings"].forEach(id =>
      $(id).addEventListener("change", () => {
        if (id === "terrainTxLat" || id === "terrainTxLon") {
          lastTxElevation = null;
          $("terrainGround").textContent = "Not loaded";
          updateAntennaDisplay();
          const p = point("terrainTxLat", "terrainTxLon");
          if (validLatLon(p) && towerMarker) towerMarker.setLatLng([p.lat, p.lon]);
        }
        invalidateTerrain();
      })
    );
    $("location").addEventListener("change", () => {
      const match = $("location").value.match(/^\s*([+-]?\d{1,2}(?:\.\d+)?)\s*,\s*([+-]?\d{1,3}(?:\.\d+)?)\s*$/);
      if (match) {
        const p = { lat: Number(match[1]), lon: Number(match[2]) };
        if (validLatLon(p)) updateTowerPosition(p.lat, p.lon);
      }
    });
    window.addEventListener("towerCoordinatesLoaded", (e) => {
      if (validLatLon(e.detail)) {
        updateTowerPosition(e.detail.lat, e.detail.lon);
        fetchAndDisplayElevation();
      }
    });
    initializeMap();
    window.TowerHorizonData = Object.freeze({
      getMap: () => map,
      getCoverage: () => coverageSnapshot,
      getProfile: () => currentProfile,
      getTerrainApi: () => TOWER_API
    });
    updateAntennaDisplay();
  }
  wire();
})();
