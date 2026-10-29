/* Tower Horizon 2.0 - browser-side terrain exports.
 * CSV: sampled radial elevations and per-ring visibility.
 * KML: classified coverage cells including gray unknown areas.
 * JPEG/PDF: current Leaflet view and a one-page US Letter report.
 * Nothing is sent to an export server.
 */
(function terrainExports() {
  "use strict";
  // Exact meters in an international statute mile. Used to report the
  // spacing between terrain samples, NOT source raster resolution.
  const MI = 1609.344;
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
  // Draw verified coverage directly from the scan, never by screenshotting
  // Leaflet's SVG layer. We use a FRESH canvas because html2canvas can leave
  // a transformed/filtered/clipped 2D context after painting its tiles. Drawing
  // on that original context can put all polygons outside the image.
  function drawCoverageOverlay(ctx, canvas, map, scan, includeReceiver = true) {
    if (!scan?.cells?.length) return 0;
    const originalSize = map.getSize();
    if (!(originalSize.x > 0 && originalSize.y > 0))
      throw new Error("Cannot project coverage while the map has no visible size.");
    const sx = canvas.width / originalSize.x;
    const sy = canvas.height / originalSize.y;
    const toPx = p => {
      const pixel = map.latLngToContainerPoint([p.lat, p.lon]);
      return { x: pixel.x * sx, y: pixel.y * sy };
    };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.clip();
    let drawn = 0;
    for (const cell of scan.cells) {
      if (!Array.isArray(cell.vertices) || cell.vertices.length < 3) continue;
      const pts = cell.vertices.map(toPx);
      if (pts.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) continue;
      // Only draw cells intersecting the current map view; leave other cells
      // untouched. A completed scan can legitimately be panned offscreen.
      if (pts.every(p => p.x < 0) || pts.every(p => p.y < 0) ||
          pts.every(p => p.x > canvas.width) ||
          pts.every(p => p.y > canvas.height)) continue;
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle = cell.status === "terrain_clear" ? "rgba(18,110,66,.67)" :
        cell.status === "terrain_blocked" ? "rgba(170,45,48,.65)" :
        "rgba(98,107,117,.60)";
      ctx.fill();
      drawn++;
    }
    const tx = toPx(scan.tx);
    const deltaLon = (scan.radiusM / 6371000) * (180 / Math.PI) /
      Math.max(.01, Math.cos(scan.tx.lat * Math.PI / 180));
    const east = toPx({ lat: scan.tx.lat, lon: scan.tx.lon + deltaLon });
    const radiusPx = Math.abs(east.x - tx.x);
    if (Number.isFinite(radiusPx) && radiusPx > 0 &&
        Number.isFinite(tx.x) && Number.isFinite(tx.y)) {
      ctx.beginPath();
      ctx.arc(tx.x, tx.y, radiusPx, 0, Math.PI * 2);
      ctx.strokeStyle = "#184c83";
      ctx.lineWidth = Math.max(2.5, 2.8 * sx);
      ctx.setLineDash([Math.max(4, 7 * sx), Math.max(3, 5 * sx)]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // The original Leaflet markers may have been covered by the solid terrain
    // cells, so redraw clear, print-friendly TX and RX symbols on top.
    function dot(point, label, fill, radius) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
          point.x < -20 || point.y < -20 ||
          point.x > canvas.width + 20 || point.y > canvas.height + 20) return;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(2, sx * 2);
      ctx.stroke();
      ctx.font = "bold " + Math.max(13, Math.round(12 * sx)) + "px Arial, sans-serif";
      ctx.fillStyle = "#142e42";
      ctx.fillText(label, point.x + radius + 5, point.y - radius - 2);
    }
    dot(tx, "TX", "#193b58", Math.max(5, 5 * sx));
    const rxLat = Number(val("terrainRxLat")), rxLon = Number(val("terrainRxLon"));
    if (includeReceiver && Number.isFinite(rxLat) && Number.isFinite(rxLon))
      dot(toPx({lat:rxLat,lon:rxLon}), "RX", "#b58c28", Math.max(4, 4 * sx));
    ctx.restore();
    return drawn;
  }

  function mapVectorFallback(map, includeReceiver = true) {
    const scan = coverage();
    const element = $("terrainMap");
    const canvas = document.createElement("canvas");
    const width = 1200;
    const height = Math.max(620, Math.round(width * element.clientHeight /
      Math.max(1, element.clientWidth)));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create a printable terrain map.");
    ctx.fillStyle = "#eff2f3";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#d5dce0";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y < height; y += 60) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    const drawn = drawCoverageOverlay(ctx, canvas, map, scan, includeReceiver);
    if (scan?.cells?.length && !drawn)
      throw new Error("Coverage is outside the current map view. Center the map on the transmitter and export again.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, height - 42, width, 42);
    ctx.fillStyle = "#52616b";
    ctx.font = "15px Arial";
    ctx.fillText("Schematic background: map tiles unavailable | Terrain: USGS 3DEP", 18, height - 15);
    return canvas;
  }

  async function captureMap(options = {}) {
    const map = dataSource()?.getMap();
    if (!map) throw new Error("Map is not available. Reload the page and try again.");
    const target = $("terrainMap");
    const scan = coverage();
    const reportFocused = options.focusCoverage === true && !!scan?.radiusM;
    const previousView = reportFocused ? {
      center:map.getCenter(),
      zoom:map.getZoom(),
      zoomSnap:map.options?.zoomSnap
    } : null;
    try {
      if (reportFocused) {
        // Use quarter-level zoom snapping for the print view only.
        // Leaflet's default integer zoom can make a coverage circle occupy
        // less than half of the short, wide map canvas when the next whole
        // zoom level would not fit. Restore the user's zoomSnap afterward.
        if (typeof previousView.zoomSnap === "number")
          map.options.zoomSnap = 0.25;
        // A 360 report frames only its transmitter-centered coverage circle,
        // never an unrelated receiver or a prior user-panned map position.
        const latitudeDegrees = scan.radiusM / 6371000 * 180 / Math.PI;
        const longitudeDegrees = latitudeDegrees /
          Math.max(.01,Math.cos(scan.tx.lat * Math.PI / 180));
        map.fitBounds([
          [Math.max(-89.999,scan.tx.lat - latitudeDegrees),scan.tx.lon - longitudeDegrees],
          [Math.min(89.999,scan.tx.lat + latitudeDegrees),scan.tx.lon + longitudeDegrees]
        ], {padding:[25,25],animate:false});
        await new Promise(resolve=>setTimeout(resolve,1100));
      }
    if (typeof window.html2canvas === "function") {
      try {
        // Capture displayed map tiles, but do not rely on html2canvas to
        // reproduce Leaflet's separate SVG overlay layer.
        const screenshot = await window.html2canvas(target, {
          useCORS: true, allowTaint: false, backgroundColor: "#edf1f3",
          scale: Math.min(2, window.devicePixelRatio || 2),
          logging: false, imageTimeout: 9000,
          onclone: clonedDocument => {
            const pane = clonedDocument.querySelector("#terrainMap .leaflet-overlay-pane");
            if (pane) pane.style.opacity = "0";
            if (reportFocused) {
              const markers = clonedDocument.querySelector("#terrainMap .leaflet-marker-pane");
              if (markers) markers.style.opacity = "0";
            }
          }
        });
        if (screenshot.width && screenshot.height) {
          const canvas = document.createElement("canvas");
          canvas.width = screenshot.width;
          canvas.height = screenshot.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Unable to composite a map image.");
          // A new canvas has the identity transform and a clean clipping path.
          // This is essential: never paint overlay geometry directly on the
          // returned html2canvas context, which can retain a scaled transform.
          ctx.drawImage(screenshot, 0, 0);
          const drawn = drawCoverageOverlay(ctx, canvas, map, scan, !reportFocused);
          if (scan?.cells?.length && !drawn) {
            throw new Error("The current map view contains no visible coverage cells. Center the map on the transmitter and try again.");
          }
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = "rgba(255,255,255,.95)";
          ctx.fillRect(0, canvas.height - 29, canvas.width, 29);
          ctx.fillStyle = "#334455";
          ctx.font = "12px Arial";
          ctx.fillText("Map: OpenStreetMap contributors  |  Terrain: USGS 3DEP  |  Model is not an FCC service contour", 12, canvas.height - 9);
          return { canvas, fallback: false, polygonsDrawn: drawn };
        }
      } catch (error) {
        console.warn("Could not composite map tiles and coverage; rendering a schematic instead:", error);
      }
    }
    const schematic = mapVectorFallback(map, !reportFocused);
    return { canvas: schematic, fallback: true,
      polygonsDrawn: scan?.cells?.length || 0 };
    } finally {
      if (previousView) {
        if (typeof previousView.zoomSnap === "number")
          map.options.zoomSnap = previousView.zoomSnap;
        map.setView(previousView.center,previousView.zoom,{animate:false});
      }
    }
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
  function pdfShortLine(doc, text, maxPt=550) {
    const full=pdfText(text);
    if(doc.getTextWidth(full)<=maxPt)return full;
    let short=full;
    while(short.length>12 && doc.getTextWidth(short+"...")>maxPt)
      short=short.slice(0,-1);
    return short+"...";
  }
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
    const scan = coverage();
    doc.setTextColor(25,59,88);doc.setFont("helvetica","bold");doc.setFontSize(9);
    const mapSummary = scan
      ? (scan.bearings - scan.failedBearings) + "/" + scan.bearings +
        " verified bearings | " + scan.rings + " rings | " +
        (scan.complete ? fmt(scan.terrainVisibleAreaSqMi, 0) + " sq mi estimated visible" : "Incomplete area") +
        " | " + scan.unknownSectors + " unknown sectors"
      : "No 360-degree terrain scan has been run";
    doc.text(pdfText(mapSummary),34,542);
    doc.setTextColor(64,81,91);doc.setFont("helvetica","normal");doc.setFontSize(9);
    doc.text(pdfText("Green: terrain clear | Red: terrain blocked | Gray: unknown | Blue: theoretical radio horizon"),34,556);
    doc.text(pdfText("USGS 3DEP sampling; not a signal prediction or FCC service contour. Map data: OpenStreetMap contributors."),34,573);
    doc.save(safeName("-map.pdf"));
    setStatus(result.fallback
      ? "Map PDF downloaded using schematic terrain overlay because background tiles could not be exported."
      : "Map PDF downloaded (US Letter landscape, one page)." +
        (coverage() ? " Terrain cells rendered: " + result.polygonsDrawn + "." :
          " No 360-degree scan has been run."));
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
  function drawCoverageDiagnostics(doc, scan, chart) {
    // One page: show scan diagnostics in the space formerly reserved for an
    // empty selected-path chart. This does not imply a path analysis was run.
    const x = 30, y = 515, w = 552, h = 129;
    doc.setDrawColor(148,159,169);
    doc.setFillColor(248,249,250);
    doc.rect(x,y,w,h,"FD");
    doc.setTextColor(25,59,88);
    if (!scan) {
      doc.setFont("helvetica","normal"); doc.setFontSize(10);
      doc.text("Run Calculate Terrain-Visible Area to include verified coverage results.",42,567);
      if (chart) drawImageContained(doc,chart,36,581,540,55);
      return;
    }

    const verified = scan.bearings - scan.failedBearings;
    const cells = Array.isArray(scan.cells) ? scan.cells : [];
    const clear = cells.filter(c => c.status === "terrain_clear").length;
    const blocked = cells.filter(c => c.status === "terrain_blocked").length;
    const unknown = cells.filter(c => c.status === "unknown").length;
    const resultsLine = verified + "/" + scan.bearings + " verified bearings  |  " +
      scan.rings + " distance rings  |  " +
      (scan.samplesPerBearing * scan.bearings).toLocaleString("en-US") +
      " sampled terrain positions  |  " + scan.unknownSectors + " unknown sectors";
    doc.setFont("helvetica","bold");
    doc.setFontSize(9);
    doc.text(pdfText(scan.complete ? "SCAN COMPLETE" : "SCAN INCOMPLETE - UNKNOWN TERRAIN REMAINS"),42,531);
    doc.setFont("helvetica","normal");
    doc.setFontSize(8.4);
    doc.setTextColor(64,81,91);
    doc.text(pdfText(resultsLine),42,545);

    if (chart) {
      // When a selected receiving path was also analyzed, show its elevation
      // profile without sacrificing the scan's verified-status summary.
      drawImageContained(doc,chart,35,551,542,89);
      return;
    }

    const summary = [
      ["MOSTLY TERRAIN-CLEAR CELLS",clear],
      ["MOSTLY TERRAIN-BLOCKED CELLS",blocked],
      ["UNKNOWN TERRAIN CELLS",unknown]
    ];
    const centers=[116,298,480];
    summary.forEach((metric,i)=>{
      doc.setTextColor(79,97,109);doc.setFont("helvetica","normal");doc.setFontSize(7.8);
      doc.text(pdfText(metric[0]),centers[i],567,{align:"center"});
      doc.setTextColor(25,59,88);doc.setFont("helvetica","bold");doc.setFontSize(16);
      doc.text(fmt(metric[1],0),centers[i],586,{align:"center"});
    });

    const total = clear + blocked + unknown;
    const segments = [
      {n:clear,color:[18,110,66]},
      {n:blocked,color:[170,45,48]},
      {n:unknown,color:[98,107,117]}
    ];
    let pos=42;
    const length=528;
    doc.setFillColor(229,233,236);doc.rect(pos,602,length,13,"F");
    if(total){
      segments.forEach(segment=>{
        const portion=length*segment.n/total;
        if(portion>0) {
          doc.setFillColor(...segment.color);
          doc.rect(pos,602,portion,13,"F");
          pos+=portion;
        }
      });
    }
    doc.setTextColor(79,97,109);doc.setFont("helvetica","normal");doc.setFontSize(8);
    doc.text("Classification of " + fmt(total,0) +
      " sampled map cells; colors indicate terrain visibility, not received signal strength.",42,630);
  }

  async function onePageReport() {
    await ensurePdfLibrary();
    const result = await captureMap({focusCoverage:true});
    const scan = coverage();
    // Metadata lookup is optional and read-only. Even if USGS catalogs fail,
    // we can still export verified terrain visibility with an explicit
    // "not reported" provenance note.
    const sources = await window.TowerHorizonTerrainSources?.describeCoverage(scan)
      .catch(error => { console.warn("USGS source metadata unavailable", error); return null; });
    const doc = pdf("portrait");
    // This report is always a single 612 x 792 pt US Letter page.
    pdfHeader(doc,"Radio horizon and terrain assessment",
      "Generated " + new Date().toLocaleString("en-US") + " | Preliminary engineering estimate",612);

    doc.setDrawColor(160,174,184);
    doc.setFillColor(245,247,248);doc.roundedRect(30,89,552,76,3,3,"FD");
    labelValue(doc,"Location",val("location") || "Manual coordinates",40,104,235);
    labelValue(doc,"ASRN",val("asrn") || "Manual site",330,104,220);
    labelValue(doc,"TX coordinates",point("terrainTxLat","terrainTxLon"),40,139,240);
    labelValue(doc,"Radial sampling",scan ?
      scan.samplesPerBearing + " points, ~" +
      fmt(scan.radiusM / MI / Math.max(1,scan.samplesPerBearing-1),2) +
      " mi apart" : "Not analyzed",330,139,230);

    const top = 176;
    const boxW = 178;
    const cards = [
      {label:"RADIO HORIZON",value:display("radioHorizon")},
      {label:"GEOMETRIC HORIZON",value:display("geometricHorizon")},
      {label:"TERRAIN VISIBLE AREA",value:scan?.complete ?
        fmt(scan.terrainVisibleAreaSqMi,0) + " sq mi" : "Incomplete / not run"}
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
    doc.text("COVERAGE TEST RESULTS",30,507);
    drawCoverageDiagnostics(doc,scan,null);

    doc.setDrawColor(181,191,198);doc.line(30,657,582,657);
    doc.setTextColor(25,59,88);doc.setFont("helvetica","bold");doc.setFontSize(9);
    doc.text("ENGINEERING INPUTS / USGS TERRAIN SOURCES",30,673);
    doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(64,81,91);
    const k = Number(val("terrainK"));
    const kLabel = Math.abs(k - 4 / 3) < .001 ? "4/3 (Standard RF)" :
      Math.abs(k - 1) < .001 ? "1 (Geometric LoS)" : fmt(k,3);
    const first = "TX center: " + (val("radCenter") || "?") +
      " ft AGL  |  RX assumption: " + (val("receiverHeight") || "?") +
      " ft AGL  |  Base: " + (val("baseElevation") || "?") +
      " ft AMSL  |  k=" + kLabel;
    const second = scan ? "Terrain scan: " +
      (scan.bearings - scan.failedBearings) + "/" + scan.bearings +
      " verified bearings  |  " + scan.rings +
      " distance rings  |  " + scan.unknownSectors +
      " unknown sectors" : "Terrain scan: Not run";
    doc.text(pdfText(first),30,687);
    const secondLines=doc.splitTextToSize(pdfText(second),550);
    doc.text(secondLines.slice(0,2),30,701);
    doc.setTextColor(35,67,84);doc.setFontSize(7.7);
    doc.text(pdfShortLine(doc, "USGS DEM raster resolution: " +
      (sources?.resolutionText || "Not reported by source"),548),30,712);
    doc.text(pdfShortLine(doc, "USGS source projects: " +
      (sources?.projectText || "Not reported by source"),548),30,724);

    doc.setTextColor(104,113,120);doc.setFontSize(7.5);
    doc.text("DEM resolution differs from radial sample spacing. Bare-earth model excludes buildings, trees,",30,739);
    doc.text("Fresnel clearance, diffraction, field strength and interference. Not an FCC service contour.",30,750);
    doc.text(pdfText(result.fallback?"Schematic map export (base tiles unavailable).":"Map: OpenStreetMap contributors; terrain: USGS 3DEP."),30,760);
    doc.setDrawColor(181,191,198);doc.line(30,768,582,768);
    doc.setFontSize(8);doc.text("WAYPOINT UTILITY WEB  /  BETA  /  1 OF 1",30,782);
    doc.save(safeName("-one-page-report.pdf"));
    setStatus("One-page US Letter PDF report downloaded." +
      (scan?.complete === false ? " The report flags incomplete terrain coverage." : "") +
      (scan ? " Terrain cells rendered: " + result.polygonsDrawn + "." :
        " No 360-degree scan has been run.") +
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
  // Shared PDF-loader entrypoint for the independent point-to-point report.
  window.TowerHorizonExports = Object.freeze({ ensurePdfLibrary });
  $("exportCsv").addEventListener("click",()=>runExport("exportCsv",radialsCSV));
  $("exportKml").addEventListener("click",()=>runExport("exportKml",cellsKML));
  $("exportJpeg").addEventListener("click",()=>runExport("exportJpeg",mapJPEG));
  $("exportMapPdf").addEventListener("click",()=>runExport("exportMapPdf",mapPDF));
  $("exportReportPdf").addEventListener("click",()=>runExport("exportReportPdf",onePageReport));
  window.addEventListener("towerCoverageUpdated",refreshButtons);
  window.addEventListener("towerCoverageCleared",refreshButtons);
  refreshButtons();
})();
