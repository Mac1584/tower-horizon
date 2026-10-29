# Tower Horizon 2.0 - Staging release candidate

**Status:** GitHub-staged candidate; **not yet production-ready**. Date: 2026-10-29.

## Environments and safety boundaries

| Purpose | Branch / URL | Terrain API | FCC ASRN API |
|---|---|---|---|
| Current production v1.9 | `main`; `https://mac1584.github.io/tower-horizon/` | Existing v1.9 behavior | `https://tower-data-api.mac1584.workers.dev` |
| v2 implementation / draft PR #1 | `feature/terrain-v2-usgs` | Source currently points to the production Worker for the future merge; do not deploy to production yet | Existing production FCC Worker |
| **Dedicated staging candidate** | `staging/terrain-v2` | **`https://tower-terrain-staging.mac1584.workers.dev`** | Existing production FCC Worker |
| Optional hosted browser test | A Git-integrated **Cloudflare Pages** staging project | Same staging terrain Worker | Existing production FCC Worker |

**Never merge PR #1 into `main` until production terrain routes are installed and verified.** Do not overwrite, delete, or repurpose the existing FCC `/tower` route or its D1 binding. The existing Cloudflare staging Worker remains the **only** terrain staging Worker; no additional Worker is needed.

## Two primary use cases

1. **360-degree site terrain visibility:** from a single location, sample 12, 24 or 36 bearings, each with 48 USGS 3DEP multipoint elevations, and 40 distance rings. Show terrain-clear, blocked, and unknown regions. This is a terrain-only preliminary visibility estimate, not a broadcast field-strength contour or FCC coverage calculation. Download 360 CSV, KML, JPEG, map PDF, and one-page visibility report.
2. **Two-way point-to-point geometric clearance:** evaluate a specified A-to-B link with individually entered heights, report total distance, forward/reverse true bearings, terrain/antenna heights, minimum clearance and endpoint height options, show a direct elevation cross-section, and generate a separate **one-page Letter-size Point-to-Point PDF**. Its map contains a single 30-degree **orientation sector** centered on the tested A-to-B path; **only the centerline was measured**, not the entire sector. A reciprocal geometric line of sight does **not** establish an RF duplex link budget.

No new external terrain providers or backend services were added for the point-to-point report.

## Automated source check

Use Node 18+ in the repository root:

```powershell
node tests/check-static.mjs --staging
```

The check validates local script syntax, linked assets, report controls, point-to-point event wiring and the staging Worker endpoint. This is **not** a substitute for a real-browser functional test.

## Stage a static site with Cloudflare Pages

Cloudflare supports GitHub-connected static Pages projects and explicit branch selection. For the staging frontend only, the recommended setup is:

1. In Cloudflare **Workers & Pages**, select **Create application > Pages > Import an existing Git repository** (dashboard labels may vary).
2. Authorize/select `Mac1584/tower-horizon`. Create a **separate Pages project** named something like `tower-horizon-v2-staging`. This is a static website project, **not an extra Worker**.
3. Select `staging/terrain-v2` as this Pages project's **production branch** (it is *only* production within this independent staging Pages project).
4. Framework: **None / no framework**. Build command: `exit 0` (or leave blank if the dashboard accepts it). Build output directory: **`.`** (repository root). Root directory: repository root.
5. Deploy and test the generated `pages.dev` URL. Do **not** point the existing GitHub Pages production domain at this project.
6. Confirm the browser's Network tab calls `tower-terrain-staging.mac1584.workers.dev/terrain/multipoint` for terrain radials and `tower-data-api.mac1584.workers.dev` for FCC ASRN lookup. The staging origin must be allowed by the Workers' CORS policy.

Official Cloudflare guidance:
- https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/
- https://developers.cloudflare.com/pages/configuration/branch-build-controls/
- https://developers.cloudflare.com/pages/framework-guides/deploy-anything/

## Real-browser release acceptance checks

