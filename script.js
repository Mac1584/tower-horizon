"use strict";

// BEGINNER GUIDE: IDs below match the id="..." attributes in index.html.
// Keep this file beside index.html and style.css. It runs after the HTML loads.
const WORKER_URL = "https://tower-data-api.mac1584.workers.dev";
const FEET_TO_METERS = 0.3048;
const METERS_PER_MILE = 1609.344;
const EARTH_RADIUS_METERS = 6371000;
const ANTENNA_SETBACK_FEET = 26.2467; // 8 meters below the tower top.
const byId = (id) => document.getElementById(id);
const towerHeight = byId("towerHeight");
const radCenter = byId("radCenter");
const receiverHeight = byId("receiverHeight");
const baseElevation = byId("baseElevation");
const lookupButton = byId("asrnLookup");
const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

// Once you type your own radiation center, changing tower height preserves it.
// An explicit new lookup replaces the tower inputs and returns to automatic mode.
let radiationCenterEdited = false;

function readNumber(input) {
  // Number("") is zero, so handle blank inputs explicitly instead.
  if (input.value.trim() === "") return null;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : null;
}

function estimateRadiationCenter() {
  const height = readNumber(towerHeight);
  radCenter.value = height !== null && height >= 0
    ? String(Math.round(Math.max(0, height - ANTENNA_SETBACK_FEET) * 10000) / 10000)
    : "";
}

function setText(id, text) { byId(id).textContent = text; }
function format(value) { return numberFormat.format(value); }

function horizonMiles(transmitterFeet, receiverFeet, k) {
  // Each endpoint contributes its own horizon. k=4/3 models standard refraction.
  const endpoint = (feet) => Math.sqrt(2 * k * EARTH_RADIUS_METERS * feet * FEET_TO_METERS);
  return (endpoint(transmitterFeet) + endpoint(receiverFeet)) / METERS_PER_MILE;
}

function update() {
  const height = readNumber(towerHeight);
  const transmitter = readNumber(radCenter);
  const receiver = readNumber(receiverHeight);
  const elevation = readNumber(baseElevation);
  const invalidHeights = [height, transmitter, receiver].some((n) => n === null || n < 0);
  const invalidElevation = baseElevation.value.trim() !== "" && elevation === null;

  setText("radHelp", radiationCenterEdited
    ? "Manual radiation center: your value is preserved when tower height changes."
    : "Automatic estimate: tower top minus 8 m (26.2467 ft), with a minimum of 0 ft. A lookup may supply its own rounded estimate.");
  setText("diagramTx", transmitter === null || transmitter < 0 ? "Radiation center: —" : `Radiation center: ${format(transmitter)} ft AGL`);
  setText("diagramRx", receiver === null || receiver < 0 ? "Height: —" : `${format(receiver)} ft AGL`);

  if (invalidHeights || invalidElevation) {
    setText("inputStatus", "Enter nonnegative tower, radiation-center, and receiver heights. Base elevation may be blank or any finite number.");
    byId("inputStatus").classList.add("error");
    ["radioHorizon", "radioKm", "geometricHorizon", "geometricKm", "theoreticalArea", "radiationAMSL", "diagramDistance"].forEach((id) => setText(id, "—"));
    setText("amslNote", "Complete the valid height inputs first");
    return;
  }

  byId("inputStatus").classList.remove("error");
  setText("inputStatus", transmitter > height
    ? "Check your inputs: radiation center is above the registered tower top. The estimate uses your entered value."
    : "");
  const radio = horizonMiles(transmitter, receiver, 4 / 3);
  const geometric = horizonMiles(transmitter, receiver, 1);
  const area = Math.PI * radio * radio;
  if (![radio, geometric, area, elevation === null ? 0 : elevation + transmitter].every(Number.isFinite)) {
    setText("inputStatus", "These inputs are too large to calculate. Enter realistic heights.");
    byId("inputStatus").classList.add("error");
    ["radioHorizon", "radioKm", "geometricHorizon", "geometricKm", "theoreticalArea", "radiationAMSL", "diagramDistance"].forEach((id) => setText(id, "—"));
    setText("amslNote", "Enter realistic heights");
    return;
  }
  setText("radioHorizon", `${format(radio)} mi`);
  setText("radioKm", `${format(radio * 1.609344)} km · k = 4/3`);
  setText("geometricHorizon", `${format(geometric)} mi`);
  setText("geometricKm", `${format(geometric * 1.609344)} km · k = 1`);
  setText("theoreticalArea", `${format(area)} mi²`);
  setText("radiationAMSL", elevation === null ? "Unknown" : `${format(elevation + transmitter)} ft`);
  setText("amslNote", elevation === null ? "Enter base elevation to calculate" : "Base elevation + radiation center AGL");
  setText("diagramDistance", `${format(radio)} mi`);
}

