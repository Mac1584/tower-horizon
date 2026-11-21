/* One RF page, also appended to the existing selected-path PDF. */
(() => {
  "use strict";
  const $=id=>document.getElementById(id),RF=window.TowerRF;
  const fmt=(n,d=2)=>Number.isFinite(n)?n.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}):"N/A";
  const clean=s=>String(s).replace(/[^\x20-\x7e]/g,"-");
  function drawPage(doc,s,page=1,total=1){
    doc.setFillColor(25,59,88);doc.rect(0,0,612,64,"F");
    doc.setTextColor(255,255,255);doc.setFont("helvetica","bold");doc.setFontSize(10);
    doc.text("WAYPOINT UTILITY WEB / TOWER HORIZON "+s.version,30,22);
    doc.setFontSize(17);doc.text("Two-way RF free-space reference",30,47);
    doc.setTextColor(45,64,77);doc.setFont("helvetica","normal");doc.setFontSize(9);
    const line=(text,y)=>doc.text(clean(text),30,y);
    line("Calculated: "+s.calculatedAt+" | Preset revision: "+s.presetVersion,85);
    line("Preset: "+s.presetLabel,101);
    line("Distance: "+fmt(s.distanceM/RF.MI)+" mi / "+fmt(s.distanceM/1000)+" km | Source: "+
      (s.distanceSource==="path"?"selected terrain path":"manual distance"),117);
    line("Environment: "+s.environment+" | Terrain: "+s.terrainStatus+
      (s.k!==null?" | Terrain k: "+fmt(s.k,4):""),133);
    if(s.sites){
      line("Site A: "+fmt(s.sites.a.lat,6)+", "+fmt(s.sites.a.lon,6)+" | Site B: "+fmt(s.sites.b.lat,6)+", "+fmt(s.sites.b.lon,6),149);
      line("Terrain sampled: "+(s.sites.sampledAt||"Not recorded"),165);
    }
    function table(title,rows,y){
      doc.setFillColor(226,232,236);doc.rect(30,y-14,552,23,"F");doc.setFont("helvetica","bold");
      doc.text(title,38,y+1);doc.text("Site A",334,y+1);doc.text("Site B",465,y+1);
      doc.setFont("helvetica","normal");
      rows.forEach(([label,a,b],i)=>{
        const yy=y+28+i*22;doc.text(label,38,yy);doc.text(a,334,yy);doc.text(b,465,yy);
        doc.setDrawColor(202,211,218);doc.line(30,yy+7,582,yy+7);
      });
    }
    table("EQUIPMENT AT EACH SITE",[
      ["Conducted output (W)",fmt(s.a.powerW),fmt(s.b.powerW)],
      ["TX gain (dBi) / passive loss (dB)",fmt(s.a.txGainDbi)+" / "+fmt(s.a.txLossDb),fmt(s.b.txGainDbi)+" / "+fmt(s.b.txLossDb)],
      ["RX gain (dBi) / passive loss (dB)",fmt(s.a.rxGainDbi)+" / "+fmt(s.a.rxLossDb),fmt(s.b.rxGainDbi)+" / "+fmt(s.b.rxLossDb)]
    ],194);
    doc.setFillColor(226,232,236);doc.rect(30,302,552,23,"F");doc.setFont("helvetica","bold");
    doc.text("FREE-SPACE BUDGET",38,317);doc.text("A to B",334,317);doc.text("B to A",465,317);
    const rows=[["Frequency (MHz)","frequencyMHz"],["Transmitter output (dBm)","txDbm"],["EIRP (dBm)","eirpDbm"],["Free-space path loss (dB)","fsplDb"],["Receiver input (dBm)","receivedDbm"]];
    rows.forEach(([label,key],i)=>{
      const y=345+22*i;doc.setFont("helvetica",key==="receivedDbm"?"bold":"normal");
      doc.text(label,38,y);doc.text(fmt(s.ab[key]),334,y);doc.text(fmt(s.ba[key]),465,y);
    });
    doc.setFont("helvetica","normal");doc.setFontSize(9);
    const paragraph=(text,y)=>doc.text(doc.splitTextToSize(text,550),30,y);
    paragraph("Receiver input is after receive passive loss, before active gain or downconversion. Power, gains, and losses are independent for each direction.",463);
    if(s.scenarios.length){
      line("HEIGHT-ONLY HORIZON SENSITIVITY | A "+fmt(s.heightA)+" ft / B "+fmt(s.heightB)+" ft AGL",506);
      line(s.scenarios.map(x=>"k="+(x.k===2/3?"2/3":x.k===4/3?"4/3":x.k)+": "+fmt(x.distanceM/RF.MI)+" mi").join(" | "),523);
    }
    paragraph("Environment labels do not alter free-space power. Refraction k values are scenarios, not weather predictions. Temperature alone cannot determine refraction or evaporation ducting; vertical temperature, humidity, and pressure profiles are needed.",549);
    paragraph("MODEL LIMITS: Free-space reference only. Excludes reflection, ducting, diffraction, Fresnel obstruction, rain, atmospheric absorption, foliage, buildings, interference, receiver thresholds, and fade margin. No coverage, usable range, or duplex reliability is predicted.",603);
    paragraph("An obstructed terrain path remains obstructed. Presets are editable planning examples, not verified equipment or authorized channel assignments. Non-ENG 0 dBi gains are neutral placeholders; passive losses are design allowances.",660);
    line("Method: ITU-R P.525 | Refraction context: ITU-R P.453 | inwoodtech.com",730);
    doc.setDrawColor(188,199,208);doc.line(30,758,582,758);doc.setFontSize(8);
    line("BETA / "+s.version+" / "+page+" OF "+total,775);
  }
  let busy=false;
  $("exportRfPdf").addEventListener("click",async()=>{
    if(busy)return;busy=true;$("exportRfPdf").disabled=true;
    const status=$("rfExportStatus");
    try{
      const s=window.TowerRFUI.getSnapshot();if(!s)throw new Error("Complete the RF inputs before exporting.");
      if(!window.jspdf?.jsPDF)await window.TowerHorizonExports?.ensurePdfLibrary();
      if(!window.jspdf?.jsPDF)throw new Error("PDF library unavailable. Reload and try again.");
      if(!window.TowerRFUI.isCurrent(s))throw new Error("Inputs changed during export. Export the new result.");
      const doc=new window.jspdf.jsPDF({orientation:"portrait",unit:"pt",format:"letter",compress:true});
      drawPage(doc,s);doc.save("tower-horizon-rf-"+s.calculatedAt.slice(0,10)+".pdf");
      status.textContent="RF reference PDF downloaded with both directions and model assumptions.";
    }catch(error){status.textContent="RF PDF failed: "+error.message;}
    finally{busy=false;$("exportRfPdf").disabled=false;}
  });
  window.TowerRFReport=Object.freeze({drawPage});
})();