- Location-first, address/ZIP/coordinates, compact ASRN lookup, and station elevation lookup.
- 360-degree 12-bearing scan with 12 multipoint / 0 legacy results, 0 unknown sectors; CSV/KML exports.
- 24-bearing scan, caching, 40 rings and gray/unknown handling if any bearing fails.
- Map JPEG/PDF with visibly darkened green/red/gray regions and blue horizon overlay.
- One-page **360 report** with coverage results and accurate map on US Letter.
- Point-to-point **Analyze Selected Path**, then **Download Two-way Link PDF**. Verify map shows **only one 30-degree sector**, the actual TX-RX centerline, endpoints A/B, and no 360 coverage polygons; check that measured profile and numbers agree with the UI.
- Confirm the point-to-point button is disabled before a successful path analysis and reset if any relevant inputs change.
- For transient USGS HTTP 502 errors: two automatic retries; optional user-clicked five-minute retry window; stop when successful/expired; results return to original map without a fresh full scan.
- An invalid/missing elevation sample never becomes a green terrain-clear sector. When a 360 scan is incomplete, no reliable overall visible-area total is reported.
- PDF printed on one 8.5 x 11 inch page; map/attribution/engineering cautions legible.
- Verify browser console free of unexpected script errors at Cloudflare Pages staging origin.

**Hosted staging acceptance (Oct 29, 2026):** Cloudflare Pages `tower-horizon-v2-staging.pages.dev` loaded correctly; FCC ASRN lookup, tower-population of fields and USGS elevation lookup all passed; the user also confirmed a successful 12-bearing 360-degree analysis and successful PDF exports. The dedicated point-to-point report was generated in the hosted browser and inspected as a one-page (612 x 792 pt) US Letter PDF with A/B coordinates, a single 30-degree orientation sector, true bearings, terrain profile, and obstruction/clearance metrics. Remaining release gates include 24/36-bearing stress tests, a live failure/recovery test, and production Worker compatibility/rollback verification.

## Later: production Cloudflare integration (DO NOT do now)

The current production FCC Worker is `tower-data-api.mac1584.workers.dev`. Before merging the feature PR to `main`, add and test the three terrain endpoints **within that existing production Worker**: `/terrain/elevation`, `/terrain/profile`, `/terrain/multipoint`. Preserve the FCC `/tower` route and database bindings.

**Suggested controlled sequence**:

1. Save a backup of the entire production FCC Worker source, environment/bindings and current deployment/version. Preserve a rollback path.
2. Prepare an additive combined Worker with the unchanged `/tower` handler and staging-validated terrain handlers. Validate via a Cloudflare Worker **Version URL** before deploying the existing production route, if available in your dashboard.
3. Verify FCC ASRN lookup and every terrain route with known coordinates, HTTP OPTIONS/CORS from both GitHub Pages and Pages origins, 404/405 behavior, timeouts and partial-sample responses.
4. Deploy a new version to the **existing** FCC Worker with a rollback plan; test from a browser. Avoid redirecting `/tower` to a different service.
5. Confirm `feature/terrain-v2-usgs` points to the production API and run a final diff/QA check. Only then merge draft PR #1 into `main`, which updates the existing GitHub Pages website.
6. Rollback if needed by reverting the GitHub Pages code and restoring the previous Worker deployment; retain the separate staging Pages/Worker environment for follow-up fixes.

Worker version URLs: https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/

## Live production backend verification — October 29, 2026

Production Worker `tower-data-api` was deployed as version `d01a0284-f058-47f2-97d2-e222023f7399`. Rollback version: `e9e5d798-1b9f-459b-a910-36090a0aeceb`. The user verified the following three **read-only live GET tests**:

- `GET /`: Worker status `running` and `databaseBindingConfigured: true`.
- `GET /tower?asrn=1004233`: successful unchanged FCC record, including Needham, MA coordinates **42.30297222, -71.21802778**, tower height 1200.8 ft, estimated radiation center 1174.5 ft, and base elevation 150.9 ft.
- `GET /terrain/elevation?lat=42.29&lon=-71.23`: USGS EPQS `elevationMeters: 57.576194763` (`elevationFeet: 188.9`). **These are example coordinates, not the exact FCC ASRN coordinates.**

