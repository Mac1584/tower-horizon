# SOP-THC-002 — Cloudflare Setup & Deployment
**Tower Horizon Calculator v2.0 — USGS Terrain Integration**

| Control | Value |
|---|---|
| Document | SOP-THC-002 |
| Revision | 1.0 — October 20, 2026 |
| Application | Tower Horizon Calculator 2.0 |
| Environment | GitHub Pages frontend + Cloudflare Worker backend |
| Existing production Worker | `tower-data-api` |
| Existing Worker URL | `https://tower-data-api.mac1584.workers.dev` |
| Feature branch | `feature/terrain-v2-usgs` |
| Status | **BETA — Worker not yet integrated or deployed** |
| Objective | Add USGS ground elevation, terrain profiles, and 360-degree coarse terrain-visibility calculations without breaking existing FCC lookups |

> **Release safeguard:** Do not merge the pull request or deploy to the production Worker until staging tests and an explicit production review are complete. The GitHub repository does **not** currently include the original source code or full configuration of the deployed FCC Worker. The extension is an integration module, not a complete replacement Worker.

## A. System overview

![System architecture: GitHub Pages, Cloudflare Worker, FCC, USGS and Census](diagrams/architecture.svg)

- **GitHub Pages** serves `index.html`, `script.js`, `terrain.js`, and CSS. Frontend map tiles use Leaflet and OpenStreetMap.
- **Cloudflare Worker** keeps the existing `GET /tower?asrn=...` FCC lookup and adds three terrain/geocoding routes.
- **USGS EPQS** supplies ground elevation at a coordinate.
- **USGS 3DEP elevation image service** supplies many elevations along a transmitter-to-receiver route.
- **Census Geocoder** optionally resolves a full U.S. street address into receiver coordinates.
- **Browser** calculates path clearance, additional height, a sampled terrain profile, and a coarse sector/ring viewshed.

### Endpoint contract

| Method | Route | Request | Expected result |
|---|---|---|---|
| GET | `/tower?asrn=1004233` | FCC ASRN | Existing tower record; must remain unchanged |
| GET | `/terrain/elevation?lat=42.29&lon=-71.23` | Latitude, longitude | JSON: `{"elevationMeters":...,"source":"USGS EPQS"}` |
| POST | `/terrain/profile` | JSON with `tx`, `rx`, `samples` | JSON with `samples` array |
| GET | `/terrain/geocode?address=...` | URL-encoded U.S. address | Census geocoder's `result.addressMatches` |
| OPTIONS | `/terrain/*` | CORS preflight | Successful response with CORS headers |

Source for the additional routes: [`worker-terrain-extension.js`](../worker-terrain-extension.js).

## B. Prerequisites and preservation

**Prepare these items on the Windows computer you use for development:**

- Access to your existing Cloudflare account and the `tower-data-api` Worker in **Workers & Pages**.
- Git and a copy of `Mac1584/tower-horizon` (preferably in VS Code).
- Node.js (an actively supported release) and npm; PowerShell is fine.
- Ability to authenticate Wrangler with your Cloudflare account.
- A copy of the *deployed* Worker's original entry point, Wrangler configuration, resource bindings, deployment settings, and any required secrets (store secrets securely, not in Git).

**Before editing anything:**

1. In Cloudflare, open **Workers & Pages → tower-data-api**. Record its current deployment version, routes/domains, bindings, compatibility settings, and relevant secrets *names* (not their values).
2. Run the existing production lookup to establish a baseline: open `https://tower-data-api.mac1584.workers.dev/tower?asrn=1004233`. Save the response in your notes.
3. Verify that the existing calculator is live at `https://mac1584.github.io/tower-horizon/` and record its current version.
4. Keep the GitHub `main` branch and the live Worker unchanged. Work on `feature/terrain-v2-usgs` and in a local/staging Worker first.
5. Do **not** paste the extension as a standalone replacement for the existing Worker. That would lose the current FCC endpoint.

## C. Recover the original Cloudflare Worker locally

If you already have the actual `tower-data-api` development folder on your computer, use that folder. Otherwise use Cloudflare's existing-Worker import workflow:

