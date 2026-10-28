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
      value: null
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