**Not yet verified against production:** `POST /terrain/profile`, `POST /terrain/multipoint`, production-origin browser CORS, 24/36-bearing scans, and a real five-minute recovery test. Do not merge Version 2.0 into the live frontend until these gates are reviewed.

### Production USGS POST check — October 29, 2026

The user tested production version `d01a0284-f058-47f2-97d2-e222023f7399` using precise FCC ASRN `1004233` TX coordinates `42.30297222,-71.21802778` and Boston RX `42.3601,-71.0589`, requesting 48 samples:

- `POST /terrain/multipoint`: `sampleMethod=multipoint`, `requestedCount=48`, `returnedCount=48`, `complete=true`, empty `missingIndices`. **PASS.**
- `POST /terrain/profile`: `source=USGS 3DEP`, `sampleCount=49`, `complete=false`, `endpointAdded=true`, `missingSampleIds=[47]`. The appended receiver locationId `49` has `exactEndpoint=true`, location `(-71.0589,42.3601)` and elevation `10.126227379` meters. **PARTIAL: endpoint verified, but original USGS polyline sample ID 47 is absent.**
- Repeated with 72 requested profile samples: `sampleCount=73`, `complete=false`, `endpointAdded=true`, `missingSampleIds=[70]`. Omission of an interior polyline sample near the receiver recurs across sample counts. Do **not** describe the polyline as complete based solely on a separately verified endpoint.
- **Front-end mitigation committed** to both `feature/terrain-v2-usgs` and `staging/terrain-v2`: point-to-point calls `POST /terrain/multipoint` instead of `/terrain/profile`, demanding exactly the requested geolocated elevations, including both endpoints. Missing values, invalid order, and any legacy polyline fallback are rejected; no PDF report is enabled on failure. The `/terrain/profile` Worker endpoint is retained for API compatibility; it no longer powers point-to-point analysis in the updated frontend.
- **72-sample production multipoint test: PASS** (user-confirmed on 2026-10-29), using the exact Needham FCC coordinates and Boston receiver. No missing elevations reported. **Next gate:** refresh Cloudflare Pages staging, rerun Needham/Boston point-to-point analysis using the newly updated 72-point multipoint path, then visually inspect the resulting PDF. Keep live website v1.9 and the deployed production Worker unchanged until acceptance.

### Hosted 24-bearing 360-degree scan — October 29, 2026

The user tested the live Cloudflare Pages staging site with the Needham tower, 24 bearings and 48 USGS 3DEP multipoint samples per bearing. **First run:** one bearing failed after a temporary USGS HTTP 502, even after automatic retry 2 of 2. **Second run:** all 24 bearings completed, with 24 multipoint and 0 legacy radial queries, 23 profiles reused from cache, 40 range rings, and estimated terrain-visible area **5,906 mi²** inside a **51.9 mi** theoretical horizon. The supplied screenshot shows green/red terrain overlay and a dashed blue horizon.

**Acceptance:** 24-bearing completion and reuse of previously successful terrain profiles after a transient failure are verified. This is **not** proof that the optional five-minute separate-window recovery process works; that remains an outstanding acceptance test. Likewise, the one-page 360 PDF for this run has not been separately inspected. Do not infer that an unknown sector was plotted correctly in the first incomplete scan without first-run evidence. Next: 36-bearing scan, one-page 360 PDF inspection, and five-minute recovery QA before live website release.

### Hosted 36-bearing scan and 360 PDF — October 29, 2026

The user uploaded a one-page 360-degree PDF from a completed **36/36 bearing** Cloudflare staging run using FCC ASRN `1004233`. Results: **1,728 verified terrain positions**, **40 distance rings**, **0 unknown sectors**, **1,265 terrain-clear cells**, **175 terrain-blocked cells**, and estimated terrain-visible area **5,878 sq mi** within the **51.9-mile** radio horizon. The PDF page and colored green/red map overlay rendered correctly. Compared with the complete 24-bearing report (**5,906 sq mi**), the estimate differs by approximately 0.47%. This is internal convergence evidence, not measured model accuracy.

