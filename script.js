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
    setLocationStatus(coordinates ? "FCC coordinates loaded from ASRN. Verify on the map before using for path analysis." :
      "FCC record loaded without usable coordinates; enter a location manually.");
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
    if (Number.isFinite(Number(data.latitude)) && Number.isFinite(Number(data.longitude)) && data.latitude !== null && data.longitude !== null) {
      window.dispatchEvent(new CustomEvent("towerCoordinatesLoaded", {detail:{lat:Number(data.latitude),lon:Number(data.longitude)}}));
    }
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

// Resolve an entered transmitter location without modifying the FCC tower data.
// The Census service does not offer browser CORS; its published JSONP interface
// allows a single U.S. street-address lookup without a new Cloudflare route.
function setLocationStatus(message, error = false) {
  const el = byId("locationStatus");
  el.textContent = message;
  el.classList.toggle("error", error);
}

function censusAddressJSONP(address) {
  return new Promise((resolve, reject) => {
    const name = "towerCensus_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    let finished = false;
    const finish = (err, data) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      script.remove();
      delete window[name];
      if (err) reject(err); else resolve(data);
    };
    window[name] = data => finish(null, data);
    const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
    url.search = new URLSearchParams({
      address, benchmark: "Public_AR_Current",
      format: "jsonp", callback: name
    }).toString();
    script.src = url.toString();
    script.onerror = () => finish(new Error("Census geocoder could not be reached."));
    const timer = setTimeout(() => finish(new Error("Census geocoder timed out.")), 15000);
    document.head.append(script);
  });
}

async function locateTransmitter() {
  const raw = byId("location").value.trim();
  const button = byId("locateInput");
  if (!raw) return setLocationStatus("Enter coordinates, a full U.S. street address or a ZIP code.", true);
  let geo, description;
  button.disabled = true;
  button.textContent = "Locating…";
  setLocationStatus("Resolving transmitter location…");
  try {
    const m = raw.match(/^\s*([+-]?\d{1,2}(?:\.\d+)?)\s*,\s*([+-]?\d{1,3}(?:\.\d+)?)\s*$/);
    if (m) {
      geo = { lat: Number(m[1]), lon: Number(m[2]) };
      description = "Coordinates used exactly as supplied.";
    } else if (/^\d{5}(?:-\d{4})?$/.test(raw)) {
      const response = await fetch("https://api.zippopotam.us/us/" + raw.slice(0, 5));
      if (!response.ok) throw new Error("ZIP code not found. Enter coordinates instead.");
      const data = await response.json();
      const place = data.places?.[0];
      geo = { lat: Number(place?.latitude), lon: Number(place?.longitude) };
      description = "ZIP code geographic center (approximate, NOT a tower-site coordinate).";
    } else {
      if (!/^\d+\s+\S+/.test(raw))
        throw new Error("For street addresses, include the street number, street name, city and state.");
      const data = await censusAddressJSONP(raw);
      const result = data?.result?.addressMatches?.[0];
      if (!result) throw new Error("Census could not locate that address. Enter a complete U.S. address or coordinates.");
      geo = { lat: Number(result.coordinates?.y), lon: Number(result.coordinates?.x) };
      description = "Approximate Census address match: " + (result.matchedAddress || raw) + ".";
    }
    if (!Number.isFinite(geo?.lat) || !Number.isFinite(geo?.lon) ||
      Math.abs(geo.lat) > 90 || Math.abs(geo.lon) > 180)
      throw new Error("The location service returned invalid coordinates.");
    window.dispatchEvent(new CustomEvent("towerCoordinatesLoaded", { detail: geo }));
    setLocationStatus(description + " TX: " + geo.lat.toFixed(6) + ", " + geo.lon.toFixed(6) +
      ". Review the map and run USGS elevation when ready.");
  } catch (error) {
    setLocationStatus(error.message || "Unable to resolve location. Try coordinates.", true);
  } finally {
    button.disabled = false;
    button.textContent = "Locate";
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
byId("locateInput").addEventListener("click", locateTransmitter);
byId("location").addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); locateTransmitter(); }
});
update(); // Populate results using the initial illustrative heights.
