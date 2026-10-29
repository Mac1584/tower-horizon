// End-to-end 360 scan metadata test: emulate 12 successful USGS multipoint
// responses and confirm per-sample source data reaches the report snapshot.
// No external network. Run: node tests/check-360-provenance.mjs
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {runInNewContext} from "node:vm";

const terrain=readFileSync(fileURLToPath(new URL("../terrain.js",import.meta.url)),"utf8");
const sources=readFileSync(fileURLToPath(new URL("../terrain-sources.js",import.meta.url)),"utf8");
const DEG=Math.PI/180, R=6371000;
function interpolate(a,b,f) {
  const dlat=(b.lat-a.lat)*DEG,dlon=(b.lon-a.lon)*DEG;
  const h=Math.sin(dlat/2)**2+
    Math.cos(a.lat*DEG)*Math.cos(b.lat*DEG)*Math.sin(dlon/2)**2;
  const arc=2*Math.asin(Math.min(1,Math.sqrt(h)));
  if(arc<1e-8)return {lat:a.lat+(b.lat-a.lat)*f,lon:a.lon+(b.lon-a.lon)*f};
  const A=Math.sin((1-f)*arc)/Math.sin(arc),B=Math.sin(f*arc)/Math.sin(arc);
  const lat1=a.lat*DEG,lat2=b.lat*DEG,lon1=a.lon*DEG,lon2=b.lon*DEG;
  const x=A*Math.cos(lat1)*Math.cos(lon1)+B*Math.cos(lat2)*Math.cos(lon2);
  const y=A*Math.cos(lat1)*Math.sin(lon1)+B*Math.cos(lat2)*Math.sin(lon2);
  const z=A*Math.sin(lat1)+B*Math.sin(lat2);
  return {lat:Math.atan2(z,Math.hypot(x,y))/DEG,
    lon:Math.atan2(y,x)/DEG};
}
let calls=0;
const fetchMock=async (url,options)=>{
  assert.match(String(url),/\/terrain\/multipoint$/);
  const req=JSON.parse(options.body);
  assert.equal(req.samples,48);
  calls++;
  const points=Array.from({length:48},(_,i)=>{
    const p=interpolate(req.tx,req.rx,i/47);
    return {index:i,location:{
      x:p.lon,y:p.lat,spatialReference:{wkid:4326}
    },value:44.86+i/10,rasterId:i%2?88413:130833,
      resolution:1,sourceDetails:{
        name:i%2?"MA_CentralEastern_2021_B21":"MA_Other_2021",
        provider:"USGS",product:"USGS_3DEP"
      }};
  });
  return Response.json({sampleMethod:"multipoint",requestedCount:48,
    returnedCount:48,complete:true,samples:points});
};
const initial={
  terrainTxLat:"42.30297222",terrainTxLon:"-71.21802778",
  terrainRxLat:"42.3601",terrainRxLon:"-71.0589",
  receiverHeight:"6",terrainReceiverHeight:"6",radCenter:"1174.5",
  towerHeight:"1200.8",baseElevation:"150.9",
  terrainK:"1.3333333333333",terrainBearings:"12",
  terrainBasemap:"muted",location:"Needham, MA",asrn:"1004233"
};
const controls=new Map();
function node(id) {
  if(!controls.has(id))controls.set(id,{
    id,value:initial[id]||"",textContent:"",
    classList:{add(){},remove(){},toggle(){}},
    disabled:false,listeners:{},
    addEventListener(type,handler){this.listeners[type]=handler;},
    dispatchEvent(){}
  });
  return controls.get(id);
}
const window={
  addEventListener(){},dispatchEvent(){},
  // No Leaflet: 360 geometry is valid without rendering a map.
  location:{href:"https://tower-horizon-v2-staging.pages.dev"}
};
const sandbox={
  window,document:{getElementById:node},
  fetch:fetchMock,URL,Response,AbortController,AbortSignal,
  setTimeout,clearTimeout,Event:class Event {constructor(type){this.type=type}},
  console:{log(){},warn(){}},Math,Date
};
runInNewContext(terrain,sandbox,{filename:"terrain.js",timeout:3000});
runInNewContext(sources,sandbox,{filename:"terrain-sources.js",timeout:3000});
assert.equal(typeof node("analyzeCoverage").listeners.click,"function");
await node("analyzeCoverage").listeners.click();
const scan=window.TowerHorizonData.getCoverage();
assert(scan,"Scan snapshot missing");
assert.equal(scan.complete,true);
assert.equal(scan.bearings,12);
assert.equal(scan.failedBearings,0);
assert.equal(scan.radialData.length,12);
assert.equal(calls,12,"Expected 12 uncached USGS multipoint requests");
const samples=window.TowerHorizonTerrainSources.coverageSamples(scan);
assert.equal(samples.length,576);
assert(samples.every(p=>p.elevationM>0&&p.distanceM>=0));
assert(samples.every(p=>p.resolution===1),"360 source resolution was dropped");
assert(samples.every(p=>[88413,130833].includes(p.rasterId)),"360 raster IDs were dropped");
assert(samples.every(p=>p.sourceDetails?.name?.startsWith("MA_")),
  "360 source project names were dropped");
const summary=window.TowerHorizonTerrainSources.summarize(samples);
assert.equal(summary.knownResolutionSamples,576);
assert.equal(summary.knownRasterSamples,576);
assert.equal(summary.rasterCount,2);
assert.equal(summary.resolutionText,"1 m (576)");
assert(summary.projectText.includes("MA_CentralEastern_2021_B21"));
assert(summary.projectText.includes("MA_Other_2021"));
console.log("PASS: 12-bearing 360 scan retains all 576 per-sample USGS raster IDs, 1m resolution and source project names.");
console.log("      Visibility calculations continue through the original sampled-radial pipeline.");
