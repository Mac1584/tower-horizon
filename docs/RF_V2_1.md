# Tower Horizon v2.1 candidate

Build: **2.1.0-beta.1**. Preset revision: **2026-11-21.1**.

This candidate adds a bidirectional free-space RF reference to the existing
geometric/radio horizon and USGS terrain tools. It is not a coverage predictor.
The production Worker, D1 database, DNS, and existing 360-degree export contracts
are unchanged. GitHub Pages still serves static files; npm is for tests only.

## User workflow

1. Choose a starting equipment preset, or edit frequency and equipment manually.
2. For a quick RF estimate, enter a positive distance in miles. No terrain service
   is required. A standalone RF PDF includes both directions and assumptions.
3. For a geographic link, analyze the selected terrain path. A successful analysis
   automatically selects its distance for RF. Site A is the origin/TX location in
   the existing terrain form; Site B is its receiving location. Both can transmit.
4. Expand equipment to edit conducted output power, TX gain, TX passive loss, RX
   gain, and RX passive loss independently at each site. Optionally use a separate
   reverse frequency. The combined two-page PDF contains the existing terrain/map
   page and an RF page with both budgets and the exact on-screen assumptions.
5. An edit invalidates a pending export. Changing path inputs also clears terrain
   results immediately and prevents an older network response restoring them.

An analyzed but obstructed path remains **OBSTRUCTED**. The RF number alongside
it is only a free-space reference; no made-up terrain loss is applied.

## Model and reference plane

- Transmitter output: `10 log10(watts) + 30` dBm.
- Free-space loss: `20 log10(4 pi distance_m frequency_Hz / 299792458)` dB.
- A-to-B: `P_A + G_A_TX - L_A_TX - FSPL(f_AB,d) + G_B_RX - L_B_RX` dBm.
- B-to-A independently uses Site B's transmitter, Site A's receiver, and f_BA.
- Receiver input is after passive receive losses, before active gain or frequency
  conversion. EIRP is transmitter output plus TX gain minus TX passive loss.
- Gains use dBi. Output power must be conducted power, not ERP or EIRP.
- The height-only horizon uses `sqrt(2 k R h_A) + sqrt(2 k R h_B)`, R=6,371,000 m.
  Frequency does not change that height-only horizon.

[ITU-R P.525-5](https://www.itu.int/rec/R-REC-P.525/) is the free-space reference.
The free-space formula assumes far-field propagation. The model does not check
antenna dimensions or near-field distance. It excludes diffraction, reflection,
Fresnel obstruction, rain, gaseous absorption, foliage, buildings, interference,
receiver thresholds, and fade margin. It does not assign link quality or maximum
usable range. Even a geometrically clear path is not a reliability guarantee.

## Starting defaults

These are editable planning examples, not measured averages, verified equipment,
authorized operating frequencies, or licensing guidance. Both endpoints start
with the same values. TX/RX gain and TX/RX passive loss start equal at each site.

| Preset | MHz | Output W | Each gain dBi | Each passive loss dB |
|---|---:|---:|---:|---:|
| 2 GHz ENG dish-to-dish (default) | 2050 | 7 | 20 | 1 |
| 6.5 GHz ENG dish-to-dish | 6475 | 1 | 30 | 1 |
| 7 GHz ENG dish-to-dish | 7000 | 1 | 30 | 1 |
| Aircraft VHF installed | 127 | 10 | 0 | 2 |
| Marine VHF fixed mount | 156.8 | 25 | 0 | 2 |
| Land mobile VHF | 155 | 25 | 0 | 2 |
| Land mobile UHF | 460 | 25 | 0 | 2 |
| Public safety 700 MHz mobile | 770 | 30 | 0 | 2 |
| Public safety 800 MHz mobile | 855 | 35 | 0 | 2 |
| GMRS handheld | 462.6 | 5 | 0 | 0 |

The ENG power starting points are supported by the
[Vislink LiveStream datasheet](https://www.vislink.com/wp-content/uploads/2025/01/LiveStream-Datasheet-12-24.pdf):
7 W typical for 2.0–2.5 GHz and 1 W typical for 6.4–7.1 GHz. Dish gains are
representative assumptions; actual diameter, efficiency, band, and alignment
matter. Non-ENG gains of 0 dBi are deliberately neutral placeholders, not claims
about installed antenna gain. All loss figures are design allowances, not
measurements. Other power and frequency entries are illustrative starting
configurations from the development plan, not universal equipment specifications.

## Marine paths and temperature

The optional environment labels are Unspecified, Land, Freshwater, Saltwater, and
Mixed land/water. They are recorded in the screen/PDF snapshot but add no RF loss.
There is no universal water penalty: surface reflection can add or cancel energy,
and atmospheric ducts need more information than a single air temperature.

[ITU-R P.453](https://www.itu.int/rec/R-REC-P.453/en) relates radio refractivity to
temperature, pressure, and water vapour and describes vertical profile behaviour.
This candidate does not infer a refractivity gradient from surface temperature.
The terrain k selector and height-only horizon comparison expose 2/3, 1, 4/3, and
2 as explicit sensitivity assumptions. They are not forecasts or evaporation-duct
models. A selected k changes geometric Earth curvature only after terrain is
reanalyzed; it does not add a dB adjustment to the RF budget. Horizon comparison
heights are AGL as used by the terrain calculator, not a marine tidal datum.

Later work may include weather profiles, antenna heights above water, tides,
polarization, surface roughness, reflection models, and P.530 statistical fading.
The feedback/results form remains scheduled for v2.3. Field measurements are
not yet available, so field validation remains outstanding.

## Verification and deployment

Local verification: all existing `tests/check-*.mjs` plus RF mathematical cases
and DOM integration checks. `npm ci --ignore-scripts`, then `npm run test:rf`.
The DOM tests simulate external DEM acquisition, map rasterization, and PDF
capture; they test actual form events, terrain analysis/invalidation, snapshot
identity, stale-export cancellation, and one-/two-page PDF orchestration. They do
not substitute for real browser layout or live-service testing.

Deployment sequence:

1. Save the candidate on `feature/rf-v2.1` and open a draft PR against `main`.
2. Require all CI checks to pass. Review the diff, presets, assumptions, and PDFs.
3. Preview the branch in an isolated static host or local checkout. The existing
   terrain staging branch/host belongs to other work; do not overwrite it.
4. Complete desktop/mobile and keyboard QA, live FCC/DEM checks, and visual PDF
   review with unequal endpoint settings, blocked terrain, and manual distance.
5. Merge the accepted release into `main`; GitHub Pages publishes the static
   frontend. No Cloudflare Worker, DB, or DNS deployment is required for v2.1.
6. Smoke-test the live site, verify version and both PDF workflows, then monitor
   errors. If necessary revert the release commit through a PR and let Pages
   republish the prior frontend. Do not roll back the Worker or terrain data.

This candidate is not a production release. Visual browser QA and field
validation must be reported separately from numerical and simulated checks.
