/**
 * Additional staging Worker route for Tower Horizon Calculator v2.0.
 * This is a helper function, NOT an entire replacement Worker.
 *
 * To install in the existing tower-terrain-staging Cloudflare Worker:
 *   1. Keep the existing worker code and all its routes.
 *   2. In export default { async fetch(request) { ... } }, after
 *      const url = new URL(request.url); insert:
 *
 *        if (url.pathname === "/terrain/multipoint") {
 *          return handleTerrainMultipoint(request);
 *        }
 *
 *   3. Append this complete file BELOW the existing export default block.
 *   4. Deploy the staging Worker only. Do not change tower-data-api.
 *
 * Request:  POST /terrain/multipoint
 * JSON:     {"tx":{"lat":42.29,"lon":-71.23},
 *            "rx":{"lat":42.3601,"lon":-71.0589},"samples":48}
 *
 * Uses a single USGS ArcGIS ImageServer getSamples multipoint request.
 * Exactly "samples" coordinates are requested, including both endpoints.
 * When USGS omits locations, returns value:null at those exact indexes.
 */
async function handleTerrainMultipoint(request) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  const reply = (data, status = 200) =>
    Response.json(data, {
      status,
      headers: { ...cors, "Cache-Control": "no-store" }
    });

  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST")
    return reply({ error: "Use POST for terrain multipoint samples" }, 405);

  const R = 6371000, DEG = Math.PI / 180;
  const radians = n => n * DEG;
  const degrees = n => n / DEG;
  const valid = p => p && typeof p === "object" &&
    Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
    Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
  function distance(a, b) {
    const dLat = radians(b.lat - a.lat), dLon = radians(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) *
      Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function interpolate(a, b, fraction) {
    const d = distance(a, b) / R;
    if (d < 1e-8)
      return { lat: a.lat + (b.lat - a.lat) * fraction,
        lon: a.lon + (b.lon - a.lon) * fraction };
    const A = Math.sin((1 - fraction) * d) / Math.sin(d);
    const B = Math.sin(fraction * d) / Math.sin(d);
    const x = A * Math.cos(radians(a.lat)) * Math.cos(radians(a.lon)) +
      B * Math.cos(radians(b.lat)) * Math.cos(radians(b.lon));
    const y = A * Math.cos(radians(a.lat)) * Math.sin(radians(a.lon)) +
      B * Math.cos(radians(b.lat)) * Math.sin(radians(b.lon));
    const z = A * Math.sin(radians(a.lat)) + B * Math.sin(radians(b.lat));
    return { lat: degrees(Math.atan2(z, Math.hypot(x, y))),
      lon: degrees(Math.atan2(y, x)) };
  }
  function sampleLocation(location) {
    if (!location) return null;
    const x = Number(location.x), y = Number(location.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const wkid = Number(location.spatialReference?.wkid ||
      location.spatialReference?.latestWkid);
    if (wkid === 3857 || wkid === 102100 ||
        Math.abs(x) > 180 || Math.abs(y) > 90) {
      const mercatorR = 6378137;
      return {
        lat: degrees(2 * Math.atan(Math.exp(y / mercatorR)) - Math.PI / 2),
        lon: degrees(x / mercatorR)
      };
    }
    return { lat: y, lon: x };
  }

  try {
    if (Number(request.headers.get("content-length")) > 10000)
      return reply({ error: "Request body too large" }, 413);
    const args = await request.json();
    const tx = args?.tx, rx = args?.rx, n = args?.samples;
    if (!valid(tx) || !valid(rx) || distance(tx, rx) < 100 ||
        !Number.isInteger(n) || n < 2 || n > 120)
      return reply({
        error: "Provide distinct coordinates and an integer sample count from 2 through 120"
      }, 400);

    // Request exactly n locations; both endpoints are included.
    const requested = Array.from({ length: n }, (_, index) => {
      const p = index === 0 ? tx : index === n - 1 ? rx :
        interpolate(tx, rx, index / (n - 1));
      return { lat: Number(p.lat.toFixed(7)), lon: Number(p.lon.toFixed(7)) };
    });
    const geometry = {
      points: requested.map(p => [p.lon, p.lat]),
      spatialReference: { wkid: 4326 }
    };
    const endpoint = new URL(
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples"
    );
    endpoint.searchParams.set("geometryType", "esriGeometryMultipoint");
    endpoint.searchParams.set("geometry", JSON.stringify(geometry));
    endpoint.searchParams.set("returnFirstValueOnly", "true");
    // Source fields are optional in some USGS mosaics. Request them when
    // offered without depending on them for the terrain calculation.
    endpoint.searchParams.set("outFields",
      "Name,ProductName,Source,AcquisitionDate,title,VerticalDatum");
    endpoint.searchParams.set("f", "json");

    const upstream = await fetch(endpoint.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30000)
    });
    if (!upstream.ok)
      throw new Error("USGS returned HTTP " + upstream.status);
    const payload = await upstream.json();
    if (payload.error)
      throw new Error("USGS returned " + (payload.error.message || "an error"));
    if (!Array.isArray(payload.samples))
      throw new Error("USGS response did not contain a samples array");

    // ArcGIS can omit points and return results out of order. Match by
    // geographic coordinates rather than assuming response array positions
    // or the locationId sequence is complete.
    const resolutionMeters = distance(requested[0], requested[1]);
    const maxMatchMeters = Math.max(10, resolutionMeters * 0.4);
    const ordered = requested.map((p, index) => ({
      index,
      location: {
        x: p.lon, y: p.lat,
        spatialReference: { wkid: 4326 }
      },
      // Declare all optional USGS raster metadata fields up front so
      // Cloudflare's JavaScript/TypeScript analyzer recognizes them.
      value: null,
      rasterId: null,
      resolution: null,
      sourceDetails: null
    }));
    const bestDistances = Array(n).fill(Infinity);
    for (const candidate of payload.samples) {
      if (candidate?.value == null || candidate.value === "") continue;
      const elevation = Number(candidate.value);
      if (!Number.isFinite(elevation) || elevation < -1500 || elevation > 9000)
        continue;
      const p = sampleLocation(candidate.location);
      if (!valid(p)) continue;

      let nearest = -1, meters = Infinity;
      for (let i = 0; i < requested.length; i++) {
        const d = distance(p, requested[i]);
        if (d < meters) { meters = d; nearest = i; }
      }
      if (nearest >= 0 && meters <= maxMatchMeters &&
          meters < bestDistances[nearest]) {
        bestDistances[nearest] = meters;
        ordered[nearest].value = elevation;
        // ArcGIS getSamples returns the individual source raster ID and
        // spatial resolution. Never substitute our radial sample spacing.
        const rasterId = Number(candidate.rasterId);
        const resolution = Number(candidate.resolution);
        ordered[nearest].rasterId =
          Number.isSafeInteger(rasterId) && rasterId > 0 ? rasterId : null;
        ordered[nearest].resolution =
          Number.isFinite(resolution) && resolution > 0 && resolution < 1e6 ?
          resolution : null;
        const attr = candidate.attributes;
        if (attr && typeof attr === "object") {
          const safe = (v, max = 160) => typeof v === "string" ?
            v.trim().slice(0, max) || null : null;
          ordered[nearest].sourceDetails = {
            name: safe(attr.Name),
            title: safe(attr.title, 200),
            product: safe(attr.ProductName),
            provider: safe(attr.Source),
            verticalDatum: safe(attr.VerticalDatum),
            acquisitionDate: typeof attr.AcquisitionDate === "number" &&
              Number.isFinite(attr.AcquisitionDate) ? attr.AcquisitionDate : null
          };
        }
      }
    }
    const missingIndices = ordered.filter(p => p.value === null).map(p => p.index);
    return reply({
      source: "USGS 3DEP ImageServer",
      sampleMethod: "multipoint",
      requestedCount: n,
      returnedCount: n - missingIndices.length,
      missingIndices,
      complete: missingIndices.length === 0,
      samples: ordered
    });
  } catch (error) {
    console.error("Multipoint request failed:", error);
    return reply({
      error: "USGS multipoint unavailable: " +
        (error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "request timed out" : String(error?.message || error))
    }, 502);
  }
}

