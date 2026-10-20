# Tower Horizon Calculator v2.0 — terrain beta

Feature branch: `feature/terrain-v2-usgs`. Existing production `main` remains untouched.

## Stage 1 — elevation
- Enter transmitter latitude and longitude or use a tower lookup with FCC coordinates.
- Select **Load USGS Elevation**. Ground elevation is displayed in feet AMSL.
- Antenna AMSL = retrieved elevation + radiation center height AGL.
- **Copy to Base Elevation** optionally updates the original calculator's AMSL input.

## Stage 2 — terrain profiles and line of sight
- Set receiver coordinates by clicking the map, entering coordinates, or geocoding a U.S. address.
- Select standard `k=4/3` or geometric `k=1`, then **Analyze Selected Path**.
- Terrain samples are retrieved from USGS 3DEP. The SVG shows sampled apparent terrain including curvature and the straight-line effective-Earth path.
- Negative minimum clearance means sampled terrain obstructs line of sight. Additional receiver/transmitter height estimates are mutually exclusive alternatives; they do not address Fresnel zones or diffraction.

## Stage 3 — 360-degree coarse viewshed
- Choose 12, 24, or 36 bearings. The tool samples 80 elevation points on each radial and checks 40 distance rings.
- The map shades mostly-clear/mostly-blocked cells; it reports an approximate visible area only if *all* bearings succeed. Unknown regions stay unshaded.
- A coarse polar grid and interpolated terrain can miss narrow ridges and gaps; do not use this for service contours, aviation, safety, or engineering certification.

## Worker integration required for production reliability
The current GitHub repository contains the website, not the source of the existing `tower-data-api` deployment. **This branch does not deploy or modify the live Cloudflare Worker.**

`worker-terrain-extension.js` provides an ES module `handleTerrainRequest(request)` that implements:
- `GET /terrain/elevation?lat=...&lon=...` using USGS EPQS
- `POST /terrain/profile` using 3DEP `getSamples`
- `GET /terrain/geocode?address=...` using the U.S. Census geocoder

To integrate, copy the module into the Cloudflare Worker source, import `handleTerrainRequest`, and add this before the existing route handling:

```js
const terrainResponse = await handleTerrainRequest(request);
if (terrainResponse) return terrainResponse;
```

Configure the Worker bundler so the module is included. Retain the existing FCC `/tower` route. Deploy with Wrangler **after reviewing and testing**. The web frontend tries the three new Worker routes first and falls back to direct USGS/Census endpoints when missing; direct browser requests may fail due to CORS, network policy, or provider rate limits. **Until the Worker module is deployed, end-to-end success is unverified.**

## Quick checks
1. Test legacy FCC lookup and horizon calculation before and after integrating the module.
2. Use Needham transmitter `42.29,-71.23`, verify USGS elevation and antenna AMSL.
3. Click a nearby receiver on the map; run terrain path; verify chart and clearance.
4. Set a receiver in mountainous terrain; verify blockage and required additional height.
5. Run 12-bearing and 24-bearing analysis, ensuring any missing USGS data causes *Incomplete* rather than a misleading area.
6. Test coordinate validation, browser console/network errors, and small screens.
7. Compare representative profiles against an independent GIS profile before interpreting the viewshed area.

## References
- USGS 3DEP ImageServer: https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer
- USGS EPQS: https://epqs.nationalmap.gov/v1/docs
- U.S. Census geocoder: https://geocoding.geo.census.gov/geocoder/
- Leaflet map: https://leafletjs.com/

Source terrain surfaces generally do not represent structures, vegetation, or radio field strength. Vertical datum, resolution, uncertainty and endpoint elevation sampling need validation before operational use.
