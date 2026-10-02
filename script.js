"use strict";

// No network calls: this prototype intentionally keeps all calculations local.
const SAMPLE = Object.freeze({ asrn: "1004233", tower: 366, base: 46, offset: 8 });
const $ = (id) => document.getElementById(id);
const form = $("calculator");
const number = (value, digits = 1) => value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });

function calculateHorizon(towerM, offsetM, baseM, receiverFt) {
  if (![towerM, offsetM, baseM, receiverFt].every(Number.isFinite) || towerM < 0 || offsetM < 0 || offsetM > towerM || receiverFt < 0) {
    throw new RangeError("Enter finite heights; the top offset must not exceed the tower height.");
  }
  const agl = towerM - offsetM;
  const heightSum = Math.sqrt(agl) + Math.sqrt(receiverFt * 0.3048);
  const geometricKm = Math.sqrt(2 * 6371 / 1000) * heightSum;
  const radioKm = geometricKm * Math.sqrt(4 / 3);
  return { agl, amsl: baseM + agl, geometricKm, radioKm, areaKm2: Math.PI * radioKm ** 2 };
}

function syncFields() {
  const manual = $("mode").value === "manual";
  const coords = $("location-type").value === "coords";
  $("asrn-fields").hidden = manual;
  $("manual-fields").hidden = !manual;
  $("zip-fields").hidden = coords;
  $("coords-fields").hidden = !coords;
  $("zip").disabled = !manual || coords;
  $("latitude").disabled = $("longitude").disabled = !manual || !coords;
  $("asrn").disabled = manual;
}

function clearResults(message) {
  for (const id of ["radio", "geometric", "area", "agl", "amsl"]) $(id).textContent = "—";
  $("radio-km").textContent = "Calculate with valid inputs to see results";
  $("context").textContent = "Results pending";
  $("svg-tx").textContent = "Height pending";
  $("svg-rx").textContent = "Height pending";
  $("status").textContent = message;
}

function calculate() {
  $("offset").setCustomValidity("");
  const tower = $("tower").valueAsNumber;
  const offset = $("offset").valueAsNumber;
  if (offset > tower) $("offset").setCustomValidity("The radiation-center offset cannot exceed the tower height.");
  if (!form.checkValidity()) { clearResults("Check the highlighted input fields."); form.reportValidity(); return; }
  const manual = $("mode").value === "manual";
  if (!manual && $("asrn").value.trim() !== SAMPLE.asrn) {
    clearResults("Only ASRN 1004233 is built in. Choose Manual entry for another tower; live ASRN lookup is not connected."); return;
  }
  const lat = $("latitude").value, lon = $("longitude").value;
  if (manual && $("location-type").value === "coords" && Boolean(lat) !== Boolean(lon)) {
    clearResults("Enter both latitude and longitude, or leave both blank."); return;
  }
  const rx = $("receiver").valueAsNumber;
  const result = calculateHorizon(tower, offset, $("base").valueAsNumber, rx);
  $("radio").textContent = `${number(result.radioKm / 1.609344)} miles`;
  $("radio-km").textContent = `${number(result.radioKm)} km · transmitter + receiver horizons`;
  $("geometric").textContent = `${number(result.geometricKm / 1.609344)} mi / ${number(result.geometricKm)} km`;
  $("area").textContent = `${number(result.areaKm2 / 2.589988110336, 0)} mi² / ${number(result.areaKm2, 0)} km²`;
  $("agl").textContent = `${number(result.agl)} m / ${number(result.agl / 0.3048)} ft`;
  $("amsl").textContent = `${number(result.amsl)} m / ${number(result.amsl / 0.3048)} ft`;
  $("svg-tx").textContent = `${number(result.agl)} m AGL`;
  $("svg-rx").textContent = `${number(rx)} ft AGL`;
  const location = $("location-type").value === "zip" ? $("zip").value.trim() : (lat && lon ? `${lat}, ${lon}` : "");
  $("context").textContent = manual ? `Manual inputs${location ? " · " + location : " · no location supplied"}` : "ASRN 1004233 · editable Needham sample";
  $("status").textContent = "Calculated from the heights shown. No external data was fetched.";
}

form.addEventListener("submit", (event) => { event.preventDefault(); calculate(); });
form.addEventListener("input", () => { $("offset").setCustomValidity(""); clearResults("Inputs changed. Select Calculate horizon to update."); });
for (const id of ["mode", "location-type"]) $(id).addEventListener("change", () => { syncFields(); clearResults("Input method changed. Review the heights and calculate."); });
$("load").addEventListener("click", () => {
  if ($("asrn").value.trim() !== SAMPLE.asrn) { clearResults("Only ASRN 1004233 is built in. Use Manual entry for other towers."); return; }
  for (const id of ["tower", "base", "offset"]) $(id).value = SAMPLE[id];
  calculate();
});
syncFields();
calculate();