/**
 * Optional read-only USGS raster catalog metadata lookup.
 *
 * Staging Worker fetch() dispatch (BEFORE default/not-found routes):
 *   if (url.pathname === "/terrain/catalog")
 *     return handleTerrainCatalog(request);
 *
 * GET /terrain/catalog?ids=88413,88414
 * Returns source identity for the given USGS ImageServer rasterId values.
 * Never changes existing elevation, profile or multipoint analysis.
 */
async function handleTerrainCatalog(request) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  const reply = (data, status = 200) => Response.json(data, {
    status, headers: { ...cors, "Cache-Control": "public, max-age=86400" }
  });
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET")
    return reply({ error: "Use GET for catalog metadata" }, 405);

  const query = new URL(request.url).searchParams.get("ids") || "";
  const parts = query.split(",").map(p => p.trim());
  if (!parts.length || parts.length > 24 ||
      parts.some(p => !/^[1-9]\d{0,8}$/.test(p)))
    return reply({ error: "Provide 1 to 24 comma-separated positive raster IDs" }, 400);
  const ids = [...new Set(parts.map(Number))];
  const uri = new URL(
    "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/query"
  );
  uri.searchParams.set("objectIds", ids.join(","));
  uri.searchParams.set("outFields",
    "OBJECTID,Name,ProductName,Source,AcquisitionDate,title,VerticalDatum,DEM_Type");
  uri.searchParams.set("returnGeometry", "false");
  uri.searchParams.set("f", "json");
  try {
    const upstream = await fetch(uri.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    if (!upstream.ok) throw new Error("Catalog HTTP " + upstream.status);
    const data = await upstream.json();
    if (data.error || !Array.isArray(data.features))
      throw new Error("USGS raster catalog response invalid");
    const records = {};
    const safe = (v, length = 160) => typeof v === "string" ?
      v.trim().slice(0, length) || null : null;
    for (const item of data.features) {
      const a = item?.attributes;
      const id = Number(a?.OBJECTID);
      if (!ids.includes(id)) continue;
      records[id] = {
        rasterId: id,
        name: safe(a.Name),
        title: safe(a.title, 200),
        product: safe(a.ProductName),
        provider: safe(a.Source),
        verticalDatum: safe(a.VerticalDatum),
        acquisitionDate: typeof a.AcquisitionDate === "number" &&
          Number.isFinite(a.AcquisitionDate) ? a.AcquisitionDate : null,
        // DEM_Type is a catalog code; do not interpret it as pixel size or
        // automatically label a raster "lidar" based solely on that code.
        demTypeCode: Number.isInteger(a.DEM_Type) ? a.DEM_Type : null
      };
    }
    return reply({
      source: "USGS 3DEP ImageServer raster catalog",
      requestedIds: ids,
      records
    });
  } catch (error) {
    console.error("USGS source catalog failed:", error);
    return reply({ error: "USGS raster catalog temporarily unavailable" }, 502);
  }
}