```powershell
node --version
npm --version
npx wrangler --version
npx wrangler login
npx wrangler init --from-dash tower-data-api
```

The `--from-dash` command fetches a dashboard-created Worker into a local project. Check the resulting folder and do not assume it is a complete, automatically synchronized backup. Confirm its entry point, dependencies, bindings, triggers, routes, environment configuration, and existing response before using it. If the import is incompatible with the original project or the Worker was developed elsewhere, stop and recover its authoritative source instead.

**Recommended local folder arrangement:**

```text
Web-Creations/
  tower-horizon/                  # GitHub Pages / calculator frontend
    index.html
    script.js
    terrain.js
    worker-terrain-extension.js   # source to copy into Worker project
    docs/
  tower-data-api/                 # existing Worker source, recovered separately
    wrangler.jsonc               # or existing wrangler.toml
    src/
      index.js                   # actual filename may differ
      worker-terrain-extension.js
```

The existing Worker and the GitHub Pages frontend are two different deployments. The repository copy of `worker-terrain-extension.js` is **not active** just because it appears in GitHub.

## D. Add the terrain module to the Worker

1. Open your **actual Worker source folder** in VS Code.
2. Copy `tower-horizon/worker-terrain-extension.js` alongside the Worker's existing entry file. Update the import path to reflect the actual folder structure.
3. Preserve the entire existing `/tower` implementation and other routes.
4. If the Worker already uses the ES-module format (`export default { async fetch(request, env, ctx) { ... } }`), add the terrain dispatch *inside its current fetch handler, before the existing router*:

```javascript
import { handleTerrainRequest } from "./worker-terrain-extension.js";

// The following two lines belong at the START of the existing fetch handler:
// const terrainResponse = await handleTerrainRequest(request);
// if (terrainResponse) return terrainResponse;
//
// Keep your existing FCC /tower and other route-handling code below them.
```

A structural example (not a complete replacement file):

```javascript
import { handleTerrainRequest } from "./worker-terrain-extension.js";

export default {
  async fetch(request, env, ctx) {
    const terrainResponse = await handleTerrainRequest(request);
    if (terrainResponse) return terrainResponse;

    // KEEP ALL EXISTING PRODUCTION ROUTES HERE, INCLUDING /tower.
    return existingRouter(request, env, ctx); // illustration only
  }
};
```

**Important:** `existingRouter` is a placeholder—not a function included in this project. Insert the two dispatch lines into your existing handler, rather than copying the example wholesale. If your current Worker uses the older Service Worker `addEventListener("fetch", ...)` syntax, do not use the ES-module snippet directly; migrate carefully or adapt the handler to the current design first.

5. Keep your existing `wrangler.toml` or `wrangler.jsonc` settings. For **new** simple Worker projects, Cloudflare currently recommends `wrangler.jsonc`; don't arbitrarily replace an established configuration.
6. The sample terrain module requires no USGS or Census API key. It still depends on Cloudflare outbound HTTP access, public service availability, and compatible CORS behavior.

## E. Local test — before any deployment

From the local **Worker** folder:

```powershell
npx wrangler dev
```

Wrangler prints a local URL, normally `http://localhost:8787`. In a second PowerShell window:

```powershell
$api = "http://localhost:8787"

# 1. Original FCC lookup must still work
Invoke-RestMethod -Uri "$api/tower?asrn=1004233"

# 2. New USGS point elevation
Invoke-RestMethod -Uri "$api/terrain/elevation?lat=42.29&lon=-71.23"

# 3. Terrain samples between Needham and a Boston-area test point
$body = @{
  tx = @{ lat = 42.29; lon = -71.23 }
  rx = @{ lat = 42.3601; lon = -71.0589 }
  samples = 48
} | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post -Uri "$api/terrain/profile" -ContentType "application/json" -Body $body

# 4. Address lookup (use a genuine full U.S. postal address)
Invoke-RestMethod -Uri "$api/terrain/geocode?address=24%20Beacon%20St%2C%20Boston%2C%20MA"
```

Check **all** of the following before proceeding:

- The FCC endpoint still returns a valid record.
- The elevation endpoint returns a finite `elevationMeters` value, not a 404 or `null`.
- The profile endpoint returns multiple ordered geographic elevation samples, including both endpoints, with no unexplained gaps.
- Geocoding returns a matched address and coordinates, or a meaningful message when the address cannot be resolved.
- A browser on your GitHub Pages origin can call the Worker with correct CORS headers; verify both actual GET/POST responses and the OPTIONS preflight for POST.
- Invalid coordinates, unsupported paths, upstream failures, and excessive sample counts return controlled errors.
- Check Worker's console logs for unexpected errors.

**Stop condition:** If `/tower` fails after integration, restore your original local source before deploying.

## F. Deploy a separate staging Worker

Do not initially deploy to the name `tower-data-api`. First use a separate staging service and **do not copy production secrets into Git**.

1. Create a staging Wrangler configuration (example below) inside the recovered Worker project. Substitute the *real* path to its entry point and preserve any required test bindings:

```json
{
  "name": "tower-data-api-terrain-staging",
  "main": "./src/index.js",
  "compatibility_date": "2026-10-20",
  "workers_dev": true
}
```

Save it as `wrangler.terrain-staging.jsonc`. If the existing Worker depends on KV, D1, R2, variables, or other bindings, add appropriate **staging** resources to this file. Do not assume the above minimal example preserves production behavior.

2. Deploy the staging configuration:

```powershell
npx wrangler deploy --config wrangler.terrain-staging.jsonc
```

3. Use the actual staging URL shown by Wrangler, which should have the staging Worker name and your account's workers.dev subdomain.
4. Repeat the four endpoint tests from **Section E**, replacing the `$api` value with that staging URL.
5. Test the frontend against staging **without changing the public production site**. Temporarily set `TOWER_API` in a local copy of `terrain.js` to the staging URL; `WORKER_URL` in `script.js` controls the existing FCC lookup separately. Use a local HTTP server to serve the preview, for example:

```powershell
cd path\to\tower-horizon
python -m http.server 8000
```

6. Open `http://localhost:8000/` and exercise all three terrain features. Keep this staging-only URL change out of production commits unless intentionally configured.

> If the Worker requires specific account bindings or only exists in dashboard-managed source, confirm those before trusting staging. `wrangler deploy` changes a live Worker named by its configuration; always inspect the `name` field first.

## G. Frontend acceptance test

![Illustrative terrain profile with a blocked line of sight](diagrams/terrain-profile.svg)

**Elevation / AMSL**
1. Load the Needham example using `42.2900, -71.2300`.
2. Select **Load USGS Elevation**; a ground elevation appears in feet AMSL.
3. Compare `ground elevation + radiation center AGL` with the displayed antenna AMSL.
4. Select **Copy to Base Elevation** and verify the original radiation AMSL display changes correctly.
5. Enter another valid coordinate and confirm the old elevation is not reused.

**Path visibility**
1. Use transmitter `42.29, -71.23`.
2. Use receiver `42.3601, -71.0589` or select a point on the map.
3. Select `k = 4/3`, 72 samples, and **Analyze Selected Path**.
4. Confirm the terrain cross-section appears with a modeled radio path; verify min clearance and obstruction/clear status.
5. Re-run with `k = 1` and compare results, then change receiver height and confirm the result is recomputed.
6. Repeat on hilly terrain. Compare at least one profile independently before trusting the numbers.

**360-degree visibility**
1. Select 12 bearings and **Calculate Terrain-Visible Area**, then try 24.
2. Confirm the map uses sector/ring shading and a blue dashed theoretical horizon.
3. Review the area estimate for plausibility; changing receiver height should affect results.
4. If one or more USGS bearings fail, the UI must display **Incomplete** and not a seemingly precise area.
5. Test mobile sizing and display state after interrupted/failed requests.

![Schematic radial terrain-visibility coverage map](diagrams/coverage-map.svg)

These two illustrations are schematic, not validated output from USGS, and are intentionally not service or propagation contours.

## H. Production release and rollback

**Release only after the existing FCC route, all three new routes, CORS, map interaction, numerical methods and service reliability pass acceptance testing.**

