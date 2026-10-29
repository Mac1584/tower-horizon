# Tower Horizon 2.0 — USGS source DEM provenance

**Release state: deployed to staging and production, October 29, 2026.** See the [production release record](PRODUCTION_RELEASE_2026-10-29.md). The workflow and staging acceptance notes below are retained as release history.

## What the reports identify

Three different measures must never be conflated:

1. **USGS sampled DEM resolution**, directly reported as `resolution` by the 3DEP ImageServer `getSamples` response (the service uses a meter-based Web Mercator coordinate system). This may vary across points or rasters.
2. **USGS source/project**, via the returned `rasterId`, optionally `Name`, `ProductName`, `Source`, `AcquisitionDate` and `title` fields, and the read-only ImageServer raster catalog. `DEM_Type` is a *coded category*, not a resolution or proof that a product is lidar.
3. **Our calculator's sample separation**, determined by requested elevations and evaluated path length (e.g., 9.04 miles / 71 intervals for 72 point-to-point elevations; 48 points along a 51.9-mile radial at approximately 1.10 miles between samples).

Reporting a high-resolution 1-meter DEM **does not make a 1.10-mile radial sampling interval equivalent to a 1-meter terrain profile.** No terrain values are filled by interpolating unverified missing USGS points.

### Evidence from the user's live USGS response

The existing production `POST /terrain/profile` response (from a request initiated at the actual Needham FCC coordinates) included an elevation sample with `value=44.861087799` meters, `rasterId=88413`, and `resolution=1`. The user's read-only catalog query for `objectIds=88413` returned `Name=MA_CentralEastern_2021_B21`, `ProductName=USGS_3DEP`, `Source=USGS`, `DEM_Type=1`, and empty `Resolution_X`/`Resolution_Y`. That confirms the named source for **one sample only**, not automatically for all 72 or 1,728 points.

Source references:
- [ArcGIS REST Get Samples](https://developers.arcgis.com/rest/services-reference/enterprise/get-samples/): sample `value`, `resolution`, `rasterId`, `attributes`; optional `outFields`.
- [USGS 3DEP ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer): multi-resolution DEM service, field schema and raster catalog.
- [USGS ImageServer Get Samples interface](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples)

## Code changes

| Layer | Repository file | Change |
|---|---|---|
| Existing terrain sampling | `cloudflare/staging-multipoint-handler.js` | Ask `getSamples` for a small list of source attributes; preserve `rasterId`, `resolution` and sanitized source details for each matched elevation. Unknown source metadata remains null; missing elevation stays unknown. |
| Optional catalog proxy | `handleTerrainCatalog` in worker code | Read-only `GET /terrain/catalog?ids=88413,88414`; validates 1–24 numeric IDs, requests a limited field set from USGS ImageServer's `/query`, and returns source records. No D1 involvement. |
| Standalone staging Worker | `cloudflare/staging-worker-v2-provenance.js` | Complete nondeployed staging Worker candidate, preserving elevation, profile, multipoint and geocode endpoints. **Not for the production FCC Worker.** |
| Production FCC-compatible Worker | `cloudflare/production-worker-v2-candidate.js` | Separately prepared nondeployed upgrade for the existing `tower-data-api`, retaining `env.DB`, FCC response contract, and rollback path. |
| Website cache and models | `terrain.js` | Carry optional metadata through verified multipoint samples; do not affect clearance computation. |
| Source aggregation | `terrain-sources.js` | Count resolutions and distinct raster sources, deduplicate names, optional bounded batched catalog lookup, memoization and failure fallback. |
| Reports | `export.js`, `path-report.js` | Add USGS DEM resolution and source-project summary; show calculator sample spacing separately. Retain one-page US Letter output. |

All changes have been committed to development/staging branches. **The Cloudflare Pages staging website deploys automatically; Cloudflare Workers do not deploy from this repository.**

## Step 1 — Test on EXISTING staging Worker first

1. Back up and record the active version of `tower-terrain-staging` in Cloudflare. Confirm you are **not** editing `tower-data-api`.
2. Open [staging Worker full source](../cloudflare/staging-worker-v2-provenance.js), choose **Raw**, copy its entire contents.
3. In **Workers & Pages → tower-terrain-staging → Edit code**, replace the staging Worker code with this **complete standalone staging** source. Deploy to staging only.
4. Verify that the original `GET /terrain/elevation`, `POST /terrain/profile` and `POST /terrain/multipoint` continue to respond.
5. Verify sample provenance and the optional catalog endpoint with the PowerShell example below.

```powershell
$api = "https://tower-terrain-staging.mac1584.workers.dev"
$body = @{
  tx = @{ lat = 42.30297222; lon = -71.21802778 }
  rx = @{ lat = 42.3601; lon = -71.0589 }
  samples = 48
} | ConvertTo-Json -Depth 4
$mp = Invoke-RestMethod -Uri "$api/terrain/multipoint" -Method Post -ContentType "application/json" -Body $body
$mp | Select-Object sampleMethod, requestedCount, returnedCount, complete
$mp.samples | Select-Object -First 3 index, value, rasterId, resolution, sourceDetails

$ids = @($mp.samples | Where-Object { $_.rasterId } | ForEach-Object { $_.rasterId } | Select-Object -Unique)
if ($ids.Count -gt 0) {
  $idsQuery = ($ids | Select-Object -First 24) -join ","
  $catalog = Invoke-RestMethod -Uri "$api/terrain/catalog?ids=$idsQuery"
  $catalog.records | Format-List
}
```

Expected: 48 valid samples, optional numeric raster/resolution values, project names from `sourceDetails` or catalog when available. An unavailable catalog must **not** fail the terrain analysis.

## Step 2 — Browser and PDF acceptance

After updating staging Worker, refresh [the staging website](https://tower-horizon-v2-staging.pages.dev/) with Ctrl+Shift+R. Run point-to-point Needham-to-Boston with 72 points and verify the one-page PDF's source metadata, sampling interval, one 30-degree orientation sector, and values. Run a 12-bearing scan and verify the one-page 360 PDF's source metadata, map center and area. Only if these pass should we consider a repeat 24/36 scan.

Source fields can legitimately be absent for particular rasters. Show "Not reported" rather than guessing a dataset or changing any geometric result.

## Step 3 — Separate production approval and rollback

The **currently deployed** production FCC-compatible Worker is `d01a0284-f058-47f2-97d2-e222023f7399`; original rollback `e9e5d798-1b9f-459b-a910-36090a0aeceb`. Do not replace production from the staging Worker file. Once staging is validated, deploy the separately prepared `cloudflare/production-worker-v2-candidate.js` through an explicitly approved production rollout with live FCC lookup regression tests. Record a new rollback deployment before merging PR #1.

No database schema changes or writes are involved. The new catalog lookup uses USGS publicly available raster metadata only.

## Remaining limitations

- USGS returns sampled raster resolution, not a certified vertical error bound or on-demand point-cloud point spacing.
- Multiple raster resolutions and source projects can occur along one line or across one 360 study.
- Acquisition date may be missing even when a project name includes a year. Never present a name-embedded year as a verified survey date without corroboration.
- Optional catalog lookups are limited to the most common 48 unresolved raster IDs; other sources may remain unnamed and are not hidden from counts.
- Report text truncates long project lists to preserve a single PDF page; full raster breakdown remains in the client source model for potential later exports.