function lookupStatus(message, isError = false) {
  setText("lookupStatus", message);
  byId("lookupStatus").classList.toggle("error", isError);
}

async function lookupTower(event) {
  event.preventDefault(); // Do not reload the page when the form is submitted.
  const asrn = byId("asrn").value.trim();
  if (!/^\d{7}$/.test(asrn)) {
    lookupStatus("Enter a seven-digit FCC ASRN, such as 1004233.", true);
    return;
  }
  lookupButton.disabled = true;
  lookupButton.textContent = "Looking up…";
  lookupStatus("Requesting tower data…");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    // This is the only external request. No API key is required in these files.
    const response = await fetch(`${WORKER_URL}/tower?asrn=${encodeURIComponent(asrn)}`, {
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || `Lookup failed (HTTP ${response.status}).`);

    // API fields: location, towerHeightFeet, estimatedRadiationCenterFeet,
    // baseElevationFeet, receiverHeightFeet, siteName, warning, source, coordinates.
    // Validate before changing any inputs; an error preserves your current work.
    const apiNumber = (value) => {
      if (value === null || value === undefined || value === "") return null;
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? number : null;
    };
    const height = apiNumber(data.towerHeightFeet);
    if (height === null) throw new Error("The API did not return a valid towerHeightFeet field.");
    const radiation = apiNumber(data.estimatedRadiationCenterFeet);
    const receiver = apiNumber(data.receiverHeightFeet);
    const coordinates = Number.isFinite(data.latitude) && Number.isFinite(data.longitude)
      ? `${data.latitude}, ${data.longitude}` : "";

    byId("location").value = typeof data.location === "string" ? data.location : coordinates;
    towerHeight.value = String(height);
    radiationCenterEdited = false;
    radCenter.value = String(radiation ?? Math.max(0, height - ANTENNA_SETBACK_FEET));
    receiverHeight.value = String(receiver ?? 6);
    // Elevation can be negative. Missing elevation clears the previous site's value.
    const elevation = data.baseElevationFeet;
    const hasElevation = elevation !== null && elevation !== undefined && elevation !== ""
      && Number.isFinite(Number(elevation));
    baseElevation.value = hasElevation ? String(Number(elevation)) : "";
    const notes = [data.siteName, data.source, data.warning].filter((value) => typeof value === "string" && value.trim());
    lookupStatus(`ASRN ${asrn} loaded. ${notes.join(" ")} ${hasElevation ? "Base elevation loaded from the FCC record." : "Base elevation is unknown; enter it manually."}`);
    update();
  } catch (error) {
    const message = error.name === "AbortError"
      ? "The tower API timed out. Try again or continue with manual inputs."
      : `Could not retrieve this tower: ${error.message} You can continue with manual inputs.`;
    lookupStatus(message, true);
  } finally {
    clearTimeout(timeout);
    lookupButton.disabled = false;
    lookupButton.textContent = "Look Up FCC";
  }
}

// Listen for typing so results update immediately, with no Calculate button.
towerHeight.addEventListener("input", () => {
  if (!radiationCenterEdited) estimateRadiationCenter();
  update();
});
radCenter.addEventListener("input", () => { radiationCenterEdited = true; update(); });
receiverHeight.addEventListener("input", update);
baseElevation.addEventListener("input", update);
byId("resetRadCenter").addEventListener("click", () => {
  radiationCenterEdited = false;
  estimateRadiationCenter();
  update();
});
byId("towerForm").addEventListener("submit", lookupTower);
update(); // Populate results using the initial illustrative heights.