The 36-bearing PDF exposed report-only presentation issues: it included old receiver coordinates far outside the 360-degree study and a marker at that unrelated receiver; the map framing wasted space; empty point-to-point results appeared, `mi^2` rendered as text, and k was shown to 13 decimal places. The `export.js` correction has been committed to feature and staging branches and has not altered backend calculations. **Fresh hosted 360 PDF visual QA is still required** after the staging Pages update. Source-resolution metadata is not yet retained in the 360 multipoint Worker; it should not be inferred from the 48-point radial sampling interval.

### Step 62 — 12-bearing 360 scan completed; PDF export MI bug fixed and regression-tested (October 29, 2026)

The user ran a **fresh 12-bearing scan** on Cloudflare Pages staging after USGS source-provenance deployment. The browser screenshot confirms **12/12 bearings**, **48 samples/bearing (576 elevations)**, four complete chunks, 40 distance rings, **12 multipoint / 0 legacy** queries, **6,085 mi²** estimated terrain-visible area, and **51.9 mi** smooth-Earth horizon. The map displays green/red classified terrain regions and a dashed blue horizon.

**Blocker encountered:** Clicking *One-page PDF report* returned `Export failed: MI is not defined`. Root cause: the recent new *Radial sampling* line in `export.js` referenced `scan.radiusM / MI` without defining `MI` in that module. This was **PDF formatting/runtime only**, not a USGS sampling or terrain calculation failure.

**Fix:** Added `const MI = 1609.344;` (meters per international mile) in `export.js` on both `staging/terrain-v2` and `feature/terrain-v2-usgs` branches. Added an offline end-to-end browser/PDF mock test `tests/check-360-pdf.mjs` that clicks the export handler, exercises tower-centered coverage capture, verifies PDF sample-spacing/source-resolution/project/area text, and checks map-view restoration. Integrated the test into GitHub Actions. **Feature-branch CI run `40939675424` completed successfully.** The staging branch may need a short Cloudflare Pages deployment interval; hard refresh after deployment and **rerun the 12-bearing scan** before downloading the report.

**Acceptance remaining:** This code fix is tested but the user's real browser PDF **has not yet been downloaded or visually checked** after the fix. Request the newly exported one-page 360 PDF. Confirm centered transmitter, no unrelated receiver, 576 samples and source projects/resolutions, correct k label, area and single-page layout. The separate five-minute recovery test remains incomplete. Do not deploy code to the production Worker or merge GitHub Pages v2 until accepted.

### Step 61 — FCC Needham point-to-point PDF accepted (October 29, 2026)

The user uploaded `tower-horizon-1004233-2026-10-29-point-to-point (1).pdf` (generated 3:16:51 PM), the **actual FCC-coordinate** one-page report for the Needham ASRN `1004233` to Boston `42.3601,-71.0589` link. The assistant read and visually rendered the PDF (one US Letter 612 × 792 pt page) and confirmed:
- TX coordinates `42.302972,-71.218028` (rounded FCC `42.30297222,-71.21802778`), antenna `1174.5 ft AGL`, local USGS ground `147.2 ft AMSL`, antenna center `1321.7 ft AMSL`.
- RX `42.3601,-71.0589`, `6 ft AGL`, USGS ground `33.2 ft AMSL`, antenna center `39.2 ft AMSL`.
- Path `9.04 miles`, geometric `OBSTRUCTED`, minimum sampled clearance `-16.9 ft`, forward bearing `64 deg`, reverse bearing `244.2 deg`, `k = 1.333`, worst sample `8.78 mi from A`, and approximate additional height `801 ft at A OR 17 ft at B`. These **match the earlier exact-FCC-coordinate baseline** from before the source-metadata enhancements.
- `72 verified samples` spaced approximately `672 ft`; `USGS DEM raster resolution: 1 m (72)`; `USGS source projects: MA_CentralEastern_2021_B21`.
- The original two-site panels, one 30-degree orientation-sector context map, elevation profile and USGS source section render on one page without overlap or major clipping. Minor nonblocking issue: the copyright/status footer is close to the bottom page edge.
- **Scope limitation:** The report identifies the *project* name, not every unique raster ID encountered. The earlier separate 48-sample Needham-to-Boston query included four distinct raster IDs. Do not infer that all 72 samples came from the same raster because the project summary shows only one name.
- The report remains a **preliminary sampled geometric clearance** model; it does not include Fresnel-zone, vegetation/building, diffraction, field strength or full RF link-budget effects.

