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

## Test and release record

- Existing staging Worker multipoint handler: manually deployed and validated, 12/12 bearings achieved on a repeated 12-bearing USGS test.
- The 360 one-page and map PDFs were corrected following user-provided PDFs that omitted overlay polygons; the user confirmed the updated PDFs render correctly.
- Two automatic transient-failure retries and the optional five-minute separate-window recovery implemented in the development branch; mock tests passed; still needs a live failure/recovery acceptance test.
- Point-to-point report and 30-degree sector: automated test passed, and the hosted PDF was visually reviewed on 2026-10-29. Needham-to-Boston sample report: 9.99 mi, 60.9 deg true A-to-B, 241.1 deg reverse, 50 verified terrain samples, lowest sampled clearance -21.6 ft, status OBSTRUCTED. It fits one Letter page and does not include the 360-degree coverage overlay. It explicitly states that the orientation sector is not antenna beamwidth or predicted coverage.
- No production site or production Cloudflare Worker changes made as part of this staging candidate.
