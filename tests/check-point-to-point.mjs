// Contract: point-to-point analysis MUST use complete verified multipoint
// samples, never silently fill unknown elevations or accept legacy polylines.
// Usage: node tests/check-point-to-point.mjs
// This unit test uses the actual verifiedLinkProfile function from terrain.js,
// with a mocked source of USGS samples. It does not call any live service.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const source = readFileSync(
  fileURLToPath(new URL("../terrain.js", import.meta.url)), "utf8"
);
const begin = source.indexOf("  async function verifiedLinkProfile(");
const end = source.indexOf("  async function analyzeSelectedPath()", begin);
assert(begin >= 0 && end > begin, "Could not isolate point-to-point verifier");
const code = source.slice(begin, end);
assert(code.includes("getRadialProfile(tx, rx, count)"),
  "Point-to-point analysis must call the validated multipoint client");
assert(!code.includes("getProfile("),
  "Do not use incomplete legacy polyline profiles for point-to-point");
const R = 6371000;
function distance(a,b) {
  const rad=x=>x*Math.PI/180;
  const dl=rad(b.lat-a.lat), dn=rad(b.lon-a.lon);
  const h=Math.sin(dl/2)**2+
    Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dn/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}
function validLatLon(p) {
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
    Math.abs(p.lat)<=90 && Math.abs(p.lon)<=180;
}
const tx={lat:42.30297222,lon:-71.21802778};
const rx={lat:42.3601,lon:-71.0589};
const total=distance(tx,rx);
function profile(count) {
  return Array.from({length:count},(_,i)=>{
    const f=i/(count-1);
    return {
      lat:tx.lat+(rx.lat-tx.lat)*f,
      lon:tx.lon+(rx.lon-tx.lon)*f,
      d:total*f,elev:60-i/10
    };
  });
}
let mock={method:"multipoint",samples:profile(72)};
const verifiedLinkProfile = runInNewContext(
  "(function(){"+code+"; return verifiedLinkProfile;})()",
  {getRadialProfile:async()=>mock,distance,validLatLon}
);
// Run cases sequentially, keeping mocked source data stable.
async function pass(label,fn) {
  await fn(); console.log("PASS: "+label);
}
await pass("72/72 verified, both endpoints, no repairs",async()=>{
  mock={method:"multipoint",samples:profile(72)};
  const result=await verifiedLinkProfile(tx,rx,72);
  assert.equal(result.samples.length,72);
  assert.equal(result.repairedEndpoints,0);
  assert.equal(result.sampleMethod,"multipoint");
  assert.equal(result.samples[71].d,total);
});
await pass("48/48 verified",async()=>{
  mock={method:"multipoint",samples:profile(48)};
  const result=await verifiedLinkProfile(tx,rx,48);
  assert.equal(result.samples.length,48);
});
await pass("unknown final elevation never accepted",async()=>{
  mock={method:"multipoint",samples:profile(72).slice(0,-1)};
  await assert.rejects(()=>verifiedLinkProfile(tx,rx,72),
    /verify every point-to-point terrain sample/);
});
await pass("unknown interior elevation never accepted",async()=>{
  const samples=profile(72);samples[70].elev=NaN;
  mock={method:"multipoint",samples};
  await assert.rejects(()=>verifiedLinkProfile(tx,rx,72),
    /verify every point-to-point terrain sample/);
});
await pass("legacy polyline fallback refused",async()=>{
  mock={method:"polyline",samples:profile(72)};
  await assert.rejects(()=>verifiedLinkProfile(tx,rx,72),
    /requires the terrain Worker's multipoint endpoint/);
});
await pass("shifted RX endpoint refused",async()=>{
  const samples=profile(72);samples[71].lon-=0.001;
  mock={method:"multipoint",samples};
  await assert.rejects(()=>verifiedLinkProfile(tx,rx,72),
    /verify every point-to-point terrain sample/);
});
await pass("duplicated sample distances refused",async()=>{
  const samples=profile(72);samples[70].d=samples[69].d;
  mock={method:"multipoint",samples};
  await assert.rejects(()=>verifiedLinkProfile(tx,rx,72),
    /verify every point-to-point terrain sample/);
});
await pass("invalid sample counts refused",async()=>{
  await assert.rejects(()=>verifiedLinkProfile(tx,rx,121),
    /valid point-to-point sample count/);
});
console.log("PASS: 8 point-to-point multipoint verification cases.");