**Acceptance: PASS — exact FCC Needham point-to-point PDF with verified 72-sample multipoint DEM provenance.** No calculation regression indicated. The live production `tower-data-api` Worker and GitHub Pages v1.9 were not changed.

**Next:** On the Cloudflare Pages v2 staging website, run a fresh **12-bearing 360-degree scan** of ASRN 1004233 and upload the new one-page 360 PDF to check the previously fixed tower-centered framing, omitted unrelated RX details, correct area, and the added DEM source resolution/project summary. The earlier 24/36-bearing scans passed *before* the latest provenance upgrade. The optional five-minute recovery behavior remains an acceptance item before final production release.

### Step 60 — uploaded one-page link PDF: provenance PASS, FCC coordinates NOT YET VERIFIED (October 29, 2026)

The user uploaded `tower-horizon-manual-2026-10-29-point-to-point (3).pdf`, generated at 3:13:06 PM. Direct PDF visual/render review confirms **one US Letter page**, the two endpoint cards, 30-degree orientation-sector map, line-of-sight elevation profile, and new USGS source details. PDF values: `72 verified samples`, `USGS DEM raster resolution: 1 m (72)`, `USGS source projects: MA_CentralEastern_2021_B21`, and `~743 ft apart` (consistent with 9.99-mile path divided into 71 intervals). It reports `OBSTRUCTED`, `min clearance -22.4 ft`, TX elevation 188.9 ft AMSL, and 6-ft AGL Boston RX. No clipping or pagination defects were observed in the rendered page; bottom disclaimer/footer is slightly tight but legible.

**Important: manual test only.** The PDF has TX `42.29,-71.23`, not the actual FCC Needham ASRN `1004233` coordinates `42.30297222,-71.21802778`. The AGL antenna is 1174.8 ft (illustrative) rather than 1174.5 ft (FCC snapshot), and the filename includes `manual`, not `1004233`. The current site pre-fills TX `42.29,-71.23` as an example; `1004233` in the ASRN input is a *placeholder*, not a loaded FCC registration. **Do not count this as the correct FCC path acceptance**. The apparent difference from prior exact Needham 9.04-mile/-16.9-ft report is due to differing transmitter location and height; it does not prove a terrain-algorithm regression.

**Next:** Enter `1004233` in the actual FCC ASRN field and click `Look Up FCC`; confirm status says loaded and TX inputs change to about `42.302972,-71.218028`. Then use Boston RX `42.3601,-71.0589`, 6 ft, k=4/3, 72 samples, analyze, download and inspect the fresh one-page PDF. Verify complete elevations and DEM source metadata across the true FCC path before the 12-bearing 360 PDF check and eventual production rollout. Live production Worker and GitHub Pages remain unchanged.

### Step 59 — staging multipoint with DEM provenance PASSED (October 29, 2026)

The user ran a **live** POST to `https://tower-terrain-staging.mac1584.workers.dev/terrain/multipoint` on staging Worker deployment `88c521f6-acb9-4cb8-83aa-8682f7c1b367` with actual Needham FCC ASRN 1004233 coordinates `42.30297222,-71.21802778` and Boston remote `42.3601,-71.0589`, requesting `samples:48`. Returned `sampleMethod:multipoint`, `requestedCount:48`, `returnedCount:48`, `complete:true`.

