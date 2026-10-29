// Offline 360 PDF export regression: exercises the button -> one-page report
// with a fully completed 12-bearing scan and real geometric conversions.
// Catches ReferenceError for missing constants such as "MI" in export.js.
// Usage: node tests/check-360-pdf.mjs (no network, browser or PDF dependency)
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {runInNewContext} from "node:vm";
const source=readFileSync(fileURLToPath(new URL("../export.js",import.meta.url)),"utf8");
const scan={
  tx:{lat:42.30297222,lon:-71.21802778},
  radiusM:51.9*1609.344, samplesPerBearing:48,
  bearings:12, rings:40, failedBearings:0, unknownSectors:0,
  terrainVisibleAreaSqMi:6085, complete:true,
  cells:[{
    status:"terrain_clear",
    vertices:[
      {lat:42.40,lon:-71.20},
      {lat:42.40,lon:-71.10},
      {lat:42.35,lon:-71.15}
    ]
  }],
  radialData:[]
};
const controls=new Map();
function node(id) {
  if(!controls.has(id))controls.set(id,{
    id,
    value:({asrn:"1004233",location:"Needham, MA",
      terrainTxLat:"42.30297222",terrainTxLon:"-71.21802778",
      terrainRxLat:"42.3601",terrainRxLon:"-71.0589",
      radCenter:"1174.5",receiverHeight:"6",
      baseElevation:"150.9",terrainK:"1.3333333333333"})[id] || "",
    textContent:({radioHorizon:"51.9 mi",geometricHorizon:"45 mi",
      terrainArea:"6,085 mi²",terrainResult:"-",pathClearance:"-"})[id] || "",
    classList:{toggle(){}}, listeners:{}, disabled:false,
    addEventListener(event,handler){this.listeners[event]=handler;}
  });
  return controls.get(id);
}
const ctxCalls=[];
function context() {
  const ctx={};
  for(const f of ["drawImage","beginPath","closePath","moveTo","lineTo",
    "save","restore","rect","clip","fill","stroke","arc",
    "setLineDash","setTransform","fillRect","fillText"]){
    ctx[f]=(...args)=>{ctxCalls.push([f,args]);};
  }
  return ctx;
}
const canvas=()=>({
  width:800,height:420,
  getContext:()=>context(),
  toDataURL:()=> "data:image/jpeg;base64,ZmFrZQ=="
});
const restore=[];
const map={
  getCenter:()=>({lat:42.3,lng:-71.2}),
  getZoom:()=>9,
  fitBounds:(bounds)=>{restore.push(["fitBounds",bounds]);},
  setView:(center,zoom)=>{restore.push(["setView",zoom]);},
  getSize:()=>({x:800,y:420}),
  latLngToContainerPoint:([lat,lon])=>
    ({x:400+(lon+71.218)*160,y:210-(lat-42.303)*160})
};
const lines=[];
let completed;
const savedPromise=new Promise((resolve,reject)=>{
  completed={resolve,reject};
});
class Doc {
  setFillColor(){} setDrawColor(){} setTextColor(){} setFont(){}
  setFontSize(){} setLineWidth(){} line(){} rect(){} roundedRect(){}
  addImage(){}
  splitTextToSize(v){return [v];}
  getTextWidth(v){return String(v).length*3.2;}
  text(v){lines.push(Array.isArray(v)?v.join(" "):String(v));}
  save(filename){completed.resolve(filename);}
}
const sandbox={
  document:{getElementById:node,createElement:canvas},
  window:{
    TowerHorizonData:{getMap:()=>map,getCoverage:()=>scan},
    TowerHorizonTerrainSources:{describeCoverage:async()=>({
      resolutionText:"1 m (576)",
      projectText:"MA_CentralEastern_2021_B21"
    })},
    html2canvas:async()=>canvas(),
    jspdf:{jsPDF:Doc},
    addEventListener(){},
    devicePixelRatio:1
  },
  setTimeout,clearTimeout,Date,URL,
  console:{warn:()=>{},error:(...x)=>completed.reject(new Error(x.join(" ")))}
};
runInNewContext(source,sandbox,{filename:"export.js",timeout:3000});
const button=node("exportReportPdf");
assert.equal(typeof button.listeners.click,"function","PDF button listener missing");
button.listeners.click();
const file=await Promise.race([
  savedPromise,
  new Promise((_,reject)=>setTimeout(()=>reject(new Error(
    "360 PDF export timed out or encountered an error: "+
    node("exportStatus").textContent)),3500))
]);
assert.match(file,/1004233.*one-page-report\.pdf$/);
assert(lines.some(s=>s.includes("USGS DEM raster resolution: 1 m (576)")));
assert(lines.some(s=>s.includes("USGS source projects: MA_CentralEastern_2021_B21")));
assert(lines.some(s=>s.includes("48 points, ~1.1 mi apart")));
assert(lines.some(s=>s.includes("6,085 sq mi")));
assert(restore.some(x=>x[0]==="fitBounds"),"360 PDF did not frame coverage");
assert(restore.some(x=>x[0]==="setView"),"360 PDF did not restore original map");
assert(ctxCalls.some(x=>x[0]==="fill"),"Coverage polygon was not rendered");
assert(!lines.some(s=>s.includes("Path: -")),"360 report leaked empty point-to-point result");
console.log("PASS: full 12-bearing 360 PDF export exercised without missing constants;");
console.log("      verified DEM metadata, source name, 48-point spacing, area and tower framing.");
