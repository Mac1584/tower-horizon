/* Tower Horizon 2.0 - optional, read-only DEM source provenance.
 * Distinguish ArcGIS/USGS raster spatial resolution from our distance
 * between requested elevations. Source failures NEVER alter terrain results.
 */
(() => {
  "use strict";
  const VALID_MAX_ID = 999999999, MAX_BATCH_IDS = 24;
  const catalogCache = new Map();
  const number = value =>
    value !== null && value !== undefined && value !== "" &&
    Number.isFinite(Number(value)) ? Number(value) : null;
  const idOf = sample => {
    const id = number(sample?.rasterId);
    return Number.isSafeInteger(id) && id > 0 && id <= VALID_MAX_ID ? id : null;
  };
  const resolutionOf = sample => {
    const resolution = number(sample?.resolution ?? sample?.resolutionMeters);
    return resolution !== null && resolution > 0 && resolution < 1e6 ?
      resolution : null;
  };
  const safe = (value, max=140) => typeof value === "string" ?
    value.trim().slice(0,max) || null : null;
  const info = sample => sample?.sourceDetails && typeof sample.sourceDetails === "object" ?
    sample.sourceDetails : {};
  const year = source => {
    const timestamp = number(source?.acquisitionDate);
    if (timestamp === null || timestamp <= 0) return null;
    const y = new Date(timestamp).getUTCFullYear();
    return y >= 1950 && y <= new Date().getUTCFullYear()+1 ? y : null;
  };
  // Keep source categories exact, including fractional meter values.
  // These describe the sampled raster, NOT the spacing in our model.
  const meters = m => m < 10 ? Number(m.toFixed(2)).toString() :
    Number(m.toFixed(1)).toString();
  function summarize(samples, catalog={}) {
    const values = Array.isArray(samples) ? samples : [];
    const counts = new Map(), rasterCounts = new Map();
    let resolutionMissing = 0, rasterMissing = 0;
    for (const sample of values) {
      const res=resolutionOf(sample), id=idOf(sample);
      if (res===null)resolutionMissing++;
      else counts.set(res,(counts.get(res)||0)+1);
      if (id===null)rasterMissing++;
      else {
        if (!rasterCounts.has(id)) rasterCounts.set(id,{id,count:0,source:info(sample)});
        const item=rasterCounts.get(id);item.count++;
        if (!item.source?.name && info(sample)?.name)item.source=info(sample);
      }
    }
    const resolutions=[...counts.entries()].sort((a,b)=>a[0]-b[0])
      .map(([metersValue,count])=>({meters:metersValue,count}));
    const sourceRecords=[...rasterCounts.values()].map(entry=>{
      const catalogValue=catalog[entry.id] || {};
      const details={
        ...catalogValue, ...Object.fromEntries(
          Object.entries(entry.source||{}).filter(([,v])=>v!==null&&v!==undefined&&v!=="")
        )
      };
      return {rasterId:entry.id,count:entry.count,
        name:safe(details.name), title:safe(details.title,200),
        product:safe(details.product),provider:safe(details.provider),
        year:year(details), verticalDatum:safe(details.verticalDatum)};
    }).sort((a,b)=>b.count-a.count);
    const resParts=resolutions.map(x=>meters(x.meters)+" m ("+x.count+")");
    if (resolutionMissing)resParts.push("not reported ("+resolutionMissing+")");
    const resText=resolutions.length ? resParts.slice(0,3).join("; ") +
      (resParts.length>3 ? "; +"+(resParts.length-3)+" more" : "") :
      "Not reported by USGS for these samples";
    const named=new Map();
    for (const item of sourceRecords) {
      if (!item.name && !item.title) continue;
      const key=item.name || item.title;
      if(!named.has(key))named.set(key,{name:key,count:0,year:item.year});
      const group=named.get(key);group.count+=item.count;
      if(!group.year && item.year)group.year=item.year;
    }
    const projects=[...named.values()].sort((a,b)=>b.count-a.count);
    const projectText=projects.length ?
      projects.slice(0,2).map(p=>p.name+
        (p.year && !p.name.includes(String(p.year))?" ("+p.year+")":"")).join("; ") +
        (projects.length>2 ? "; +"+(projects.length-2)+" more" : "") :
      (rasterCounts.size ? rasterCounts.size+" source rasters identified; project names unavailable" :
        "Source raster IDs not reported");
    return {
      sampleCount:values.length,
      rasterCount:rasterCounts.size,
      knownRasterSamples:values.length-rasterMissing,
      knownResolutionSamples:values.length-resolutionMissing,
      resolutionCounts:resolutions,
      sources:sourceRecords,
      projects,
      resolutionText:resText,
      projectText,
      catalogComplete:sourceRecords.every(s=>s.name||s.title)
    };
  }
  function coverageSamples(scan) {
    return Array.isArray(scan?.radialData) ?
      scan.radialData.flatMap(ray=>Array.isArray(ray.samples)?ray.samples:[]) : [];
  }
  async function lookup(ids, apiUrl) {
    const base=typeof apiUrl==="string" && /^https:\/\/[a-z0-9.-]+\.workers\.dev$/.test(apiUrl) ?
      apiUrl : null;
    if(!base || !Array.isArray(ids) || !ids.length)return {};
    const out={};
    const unique=[...new Set(ids.filter(id=>
      Number.isSafeInteger(id)&&id>0&&id<=VALID_MAX_ID))];
    // Limit background metadata requests independently of the size of a
    // 360 scan: max 48 source IDs (two read-only batches).
    for(let offset=0;offset<Math.min(unique.length,MAX_BATCH_IDS*2);offset+=MAX_BATCH_IDS) {
      const chunk=unique.slice(offset,offset+MAX_BATCH_IDS);
      const newIds=chunk.filter(id=>!catalogCache.has(id));
      if(newIds.length) {
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),8500);
        try {
          const url=base+"/terrain/catalog?ids="+encodeURIComponent(newIds.join(","));
          const response=await fetch(url,{signal:controller.signal});
          if(!response.ok)throw new Error("USGS catalog HTTP "+response.status);
          const data=await response.json();
          if(data?.error || !data?.records || typeof data.records!=="object")
            throw new Error("Unusable USGS catalog response");
          for(const id of newIds)catalogCache.set(id,data.records[id]||null);
        } catch(error) {
          // Provenance is optional: never fail a line-of-sight study or PDF.
          console.warn("USGS raster catalog metadata unavailable:",error);
          for(const id of newIds)catalogCache.set(id,null);
        } finally {clearTimeout(timer);}
      }
      for(const id of chunk)if(catalogCache.get(id))out[id]=catalogCache.get(id);
    }
    return out;
  }
  async function describe(samples) {
    const original=summarize(samples);
    if(original.catalogComplete)return original;
    const missing=original.sources.filter(s=>!s.name&&!s.title).map(s=>s.rasterId);
    if(!missing.length)return original;
    const api=window.TowerHorizonData?.getTerrainApi?.();
    const metadata=await lookup(missing,api);
    return summarize(samples,metadata);
  }
  async function describeCoverage(scan) {
    return describe(coverageSamples(scan));
  }
  window.TowerHorizonTerrainSources=Object.freeze({
    summarize, coverageSamples, describe, describeCoverage
  });
})();
