# Tower Horizon Calculator v1.9

Waypoint Utility Web edition. A static calculator for radio and geometric horizons, theoretical area, and radiation-center elevation. No build step, package installation, or API key is required.

## Files

- `index.html` — accessible calculator page, diagram, method, and sources.
- `waypoint.css` — shared Waypoint Utility Web colors, navigation, headers, and footer.
- `style.css` — tower calculator layout and responsive styles.
- `script.js` — original tower calculation and FCC lookup code, unchanged.
- `.nojekyll` — tells GitHub Pages to serve this static site directly.

## Deploy to GitHub Pages

1. Extract the ZIP. Upload **all files from inside the extracted folder** to the root of your GitHub repository. `index.html` should be at the repository root, with both stylesheets and `script.js` beside it. Include `.nojekyll` if your file picker shows hidden files.
2. In the repository, open **Settings → Pages**. Choose **Deploy from a branch**, select your branch (usually `main`), and select **/ (root)**. Save.
3. Open the Pages URL when deployment completes. All site assets use relative paths, so repository and custom-domain Pages sites both work.

For a local preview, open `index.html` in a browser. A local static web server is recommended when checking FCC lookups.

## Preserved behavior and data

The horizon formulas, constants, input defaults, automatic 8 m radiation-center setback, manual override, negative base elevations, validation, and lookup behavior are unchanged from [Mac1584/tower-horizon](https://github.com/Mac1584/tower-horizon) `main`, whose files match the supplied local calculator. The interface was restyled; the calculation script is byte-identical to that source.

FCC ASRN lookup calls the existing external service at `https://tower-data-api.mac1584.workers.dev/tower?asrn=NUMBER`. It uses an imported FCC registration snapshot and requires internet access and service availability. Manual calculations run locally without it. ZIP/coordinates remain a reference label; terrain, geocoding, population, and population density are not connected. Radio horizon is a smooth-Earth estimate, not a predicted reception or coverage contour.

## Local verification

Checked in a local browser against the original calculator: default and edited horizons/area/AMSL, automatic and manual radiation-center modes, zero/negative/blank/extreme input handling, location-label behavior, FCC success/error/timeout responses, keyboard access, labels/landmarks, and 320 px/390 px responsive layouts. All comparisons passed with no JavaScript errors or missing local assets. Live ASRN 1004233 lookup also succeeded on October 9, 2026, returning the October 7, 2026 FCC snapshot. No calculation changes were made.
