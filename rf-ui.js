/* Local-only RF inputs and an immutable, shared screen/report snapshot. */
(() => {
  "use strict";
  const $=id=>document.getElementById(id), RF=window.TowerRF;
  const form=$("rfForm"), fields=[
    ["powerW","Conducted output (W)","0.000001"],
    ["txGainDbi","TX antenna gain (dBi)",null], ["txLossDb","TX passive loss (dB)","0"],
    ["rxGainDbi","RX antenna gain (dBi)",null], ["rxLossDb","RX passive loss (dB)","0"]
  ];
  let baseline="eng2", snapshot=null, fingerprint=null, pathRef=null, revision=0;
  const currentPath=()=>window.TowerHorizonData?.getProfile()||null;
  const fmt=n=>n.toLocaleString("en-US",{maximumFractionDigits:2,minimumFractionDigits:2});
  const deepFreeze=o=>{if(o&&typeof o==="object"){Object.values(o).forEach(deepFreeze);Object.freeze(o);}return o;};
  for(const site of ["A","B"]){
    for(const [key,label,min] of fields){
      const box=document.createElement("div"),id="rf"+site+key;
      const l=document.createElement("label");l.htmlFor=id;l.textContent=label;
      const input=document.createElement("input");input.id=id;input.name=id;input.type="number";input.step="any";
      input.required=true;input.setAttribute("aria-invalid","false");if(min!==null)input.min=min;
      box.append(l,input);$("rfEquipment"+site).append(box);
    }
  }
  for(const p of RF.presets){const option=document.createElement("option");option.value=p.id;option.textContent=p.label;$("rfPreset").append(option);}
  const custom=document.createElement("option");custom.value="custom";custom.textContent="Custom / modified preset";$("rfPreset").append(custom);
  function applyPreset(id){
    const p=RF.preset(id);if(!p)return;
    baseline=id;$("rfPreset").value=id;$("rfFrequency").value=p.frequencyMHz;
    $("rfSeparateFrequency").checked=false;$("rfReverseFrequency").value=p.frequencyMHz;
    for(const site of ["A","B"])for(const [key,value] of Object.entries(RF.equipment(p)))$("rf"+site+key).value=value;
    for(const el of form.querySelectorAll("input"))el.setAttribute("aria-invalid","false");
    refresh();
  }
  function read(){
    const path=currentPath(),data={presetId:$("rfPreset").value,baselinePresetId:baseline,
      distanceSource:$("rfDistanceMode").value,distance:$("rfDistance").value,
      frequencyMHz:$("rfFrequency").value,separate:$("rfSeparateFrequency").checked,
      reverseFrequencyMHz:$("rfReverseFrequency").value,environment:$("rfEnvironment").value,
      a:{},b:{},heightA:$("radCenter").value,heightB:$("receiverHeight").value};
    for(const [key] of fields){data.a[key]=$("rfA"+key).value;data.b[key]=$("rfB"+key).value;}
    // Include raw geographic controls: an edit cancels export before blur events run.
    data.terrainInputs=["terrainTxLat","terrainTxLon","terrainRxLat","terrainRxLon","terrainK","terrainSamples","terrainReceiverHeight"].map(id=>$(id).value);
    return {data,path};
  }
  function refresh(){
    const {data,path}=read(),key=JSON.stringify(data);
    if(key===fingerprint && path===pathRef)return snapshot;
    fingerprint=key;pathRef=path;revision++;snapshot=null;
    $("rfDistance").disabled=data.distanceSource==="path";
    $("rfReverseFrequency").disabled=!data.separate;
    $("rfReverseWrap").hidden=!data.separate;
    try{
      if(data.distanceSource==="path"&&!path)throw new Error("Analyze the selected terrain path, or choose a manual distance.");
      const distanceM=data.distanceSource==="path"?path.distanceM:RF.number(data.distance,"Distance",0,true)*RF.MI;
      const budget=RF.calculate({distanceM,frequencyMHz:data.frequencyMHz,
        reverseFrequencyMHz:data.separate?data.reverseFrequencyMHz:undefined,a:data.a,b:data.b});
      let scenarios=[];
      const heightA=data.distanceSource==="path"?path.txAglFt:data.heightA;
      const heightB=data.distanceSource==="path"?path.rxAglFt:data.heightB;
      try{scenarios=[2/3,1,4/3,2].map(k=>({k,distanceM:RF.horizon(heightA,heightB,k)}));}catch{/* RF-only mode does not require antenna heights. */}
      snapshot=deepFreeze({...budget,version:RF.VERSION,presetVersion:RF.PRESET_VERSION,revision,
        presetId:data.presetId,presetLabel:data.presetId==="custom"?"Custom (based on "+RF.preset(baseline).label+")":RF.preset(data.presetId).label,
        distanceSource:data.distanceSource,environment:data.environment,
        terrainStatus:data.distanceSource==="path"?(path.clear?"CLEAR":"OBSTRUCTED"):"NOT ASSESSED",
        k:data.distanceSource==="path"?path.k:null,
        sites:data.distanceSource==="path"?{a:{...path.tx},b:{...path.rx},sampledAt:path.sampledAt}:null,
        heightA:scenarios.length?Number(heightA):null,heightB:scenarios.length?Number(heightB):null,
        scenarios,calculatedAt:new Date().toISOString()});
      $("rfAB").textContent=fmt(snapshot.ab.receivedDbm)+" dBm";
      $("rfBA").textContent=fmt(snapshot.ba.receivedDbm)+" dBm";
      $("rfABLoss").textContent="FSPL "+fmt(snapshot.ab.fsplDb)+" dB | "+fmt(snapshot.ab.frequencyMHz)+" MHz";
      $("rfBALoss").textContent="FSPL "+fmt(snapshot.ba.fsplDb)+" dB | "+fmt(snapshot.ba.frequencyMHz)+" MHz";
      $("rfContext").textContent=fmt(distanceM/RF.MI)+" mi | Terrain: "+snapshot.terrainStatus+" | "+data.environment;
      $("rfStatus").textContent="";
      $("rfScenarios").textContent=scenarios.length?"Height-only horizon sensitivity (A "+fmt(Number(heightA))+" ft, B "+fmt(Number(heightB))+" ft AGL): "+
        scenarios.map(s=>"k="+(s.k===2/3?"2/3":s.k===4/3?"4/3":s.k)+": "+fmt(s.distanceM/RF.MI)+" mi").join("; ")+".":"Enter valid antenna heights above to compare horizon scenarios.";
    }catch(error){
      for(const id of ["rfAB","rfBA","rfABLoss","rfBALoss"])$(id).textContent="—";
      $("rfContext").textContent="No current RF result";$("rfScenarios").textContent="";
      // Suppress live error announcements while typing; show correction text on blur/export.
      $("rfStatus").textContent=error.message;
    }
    window.dispatchEvent(new Event("towerRFUpdated"));return snapshot;
  }
  function pathSnapshot(path){
    const s=refresh();if(!s||s.distanceSource!=="path"||path!==currentPath())
      throw new Error("Choose selected terrain path in RF distance and complete the RF inputs before exporting.");
    return s;
  }
  window.TowerRFUI=Object.freeze({getSnapshot:refresh,isCurrent:s=>refresh()===s,
    getPathSnapshot:pathSnapshot,canExportPath:()=>{try{return !!pathSnapshot(currentPath());}catch{return false;}}});
  form.addEventListener("submit",e=>e.preventDefault());
  form.addEventListener("input",e=>{
    e.target.setAttribute("aria-invalid","false");
    if(e.target.id==="rfFrequency"||e.target.id==="rfReverseFrequency"||/^rf[AB]/.test(e.target.id))$("rfPreset").value="custom";
    refresh();
  });
  form.addEventListener("change",e=>{if(e.target.id==="rfPreset"&&e.target.value!=="custom")applyPreset(e.target.value);else refresh();});
  form.addEventListener("focusout",e=>{
    if(e.target.type==="number"&&!e.target.disabled){
      const invalid=!e.target.validity.valid;
      e.target.setAttribute("aria-invalid",String(invalid));
      $("rfError").textContent=invalid?"Please enter a valid value for "+(e.target.labels[0]?.textContent||"this field")+".":"";
    }
  });
  $("resetRadCenter").addEventListener("click",refresh);
  $("rfResetPreset").addEventListener("click",()=>applyPreset(baseline));
  for(const id of ["radCenter","receiverHeight","terrainReceiverHeight","towerHeight","terrainTxLat","terrainTxLon","terrainRxLat","terrainRxLon","terrainK","terrainSamples"])
    $(id).addEventListener("input",refresh);
  window.addEventListener("towerPathUpdated",()=>{$("rfDistanceMode").value="path";refresh();});
  window.addEventListener("towerPathCleared",refresh);
  window.addEventListener("towerCoordinatesLoaded",refresh);
  applyPreset("eng2");
})();
