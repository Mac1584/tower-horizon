/* Tower Horizon 2.0 - dedicated point-to-point connectivity report.
 * One US Letter page. The single 30-degree context sector is centered on the
 * analyzed A-to-B great-circle bearing; only the A-to-B line is evaluated.
 */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const R = 6371000, MI = 1609.344, FT = 3.280839895, RAD = Math.PI / 180;
  const pathData = () => window.TowerHorizonData?.getProfile() || null;
  const fmt = (n, places=1) => Number.isFinite(n) ?
    n.toLocaleString("en-US",{maximumFractionDigits:places}) : "N/A";
  const clean = value => String(value ?? "").replace(/[\u2013\u2014]/g,"-")
    .replace(/[^\x20-\x7e]/g,"");
  const status = (message,error=false) => {
    const el = $("exportStatus");
    if(el) {el.textContent=message;el.classList.toggle("error",error);}
  };
  function bearing(a,b) {
    const p1=a.lat*RAD,p2=b.lat*RAD, dl=(b.lon-a.lon)*RAD;
    const y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-
      Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
    return (Math.atan2(y,x)/RAD+360)%360;
  }
  function destination(p,heading,meters) {
    const phi=p.lat*RAD,lon=p.lon*RAD,a=meters/R,t=heading*RAD;
    const lat=Math.asin(Math.sin(phi)*Math.cos(a)+Math.cos(phi)*Math.sin(a)*Math.cos(t));
    const lng=lon+Math.atan2(Math.sin(t)*Math.sin(a)*Math.cos(phi),
      Math.cos(a)-Math.sin(phi)*Math.sin(lat));
    return {lat:lat/RAD,lon:((lng/RAD+540)%360)-180};
  }
  function wedge(path) {
    const az=bearing(path.tx,path.rx), r=Math.max(path.distanceM*1.17,500);
    const arc=Array.from({length:31},(_,i)=>destination(path.tx,az-15+i,r));
    return {az,reverse:bearing(path.rx,path.tx),outline:[path.tx,...arc,path.tx]};
  }
  function checkPath(path) {
    if(!path?.tx || !path?.rx || !Array.isArray(path.data) || path.data.length<2 ||
        !Number.isFinite(path.distanceM) || path.distanceM<100 ||
        !Number.isFinite(path.minimum) || !Number.isFinite(path.txH) ||
        !Number.isFinite(path.rxH) || !Number.isFinite(path.k))
      throw new Error("Run a successful Analyze Selected Path calculation before exporting a point-to-point report.");
  }
  function renderPathOverlay(ctx,canvas,map,path,sector) {
    const sz=map.getSize(), sx=canvas.width/sz.x, sy=canvas.height/sz.y;
    if(!(sz.x>0&&sz.y>0))throw new Error("The map is not ready.");
    const px=p=>{
      const q=map.latLngToContainerPoint([p.lat,p.lon]);
      return {x:q.x*sx,y:q.y*sy};
    };
    ctx.save();ctx.setTransform(1,0,0,1,0,0);
    ctx.globalAlpha=1;ctx.filter="none";ctx.globalCompositeOperation="source-over";
    ctx.beginPath();ctx.rect(0,0,canvas.width,canvas.height);ctx.clip();
    ctx.beginPath();
    sector.outline.forEach((p,i)=>{
      const q=px(p);
      if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);
    });
    ctx.closePath();ctx.fillStyle="rgba(181,140,40,.17)";ctx.fill();
    ctx.strokeStyle="#b58c28";ctx.lineWidth=Math.max(2,sx*1.7);
    ctx.setLineDash([Math.max(6,sx*5),Math.max(4,sx*4)]);ctx.stroke();
    ctx.setLineDash([]);
    const pts=path.data.map(p=>px(p));
    ctx.beginPath();
    pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    ctx.strokeStyle="#ffffff";ctx.lineWidth=Math.max(4,7*sx);ctx.stroke();
    ctx.strokeStyle=path.clear?"#126e42":"#aa2d30";
    ctx.lineWidth=Math.max(3,4*sx);ctx.stroke();
    // Both directions, same terrain path; this is not a link-budget result.
    function arrow(t,reverse){
      const at=Math.min(pts.length-2,Math.max(1,Math.round((pts.length-1)*t)));
      const prev=pts[at-1],next=pts[at+1],here=pts[at];
      const angle=Math.atan2(next.y-prev.y,next.x-prev.x)+(reverse?Math.PI:0);
      const len=Math.max(11,sx*14);
      ctx.strokeStyle="#ffffff";ctx.lineWidth=Math.max(2,2.4*sx);
      ctx.beginPath();ctx.moveTo(here.x,here.y);
      ctx.lineTo(here.x-len*Math.cos(angle-.45),here.y-len*Math.sin(angle-.45));
      ctx.moveTo(here.x,here.y);
      ctx.lineTo(here.x-len*Math.cos(angle+.45),here.y-len*Math.sin(angle+.45));
      ctx.stroke();
    }
    if(pts.length>3){arrow(.35,false);arrow(.65,true);}
    function marker(site,label,color) {
      const p=px(site), radius=Math.max(7,sx*8);
      ctx.beginPath();ctx.arc(p.x,p.y,radius,0,2*Math.PI);
      ctx.fillStyle=color;ctx.fill();ctx.strokeStyle="#ffffff";
      ctx.lineWidth=Math.max(2,sx*2);ctx.stroke();
      ctx.font="bold "+Math.max(10,Math.round(12*sx))+"px Arial";
      ctx.fillStyle="#ffffff";ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.fillText(label,p.x,p.y);
      ctx.textAlign="start";ctx.textBaseline="alphabetic";
    }
    marker(path.tx,"A","#193b58");marker(path.rx,"B","#b58c28");
    const font=Math.max(12,Math.round(11*sx));
    ctx.font="bold "+font+"px Arial";
    ctx.fillStyle="rgba(255,255,255,.95)";
    ctx.fillRect(10,10,Math.min(canvas.width-20,390*sx),48*sy);
    ctx.fillStyle="#193b58";
    ctx.fillText("30-degree orientation sector",18,26*sy);
    ctx.font=Math.max(10,Math.round(10*sx))+"px Arial";
    ctx.fillText("A to B "+fmt(sector.az,1)+" deg true | B to A "+
      fmt(sector.reverse,1)+" deg true",18,44*sy);
    ctx.fillStyle="rgba(255,255,255,.93)";
    ctx.fillRect(canvas.width-50*sx,10,42*sx,39*sy);
    ctx.fillStyle="#193b58";ctx.font="bold "+Math.max(11,Math.round(14*sx))+"px Arial";
    ctx.fillText("N",canvas.width-34*sx,32*sy);
    ctx.restore();
  }
  async function capturePathMap(path) {
    const map=window.TowerHorizonData?.getMap();
    if(!map || typeof window.html2canvas!=="function")
      throw new Error("The map renderer is unavailable. Reload the calculator and retry.");
    const sector=wedge(path);
    const previousCenter=map.getCenter();
    const previousZoom=map.getZoom();
    const bounds=window.L.latLngBounds(
      [path.tx,path.rx,...sector.outline].map(p=>[p.lat,p.lon])
    );
    try {
      // Temporarily frame the path specifically for the printable report.
      map.fitBounds(bounds,{padding:[40,40],animate:false,maxZoom:12});
      await new Promise(resolve=>setTimeout(resolve,900));
      const screenshot=await window.html2canvas($("terrainMap"),{
        scale:Math.min(2,window.devicePixelRatio||2),
        useCORS:true,allowTaint:false,backgroundColor:"#edf1f3",
        logging:false,imageTimeout:9000,
        onclone:doc=>{
          // No 360-degree visibility polygons or radio-horizon circle should
          // enter a point-to-point map, even after a previous 360 scan.
          const overlay=doc.querySelector("#terrainMap .leaflet-overlay-pane");
          if(overlay)overlay.style.opacity="0";
          const markers=doc.querySelector("#terrainMap .leaflet-marker-pane");
          if(markers)markers.style.opacity="0";
        }
      });
      if(!screenshot.width||!screenshot.height)
        throw new Error("The terrain map screenshot was empty.");
      const canvas=document.createElement("canvas");
      canvas.width=screenshot.width;canvas.height=screenshot.height;
      const ctx=canvas.getContext("2d");
      if(!ctx)throw new Error("Unable to draw the map image.");
      ctx.drawImage(screenshot,0,0);
      renderPathOverlay(ctx,canvas,map,path,sector);
      ctx.setTransform(1,0,0,1,0,0);
      ctx.fillStyle="rgba(255,255,255,.95)";
      ctx.fillRect(0,canvas.height-26,canvas.width,26);
      ctx.fillStyle="#344d5d";ctx.font="12px Arial";
      ctx.fillText("Map data: OpenStreetMap contributors | Terrain: USGS 3DEP | 30-degree sector is NOT a beamwidth",12,canvas.height-8);
      return {canvas,sector};
    } finally {
      map.setView(previousCenter,previousZoom,{animate:false});
    }
  }
  function header(doc,title,subtitle) {
    doc.setFillColor(25,59,88);doc.rect(0,0,612,63,"F");
    doc.setTextColor(235,241,246);doc.setFont("helvetica","bold");
    doc.setFontSize(10);doc.text("WAYPOINT UTILITY WEB  /  TOWER HORIZON 2.0",30,21);
    doc.setFontSize(15.8);doc.text(clean(title),30,45);
    doc.setTextColor(65,84,99);doc.setFont("helvetica","normal");doc.setFontSize(8.5);
    doc.text(clean(subtitle),30,78);
  }
  function sitePanel(doc,label,site,heightFt,antennaM,x) {
    const groundFt=(antennaM-heightFt/FT)*FT;
    doc.setTextColor(25,59,88);doc.setFont("helvetica","bold");doc.setFontSize(10);
    doc.text(label,x,106);
    doc.setTextColor(55,75,88);doc.setFont("helvetica","normal");doc.setFontSize(8.8);
    doc.text("Coordinates: "+fmt(site.lat,6)+", "+fmt(site.lon,6),x,124);
    doc.text("Antenna: "+fmt(heightFt,1)+" ft AGL",x,142);
    doc.text("Ground: "+fmt(groundFt,1)+" ft AMSL",x,160);
    doc.text("Antenna center: "+fmt(antennaM*FT,1)+" ft AMSL",x,176);
  }
  function profile(doc,path) {
    const x=30,y=522,w=552,h=139;
    doc.setFillColor(247,249,250);doc.setDrawColor(159,171,181);
    doc.rect(x,y,w,h,"FD");
    const left=64,right=12,top=23,bottom=22;
    const plotX=x+left,plotY=y+top,plotW=w-left-right,plotH=h-top-bottom;
    const dataset=path.data;
    const all=dataset.flatMap(p=>[p.apparentTerrain*FT,p.rayH*FT]);
    const lowest=Math.min(...all),highest=Math.max(...all);
    const pad=Math.max(20,(highest-lowest)*.10);
    const low=lowest-pad,high=highest+pad;
    const px=p=>plotX+(p.d/path.distanceM)*plotW;
    const py=v=>plotY+(high-v)/(high-low)*plotH;
    doc.setFont("helvetica","normal");doc.setFontSize(7.6);
    for(let i=0;i<=3;i++){
      const value=low+(high-low)*i/3,yy=py(value);
      doc.setDrawColor(221,227,231);doc.setLineWidth(.5);
      doc.line(plotX,yy,plotX+plotW,yy);
      doc.setTextColor(79,95,107);
      doc.text(fmt(value,0),plotX-7,yy+2,{align:"right"});
    }
    doc.setTextColor(79,95,107);
    doc.text("ft AMSL",x+10,y+15);
    [0,.5,1].forEach(t=>doc.text(fmt(t*path.distanceM/MI,1)+" mi",
      plotX+t*plotW,y+h-7,{align:t===0?"left":t===1?"right":"center"}));
    const series=(field,color,weight)=>{
      doc.setDrawColor(...color);doc.setLineWidth(weight);
      for(let i=1;i<dataset.length;i++){
        const a=dataset[i-1],b=dataset[i];
        doc.line(px(a),py(a[field]*FT),px(b),py(b[field]*FT));
      }
    };
    series("apparentTerrain",[135,91,52],1.55);
    series("rayH",[25,59,88],1.45);
    doc.setTextColor(55,78,92);doc.setFontSize(7.8);
    doc.text("Terrain (curvature adjusted)",plotX+3,y+13);
    doc.text("Path ray",plotX+plotW-40,y+13);
  }
  async function download() {
    const path=pathData();
    checkPath(path);
    if(!window.jspdf?.jsPDF) {
      if(typeof window.TowerHorizonExports?.ensurePdfLibrary==="function")
        await window.TowerHorizonExports.ensurePdfLibrary();
      else throw new Error("PDF library unavailable. Reload the calculator and try again.");
    }
    status("Preparing point-to-point report and 30-degree map...");
    const map=await capturePathMap(path);
    if(path!==pathData())throw new Error("The path inputs changed during export. Analyze the new path.");
    const doc=new window.jspdf.jsPDF({orientation:"portrait",unit:"pt",format:"letter",compress:true});
    header(doc,"Two-way point-to-point terrain assessment",
      "Generated "+new Date().toLocaleString("en-US")+
      " | Preliminary sampled geometric line-of-sight study");
    doc.setFillColor(243,246,248);doc.setDrawColor(159,171,181);
    doc.roundedRect(30,89,552,101,3,3,"FD");
    doc.setDrawColor(202,213,220);doc.line(306,98,306,181);
    sitePanel(doc,"SITE A | ORIGIN",path.tx,path.txAglFt,path.txH,41);
    sitePanel(doc,"SITE B | REMOTE",path.rx,path.rxAglFt,path.rxH,321);
    const cards=[
      ["PATH LENGTH",fmt(path.distanceM/MI,2)+" miles"],
      ["TERRAIN LINE OF SIGHT",path.clear?"CLEAR":"OBSTRUCTED"],
      ["MIN. CLEARANCE",fmt(path.minimum*FT,1)+" ft"]
    ];
    cards.forEach(([label,value],i)=>{
      const x=30+i*187;
      doc.setDrawColor(178,190,199);
      const rgb=i===1?(path.clear?[232,243,233]:[250,233,231]):[241,244,246];
      doc.setFillColor(...rgb);doc.roundedRect(x,200,178,47,2,2,"FD");
      doc.setTextColor(74,91,103);doc.setFont("helvetica","normal");
      doc.setFontSize(8);doc.text(label,x+8,213);
      doc.setTextColor(25,59,88);doc.setFont("helvetica","bold");
      doc.setFontSize(12);doc.text(clean(value),x+8,231);
    });
    doc.setTextColor(25,59,88);doc.setFont("helvetica","bold");doc.setFontSize(9.5);
    doc.text("PATH MAP  |  ONE 30-DEGREE ORIENTATION SECTOR",30,262);
    doc.setDrawColor(155,172,184);doc.rect(30,270,552,223);
    const src=map.canvas.toDataURL("image/jpeg",.9);
    const targetW=546,targetH=217,ratio=map.canvas.width/map.canvas.height;
    const imgW=Math.min(targetW,targetH*ratio),imgH=Math.min(targetH,targetW/ratio);
    doc.addImage(src,"JPEG",33+(targetW-imgW)/2,273+(targetH-imgH)/2,imgW,imgH);
    doc.setTextColor(25,59,88);doc.setFont("helvetica","bold");doc.setFontSize(9.5);
    doc.text("USGS 3DEP ELEVATION PROFILE  |  A TO B",30,513);
    profile(doc,path);
    doc.setDrawColor(184,193,201);doc.line(30,674,582,674);
    doc.setTextColor(25,59,88);doc.setFont("helvetica","bold");doc.setFontSize(8.5);
    doc.text("LINK DETAILS",30,689);
    doc.setTextColor(65,83,94);doc.setFont("helvetica","normal");doc.setFontSize(8.1);
    doc.text(clean("A to B bearing: "+fmt(map.sector.az,1)+
      " deg true   |   B to A bearing: "+fmt(map.sector.reverse,1)+
      " deg true   |   k = "+fmt(path.k,3)),30,703);
    const worst=path.worst?.d;
    const worstText=Number.isFinite(worst)?fmt(worst/MI,2)+" mi from A":"not available";
    doc.text(clean("Lowest sampled clearance: "+worstText+
      "   |   "+path.data.length+" verified terrain samples"),30,716);
    const extra=path.clear?"No additional height required for sampled geometric clearance.":
      "Approx. added height: A "+fmt(path.requiredTx*FT,0)+
      " ft OR B "+fmt(path.requiredRx*FT,0)+" ft (independent options).";
    doc.text(clean(extra),30,729);
    doc.setFontSize(7.4);doc.setTextColor(96,108,116);
    doc.text("Two-way geometric path is reciprocal. Duplex reliability, radio link budget, Fresnel-zone",30,749);
    doc.text("clearance, foliage, buildings, diffraction and interference are NOT modeled.",30,760);
    doc.text("The 30-degree map sector indicates orientation only; it is NOT modeled coverage or beamwidth.",30,771);
    doc.setDrawColor(188,199,208);doc.line(30,778,582,778);
    doc.setFontSize(7.5);doc.text("USGS 3DEP  /  OpenStreetMap contributors  /  BETA  /  1 OF 1",30,788);
    const id=String($("asrn")?.value||"").replace(/\D/g,"").slice(0,7)||"manual";
    doc.save("tower-horizon-"+id+"-"+new Date().toISOString().slice(0,10)+"-point-to-point.pdf");
    status("One-page point-to-point report downloaded. It contains only the selected path and one 30-degree orientation sector.");
  }
  async function run() {
    const button=$("exportPathPdf");
    if(button.disabled)return;
    button.disabled=true;
    try{await download();}
    catch(error){console.error("Point-to-point report failed:",error);
      status("Point-to-point PDF failed: "+error.message,true);}
    finally{update();}
  }
  function update() { $("exportPathPdf").disabled=!pathData(); }
  $("exportPathPdf").addEventListener("click",run);
  window.addEventListener("towerPathUpdated",update);
  window.addEventListener("towerPathCleared",update);
  update();
})();
