// Tower Horizon 2.0 - dependency-free staging smoke checks.
// Usage: node tests/check-static.mjs [--staging]
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
const root = fileURLToPath(new URL("../",import.meta.url));
const read = file => readFileSync(join(root,file),"utf8");
const files = ["script.js","terrain.js","export.js","path-report.js","recovery.js"];
const errors=[];
for(const path of files){
 if(!existsSync(join(root,path))){errors.push("Missing "+path);continue;}
 try{new Script(read(path),{filename:path})}
 catch(error){errors.push(path+": "+error.message)}
}
const html = read("index.html");
for(const name of files){
 if(name==="recovery.js") continue; // Loaded in its own recovery window.
 if(!html.includes('src="'+name+'"')) errors.push("index.html does not load "+name);
}
for(const id of ["exportReportPdf","exportMapPdf","exportPathPdf","terrainMap",
 "terrainTxLat","terrainTxLon","terrainRxLat","terrainRxLon",
 "analyzePath","analyzeCoverage","terrainChart","terrainRecoveryOption"]){
 if(!html.includes('id="'+id+'"'))errors.push("Missing HTML control #"+id);
}
const pathCode=read("path-report.js"),terrain=read("terrain.js");
if(!pathCode.includes('window.TowerHorizonExports?.ensurePdfLibrary'))
 errors.push("Missing shared point-to-point PDF fallback");
if(!terrain.includes('new Event("towerPathUpdated")') ||
   !terrain.includes('new Event("towerPathCleared")'))
 errors.push("Point-to-point export status events not wired");
if(!terrain.includes('getProfile: () => currentProfile'))
 errors.push("Point-to-point results not exposed to exporter");
if(!html.includes('src="vendor/leaflet-1.9.4.css"'))
 errors.push("Leaflet CSS not loaded");
for(const asset of ["waypoint.css","style.css","vendor/leaflet-1.9.4.css","recovery.html"]){
 if(!existsSync(join(root,asset)))errors.push("Missing asset "+asset);
}
if(process.argv.includes("--staging") &&
   !terrain.includes('const TOWER_API = "https://tower-terrain-staging.mac1584.workers.dev"'))
 errors.push("Staging must use the existing tower-terrain-staging Worker");
if(errors.length){
 console.error("STAGING CHECK FAILED\n"+errors.map(x=>" - "+x).join("\n"));
 process.exitCode=1;
} else {
 console.log("PASS: JavaScript syntax, report wiring, required HTML controls and local assets"+
   (process.argv.includes("--staging")?", staging terrain endpoint":"")+".");
}
