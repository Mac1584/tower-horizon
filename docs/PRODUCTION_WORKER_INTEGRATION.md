# Tower Horizon 2.0 — Production Cloudflare Worker Integration

**Current status:** Deployed October 29, 2026 as version `85eaabe4-9174-48a3-899b-cc34937370a4`. See [production release record](PRODUCTION_RELEASE_2026-10-29.md). The instructions below preserve the original candidate review and rollout procedure; references to the old v1.9 website and unapproved deployment are historical.

## Production dependencies confirmed

| Item | Existing value | Required action |
|---|---|---|
| Worker | `tower-data-api` | Preserve the existing service and public URL |
| D1 database | `tower-records` | No schema, data, import or migration changes |
| Binding variable | **`DB`**, accessed as `env.DB` | Retain the exact binding name and resource |
| Existing FCC route | `GET /tower?asrn=1004233` | Keep response keys and SQL query behavior |
| Existing root route | `GET /` | Keep diagnostic response shape |
| Existing FCC CORS | `GET, OPTIONS` | No changes to FCC route CORS |
| Current website | GitHub Pages v1.9 | Remains unchanged until release approval |
| Terrain staging | `tower-terrain-staging.mac1584.workers.dev` | Already working; do not remove or repurpose it |

The source supplied was Cloudflare's **generated/bundled** output (it begins with a bundler helper and ends with a source-map annotation). That is usable evidence for route behavior, but is not a complete source repository or Cloudflare configuration export. The candidate reconstructs its FCC code in readable, editable JavaScript.

## Prepared code — one self-contained Worker

**File:** [`cloudflare/production-worker-v2-candidate.js`](../cloudflare/production-worker-v2-candidate.js)

This standalone module contains the original FCC root and tower lookup, plus the staging-tested:

- `GET /terrain/elevation?lat=42.29&lon=-71.23` — USGS EPQS, returning `elevationMeters` and `elevationFeet`.
- `POST /terrain/profile` — USGS 3DEP polyline route with receiver elevation verified through EPQS; accepts TX, RX, and 2–120 samples.
- `POST /terrain/multipoint` — exactly requested great-circle locations, including both endpoints, with individual missing indices kept as `null` instead of fabricated elevations.
- OPTIONS preflight for the three terrain routes with `GET, POST, OPTIONS`; the original FCC routes remain GET-only.

All terrain routes are handled **before** the original global GET-only method guard. Otherwise both POST routes would fail with HTTP 405.

No D1 write methods, new Workers, new secrets, or external geography providers have been added. The existing `/tower` code and D1 access are kept logically unchanged. The USGS profile/multipoint handlers are copied from the tested **staging** implementation.

**Do not paste only** `worker-terrain-extension.js` or `cloudflare/staging-multipoint-handler.js` over the production Worker. Those files are partial helpers, not standalone FCC-compatible Workers.

## Automated contract regression

Run from a local checkout of the **feature** branch:

```powershell
node tests/check-worker-candidate.mjs
```

The test mocks D1 and USGS with no live requests, checking FCC root, valid/invalid/missing ASRN, missing D1, GET-only CORS, terrain elevation, polyline, multipoint, missing elevations, CORS and upstream failures. The test is also part of the feature-branch GitHub Actions workflow.

This does **not** prove that a new deployed Worker version has the correct live D1 binding, CF compatibility date, or live USGS connectivity; those require Version URL tests.

## Before any Cloudflare upload or deployment

1. In Cloudflare → **Workers & Pages → tower-data-api → Deployments**, record the **active deployment and version ID** and take a screenshot.
2. Save a separate copy of the **currently active** Worker source as an original backup. Do not rely on this candidate as the rollback source.
3. In **Settings → Bindings**, verify that binding variable **`DB`** still points at **`tower-records`**.
4. Confirm whether your Cloudflare dashboard supports saving/uploading a **new Worker version without deploying it to live traffic**. **If the only button is “Save and Deploy,” stop and do not click it.** We must first choose a safe upload path.
5. If a separate **Version URL** is available for the saved-but-not-deployed version, smoke-test it before promoting anything. A Version URL uses that version's existing resources/bindings. D1 tests must be **read-only**.
6. Keep the staging website and `tower-terrain-staging` Worker untouched throughout.

Cloudflare references (2026):
- [Worker Versions and Deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Worker Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)
- [Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [Compare Worker Previews and Version URLs](https://developers.cloudflare.com/workers/previews/compare-workflows/)

## Manual version-URL verification (only after an inactive version exists)

Replace the placeholder below with the **actual Version URL shown by Cloudflare**, never a guessed production address.

```powershell
$api = "https://ACTUAL-VERSION-URL.workers.dev"

# Verify FCC compatibility before exercising terrain.
Invoke-RestMethod -Uri "$api/"
Invoke-RestMethod -Uri "$api/tower?asrn=1004233"

# Verify USGS ground elevation.
Invoke-RestMethod -Uri "$api/terrain/elevation?lat=42.29&lon=-71.23"

# Test each separate 48-sample terrain route.
$body = @{
  tx = @{ lat = 42.29; lon = -71.23 }
  rx = @{ lat = 42.3601; lon = -71.0589 }
  samples = 48
} | ConvertTo-Json -Depth 4

$multi = Invoke-RestMethod -Uri "$api/terrain/multipoint" -Method Post -ContentType "application/json" -Body $body
$multi | Select-Object sampleMethod, requestedCount, returnedCount, complete
$multi.missingIndices

$profile = Invoke-RestMethod -Uri "$api/terrain/profile" -Method Post -ContentType "application/json" -Body $body
$profile | Select-Object source, sampleCount, complete, endpointAdded
```

**Acceptance gates:** unchanged FCC response shape, valid D1 binding, accepted CORS preflights, the expected multipoint response schema, faithful unknown/missing elevation handling, and a successful profile route. Compare FCC results against the still-live `tower-data-api` root and `/tower?asrn=1004233`.

If USGS temporarily returns HTTP 502, retry only the affected test; do not assume the Worker is broken. Never treat missing elevation as a clear path.

## Separate release decision

**Do not deploy the new version or merge PR #1 as part of these preparations.**

After an inactive version passes live tests, review the rollout with the user. We still need the planned 24/36-bearing and five-minute error-recovery acceptance checks. A later approved deployment should be followed immediately by live FCC and USGS checks; Cloudflare's **Deployments → Rollback** can restore the prior Worker version if required.

D1 data is **not** versioned by Worker rollback. This plan intentionally performs **no database mutations**, so rollback affects only Worker code/config.