All **48 samples reported resolution 1** (the USGS source raster spatial resolution, not the modeled path sample spacing). Four distinct raster IDs were observed: `88413` **11** samples, `130833` **22**, `140426` **13**, `31946` **2**. The first three sample records included `rasterId:88413`, `resolution:1`, and `sourceDetails` with `name:MA_CentralEastern_2021_B21`, `title:USGS 1 Meter 19 x31y469 MA_CentralEastern_2021_B21`, `product:USGS_3DEP`, `provider:USGS`, NAVD 88 and acquisition timestamp `1619222400000`. The source metadata for the other three raster IDs has **not** been individually printed in the supplied output; do not assume their project names match raster 88413.

**Outcome:** real-world staging Worker metadata propagation and complete 48/48 USGS multipoint sampling verified. No evidence of terrain analysis algorithm change. For this ~9.04 mi path, 48 elevations correspond to ~1,015 ft between requested locations; 1m DEM resolution is not equivalent to 1m path sample spacing.

**Next acceptance:** Hard refresh Cloudflare Pages staging, analyze the Needham→Boston point-to-point path at 72 samples, download/upload the newly generated **one-page point-to-point PDF** for visual review of source-project/resolution and sampling interval. Then run 12-bearing 360 and verify its report and tower-centered map. Do not merge v2 website nor deploy updated production Worker until these pass.

### Step 58 — live staging USGS raster catalog verification PASSED (October 29, 2026)

The user executed `GET https://tower-terrain-staging.mac1584.workers.dev/terrain/catalog?ids=88413` following the staging Worker deployment `88c521f6-acb9-4cb8-83aa-8682f7c1b367`. PowerShell returned a complete `records['88413']` with `rasterId: 88413`, `name: MA_CentralEastern_2021_B21`, `title: USGS 1 Meter 19 x31y469 MA_CentralEastern_2021_B21`, `product: USGS_3DEP`, `provider: USGS`, `verticalDatum: North American Vertical Datum of 1988 (NAVD 88)`, `acquisitionDate: 1619222400000` (April 24, 2021 UTC), and `demTypeCode: 1`. This **confirms the live read-only catalog route and the title's 1-meter raster designation for raster 88413**; it is *not* evidence that all samples in a line or 360 scan use 1-meter data. The `demTypeCode` is not itself a resolution.

**Next acceptance gate:** User-run live `POST /terrain/multipoint` with exact Needham ASRN 1004233 coordinates (42.30297222,-71.21802778), Boston (42.3601,-71.0589), 48 samples. Verify `complete`, `returnedCount`, and representative `rasterId`, `resolution`, `sourceDetails`, then regenerate hosted point-to-point and 360 one-page PDFs. Prior production release state unchanged. Preserve staging rollback version `a5945023-d91b-4f66-af80-4c5600eaa863`.

### USGS provenance staging Worker deployment — October 29, 2026

**User-confirmed deployment to `tower-terrain-staging`:** Cloudflare version ID `88c521f6-acb9-4cb8-83aa-8682f7c1b367`. Pre-upgrade rollback deployment ID: `a5945023-d91b-4f66-af80-4c5600eaa863`. The new candidate includes source raster metadata, a read-only `GET /terrain/catalog` route, and the three originally flagged Cloudflare editor property declarations (`rasterId`, `resolution`, `sourceDetails`). Existing production FCC/terrain Worker `tower-data-api` was **not** updated as part of this step.

**Acceptance status:** deployment reported successful, but **live endpoint responses and hosted PDF output have not yet been independently verified**. The assistant's browser/network retrieval could not access the staging Worker, so the user must execute the published read-only PowerShell smoke test or provide resulting output. Next verify `GET /terrain/catalog?ids=88413` for project name, then `POST /terrain/multipoint` for elevation completeness and `rasterId`/`resolution` fields. After this generate one-page PDFs using fresh calculations.

### Staging Worker rollback checkpoint — October 29, 2026

