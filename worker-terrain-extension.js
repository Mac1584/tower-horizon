/**
 * Tower Horizon v2 terrain handlers for EXISTING tower-data-api Cloudflare Worker.
 * This file is not deployed automatically. Import handleTerrainRequest into the
 * existing Worker's fetch handler, before its current /tower route:
 *
 *   const terrain = await handleTerrainRequest(request);
 *   if (terrain) return terrain;
 *
 * Include this module in the same deployed Worker bundle. Keep existing routes intact.
 */
const ELEV="https://epqs.nationalmap.gov/v1/json";
const SAMPLE="https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples";
const GEOCODE="https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json;charset=utf-8","Cache-Control":status===200?"public, max-age=3600":"no-store",...CORS}})}
function coords(p){return p && typeof p==="object"&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&p.lat>=-90&&p.lat<=90&&p.lon>=-180&&p.lon<=180}
async function upstream(url,init={},time=12000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),time);
  try{const r=await fetch(url,{...init,signal:controller.signal,headers:{"Accept":"application/json","User-Agent":"TowerHorizonCalculator/2.0 (public engineering research)",...(init.headers||{})}});if(!r.ok)throw Error("USGS upstream HTTP "+r.status);return await r.json()}finally{clearTimeout(timer)}
}
function interp(a,b,f){return [a.lon+(b.lon-a.lon)*f,a.lat+(b.lat-a.lat)*f]}
export async function handleTerrainRequest(request){
  const url=new URL(request.url);
  if(!url.pathname.startsWith("/terrain/"))return null;
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  try{
    if(url.pathname==="/terrain/elevation"&&request.method==="GET"){
      const p={lat:Number(url.searchParams.get("lat")),lon:Number(url.searchParams.get("lon"))};
      if(!coords(p))return response({error:"Invalid coordinates"},400);
      const qs=new URLSearchParams({x:String(p.lon),y:String(p.lat),wkid:"4326",units:"Meters",includeDate:"false"});
      const data=await upstream(ELEV+"?"+qs);
      const v=data.value;
      if(v===null||v===undefined||!Number.isFinite(Number(v)))return response({error:"No elevation data"},502);
      return response({elevationMeters:Number(v),source:"USGS EPQS"});
    }
    if(url.pathname==="/terrain/profile"&&request.method==="POST"){
      if(Number(request.headers.get("content-length"))>12000)return response({error:"Request too large"},413);
      const args=await request.json(),{tx,rx}=args;
      const n=Number(args.samples);
      if(!coords(tx)||!coords(rx)||!Number.isInteger(n)||n<8||n>160)return response({error:"Invalid profile inputs"},400);
      const geometry=JSON.stringify({paths:[Array.from({length:17},(_,i)=>interp(tx,rx,i/16))],spatialReference:{wkid:4326}});
      const qs=new URLSearchParams({geometryType:"esriGeometryPolyline",geometry,sampleCount:String(n),f:"json"});
      const data=await upstream(SAMPLE+"?"+qs,{},28000);
      if(!Array.isArray(data.samples))return response({error:"USGS did not return samples"},502);
      return response({samples:data.samples,source:"USGS 3DEP ImageServer"});
    }
    if(url.pathname==="/terrain/geocode"&&request.method==="GET"){
      const address=(url.searchParams.get("address")||"").trim();
      if(address.length<7||address.length>200)return response({error:"Enter a valid address"},400);
      const qs=new URLSearchParams({address,benchmark:"Public_AR_Current",vintage:"Current_Current",format:"json"});
      return response(await upstream(GEOCODE+"?"+qs));
    }
    return response({error:"Unsupported terrain route"},404);
  }catch(e){return response({error:"Terrain data unavailable: "+(e?.message||"Unknown error")},502)}
}