1. Confirm your production Worker's source and configuration are backed up in a source repository.
2. Record the current active Worker deployment in Cloudflare **Workers & Pages → tower-data-api → Deployments** (names may vary).
3. Review changes, confirm `wrangler` points to **the intended production Worker**, and deploy only after approval:

```powershell
npx wrangler deploy
```

4. Smoke-test `/tower`, `/terrain/elevation`, `/terrain/profile`, and geocoding on the production Worker.
5. Only then merge the approved GitHub frontend pull request to `main` so GitHub Pages serves Version 2.0.
6. Monitor logs and external request volume. A 24-bearing visibility calculation can generate dozens of terrain-service requests; public USGS access and Cloudflare usage limits can constrain reliability.

**Rollback sequence:**
- If the Worker causes issues, use **Workers & Pages → tower-data-api → Deployments → Rollback** (Cloudflare also documents `npx wrangler rollback`).
- If the frontend causes issues, revert the GitHub Pages merge to the prior working commit and verify Version 1.9 is restored.
- Retest `/tower?asrn=1004233` and the original horizon calculations.
- Record the incident, affected deployment IDs, and corrective actions.

## I. Known limitations & design precautions

- USGS 3DEP primarily represents bare-earth topography; it does **not** prove reception or model buildings, vegetation, frequency, antenna pattern, power, multipath, interference, Fresnel zone clearance, or diffraction.
- The automatic radiation-center estimate is tower top minus roughly 8 meters, not necessarily the licensed RF radiation center; manual actual AGL inputs are preferred.
- Use `k=4/3` for a conventional standard-refraction approximation or `k=1` for no refraction. Neither predicts actual moment-to-moment atmospheric conditions.
- The path model examines discrete terrain samples and can miss intervening obstacles. The 360-degree viewshed is intentionally coarse with 12/24/36 bearings and 40 rings.
- The visibility-area estimate approximates sampled terrain-visible area, **not** population, viewer households, a regulatory contour, or an FCC-certified service area.
- For this beta, the frontend may try direct USGS/Census requests if the new Worker routes are absent; these can fail due to CORS or provider/network policy. Do not mistake fallback attempts for successful Cloudflare integration.
- Public GET/POST terrain endpoints need abuse controls, origin policies and reasonable traffic monitoring before wide release. The extension currently uses permissive `Access-Control-Allow-Origin: *` and does not have rate limiting.
- Terrain service availability, sample resolution, vertical datum, and estimated accuracy should be recorded or exposed when upgrading beyond beta.
- This implementation has been code-reviewed at a basic level, **not** independently field-validated or confirmed in the deployed Worker.

## J. Troubleshooting quick reference

| Symptom | Likely cause | Action |
|---|---|---|
| `/terrain/elevation` returns 404 | Extension not deployed or import missing | Check Worker `fetch` dispatch order and deployment |
| `/tower` returns 404 after update | Original route removed/overridden | Restore original handler and retest |
| Browser CORS error | Worker headers/preflight mismatch | Inspect browser Network tab and OPTIONS response |
| `/terrain/profile` returns 502 | USGS error, timeout, invalid response | Reduce samples, inspect Worker logs and USGS status |
| Chart stays empty | Missing/invalid samples, JS runtime error | Check console, response shape and endpoint sampling |
| Viewshed shows **Incomplete** | One or more radial requests failed | Retry smaller run, inspect rate limits and remote errors |
| Worker deployed but site unchanged | Only backend deployed | Review GitHub branch / Pages deployment and caching |
| Unexpected high request volume | Radial sampling fans out | Limit test traffic; add caching, quotas and rate controls |

## K. Official references

- [Cloudflare Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
- [Cloudflare Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Worker rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [USGS EPQS documentation](https://epqs.nationalmap.gov/v1/docs)
- [USGS 3DEP ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer)
- [Census Geocoding Service](https://geocoding.geo.census.gov/geocoder/)
- [GitHub feature branch / draft pull request](https://github.com/Mac1584/tower-horizon/pull/1)

**Change record:** Rev 1.0 — Initial SOP for Cloudflare + USGS terrain beta; no production deployment performed as part of this documentation.
