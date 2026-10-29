/* Tower Horizon 2.0 - browser-side terrain exports.
 * CSV: sampled radial elevations and per-ring visibility.
 * KML: classified coverage cells including gray unknown areas.
 * JPEG/PDF: current Leaflet view and a one-page US Letter report.
 * Nothing is sent to an export server.
 */
(function terrainExports() {
  "use strict";
  const $ = id => document.getElementById(id);
  const fmt = (n, digits = 1) => Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: digits }) : "Not available";
  const val = id => $(id)?.value?.trim() || "";
  const display = id => $(id)?.textContent?.trim() || "Not analyzed";
  const dataSource = () => window.TowerHorizonData;
  const coverage = () => dataSource()?.getCoverage() || null;
  const point = (latId, lonId) => [val(latId), val(lonId)].join(", ");
  const safeName = suffix => {
    const date = new Date().toISOString().slice(0, 10);
    const id = val("asrn").replace(/\D/g, "").slice(0, 7) || "manual";
    return "tower-horizon-" + id + "-" + date + suffix;
  };
  function setStatus(message, error = false) {
    const el = $("exportStatus");
    el.textContent = message;
    el.classList.toggle("error", error);
  }
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function csvValue(value) {
    if (value === null || value === undefined) return "";
    let str = String(value);
    // Prevent user-supplied location labels or error text from being treated
    // as spreadsheet formulas when the downloaded CSV is opened in Excel.
    if (/^[=+@\t\r]/.test(str) || (/^-/.test(str) && !/^-\d+(?:\.\d+)?$/.test(str)))
      str = "'" + str;
    return /[,"\r\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  }
  function toCSV(rows) {
    return rows.map(row => row.map(csvValue).join(",")).join("\r\n") + "\r\n";
  }
  const xmlEscape = value => String(value ?? "").replace(/[<>&"']/g, c =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
  function radialsCSV() {
    const scan = coverage();
    if (!scan) throw new Error("Run a 360-degree scan before exporting CSV.");
    const headers = [
      "record_type", "scanned_at_utc", "asrn", "location",
      "tx_lat", "tx_lon", "tx_antenna_ft_agl", "rx_antenna_ft_agl",
      "earth_k", "bearing_deg", "method", "radial_status",
      "sample_index", "ring_index", "lat", "lon",
      "distance_mi", "ground_elevation_ft_amsl", "ring_terrain_clear",
      "error"
    ];
    const rows = [headers];
    const base = ["", scan.generatedAt, val("asrn"), val("location"),
      scan.tx.lat, scan.tx.lon, scan.txHeightFt, scan.rxHeightFt, scan.k];
    const build = (type, radial, sampleIndex, ringIndex, lat, lon, miles, elevation, clear, error) => [
      type, ...base.slice(1),
      radial.bearingDeg, radial.queryMethod || "", radial.status,
      sampleIndex, ringIndex, lat, lon, miles, elevation, clear, error || ""
    ];
    for (const radial of scan.radialData) {
      if (!radial.samples) {
        rows.push(build("unavailable", radial, "", "", "", "", "", "", "", radial.error));
        continue;
      }
      radial.samples.forEach((sample, i) =>
        rows.push(build("sample", radial, i, "", sample.lat, sample.lon,
          sample.distanceM / 1609.344, sample.elevationM * 3.280839895, "", "")));
      radial.visibility?.forEach((clear, ring) => {
        rows.push(build("visibility_ring", radial, "", ring, "", "",
          (scan.radiusM * ring / scan.rings) / 1609.344,
          "", clear ? "true" : "false", ""));
      });
    }
    saveBlob(new Blob(["\uFEFF", toCSV(rows)], { type: "text/csv;charset=utf-8" }),
      safeName("-terrain-360.csv"));
    setStatus("CSV downloaded: " + (rows.length - 1) +
      " records, including raw sample locations and 40-ring visibility checks.");
  }
  const kmlStyles = {
    terrain_clear: { style: "terrainClear", color: "9a426e12" },
    terrain_blocked: { style: "terrainBlocked", color: "96302daa" },
    unknown: { style: "terrainUnknown", color: "8a756b62" }
  };
  function cellsKML() {
    const scan = coverage();
    if (!scan) throw new Error("Run a 360-degree scan before exporting KML.");
    const legend = Object.values(kmlStyles).map(({style, color}) =>
      '<Style id="' + style + '"><LineStyle><color>ff334455</color><width>0.5</width></LineStyle>' +
      '<PolyStyle><color>' + color + '</color><fill>1</fill><outline>0</outline></PolyStyle></Style>'
    ).join("");
    const items = scan.cells.map(cell => {
      const ring = cell.vertices.map(p =>
        Number(p.lon).toFixed(7) + "," + Number(p.lat).toFixed(7) + ",0");
      ring.push(ring[0]);
      return '<Placemark><name>' + xmlEscape(cell.status + " " +
        fmt(cell.bearingStartDeg, 1) + "deg, ring " + cell.ringIndex) +
        '</name><styleUrl>#' + kmlStyles[cell.status].style +
        '</styleUrl><ExtendedData><Data name="status"><value>' +
        xmlEscape(cell.status) +
        '</value></Data><Data name="visible_fraction"><value>' +
        xmlEscape(cell.visibleFraction === null ? "unknown" : cell.visibleFraction) +
        '</value></Data><Data name="bearing_start_deg"><value>' +
        cell.bearingStartDeg + '</value></Data><Data name="bearing_end_deg"><value>' +
        cell.bearingEndDeg + '</value></Data></ExtendedData>' +
        '<Polygon><outerBoundaryIs><LinearRing><coordinates>' +
        ring.join(" ") +
        '</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>';
    });
    const description = "USGS 3DEP sampled terrain only; green=mostly clear, red=mostly blocked, gray=unknown. " +
      "This is not a service contour. Full area: " +
      (scan.complete ? fmt(scan.terrainVisibleAreaSqMi, 1) + " square miles" : "incomplete.");
    const kml = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' +
      '<name>Tower Horizon 360 Terrain Coverage</name><description>' +
      xmlEscape(description) + '</description>' + legend +
      '<Folder><name>Terrain visibility sectors</name>' + items.join("") +
      '</Folder></Document></kml>';
    saveBlob(new Blob([kml], {type:"application/vnd.google-earth.kml+xml;charset=utf-8"}),
      safeName("-coverage.kml"));
    setStatus("KML downloaded: " + scan.cells.length +
      " classified cells. Unknown terrain is included in gray.");
  }
  // Draw the exact coverage polygons independently of Leaflet's SVG renderer.
  // This is used on top of a map-tile screenshot, and in schematic fallback.
  function drawCoverageOverlay(ctx, canvas, map, scan) {
    if (!scan) return;
    const originalSize = map.getSize();
    const sx = canvas.width / originalSize.x;
    const sy = canvas.height / originalSize.y;
    const toPx = p => {
      const projected = map.latLngToContainerPoint([p.lat, p.lon]);
      return { x: projected.x * sx, y: projected.y * sy };
    };
    for (const cell of scan.cells) {
      const pts = cell.vertices.map(toPx);
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle = cell.status === "terrain_clear" ? "rgba(18,110,66,.60)" :
        cell.status === "terrain_blocked" ? "rgba(170,45,48,.58)" : "rgba(98,107,117,.54)";
      ctx.fill();
    }
    const tx = toPx(scan.tx);
    const deltaLon = (scan.radiusM / 6371000) * (180 / Math.PI) /
      Math.max(.01, Math.cos(scan.tx.lat * Math.PI / 180));
    const east = toPx({ lat: scan.tx.lat, lon: scan.tx.lon + deltaLon });
    ctx.save();
    ctx.beginPath(); ctx.arc(tx.x, tx.y, Math.abs(east.x - tx.x), 0, Math.PI * 2);
    ctx.strokeStyle = "#184c83"; ctx.lineWidth = Math.max(2, 3 * sx);
    ctx.setLineDash([Math.max(4,7*sx), Math.max(3,5*sx)]); ctx.stroke();
    ctx.restore();
  }
  function mapVectorFallback(map) {
    const scan = coverage();
    const element = $("terrainMap");
    const canvas = document.createElement("canvas");
    const width = 1200, height = Math.max(620, Math.round(width * element.clientHeight / Math.max(1, element.clientWidth)));
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    const originalSize = map.getSize();
    const sx = width / originalSize.x, sy = height / originalSize.y;
    ctx.fillStyle = "#eff2f3"; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#d5dce0"; ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 60) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,height); ctx.stroke(); }
    for (let y = 0; y < height; y += 60) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(width,y); ctx.stroke(); }
    const toPixel = p => {
      const pt = map.latLngToContainerPoint([p.lat, p.lon]);
      return {x: pt.x * sx, y: pt.y * sy};
    };
    if (scan) {
      for (const cell of scan.cells) {
        const points = cell.vertices.map(toPixel);
        ctx.beginPath();
        points.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
        ctx.closePath();
        ctx.fillStyle = cell.status === "terrain_clear" ? "rgba(18,110,66,.60)" :
          cell.status === "terrain_blocked" ? "rgba(170,45,48,.58)" : "rgba(98,107,117,.54)";
        ctx.fill();
      }
      const tx = toPixel(scan.tx);
      const deltaLon = (scan.radiusM / 6371000) * (180 / Math.PI) /
        Math.max(.01, Math.cos(scan.tx.lat * Math.PI / 180));
      const east = toPixel({ lat: scan.tx.lat, lon: scan.tx.lon + deltaLon });
      ctx.save();
      ctx.beginPath(); ctx.arc(tx.x, tx.y, Math.abs(east.x-tx.x), 0, 2*Math.PI);
      ctx.strokeStyle = "#184c83"; ctx.lineWidth = 4; ctx.setLineDash([12,9]); ctx.stroke();
      ctx.restore();
    }
    const transmitter = toPixel(scan?.tx || {
      lat: Number(val("terrainTxLat")), lon: Number(val("terrainTxLon"))
    });
    ctx.beginPath(); ctx.arc(transmitter.x,transmitter.y,9,0,Math.PI*2);
    ctx.fillStyle="#193b58"; ctx.fill(); ctx.strokeStyle="#fff"; ctx.lineWidth=3; ctx.stroke();
    ctx.fillStyle="#193b58"; ctx.font="bold 18px Arial";
    ctx.fillText("TRANSMITTER", Math.min(width-180,transmitter.x+14), Math.max(28,transmitter.y-10));
    const receiver = toPixel({lat:Number(val("terrainRxLat")),lon:Number(val("terrainRxLon"))});
    ctx.beginPath(); ctx.arc(receiver.x,receiver.y,7,0,Math.PI*2);
    ctx.fillStyle="#193b58";ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle="#193b58";ctx.font="15px Arial";
    ctx.fillText("RECEIVER",Math.min(width-120,receiver.x+12),Math.max(30,receiver.y-8));
    ctx.fillStyle="#ffffff"; ctx.fillRect(0,height-40,width,40);
    ctx.font="15px Arial"; ctx.fillStyle="#52616b";
    ctx.fillText("Schematic overlay only - base-map tiles unavailable in this export | Terrain: USGS 3DEP",18,height-15);
    return canvas;
  }
  async function captureMap() {
    const map = dataSource()?.getMap();
    if (!map) throw new Error("Map is not available. Reload the page and try again.");
    const target = $("terrainMap");
    if (typeof window.html2canvas === "function") {
      try {
        // Only captures the tiles already displayed on the screen.
        const canvas = await window.html2canvas(target, {
          useCORS: true, allowTaint: false, backgroundColor: "#edf1f3",
          scale: Math.min(2, window.devicePixelRatio || 2),
          logging: false, imageTimeout: 9000,
          onclone: clonedDocument => {
            // Omit the SVG overlay in the screen capture. It will be precisely
            // redrawn from verified scan geometry on the export canvas below.
            const pane = clonedDocument.querySelector("#terrainMap .leaflet-overlay-pane");
            if (pane) pane.style.opacity = "0";
          }
        });
        if (canvas.width && canvas.height) {
          const ctx = canvas.getContext("2d");
          drawCoverageOverlay(ctx, canvas, map, coverage());
          // Preserve attribution in exports even if the Leaflet control isn't captured.
          ctx.fillStyle = "rgba(255,255,255,.93)";
          ctx.fillRect(0,canvas.height-27,canvas.width,27);
          ctx.fillStyle = "#334455"; ctx.font = "12px Arial";
          ctx.fillText("Map data: OpenStreetMap contributors | Terrain data: USGS 3DEP", 12, canvas.height-9);
          return { canvas, fallback: false };
        }
      } catch (error) {
        console.warn("Map tile capture unavailable; rendering a schematic instead.", error);
      }
    }
    return { canvas: mapVectorFallback(map), fallback: true };
  }
  function canvasDownload(canvas, fileName, quality = .92) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error("Could not encode map image."));
        saveBlob(blob, fileName);
        resolve();
      }, "image/jpeg", quality);
    });
  }
  const pdfText = value => String(value ?? "Not available")
    .replace(/[\u2013\u2014]/g,"-").replace(/\u00b0/g, " deg")
    .replace(/\u00b2/g, "^2").replace(/\u00d7/g, "x")
    .replace(/[^\x20-\x7e]/g,"");
  // jsPDF is normally preloaded from jsDelivr in index.html. If that CDN
  // fails, recover on the user's PDF-export click using a different host.
  let pdfLibraryPromise = null;
  function loadPdfScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let done = false;
      const finish = (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) {
          script.remove();
          reject(error);
        } else resolve();
      };
      script.src = url;
      script.async = true;
      script.onload = () => finish();
      script.onerror = () => finish(new Error("Could not load " + new URL(url).hostname));
      const timer = setTimeout(() => finish(new Error("Timed out loading PDF library")), 15000);
      document.head.append(script);
    });
  }
  async function ensurePdfLibrary() {
    if (window.jspdf?.jsPDF) return;
    if (!pdfLibraryPromise) {
      pdfLibraryPromise = (async () => {
        const candidates = [
          "https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js",
          "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js"
        ];
        for (const url of candidates) {
          try {
            await loadPdfScript(url);
            if (window.jspdf?.jsPDF) return;
          } catch (error) {
            console.warn("PDF library fallback unavailable:", error);
          }
        }
        throw new Error("PDF library unavailable from both CDN providers. Check browser extensions or network restrictions.");
      })().catch(error => {
        // A failed attempt can be retried later, without reloading the page.
        pdfLibraryPromise = null;
        throw error;
      });
    }
    await pdfLibraryPromise;
  }
  const pdf = (orientation = "portrait") => {
    if (!window.jspdf?.jsPDF) throw new Error("PDF library is not available.");
    return new window.jspdf.jsPDF({orientation, unit:"pt", format:"letter", compress:true});
  };
  function pdfHeader(doc, title, sub, width) {
    doc.setFillColor(25,59,88);doc.rect(0,0,width,60,"F");
    doc.setTextColor(237,242,246);doc.setFont("helvetica","bold");doc.setFontSize(10);
    doc.text("WAYPOINT UTILITY WEB  /  TOWER HORIZON 2.0",32,21);
    doc.setFontSize(17);doc.text(pdfText(title),32,45);
    doc.setTextColor(64,81,91);doc.setFont("helvetica","normal");doc.setFontSize(9);
    doc.text(pdfText(sub),32,76);
  }
  function drawImageContained(doc, canvas, x,y,w,h) {
    const source = canvas.toDataURL("image/jpeg", .89);
    const imageRatio = canvas.width / canvas.height, areaRatio = w/h;
    let drawW = w, drawH = h;
    if (imageRatio > areaRatio) drawH = w / imageRatio;
    else drawW = h * imageRatio;
    doc.addImage(source,"JPEG",x+(w-drawW)/2,y+(h-drawH)/2,drawW,drawH);
  }
  async function mapJPEG() {
    const result = await captureMap();
    await canvasDownload(result.canvas, safeName("-map.jpg"));
    setStatus(result.fallback
      ? "JPEG downloaded with the terrain overlay on a schematic background (map tiles were unavailable for export)."
      : "JPEG map downloaded with the currently displayed map background and terrain overlay.");
  }
  async function mapPDF() {
    await ensurePdfLibrary();
    const result = await captureMap();
    const doc = pdf("landscape");
    pdfHeader(doc,"360-degree terrain visibility map",
      val("location") || point("terrainTxLat","terrainTxLon"),792);
    doc.setFillColor(239,242,244); doc.rect(32,90,728,444,"F");
    drawImageContained(doc,result.canvas,36,94,720,436);
    doc.setTextColor(64,81,91);doc.setFont("helvetica","normal");doc.setFontSize(9);
    doc.text(pdfText("Green: terrain clear | Red: terrain blocked | Gray: unknown | Blue: theoretical radio horizon"),34,556);
    doc.text(pdfText("USGS 3DEP sampling; not a signal prediction or FCC service contour. Map data: OpenStreetMap contributors."),34,573);
    doc.save(safeName("-map.pdf"));
    setStatus(result.fallback
      ? "Map PDF downloaded using schematic terrain overlay because background tiles could not be exported."
      : "Map PDF downloaded (US Letter landscape, one page).");
  }
  function labelValue(doc, label, value, x, y, maxWidth) {
    doc.setTextColor(79,97,109);doc.setFont("helvetica","normal");doc.setFontSize(8);
    doc.text(pdfText(label).toUpperCase(),x,y);
    doc.setTextColor(25,59,88);doc.setFont("helvetica","bold");doc.setFontSize(11);
    const lines = doc.splitTextToSize(pdfText(value),maxWidth);
    doc.text(lines.slice(0,2),x,y+15);
  }
  async function chartImage() {
    const svg = $("terrainChart");
    if (!svg || !svg.childNodes.length) return null;
    const markup = new XMLSerializer().serializeToString(svg.cloneNode(true));
    const blob = new Blob([markup],{type:"image/svg+xml;charset=utf-8"});
    const src = URL.createObjectURL(blob);
    try {
      const image = new Image();
      await new Promise((resolve,reject)=>{
        image.onload=resolve;image.onerror=()=>reject(new Error("Could not render elevation profile."));
        image.src=src;
      });
      const canvas = document.createElement("canvas");
      canvas.width=1800;canvas.height=590;
      const ctx=canvas.getContext("2d");
      ctx.fillStyle="#ffffff";ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      return canvas;
    } finally {URL.revokeObjectURL(src);}
  }
  async function onePageReport() {
    await ensurePdfLibrary();
    const result = await captureMap();
    const chart = await chartImage().catch(err => { console.warn(err);return null; });
    const scan = coverage();
    const doc = pdf("portrait");
    // This report is always a single 612 x 792 pt US Letter page.
    pdfHeader(doc,"Radio horizon and terrain assessment",
      "Generated " + new Date().toLocaleString("en-US") + " | Preliminary engineering estimate",612);

    doc.setDrawColor(160,174,184);
    doc.setFillColor(245,247,248);doc.roundedRect(30,89,552,76,3,3,"FD");
    labelValue(doc,"Location",val("location") || "Manual coordinates",40,104,235);
    labelValue(doc,"ASRN",val("asrn") || "Manual site",330,104,220);
    labelValue(doc,"TX coordinates",point("terrainTxLat","terrainTxLon"),40,139,240);
    labelValue(doc,"RX coordinates",point("terrainRxLat","terrainRxLon"),330,139,230);

    const top = 176;
    const boxW = 178;
    const cards = [
      {label:"RADIO HORIZON",value:display("radioHorizon")},
      {label:"GEOMETRIC HORIZON",value:display("geometricHorizon")},
      {label:"TERRAIN VISIBLE AREA",value:scan?.complete ? display("terrainArea") : "Incomplete / not run"}
    ];
    cards.forEach((card,i)=>{
      const x=30+i*187;
      doc.setFillColor(i===0?255:240,i===0?245:243,i===0?201:245);
      doc.setDrawColor(181,166,101);doc.roundedRect(x,top,boxW,50,2,2,"FD");
      labelValue(doc,card.label,card.value,x+8,top+14,boxW-16);
    });

    doc.setTextColor(25,59,88);doc.setFont("helvetica","bold");doc.setFontSize(10);
    doc.text("USGS 3DEP - 360 DEGREE TERRAIN VISIBILITY",30,244);
    doc.setDrawColor(148,159,169);
    doc.rect(30,252,552,236);
    drawImageContained(doc,result.canvas,33,255,546,230);

    doc.setTextColor(25,59,88);doc.setFont("helvetica","bold");doc.setFontSize(10);
    doc.text("ELEVATION CROSS-SECTION",30,507);
    doc.setDrawColor(148,159,169);doc.rect(30,515,552,129);
    if (chart) drawImageContained(doc,chart,33,518,546,123);
    else {
      doc.setFont("helvetica","normal");doc.setFontSize(10);doc.setTextColor(79,97,109);
      doc.text("Run Analyze Selected Path to include a terrain elevation profile.",41,577);
    }

    doc.setDrawColor(181,191,198);doc.line(30,657,582,657);
    doc.setTextColor(25,59,88);doc.setFont("helvetica","bold");doc.setFontSize(9);
    doc.text("ENGINEERING INPUTS AND RESULTS",30,673);
    doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(64,81,91);
    const first = "TX center: " + (val("radCenter") || "?") + " ft AGL  |  RX: " +
      (val("receiverHeight") || "?") + " ft AGL  |  Base: " +
      (val("baseElevation") || "?") + " ft AMSL  |  k=" + (val("terrainK") || "?");
    const second = "Path: " + display("terrainResult") + "  |  Min clearance: " +
      display("pathClearance") + "  |  Terrain scan: " +
      (scan ? scan.bearings + " bearings, " + scan.failedBearings + " failed, " + scan.unknownSectors + " gray sectors" : "Not run");
    doc.text(pdfText(first),30,687);
    const secondLines=doc.splitTextToSize(pdfText(second),550);
    doc.text(secondLines.slice(0,2),30,701);

    doc.setTextColor(104,113,120);doc.setFontSize(8);
    doc.text("Terrain is sampled bare-earth elevation. Buildings, vegetation, Fresnel clearance, diffraction,",30,735);
    doc.text("field strength and interference are not modeled. Not an FCC service contour.",30,746);
    doc.text(pdfText(result.fallback?"Schematic map export (base tiles unavailable).":"Map: OpenStreetMap contributors; terrain: USGS 3DEP."),30,759);
    doc.setDrawColor(181,191,198);doc.line(30,768,582,768);
    doc.setFontSize(8);doc.text("WAYPOINT UTILITY WEB  /  BETA  /  1 OF 1",30,782);
    doc.save(safeName("-one-page-report.pdf"));
    setStatus("One-page US Letter PDF report downloaded." +
      (scan?.complete === false ? " The report flags incomplete terrain coverage." : "") +
      (result.fallback ? " Map tiles were replaced by a schematic overlay." : ""));
  }
  async function runExport(buttonId, action) {
    const button=$(buttonId);
    if (button.disabled) return;
    button.disabled=true;
    setStatus("Preparing " + button.textContent.trim() + "…");
    try { await action(); }
    catch(error) {console.error("Terrain export failed",error);setStatus("Export failed: "+error.message,true);}
    finally {button.disabled=false;refreshButtons();}
  }
  function refreshButtons() {
    const available=!!coverage();
    $("exportCsv").disabled=!available;
    $("exportKml").disabled=!available;
  }
  $("exportCsv").addEventListener("click",()=>runExport("exportCsv",radialsCSV));
  $("exportKml").addEventListener("click",()=>runExport("exportKml",cellsKML));
  $("exportJpeg").addEventListener("click",()=>runExport("exportJpeg",mapJPEG));
  $("exportMapPdf").addEventListener("click",()=>runExport("exportMapPdf",mapPDF));
  $("exportReportPdf").addEventListener("click",()=>runExport("exportReportPdf",onePageReport));
  window.addEventListener("towerCoverageUpdated",refreshButtons);
  window.addEventListener("towerCoverageCleared",refreshButtons);
  refreshButtons();
})();
