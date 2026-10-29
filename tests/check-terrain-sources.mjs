// USGS source attribution is optional and MUST NOT change terrain clearance.
// Run: node tests/check-terrain-sources.mjs
// No real USGS, Cloudflare, or FCC network requests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
const path=fileURLToPath(new URL("../terrain-sources.js",import.meta.url));
const source=readFileSync(path,"utf8");
const requests=[];
let unavailable=false;
const fetchMock=async url=>{
  requests.push(String(url));
  const u=new URL(url);
  assert.equal(u.pathname,"/terrain/catalog");
  assert.equal(u.searchParams.get("ids"),"88413,90000");
  if(unavailable)return Response.json({error:"temporary outage"},{status:502});
  return Response.json({records:{
    "88413":{rasterId:88413,name:"MA_CentralEastern_2021_B21",
      product:"USGS_3DEP",acquisitionDate:1622505600000},
    "90000":{rasterId:90000,name:"MA_Other_Project",
      acquisitionDate:null}
  }});
};
const sandbox={
  window:{TowerHorizonData:{getTerrainApi:()=>
    "https://tower-terrain-staging.mac1584.workers.dev"}},
  fetch:fetchMock,AbortController,setTimeout,clearTimeout,
  console:{warn:()=>{}}
};
runInNewContext(source,sandbox,{filename:"terrain-sources.js"});
const api=sandbox.window.TowerHorizonTerrainSources;
assert(api?.describe&&api?.describeCoverage&&api?.summarize);
const checks=[];
function pass(name,fn) {
  checks.push(name);
  console.log("PASS: "+name);
}
const site=(rasterId,resolution,sourceDetails=null)=>({
  lat:42.3,lon:-71.2,elev:44,rasterId,resolution,sourceDetails
});
let summary=api.summarize([
  site(88413,1,{name:"MA_CentralEastern_2021_B21"}),
  site(88413,1),site(90000,10),site(null,null)
]);
assert.equal(summary.sampleCount,4);
assert.equal(summary.rasterCount,2);
assert.equal(summary.knownResolutionSamples,3);
assert.equal(summary.knownRasterSamples,3);
assert(summary.resolutionText.includes("1 m (2)"));
assert(summary.resolutionText.includes("10 m (1)"));
assert(summary.resolutionText.includes("not reported (1)"));
assert(summary.projectText.includes("MA_CentralEastern_2021_B21"));
pass("Mixed 1m/10m/unknown DEM resolution stays distinct from sample spacing");

const old=api.summarize([site(null,null),site(null,null)]);
assert.equal(old.sampleCount,2);
assert.equal(old.rasterCount,0);
assert(old.resolutionText.includes("Not reported"));
pass("Legacy Worker response lacking provenance is explicitly not reported");

summary=await api.describe([site(88413,1),site(88413,1),site(90000,10)]);
assert.equal(requests.length,1);
assert.equal(summary.sources.length,2);
assert(summary.projectText.includes("MA_CentralEastern_2021_B21"));
assert(summary.projectText.includes("MA_Other_Project"));
const ma=summary.sources.find(s=>s.rasterId===88413);
assert.equal(ma.year,2021);
assert.equal(ma.count,2);
pass("Optional catalog lookup attaches project identity and acquisition year");

summary=await api.describe([site(88413,1),site(90000,10)]);
assert.equal(requests.length,1,"Memoized raster IDs should avoid duplicate lookups");
pass("Repeated reports reuse cached catalog metadata");

const inline=await api.describe([site(13,3,{name:"Already named in USGS sample"})]);
assert.equal(requests.length,1,"Inline attributes should require no catalog query");
assert(inline.projectText.includes("Already named"));
pass("Inline USGS outFields source names require no extra request");

const cover=await api.describeCoverage({
  radialData:[
    {samples:[site(88413,1),site(90000,10)]},
    {samples:[site(88413,1)]},
    {samples:null,status:"missing"}
  ]
});
assert.equal(cover.sampleCount,3);
assert(cover.resolutionText.includes("1 m (2)"));
pass("360 coverage aggregates all verified radial samples");

const oldApi=sandbox.window.TowerHorizonData;
sandbox.window.TowerHorizonData={getTerrainApi:()=>null};
unavailable=true;
const none=await api.describe([site(123456,30)]);
assert(none.projectText.includes("project names unavailable"));
assert(none.resolutionText.includes("30 m (1)"));
sandbox.window.TowerHorizonData=oldApi;
pass("Absent catalog endpoint cannot erase source resolutions or block a report");

const na=api.summarize([
  site(5,0),site(5,-1),site(5,null),site(5,""),
  site(5,1.25)
]);
assert.equal(na.knownResolutionSamples,1);
assert(na.resolutionText.includes("1.25 m (1)"));
assert(na.resolutionText.includes("not reported (4)"));
pass("Invalid resolutions never become fabricated 0m or 1m samples");
console.log("PASS: "+checks.length+" USGS DEM source-provenance cases.");
