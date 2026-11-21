// DOM integration tests: real input events, terrain invalidation, and PDF orchestration.
// External DEM acquisition and map rasterization are simulated, not field validation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const dom=new JSDOM(read('index.html'),{runScripts:'outside-only',url:'https://tower.example/'});
const w=dom.window,$=id=>w.document.getElementById(id),load=p=>w.eval(read(p));
const errors=[];w.addEventListener('error',e=>errors.push(e.error));
load('script.js');
// Substitute only the external profile acquisition boundary. Use actual terrain
// validation, analysis, event wiring, and profile storage below.
let releaseProfile=null;
w.__profileFixture=async(tx,rx,count)=>{
 if(releaseProfile)await new Promise(resolve=>{releaseProfile=resolve;});
 const rad=x=>x*Math.PI/180;
 const h=Math.sin(rad(rx.lat-tx.lat)/2)**2+Math.cos(rad(tx.lat))*Math.cos(rad(rx.lat))*Math.sin(rad(rx.lon-tx.lon)/2)**2;
 const total=2*6371000*Math.asin(Math.sqrt(h));
 return {method:'multipoint',samples:Array.from({length:count},(_,i)=>({
  lat:tx.lat+(rx.lat-tx.lat)*i/(count-1),lon:tx.lon+(rx.lon-tx.lon)*i/(count-1),
  d:total*i/(count-1),elev:i===0||i===count-1?0:1000
 }))};
};
w.eval(read('terrain.js').replace('const verified = await getRadialProfile(tx, rx, count);','const verified = await window.__profileFixture(tx, rx, count);'));
load('rf.js');load('rf-ui.js');load('rf-report.js');load('path-report.js');
const change=(id,value,type='input')=>{$(id).value=value;$(id).dispatchEvent(new w.Event(type,{bubbles:true}));};
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
assert.match($('rfAB').textContent,/-46.36/);assert.match($('rfBA').textContent,/-46.36/);
change('rfBpowerW','1');assert.match($('rfBA').textContent,/-54.82/);assert.match($('rfAB').textContent,/-46.36/);
assert.equal($('rfPreset').value,'custom');
const before=w.TowerRFUI.getSnapshot();change('rfEnvironment','Saltwater','change');
const salt=w.TowerRFUI.getSnapshot();assert.equal(salt.ab.receivedDbm,before.ab.receivedDbm);assert.equal(salt.environment,'Saltwater');
assert.equal(w.TowerRFUI.isCurrent(before),false);assert.ok(Object.isFrozen(salt.scenarios));
$('rfSeparateFrequency').checked=true;$('rfSeparateFrequency').dispatchEvent(new w.Event('change',{bubbles:true}));
change('rfReverseFrequency','4100');assert.match($('rfBA').textContent,/-60.84/);
change('rfFrequency','');assert.equal(w.TowerRFUI.getSnapshot(),null);assert.equal($('rfAB').textContent,'—');
change('rfFrequency','2050');assert.ok(w.TowerRFUI.getSnapshot());
change('rfArxLossDb','-1');assert.equal(w.TowerRFUI.getSnapshot(),null);
change('rfArxLossDb','1');change('radCenter','');
assert.ok(w.TowerRFUI.getSnapshot());assert.equal(w.TowerRFUI.getSnapshot().scenarios.length,0);
change('radCenter','100');
// Returning to a preset resets both independent endpoints and reverse frequency.
change('rfPreset','eng65','change');assert.equal($('rfApowerW').value,'1');assert.equal($('rfSeparateFrequency').checked,false);
assert.match($('rfAB').textContent,/-44.81/);
change('rfPreset','eng2','change');
// Real selected-path analysis automatically switches the RF distance source.
$('analyzePath').click();await tick();
assert.ok(w.TowerHorizonData.getProfile());assert.equal($('rfDistanceMode').value,'path');
assert.equal(w.TowerRFUI.getSnapshot().terrainStatus,'OBSTRUCTED');assert.equal($('exportPathPdf').disabled,false);
const s=w.TowerRFUI.getSnapshot();assert.equal(s.distanceM,w.TowerHorizonData.getProfile().distanceM);
change('terrainRxLat','42.361');assert.equal(w.TowerHorizonData.getProfile(),null);
assert.equal(w.TowerRFUI.getSnapshot(),null);assert.equal($('exportPathPdf').disabled,true);
assert.equal($('rfDistanceMode').value,'path'); // No silent manual-distance fallback.
// An in-flight old DEM request must not restore a stale profile after an edit.
releaseProfile=true;$('analyzePath').click();await tick();const release=releaseProfile;releaseProfile=null;
change('terrainRxLon','-71.05');release();await tick();assert.equal(w.TowerHorizonData.getProfile(),null);
$('analyzePath').click();await tick();assert.ok(w.TowerHorizonData.getProfile());
// Map and PDF mocks retain real export control flow, including asynchronous work.
let saved=[],pages=1,texts=[];
class Doc {
 constructor(){pages=1;texts=[];}
 text(t){texts.push(String(t));}splitTextToSize(t){return [t];}getTextWidth(t){return String(t).length*4;}
 addPage(){pages++;}save(name){saved.push({name,pages,text:texts.join('\n')});}
}
for(const method of ['setFillColor','rect','setTextColor','setFont','setFontSize','setDrawColor','line','roundedRect','setLineWidth','addImage'])Doc.prototype[method]=()=>{};
w.jspdf={jsPDF:Doc};
const ctx=new Proxy({},{get:()=>()=>{},set:()=>true});
w.HTMLCanvasElement.prototype.getContext=()=>ctx;w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,ZmFrZQ==';
const canvas=w.document.createElement('canvas');canvas.width=800;canvas.height=400;
const map={getCenter:()=>({lat:42,lon:-71}),getZoom:()=>9,fitBounds(){},setView(){},getSize:()=>({x:800,y:400}),latLngToContainerPoint:([lat,lon])=>({x:lon*2,y:lat*2})};
w.L={latLngBounds:points=>points};
const data=w.TowerHorizonData;w.TowerHorizonData={...data,getMap:()=>map};
w.html2canvas=async()=>canvas;
const actualTimer=w.setTimeout.bind(w);w.setTimeout=(fn,delay,...args)=>actualTimer(fn,delay===900?0:delay,...args);
let finishSources;w.TowerHorizonTerrainSources={describe:()=>new Promise(resolve=>{finishSources=resolve;})};
$('exportPathPdf').click();await tick();change('rfBpowerW','2');finishSources(null);await tick();
assert.equal(saved.length,0);assert.match($('exportStatus').textContent,/RF inputs changed/);
w.TowerHorizonTerrainSources={describe:async()=>null};
$('exportPathPdf').click();await tick();await tick();
assert.equal(saved.length,1);assert.equal(saved[0].pages,2);
for(const term of ['A to B','B to A','Saltwater','OBSTRUCTED','2 OF 2','2026-11-21.1'])assert.ok(saved[0].text.includes(term),term);
// Quick report works with a manual distance, no map, and no terrain profile.
change('rfDistanceMode','manual','change');w.TowerHorizonData={getProfile:()=>null};
$('exportRfPdf').click();await tick();assert.equal(saved.length,2);assert.equal(saved[1].pages,1);
assert.ok(saved[1].text.includes('NOT ASSESSED'));
// PDF library fallback must not export the snapshot from before a subsequent edit.
delete w.jspdf;let finishLibrary;w.TowerHorizonExports={ensurePdfLibrary:()=>new Promise(resolve=>{finishLibrary=()=>{w.jspdf={jsPDF:Doc};resolve();};})};
$('exportRfPdf').click();await tick();change('rfDistance','11');finishLibrary();await tick();
assert.equal(saved.length,2);assert.match($('rfExportStatus').textContent,/Inputs changed/);
assert.deepEqual(errors,[]);
console.log('PASS: DOM presets, asymmetric inputs, environment metadata, invalid inputs, selected paths, stale terrain requests, two-page PDF, RF-only PDF, and stale-export cancellation.');
dom.window.close();
