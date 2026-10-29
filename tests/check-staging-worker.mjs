// Staging-only Worker smoke tests. No external network or Cloudflare changes.
// Run: node tests/check-staging-worker.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const source=readFileSync(fileURLToPath(
  new URL("../cloudflare/staging-worker-v2-provenance.js",import.meta.url)),"utf8");
assert(source.includes("export default worker;"));
assert(!source.includes("env.DB"),"Staging must not access FCC D1");
const requests=[];
const mockFetch=async uri=>{
  const url=new URL(uri);
  requests.push(url);
  if(url.hostname==="epqs.nationalmap.gov")
    return Response.json({value:44.86});
  if(url.hostname==="geocoding.geo.census.gov")
    return Response.json({result:{addressMatches:[]}});
  if(url.pathname.endsWith("/ImageServer/query")) {
    assert.equal(url.searchParams.get("returnGeometry"),"false");
    return Response.json({features:[{attributes:{
      OBJECTID:88413,Name:"MA_CentralEastern_2021_B21",
      ProductName:"USGS_3DEP",Source:"USGS",
      AcquisitionDate:1622505600000,DEM_Type:1
    }}]});
  }
  assert(url.pathname.endsWith("/ImageServer/getSamples"));
  const geometry=JSON.parse(url.searchParams.get("geometry"));
  if(url.searchParams.get("geometryType")==="esriGeometryMultipoint") {
    assert(url.searchParams.get("outFields")?.includes("Name"));
    return Response.json({samples:geometry.points.map(([x,y],i)=>({
      locationId:i,value:44.86+i/10,
      rasterId:88413,resolution:1,
      attributes:{Name:"MA_CentralEastern_2021_B21",ProductName:"USGS_3DEP"},
      location:{x,y,spatialReference:{wkid:4326}}
    })).reverse()});
  }
  const n=Number(url.searchParams.get("sampleCount"));
  const xy=geometry.paths[0],a=xy[0],b=xy[xy.length-1];
  return Response.json({samples:Array.from({length:n},(_,i)=>{
    const f=i/(n-1);
    return {locationId:i,value:44.86+i/10,
      location:{x:a[0]+(b[0]-a[0])*f,y:a[1]+(b[1]-a[1])*f}};
  })});
};
const sandbox={
  URL,Response,AbortSignal,fetch:mockFetch,console:{error:()=>{}}
};
runInNewContext(source.replace("export default worker;","globalThis.__worker = worker;"),
  sandbox,{filename:"staging-worker-v2-provenance.js"});
const worker=sandbox.__worker;
const checks=[];
async function check(label,url,method="GET",body,code=200) {
  const init={method};
  if(body) { init.body=JSON.stringify(body);init.headers={"Content-Type":"application/json"}; }
  const response=await worker.fetch(new Request("https://tower-terrain-staging.mac1584.workers.dev"+url,init));
  assert.equal(response.status,code,label);
  checks.push(label);
  return response.status===204?null:response.json();
}
const tx={lat:42.30297222,lon:-71.21802778};
const rx={lat:42.3601,lon:-71.0589};
const body={tx,rx,samples:48};
const root=await check("staging root available","/");
assert.equal(root.status,"running");
const elev=await check("USGS elevation","/terrain/elevation?lat=42.29&lon=-71.23");
assert.equal(elev.elevationMeters,44.86);
const multi=await check("USGS multipoint with DEM source metadata",
 "/terrain/multipoint","POST",body);
assert.equal(multi.sampleMethod,"multipoint");
assert.equal(multi.returnedCount,48);
assert.equal(multi.complete,true);
assert.equal(multi.samples[0].rasterId,88413);
assert.equal(multi.samples[0].resolution,1);
assert.equal(multi.samples[0].sourceDetails.name,"MA_CentralEastern_2021_B21");
const profile=await check("legacy polyline remains available",
  "/terrain/profile","POST",body);
assert(profile.samples.length>=48);
const metadata=await check("read-only USGS catalog","/terrain/catalog?ids=88413");
assert.equal(metadata.records["88413"].name,"MA_CentralEastern_2021_B21");
await check("catalog rejects invalid IDs","/terrain/catalog?ids=notanid", "GET",null,400);
await check("catalog rejects POST","/terrain/catalog?ids=88413","POST",body,405);
await check("multipoint requires POST","/terrain/multipoint","GET",null,405);
await check("GET unknown route returns 404","/terrain/nope","GET",null,404);
await check("CORS for new endpoints","/terrain/catalog","OPTIONS",null,204);
const geocode=await check("Census geocode preserved",
 "/terrain/geocode?address=140+Cabot+Street+Needham+MA");
assert(Array.isArray(geocode.result.addressMatches));
console.log("PASS: "+checks.length+" staging-only terrain Worker contract cases; no deployment.");
