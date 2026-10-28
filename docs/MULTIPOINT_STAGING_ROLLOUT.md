# USGS 3DEP multipoint sampling: staging rollout

**Scope:** Tower Horizon Calculator 2.0 `feature/terrain-v2-usgs`.  
**Worker:** `tower-terrain-staging` ONLY. Do **not** modify `tower-data-api` or publish `main` as part of this test.

## Why

The 360-degree scan formerly submitted a polyline and asked USGS to choose approximately 48 points. The multipoint API takes exactly 48 supplied geographic positions, including the start and end of each radial. USGS may still return no elevation at some locations. Missing values remain `null` and the corresponding map sectors stay gray.

The browser retains the existing four sequential chunks and 12 / 24 / 36 bearing modes. Each radial is **one USGS getSamples multipoint query** for 48 positions; no extra point queries are made by the multipoint handler. The original receiver-to-transmitter analysis continues using the proven `/terrain/profile` polyline route.

Official ArcGIS getSamples documentation: https://developers.arcgis.com/rest/services-reference/enterprise/get-samples/

## A. Install the new route without disturbing existing routes

1. Back up the complete current source from the **Cloudflare dashboard > Workers & Pages > tower-terrain-staging > Edit Code**.
2. Locate the beginning of the existing `async fetch(request)` function and the line:
   ```js
   const url = new URL(request.url);
   ```
3. Immediately **after** that line, insert:
   ```js
   if (url.pathname === "/terrain/multipoint") {
     return handleTerrainMultipoint(request);
   }
   ```
4. Open [staging-multipoint-handler.js](../cloudflare/staging-multipoint-handler.js). Copy its entire contents.
5. Paste the handler **below the closing `};` of the existing Worker**. Do not replace the existing Worker. The helper is self-contained and does not change the existing routes.
6. Save and deploy **tower-terrain-staging** only.

If your fetch handler uses a different structure, insert the route before the general 404 fallback. Leave existing OPTIONS/CORS handling in place.

## B. Confirm the staged API in PowerShell

```powershell
$body = @{
  tx = @{ lat = 42.2900; lon = -71.2300 }
  rx = @{ lat = 42.3601; lon = -71.0589 }
  samples = 48
} | ConvertTo-Json -Depth 4

$result = Invoke-RestMethod -Method Post `
  -Uri "https://tower-terrain-staging.mac1584.workers.dev/terrain/multipoint" `
  -ContentType "application/json" -Body $body

$result | Select-Object sampleMethod, requestedCount, returnedCount, complete
$result.missingIndices
```

**Expected schema** (values may differ with live USGS availability):

- `sampleMethod`: `multipoint`
- `requestedCount`: `48`
- `returnedCount`: between 0 and 48
- `missingIndices`: indexes of points where USGS supplied no valid elevation
- `samples`: 48 entries, in requested point order, with `value: null` for any missing elevations

A result with `complete:false` and nonempty `missingIndices` means the endpoint is working but USGS lacks elevations at those positions.

## C. Update and test the local site

The GitHub development branch contains the new browser code; locally, preserve the staging URL change to `terrain.js`:

```powershell
cd "$HOME\Web-Creations\tower-horizon"
git stash push -m "Local staging configuration" -- terrain.js
git pull --ff-only origin feature/terrain-v2-usgs
git stash pop
```

If any Git conflict appears, stop. Check that `terrain.js` still uses the staging Worker, not production. Refresh `http://localhost:8000` using Ctrl+Shift+R. Select `12 (fastest)` and run the 360-degree scan.

The progress/result text distinguishes successful **multipoint** radials from **legacy** polyline fallback radials. A 404/405 from an uninstalled multipoint route automatically falls back to the old staging profile route. Other server errors are reported as errors, not masked by fallback.

Do **not** merge the development branch or deploy the production Worker until the Needham-to-Boston path, the 12-bearing coverage scan, error handling, and gray-data display are verified.

## D. Technical validation

The new handler:
- Generates 48 great-circle points, preserving exact transmitter and receiver coordinates.
- Calls USGS `ImageServer/getSamples` once with `geometryType=esriGeometryMultipoint`; it does **not** supply a polyline `sampleCount` parameter.
- Matches returned samples by coordinates rather than response order or `locationId`.
- Converts EPSG:3857 (Web Mercator) sample locations when necessary.
- Retains missing samples as `null` at their exact indexes.
- Rejects invalid coordinates and uses an upstream 30-second timeout.
- Keeps the existing Cloudflare single-Worker architecture.

A local mocked-response test checked all 48 returned points, shuffled response ordering, Web Mercator coordinate conversion, and preservation of a missing point. **The live Cloudflare/USGS integration still needs testing after staging deployment.**
