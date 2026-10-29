# Tower Horizon 2.0 Beta — production release

Released October 29, 2026, following Pat's confirmation that the final self-hosted check passed and authorization to update Cloudflare and go live.

## Published services

| Component | Release |
|---|---|
| Public calculator | https://mac1584.github.io/tower-horizon/ |
| Frontend source | `main`; v2 release merge `8cf588f9e65fb272930622177697de96a01f9af3` |
| GitHub Pages release | Run `40942373827`, completed successfully |
| Production API | `tower-data-api.mac1584.workers.dev` |
| New production Worker version | `85eaabe4-9174-48a3-899b-cc34937370a4` |
| Worker version message | `Tower v2: USGS source provenance` |
| Promotion message | `Launch Tower Horizon 2.0 Beta` |
| Immediate rollback version | `d01a0284-f058-47f2-97d2-e222023f7399` |
| Original pre-terrain rollback | `e9e5d798-1b9f-459b-a910-36090a0aeceb` |
| Database binding | `DB` → `tower-records`; no database writes or migrations |
| Staging | Existing Cloudflare Pages project and `tower-terrain-staging` retained |

The Worker source is `cloudflare/production-worker-v2-candidate.js`. Its historical filename/header is retained to avoid breaking references. Compared with the previous production source, this update adds only the catalog route and optional per-sample raster ID, DEM resolution, and source fields. FCC behavior and terrain geometry are unchanged.

## Verification completed

- Confirmed the public GitHub Pages HTML exactly matched the v2 release source before the sharing-metadata update.
- Public browser loaded v2 Beta, returned the actual FCC Needham ASRN `1004233` record, populated its coordinates/heights, and loaded USGS elevation successfully.
- All seven repository check scripts passed: static wiring, 23 production Worker contract cases, eight point-to-point completeness cases, eight provenance cases, 360 PDF generation, full 12-bearing/576-position provenance propagation, and 11 staging Worker cases.
- Backed up the active production Worker source before editing and checked the normalized diff against the candidate. Confirmed `DB` still points at `tower-records`.
- Saved the update as an inactive version first. Cloudflare's HTTP preview for that saved version returned successful FCC and catalog responses, and **72/72 complete multipoint elevations** for the exact Needham-to-Boston path. The first sample retained raster `88413`, resolution `1`, project `MA_CentralEastern_2021_B21`, and acquisition timestamp `1619222400000`.
- Cloudflare confirmed **Promoted version to 100%** for `85eaabe4`.
- Added a canonical public URL and Open Graph/Twitter title/description metadata for sharing; calculator behavior and layout are unchanged.

## Verification limits and follow-up

Direct access to Worker/version URLs from the execution environment was unavailable, so new-version checks used Cloudflare's supported HTTP preview. That preview verifies the saved candidate and its bindings; it is not a post-promotion public-origin CORS test.

The final fresh public-site browser checks were interrupted because Chrome reported another extension UI open. Complete a fresh FCC lookup, 72-sample path analysis, and 12-bearing scan against production, then export the two PDFs to confirm the new metadata reaches both reports. Existing user-approved staging tests and automated checks are recorded separately; do not describe those as fresh production acceptance.

The optional real five-minute transient-failure recovery window has not received live acceptance. Unknown sectors must continue to remain gray/incomplete. The release remains labeled **BETA**, and reports remain preliminary terrain-only engineering estimates.

If production regresses, promote `d01a0284-f058-47f2-97d2-e222023f7399` back to 100% in the existing Worker's Deployments page. No database rollback is required because this rollout performs no data mutations.
