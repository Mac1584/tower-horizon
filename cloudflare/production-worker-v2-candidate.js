/**
 * Tower Horizon 2.0 - STANDALONE PRODUCTION WORKER CANDIDATE (NOT DEPLOYED).
 * Do NOT replace or deploy the active tower-data-api Worker without review,
 * a saved rollback version, and Version URL regression testing.
 * FCC code reconstructed from user's Oct 29, 2026 deployed Worker bundle.
 * Existing root, /tower response contract and env.DB binding are preserved.
 * The USGS elevation/profile handlers match existing tower-terrain-staging,
 * and /terrain/multipoint is identical to its validated staging helper.
 * No D1 data writes, imports, migrations, new secrets or new Worker required.
 */

// Original FCC response semantics and validation.
const METERS_PER_FOOT = 0.3048;
const SETBACK_METERS = 8;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status, headers: { ...CORS_HEADERS, "Cache-Control": "no-store", ...extraHeaders }
  });
}
function roundOne(value) { return Math.round(value * 10) / 10; }
function validNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Terrain CORS is independent, allowing POST without modifying FCC CORS.
const TERRAIN_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
function terrainJson(data, status = 200) {
  return Response.json(data, {
    status, headers: { ...TERRAIN_CORS, "Cache-Control": "no-store" }
  });
}
function terrainValidPoint(p) {
  return p && typeof p === "object" &&
    Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
    Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
}
async function terrainElevationAt(lat, lon) {
  const usgs = new URL("https://epqs.nationalmap.gov/v1/json");
  usgs.searchParams.set("x", String(lon));
  usgs.searchParams.set("y", String(lat));
  usgs.searchParams.set("wkid", "4326");
  usgs.searchParams.set("units", "Meters");
  usgs.searchParams.set("includeDate", "false");
  const response = await fetch(usgs.toString(), {
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok)
    throw new Error("USGS elevation HTTP " + response.status);
  const data = await response.json();
  const meters = Number(data.value);
  if (data.value == null || data.value === "" || !Number.isFinite(meters))
    throw new Error("USGS returned no usable elevation");
  return meters;
}
async function handleTerrainElevation(request, url) {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: TERRAIN_CORS });
  if (request.method !== "GET")
    return terrainJson({ error: "Use GET for elevation lookups" }, 405);
  const latText = url.searchParams.get("lat");
  const lonText = url.searchParams.get("lon");
  if (!latText?.trim() || !lonText?.trim())
    return terrainJson({ error: "Latitude and longitude required" }, 400);
  const p = { lat: Number(latText), lon: Number(lonText) };
  if (!terrainValidPoint(p))
    return terrainJson({ error: "Invalid coordinates" }, 400);
  try {
    const meters = await terrainElevationAt(p.lat, p.lon);
    return terrainJson({
      source: "USGS 3DEP / EPQS",
      latitude: p.lat, longitude: p.lon,
      elevationMeters: meters,
      elevationFeet: Math.round(meters * 3.280839895 * 10) / 10
    });
  } catch (error) {
    console.error("USGS elevation failed:", error);
    return terrainJson({ error: "USGS elevation unavailable" }, 502);
  }
}
async function handleTerrainProfile(request) {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: TERRAIN_CORS });
  if (request.method !== "POST")
    return terrainJson({ error: "Use POST for terrain profiles" }, 405);
  try {
    if (Number(request.headers.get("content-length")) > 10000)
      return terrainJson({ error: "Request body too large" }, 413);
    const body = await request.json();
    const { tx, rx, samples = 48 } = body || {};
    if (!terrainValidPoint(tx) || !terrainValidPoint(rx) ||
        (tx.lat === rx.lat && tx.lon === rx.lon))
      return terrainJson({ error: "Invalid transmitter or receiver coordinates" }, 400);
    if (!Number.isInteger(samples) || samples < 2 || samples > 120)
      return terrainJson({ error: "Sample count must be 2 through 120" }, 400);

    // Staging profile: USGS 3DEP polyline plus exact RX elevation check.
    const geometry = {
      paths: [[[tx.lon, tx.lat], [rx.lon, rx.lat]]],
      spatialReference: { wkid: 4326 }
    };
    const usgs = new URL(
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples"
    );
    usgs.searchParams.set("geometryType", "esriGeometryPolyline");
    usgs.searchParams.set("geometry", JSON.stringify(geometry));
    usgs.searchParams.set("sampleCount", String(samples));
    usgs.searchParams.set("f", "json");
    const response = await fetch(usgs.toString(), {
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok)
      throw new Error("USGS profile HTTP " + response.status);
    const data = await response.json();
    if (data.error || !Array.isArray(data.samples) || data.samples.length < 2)
      throw new Error("USGS returned an invalid terrain profile");
    const ordered = [...data.samples].sort((a, b) => a.locationId - b.locationId);
    const ids = ordered.map(s => s.locationId);
    if (ids.some(id => !Number.isInteger(id) || id < 0) ||
        ordered.some(s => !s.location || !Number.isFinite(Number(s.value))))
      throw new Error("Terrain samples include invalid locations or elevations");

    const presentIds = new Set(ids), missingIds = [];
    for (let id = 0; id <= Math.max(...ids); id++)
      if (!presentIds.has(id)) missingIds.push(id);

    const receiverElevation = await terrainElevationAt(rx.lat, rx.lon);
    const last = ordered[ordered.length - 1];
    const endpointAlreadySampled =
      Math.abs(Number(last.location.x) - rx.lon) < 0.0000001 &&
      Math.abs(Number(last.location.y) - rx.lat) < 0.0000001;
    if (endpointAlreadySampled) {
      last.value = receiverElevation;
      last.exactEndpoint = true;
    } else {
      ordered.push({
        locationId: Math.max(...ids) + 1,
        location: { x: rx.lon, y: rx.lat, spatialReference: { wkid: 4326 } },
        value: receiverElevation, exactEndpoint: true
      });
    }
    return terrainJson({
      source: "USGS 3DEP",
      sampleCount: ordered.length,
      complete: missingIds.length === 0 && endpointAlreadySampled,
      missingSampleIds: missingIds,
      endpointAdded: !endpointAlreadySampled,
      samples: ordered
    });
  } catch (error) {
    console.error("Terrain profile failed:", error);
    return terrainJson({ error: "USGS terrain profile unavailable" }, 502);
  }
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Terrain dispatch precedes the original GET-only FCC method check.
    if (url.pathname === "/terrain/elevation")
      return handleTerrainElevation(request, url);
    if (url.pathname === "/terrain/profile")
      return handleTerrainProfile(request);
    if (url.pathname === "/terrain/multipoint")
      return handleTerrainMultipoint(request);
    if (url.pathname === "/terrain/catalog")
      return handleTerrainCatalog(request);
    if (url.pathname.startsWith("/terrain/")) {
      if (request.method === "OPTIONS")
        return new Response(null, { status: 204, headers: TERRAIN_CORS });
      return terrainJson({ error: "Endpoint not found" }, 404);
    }

    // PRESERVED FCC behavior from existing production Cloudflare Worker.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "GET") {
      return json({ error: "Method not allowed. Use GET." }, 405, {
        Allow: "GET, OPTIONS"
      });
    }
    if (url.pathname === "/") {
      return json({
        name: "How Far Can That Tower See API",
        status: "running",
        dataSource: "Imported FCC ASR registration records",
        databaseBindingConfigured: Boolean(env?.DB)
      });
    }
    if (url.pathname !== "/tower")
      return json({ error: "Not found" }, 404);
    const asrn = (url.searchParams.get("asrn") || "").trim();
    if (!/^\d{7}$/.test(asrn)) {
      return json({
        error: "Enter a seven-digit FCC ASRN.",
        example: "/tower?asrn=1004233"
      }, 400);
    }
    if (!env?.DB) {
      return json({
        error: "Database unavailable.",
        message: "The Worker needs a D1 database binding named DB."
      }, 503);
    }
    try {
      const tower = await env.DB.prepare(
        "SELECT asrn, street_address, city, state, latitude, longitude,\n" +
        "                tower_height_m, ground_elevation_m, fcc_status, imported_at\n" +
        "         FROM towers WHERE asrn = ?"
      ).bind(asrn).first();
      if (!tower) {
        return json({
          asrn, error: "Tower not found.",
          message: "This ASRN is not in the imported FCC registration snapshot. Check the number or the FCC ASR search."
        }, 404);
      }
      if (!validNumber(tower.tower_height_m) || tower.tower_height_m < 0) {
        return json({
          asrn,
          error: "Registered tower height unavailable.",
          message: "This FCC record has no usable overall height AGL. Use manual inputs for this tower."
        }, 422);
      }
      const towerHeightFeet = roundOne(tower.tower_height_m / METERS_PER_FOOT);
      const estimatedRadiationCenterFeet =
        roundOne(Math.max(0, tower.tower_height_m - SETBACK_METERS) / METERS_PER_FOOT);
      const baseElevationFeet = validNumber(tower.ground_elevation_m) ?
        roundOne(tower.ground_elevation_m / METERS_PER_FOOT) : null;
      const hasCoordinates =
        validNumber(tower.latitude) && Math.abs(tower.latitude) <= 90 &&
        validNumber(tower.longitude) && Math.abs(tower.longitude) <= 180;
      const warnings = [
        "Radiation center is estimated as 8 meters below the registered overall tower top; it is not an FCC antenna measurement. Enter the actual antenna radiation center when known."
      ];
      if (tower.fcc_status !== "C") {
        warnings.push("This record has FCC status code " +
          (tower.fcc_status || "unknown") +
          ". Verify its construction and current existence in FCC ASR before using its height.");
      }
      if (baseElevationFeet === null)
        warnings.push("Base elevation is missing; enter it manually.");
      if (!hasCoordinates)
        warnings.push("Main tower coordinates are unavailable.");
      const site = [tower.city, tower.state].filter(Boolean).join(", ");
      const location = [tower.street_address, site].filter(Boolean).join(", ") ||
        (hasCoordinates ? tower.latitude + ", " + tower.longitude : "ASRN " + asrn);
      const importedDate = typeof tower.imported_at === "string" ?
        tower.imported_at.slice(0, 10) : "unknown date";
      return json({
        asrn,
        siteName: site ? site + " \u00B7 ASRN " + asrn : "ASRN " + asrn,
        location,
        latitude: hasCoordinates ? tower.latitude : null,
        longitude: hasCoordinates ? tower.longitude : null,
        towerHeightFeet, estimatedRadiationCenterFeet,
        baseElevationFeet, receiverHeightFeet: 6,
        fccStatus: tower.fcc_status,
        importedAt: tower.imported_at,
        radiationCenterMethod:
          "Estimated as 8 meters below registered overall height AGL, including appurtenances",
        warning: warnings.join(" "),
        source: "FCC ASR registration download, imported " + importedDate +
          ". Snapshot data; not a live FCC query."
      });
    } catch (error) {
      console.error("FCC tower database query failed:", error);
      return json({
        error: "Tower database lookup failed.",
        message: "The database could not be read. Try again or continue with manual inputs."
      }, 503);
    }
  }
};
export default worker;

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
