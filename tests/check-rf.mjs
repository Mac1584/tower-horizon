// Deterministic independent RF reference cases and report contract (no dependencies).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const window={},read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
runInNewContext(read('rf.js'),{window});
const R=window.TowerRF,near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
near(R.freeSpaceLoss(1000,1000),92.44778322188337);
near(R.freeSpaceLoss(2000,1000)-R.freeSpaceLoss(1000,1000),6.020599913279625);
near(R.freeSpaceLoss(1000,2000)-R.freeSpaceLoss(1000,1000),6.020599913279625);
near(R.wattsToDbm(1),30);near(R.wattsToDbm(7),38.45098040014257);
const a=R.equipment(R.preset('eng2')),b={...a,powerW:1};
const s=R.calculate({distanceM:10*R.MI,frequencyMHz:2050,a,b});
near(s.ab.fsplDb,122.81583814702597);near(s.ab.receivedDbm,-46.3648577468834);
near(s.ba.receivedDbm,-54.81583814702597);
for(const [id,expected] of [['eng65',-44.80555638097667],['eng7',-45.48272172619602]]){
 const p=R.preset(id),e=R.equipment(p);
 near(R.calculate({distanceM:10*R.MI,frequencyMHz:p.frequencyMHz,a:e,b:e}).ab.receivedDbm,expected);
}
const reversed=R.calculate({distanceM:10*R.MI,frequencyMHz:2050,reverseFrequencyMHz:4100,a,b});
near(s.ba.receivedDbm-reversed.ba.receivedDbm,6.020599913279625);
for(const bad of ['', ' ',null,undefined,NaN,Infinity,-1,0]){
 assert.throws(()=>R.freeSpaceLoss(bad,2050));assert.throws(()=>R.wattsToDbm(bad));
}
assert.throws(()=>R.calculate({distanceM:10,frequencyMHz:100,a:{...a,rxLossDb:-1},b}));
assert.throws(()=>R.calculate({distanceM:10,frequencyMHz:100,a:{...a,txGainDbi:''},b}));
assert.ok(Number.isFinite(R.freeSpaceLoss(1e300,1e300)));
assert.ok(Object.isFrozen(s)&&Object.isFrozen(s.ab)&&Object.isFrozen(s.a));
near(R.horizon(100,6,4/3)/R.horizon(100,6,1),Math.sqrt(4/3));
near(R.horizon(0,0),0);
// Exercise the PDF drawing function and require both directions/assumptions.
const nodes=new Map();const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,{addEventListener(){}});return nodes.get(id);}};
runInNewContext(read('rf-report.js'),{window,document});
const texts=[];const doc={splitTextToSize:t=>[t],text:t=>texts.push(String(t))};
for(const method of ['setFillColor','rect','setTextColor','setFont','setFontSize','setDrawColor','line'])doc[method]=()=>{};
window.TowerRFReport.drawPage(doc,{...s,version:R.VERSION,presetVersion:R.PRESET_VERSION,presetLabel:'Custom test',
 calculatedAt:'2026-11-21T12:00:00Z',distanceSource:'path',environment:'Saltwater',terrainStatus:'OBSTRUCTED',k:2/3,
 sites:{a:{lat:40,lon:-74},b:{lat:41,lon:-73},sampledAt:'test'},scenarios:[]},2,2);
const output=texts.join('\n');
for(const token of ['A to B','B to A','-46.36','-54.82','Saltwater','OBSTRUCTED','2026-11-21.1','2 OF 2','before active gain','Environment labels do not alter'])assert.ok(output.includes(token),token);
console.log('PASS: RF reference values, asymmetric directions, frequency overrides, invalid inputs, immutable results, horizon sensitivity, and PDF content.');
