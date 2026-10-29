// Non-deploying contract regression for the production Worker candidate.
// Run: node tests/check-worker-candidate.mjs
// Mock upstream USGS and D1; no network and no production writes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const path = fileURLToPath(new URL("../cloudflare/production-worker-v2-candidate.js", import.meta.url));
const source = readFileSync(path, "utf8");
assert(source.includes("export default worker;"), "Expected standalone ES module Worker");
const mockCalls = [];
let upstreamError = false, missingLastPoint = false;
const mockFetch = async (input) => {
  const u = new URL(input);
  mockCalls.push(u.toString());
  if (u.hostname === "epqs.nationalmap.gov")
    return Response.json({value:57.56});
  if (u.pathname.endsWith("/ImageServer/query")) {
    assert.equal(u.searchParams.get("returnGeometry"),"false");
    assert(u.searchParams.get("objectIds").split(",").includes("88413"));
    return Response.json({features:[{attributes:{
      OBJECTID:88413,Name:"MA_CentralEastern_2021_B21",
      ProductName:"USGS_3DEP",Source:"USGS",
      AcquisitionDate:1622505600000,DEM_Type:1
    }}]});
  }
  assert(u.pathname.endsWith("/ImageServer/getSamples"), "Unexpected upstream route");
  const geometry = JSON.parse(u.searchParams.get("geometry"));
  if (u.searchParams.get("geometryType") === "esriGeometryMultipoint") {
    if (upstreamError)
      return Response.json({error:"USGS temporarily unavailable"},{status:502});
    assert(u.searchParams.get("outFields")?.includes("Name"),
      "USGS provenance attributes must be requested");
    const points = missingLastPoint ? geometry.points.slice(0,-1) : geometry.points;
    const samples = points.map(([x,y],index) => ({
      locationId:index, value:60 + index / 10,
      rasterId:88413,resolution:1,
      attributes:{Name:"MA_CentralEastern_2021_B21",
        ProductName:"USGS_3DEP",Source:"USGS"},
      location:{x,y,spatialReference:{wkid:4326}}
    })).reverse();
    return Response.json({samples});
  }
  assert.equal(u.searchParams.get("geometryType"),"esriGeometryPolyline");
  const count = Number(u.searchParams.get("sampleCount"));
  const segment = geometry.paths[0];
  const a = segment[0], b = segment[segment.length - 1];
  const samples = Array.from({length:count},(_,index)=>{
    const t = index / (count - 1);
    return {
      locationId:index,value:60 + index/10,
      location:{x:a[0]+(b[0]-a[0])*t,y:a[1]+(b[1]-a[1])*t}
    };
  });
  return Response.json({samples});
};
const sandbox = {
  URL, Response, AbortSignal, fetch:mockFetch,
  console:{error:()=>{}}
};
runInNewContext(source.replace("export default worker;","globalThis.__worker = worker;"),sandbox,{
  filename:"production-worker-v2-candidate.js",timeout:5000
});
const worker = sandbox.__worker;
assert.equal(typeof worker?.fetch, "function");
const preparedSQL = [];
const env = {DB:{
  prepare(sql) {
    preparedSQL.push(sql);
    assert(sql.includes("FROM towers WHERE asrn = ?"));
    return {bind(asrn) {
      return {async first() {
        if (asrn === "9999999") return null;
        if (asrn === "8888888") return {asrn,tower_height_m:null};
        return {
          asrn,street_address:"140 Cabot Street",city:"Needham",state:"MA",
          latitude:42.29,longitude:-71.23,tower_height_m:365.99,
          ground_elevation_m:57.56,fcc_status:"C",
          imported_at:"2026-09-30T12:00:00Z"
        };
      }};
    }};
  }
}};
const tests=[];
async function probe(label,path,method="GET",data=undefined,expectedStatus=200,fields={},overrideEnv=env) {
  const init={method};
  if(data!==undefined){
    init.headers={"Content-Type":"application/json"};
    init.body=JSON.stringify(data);
  }
  const response=await worker.fetch(
    new Request("https://tower-data-api.mac1584.workers.dev"+path,init),overrideEnv
  );
  assert.equal(response.status,expectedStatus,label+" HTTP");
  if(Object.keys(fields).length) {
    const result=await response.json();
    for(const [key,value] of Object.entries(fields))
      assert.deepEqual(result[key],value,label+" property "+key);
    tests.push(label);
    return {result,response};
  }
  tests.push(label);
  return {response};
}
const pair={
  tx:{lat:42.29,lon:-71.23},rx:{lat:42.3601,lon:-71.0589},samples:48
};
await probe("FCC root","/","GET",undefined,200,{
  name:"How Far Can That Tower See API",databaseBindingConfigured:true
});
const fcc=(await probe("FCC successful lookup","/tower?asrn=1004233","GET",
  undefined,200,{asrn:"1004233",receiverHeightFeet:6,fccStatus:"C"})).result;
