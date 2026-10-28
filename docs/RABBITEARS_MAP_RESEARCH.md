# RabbitEars map architecture - research notes for Tower Horizon

Research date: 2026-10-28. These are public-reference notes, **not** implementation instructions or approval to reproduce proprietary imagery.

## The important distinction: two different radio-propagation workflows

RabbitEars' own [Signal Search Map instructions](https://www.rabbitears.info/static.php?name=searchmap_instructions) distinguish two products:

1. **Colorful Longley-Rice station contour maps** are powered by **SPLAT!** radio-propagation software.
2. **Receiver-centered Signal Search Map** studies are powered by the **FCC's TVStudy** software.

These are not the same computation, even though both produce terrain-aware results that can be displayed with maps.

## Their documented historical contour-generation pipeline

RabbitEars published a [Making Longley-Rice Coverage Maps](https://www.rabbitears.info/static.php?name=making_coverage_maps) guide. The original instructions describe:

- A Linux host with GCC, Perl, ImageMagick and GIS/image dependencies.
- SPLAT! version 1.3.0, plus Bob Nelson's supporting scripts.
- NASA/USGS SRTM terrain data (the guide refers to 3-arc-second terrain).
- A SPLAT! patch preventing the creation of an unnecessary PPM map during certain calculations, reducing wasted CPU time.
- Preparation of FCC input data, terrain conversions, propagation calculations, and map outputs.

**Caution:** The guide refers to older Linux distributions and software versions. It establishes the published approach, not the complete current server implementation.

## Current interactive map presentation

RabbitEars' contemporary `contour.php` pages expose **Leaflet** with selectable backgrounds. Examples visible in public page text include:

- OpenTopoMap and OpenStreetMap.
- Esri topo, aerial imagery and street-map backgrounds.
- USGS topo, imagery and combined layers.
- Additional providers such as OpenFreeMap, TomTom and others (providers and terms may change).

Its togglable overlay types include:

- Longley-Rice predicted field-strength regions.
- Noise-limited bounding and minimum field-strength contours.
- Low-power/Class A protected contours.
- Interfering F(50,10) contours.
- Population/Census reference information.
- Extra transmitters specified by FCC ASRN, or additional station application IDs.
- Adjustable reference radius circles.

The public station-map legend groups Longley-Rice predictions as `81+ dBu`, `71-80 dBu`, `61-70 dBu`, `51-60 dBu` and `41-50 dBu`; each band describes an approximate reception circumstance, not a simple terrain line-of-sight result.

RabbitEars' [Coverage Map Help](https://www.rabbitears.info/static.php?name=coverage_map_help) describes the use of a **13 ft receiving antenna**, versus the FCC standard of **30 ft** for the referenced studies. It also describes more pessimistic reception assumptions by **5 dB on high VHF** and **13 dB on low VHF**.

## Why this matters to Tower Horizon Calculator 2.0

Our present product **does not calculate predicted dBu field strength**. It retrieves USGS 3DEP bare-earth elevations, samples 48 precise positions per bearing, and classifies 40 distance rings with effective-Earth-curvature-adjusted terrain clearance. It does not model frequency-specific ERP, directional antenna patterns, diffraction, clutter, interference, or the reliability assumptions of Longley-Rice / TVStudy.

Consequently:

- Never label our green/red cells as **FCC coverage** or strength thresholds.
- Keep the current blue dashed theoretical radio horizon distinct from terrain-visible cells.
- Keep unknown elevations gray and total terrain-visible area incomplete when needed.
- CSV/KML/PDF data exports must label the results as **sampled terrain visibility**.
- Existing user interface and 3DEP pipeline need not change to incorporate presentation lessons.

## UX ideas that are compatible with the current model

1. Layer controls: independent switches for terrain-clear, terrain-blocked, unknown, theoretical horizon, tower marker and optional comparison circle.
2. More basemaps: muted terrain/street base and optional topography/imagery, with legal tile-provider attribution and rate-limit compliance.
3. An explicit, readable legend for *model output versus base map*. Consider a separate printable-map mode.
4. A better receiver-location UX: address search, coordinate entry, draggable marker and an instruction to verify the position.
5. Optional comparison of multiple towers, clearly segregating their geometric horizons or terrain-visibility data.

Potential **future** project: a dedicated RF propagation mode using a Longley-Rice/ITM or FCC TVStudy-compatible engine. It would need frequency, ERP, antenna pattern and other engineering inputs, more extensive terrain preprocessing and additional server computation. Treat it as a separate product feature, **not** a styling change.

## Reference links

- [RabbitEars - Making Longley-Rice Coverage Maps](https://www.rabbitears.info/static.php?name=making_coverage_maps)
- [RabbitEars - Coverage Map Help](https://www.rabbitears.info/static.php?name=coverage_map_help)
- [RabbitEars - Signal Search Map Instructions](https://www.rabbitears.info/static.php?name=searchmap_instructions)
- [Public RabbitEars station contour example showing Leaflet layers](https://www.rabbitears.info/contour.php?appid=25076ff383ce465f018417008b082c0b&coords=42.43%2C-87.82&map=Y&site=1)

The exact station `appid=25076ff39a751a3d019a974bb21f01f6` page supplied by the user was not available through the public-page fetcher during research; verified methodology comes from RabbitEars' published documentation and comparable indexed contour pages.