User-provided **pre-upgrade Cloudflare staging Worker version ID:** `a5945023-d91b-4f66-af80-4c5600eaa863`. Preserve this deployment as the rollback reference for `tower-terrain-staging` only. The initial attempt to paste the new staging Worker code produced Cloudflare editor parse error `Uncaught SyntaxError: Unexpected token 'catch'` at `worker.js:140:4`, before a confirmed successful deploy. **Do not change the production `tower-data-api` Worker**. The GitHub candidate and mocked automated tests parse and pass; inspect the active Cloudflare editor for leftover old Worker code or partial paste and re-paste the entire standalone candidate file into `worker.js`, ensuring only one top-level worker module. Do not claim staging deployment or PDF acceptance until separately verified.

### DEM source provenance upgrade — prepared but NOT deployed (Oct 29, 2026)

**Goal:** distinguish the reported resolution of the USGS raster (e.g. `resolution: 1`) from the calculator's 48-elevation/72-elevation sample spacing, and identify the underlying raster/project name and acquisition year if USGS supplies it. The user's raster `88413` resolved to `MA_CentralEastern_2021_B21`, `USGS_3DEP`, `DEM_Type: 1`; that catalog code is NOT a proven spatial resolution or a guaranteed lidar classifier.

**Committed, nondeployed code:**
- Staging Worker replacement: `cloudflare/staging-worker-v2-provenance.js`, which keeps elevation, profile, multipoint, and geocode plus adds `GET /terrain/catalog` and preserves `rasterId`, `resolution`, and optional source fields in multipoint samples.
- Separate production FCC-compatible candidate: `cloudflare/production-worker-v2-candidate.js`, preserving `env.DB` and FCC `GET /tower` behavior. **Do not paste the staging-only file into production.**
- `terrain.js`, `terrain-sources.js`, `export.js`, `path-report.js`, `index.html` now retain and summarize optional per-sample source provenance in both one-page PDF reports. DEM resolution, source raster/project, and calculator spacing are distinct.
- Automated mocked checks: `node tests/check-worker-candidate.mjs`, `node tests/check-staging-worker.mjs`, `node tests/check-terrain-sources.mjs`, static and point-to-point regression. The feature-branch GitHub Actions run has passed.
- Complete staging and follow-up production workflow: `docs/USGS_TERRAIN_PROVENANCE.md`.

**Acceptance pending:**
1. Back up currently deployed `tower-terrain-staging` source/version.
2. Manually replace only that existing Worker with the complete staging-only candidate; verify 48/48 multipoint samples include `rasterId`/`resolution` where offered, and verify catalog name(s) for returned IDs.
3. Hard-refresh Cloudflare Pages staging and generate fresh 12-bearing 360 and 72-point link PDFs; inspect source metadata, correct sample interval, one-page layout and centered coverage map.
4. Evaluate temporary USGS catalog failure with terrain analysis still functional.
5. Only after staging approval: consider a separate production Worker code deployment and live FCC regression; no merge to production GitHub Pages until all acceptance gates pass.

## Test and release record

- Existing staging Worker multipoint handler: manually deployed and validated, 12/12 bearings achieved on a repeated 12-bearing USGS test.
- The 360 one-page and map PDFs were corrected following user-provided PDFs that omitted overlay polygons; the user confirmed the updated PDFs render correctly.
- Two automatic transient-failure retries and the optional five-minute separate-window recovery implemented in the development branch; mock tests passed; still needs a live failure/recovery acceptance test.
- Point-to-point report and 30-degree sector: automated test passed, and the hosted PDF was visually reviewed on 2026-10-29. Needham-to-Boston sample report: 9.99 mi, 60.9 deg true A-to-B, 241.1 deg reverse, 50 verified terrain samples, lowest sampled clearance -21.6 ft, status OBSTRUCTED. It fits one Letter page and does not include the 360-degree coverage overlay. It explicitly states that the orientation sector is not antenna beamwidth or predicted coverage.
- No production site or production Cloudflare Worker changes made as part of this staging candidate.
