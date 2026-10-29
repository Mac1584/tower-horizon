/**
 * Tower Horizon 2.0 - COMPLETE STAGING TERRAIN WORKER CANDIDATE.
 *
 * NEVER PASTE THIS INTO tower-data-api (production FCC Worker).
 * ONLY for the pre-existing tower-terrain-staging Worker, after backing up
 * its current source. This file is NOT deployed automatically by GitHub.
 * No D1 bindings or FCC lookup in staging; the staged website uses the
 * existing tower-data-api production FCC endpoint for its tower records.
 *
 * Routes: GET /terrain/elevation, POST /terrain/profile,
 * POST /terrain/multipoint (with USGS raster provenance),
 * GET /terrain/catalog (read-only raster lookup), and GET /terrain/geocode.
 * The original staging root remains a simple status JSON.
 */
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


async function handleTerrainGeocode(request, url) {
  if(request.method==="OPTIONS")
    return new Response(null,{status:204,headers:TERRAIN_CORS});
  if(request.method!=="GET")
    return terrainJson({error:"Use GET for street address lookups"},405);
  const address=(url.searchParams.get("address")||"").trim();
  if(address.length<7||address.length>200)
    return terrainJson({error:"Provide a US address of 7-200 characters"},400);
  const census=new URL("https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress");
  census.searchParams.set("address",address);
  census.searchParams.set("benchmark","Public_AR_Current");
  census.searchParams.set("vintage","Current_Current");
  census.searchParams.set("format","json");
  try {
    const response=await fetch(census.toString(),{
      signal:AbortSignal.timeout(12000)
    });
    if(!response.ok)throw new Error("Census HTTP "+response.status);
    return terrainJson(await response.json());
  } catch(error) {
    console.error("Staging geocode failed",error);
    return terrainJson({error:"Address lookup temporarily unavailable"},502);
  }
}

const worker = {
  async fetch(request) {
    const url=new URL(request.url);
    if(url.pathname==="/terrain/elevation")
      return handleTerrainElevation(request,url);
    if(url.pathname==="/terrain/profile")
      return handleTerrainProfile(request);
    if(url.pathname==="/terrain/multipoint")
      return handleTerrainMultipoint(request);
    if(url.pathname==="/terrain/catalog")
      return handleTerrainCatalog(request);
    if(url.pathname==="/terrain/geocode")
      return handleTerrainGeocode(request,url);
    if(request.method==="OPTIONS")
      return new Response(null,{status:204,headers:TERRAIN_CORS});
    if(url.pathname==="/" && request.method==="GET")
      return terrainJson({
        name:"Tower Horizon Terrain Staging API",
        status:"running",
        endpoints:["/terrain/elevation","/terrain/profile",
          "/terrain/multipoint","/terrain/catalog","/terrain/geocode"]
      });
    return terrainJson({error:"Not found"},404);
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