for (const key of [
  "siteName","location","latitude","longitude","towerHeightFeet",
  "estimatedRadiationCenterFeet","baseElevationFeet","radiationCenterMethod",
  "warning","source","importedAt"
])assert(key in fcc,"FCC output missing "+key);
await probe("FCC invalid ASRN","/tower?asrn=bad","GET",undefined,400,
  {error:"Enter a seven-digit FCC ASRN."});
await probe("FCC unknown ASRN","/tower?asrn=9999999","GET",undefined,404,
  {error:"Tower not found."});
await probe("FCC missing height","/tower?asrn=8888888","GET",undefined,422,
  {error:"Registered tower height unavailable."});
await probe("FCC missing DB","/tower?asrn=1004233","GET",undefined,503,
  {error:"Database unavailable."},{});
await probe("FCC POST still blocked","/tower?asrn=1004233","POST",undefined,405,
  {error:"Method not allowed. Use GET."});
const fccOpt=await probe("FCC preflight unchanged","/tower","OPTIONS",undefined,204);
assert.equal(fccOpt.response.headers.get("Access-Control-Allow-Methods"),"GET, OPTIONS");
await probe("FCC unknown route","/not-found","GET",undefined,404,{error:"Not found"});
const elev=(await probe("USGS elevation","/terrain/elevation?lat=42.29&lon=-71.23","GET",
  undefined,200,{source:"USGS 3DEP / EPQS"})).result;
assert.equal(elev.elevationMeters,57.56);
await probe("USGS elevation invalid","/terrain/elevation?lat=99&lon=-71","GET",
  undefined,400,{error:"Invalid coordinates"});
await probe("USGS elevation POST blocked","/terrain/elevation","POST",pair,405);
const profile=(await probe("USGS polyline profile","/terrain/profile","POST",
  pair,200,{source:"USGS 3DEP"})).result;
assert(profile.samples.length >= 48);
await probe("USGS polyline GET blocked","/terrain/profile","GET",undefined,405);
const pre=await probe("USGS CORS preflight","/terrain/profile","OPTIONS",undefined,204);
assert.equal(pre.response.headers.get("Access-Control-Allow-Methods"),"GET, POST, OPTIONS");
const multi=(await probe("USGS 48-point multipoint","/terrain/multipoint","POST",
  pair,200,{sampleMethod:"multipoint",requestedCount:48,returnedCount:48,complete:true})).result;
assert.equal(multi.samples.length,48);
assert.equal(multi.samples[0].location.x,pair.tx.lon);
assert.equal(multi.samples[47].location.x,pair.rx.lon);
assert.equal(multi.samples[0].rasterId,88413);
assert.equal(multi.samples[0].resolution,1);
assert.equal(multi.samples[0].sourceDetails.name,"MA_CentralEastern_2021_B21");
missingLastPoint=true;
const partial=(await probe("USGS missing sample stays unknown","/terrain/multipoint","POST",
  pair,200,{returnedCount:47,complete:false})).result;
assert.deepEqual(Array.from(partial.missingIndices),[47]);
missingLastPoint=false; upstreamError=true;
await probe("USGS upstream HTTP 502 propagated","/terrain/multipoint","POST",pair,502);
upstreamError=false;
await probe("USGS invalid sample request","/terrain/multipoint","POST",
  {...pair,samples:200},400);
const catalog=(await probe("USGS source catalog lookup",
  "/terrain/catalog?ids=88413","GET",undefined,200,
  {source:"USGS 3DEP ImageServer raster catalog"})).result;
assert.equal(catalog.records["88413"].name,"MA_CentralEastern_2021_B21");
assert.equal(catalog.records["88413"].demTypeCode,1);
await probe("USGS source catalog rejects untrusted IDs",
  "/terrain/catalog?ids=88413,xx","GET",undefined,400);
await probe("USGS source catalog rejects POST",
  "/terrain/catalog?ids=88413","POST",pair,405);
await probe("USGS unknown route","/terrain/unknown","GET",undefined,404,
  {error:"Endpoint not found"});
assert(preparedSQL.length>=3,"D1 lookup must be exercised");
console.log("PASS: "+tests.length+" mocked FCC and USGS Worker contract cases.");
console.log("D1 lookup binding: env.DB | No D1 writes | No Cloudflare deployment.");
