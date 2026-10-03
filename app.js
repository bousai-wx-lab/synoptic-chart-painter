"use strict";
const byId = (id) => document.getElementById(id);
const chart = byId("chart");
const ink = byId("ink");
const context = ink.getContext("2d");
const paper = byId("paper");
const viewport = byId("viewport");
const strokeLayer = document.createElement("canvas");
const strokeContext = strokeLayer.getContext("2d");
const analysisLayer = byId("analysis-layer");
const analysisContext = analysisLayer.getContext("2d");
const jetLayer = byId("jet-layer");
const jetContext = jetLayer.getContext("2d");
const windLayer = byId("wind-layer");
const windContext = windLayer.getContext("2d");
const geographyLayer = byId("geography-layer");
const geographyContext = geographyLayer.getContext("2d");
let geography = null;
let satelliteImage = null;
let elevationData = null;
let terrainImage = null;
let terrainError = "";
let geographyStyle = "dots";
let geographyOpacity = 0.4;
let showGeography = true;
let geographyError = "";
const symbolLayer = byId("symbol-layer");
const symbolContext = symbolLayer.getContext("2d");
const symbolMask = document.createElement("canvas");
const symbolMaskContext = symbolMask.getContext("2d");
let originalPixels = null;
let symbols = null;
let showSymbols = true;
let symbolError = "";
const temperatureLayer = byId("temperature-layer");
const temperatureContext = temperatureLayer.getContext("2d");
let isotherms = null;
let showTemperature = true;
let showTemperature500 = true;
let temperatureError = "";
let windBands = null;
let showWind = false;
let candidates = null;
let showTrough = false;
let showJet = false;
let analysisError = "";
const history = [];
const future = [];
let mode = "move";
let color = "#2563eb";
let active = null;
let pointer = null;
let pan = null;
let ready = false;
let chartLabel = "AUPQ35";
let exportUrl = null;
let zoomFactor = 1;
let fitView = true;
let catalog = null;
let currentSelection = null;
let loadingError = "";
let featuresLoading = false;
let loadRevision = 0;
let loadController = null;
const drawingStates = new Map();
const zoomSteps = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const analysisTools = [
  { id: "temperature", button: "temperature", label: "気温線", plane: "300hPa" },
  { id: "wind", button: "wind", label: "風速の色塗り", plane: "300hPa" },
  { id: "jet", button: "jet", label: "強風軸候補", plane: "300hPa" },
  { id: "temperature500", button: "temperature500", label: "気温線", plane: "500hPa" },
  { id: "trough", button: "trough", label: "トラフ候補", plane: "500hPa" },
  { id: "symbols", button: "symbol-color", label: "L・H・C・Wの文字", plane: "300/500hPa" },
  { id: "geography", button: "geography-toggle", label: "陸海・地形", plane: "300/500hPa" }
];
let activeOnly = false;
let selectedDetail = null;

function updateAnalysisPanel() {
  let count = 0;
  for (const tool of analysisTools) {
    const button = byId(tool.button);
    const enabled = button.getAttribute("aria-pressed") === "true";
    if (enabled) count++;
    const row = document.querySelector(`[data-layer="${tool.id}"]`);
    row.hidden = activeOnly && !enabled;
    const detailButton = document.querySelector(`[data-layer-detail="${tool.id}"]`);
    detailButton.disabled = button.disabled;
    const open = selectedDetail === tool.id && !row.hidden;
    detailButton.setAttribute("aria-expanded", String(open));
    byId(`detail-${tool.id}`).hidden = !open;
    button.title = `${tool.label} · ${tool.plane} · ${enabled ? "表示中。クリックで外す" : "クリックで表示"}`;
  }
  byId("layer-count").textContent = String(count);
  byId("active-only").setAttribute("aria-pressed", String(activeOnly));
  byId("no-active-layers").hidden = !activeOnly || count > 0;
  for (const group of document.querySelectorAll("[data-layer-group]")) {
    group.hidden = !Array.from(group.querySelectorAll("[data-layer]")).some(row => !row.hidden);
  }
  const style = ChartGeography.patterns.find(p => p.id === geographyStyle);
  byId("geography-current").textContent = `選択中：${style.label} · 濃さ${Math.round(geographyOpacity * 100)}%`;
  byId("geography-toggle").textContent = `陸海 · ${style.label}`;
  return count;
}
byId("active-only").addEventListener("click", () => { activeOnly = !activeOnly; updateAnalysisPanel(); });
for (const button of document.querySelectorAll("[data-layer-detail]")) button.addEventListener("click", () => {
  selectedDetail = selectedDetail === button.dataset.layerDetail ? null : button.dataset.layerDetail;
  updateAnalysisPanel();
  if (selectedDetail) byId(`detail-${selectedDetail}`).scrollIntoView({ block: "nearest" });
});
function selectPanelMode(manual) {
  byId("manual").hidden = !manual;
  byId("analysis-panel").hidden = manual;
  byId("manual-mode").setAttribute("aria-pressed", String(manual));
  byId("analysis-mode").setAttribute("aria-pressed", String(!manual));
  selectMode(manual ? "paint" : "move");
}
byId("analysis-mode").addEventListener("click", () => selectPanelMode(false));
byId("manual-mode").addEventListener("click", () => selectPanelMode(true));
byId("start-manual").addEventListener("click", () => { selectPanelMode(true); byId("paint").focus(); });

function controls() {
  const afterClear = history.slice(history.map((s) => s.kind).lastIndexOf("clear") + 1);
  const paintCount = afterClear.filter((s) => s.kind === "paint").length;
  byId("undo").disabled = !history.length;
  byId("redo").disabled = !future.length;
  byId("clear").disabled = !paintCount;
  byId("save").disabled = !ready || featuresLoading;
  for (const id of ["analyze", "trough", "jet"]) byId(id).disabled = !ready || !candidates;
  byId("wind").disabled = !ready || !windBands;
  byId("wind").setAttribute("aria-pressed", String(Boolean(showWind && windBands)));
  byId("wind").textContent = "風速の色塗り";
  byId("symbol-color").disabled = !ready || !symbols;
  byId("symbol-color").setAttribute("aria-pressed", String(Boolean(showSymbols && symbols)));
  byId("symbol-color").textContent = "L・H・C・Wの文字";
  byId("temperature").disabled = !ready || !isotherms;
  byId("temperature").setAttribute("aria-pressed", String(Boolean(showTemperature && isotherms)));
  byId("temperature").textContent = "気温線";
  byId("temperature500").disabled = !ready || !isotherms;
  byId("temperature500").setAttribute("aria-pressed", String(Boolean(showTemperature500 && isotherms)));
  byId("original").disabled = !showWind && !showTrough && !showJet && !(showSymbols && symbols) && !(showGeography && geography) && !((showTemperature || showTemperature500) && isotherms);
  byId("geography-toggle").disabled = byId("geography-opacity").disabled = !ready || !geography;
  byId("geography-toggle").setAttribute("aria-pressed", String(Boolean(showGeography && geography)));
  byId("geography-opacity-value").textContent = `${Math.round(geographyOpacity * 100)}%`;
  for (const button of byId("geography-patterns").querySelectorAll("button")) {
    const style = ChartGeography.patterns.find(p => p.id === button.dataset.pattern);
    button.disabled = !ready || !geography || (style.satellite && !satelliteImage) || (style.terrain !== undefined && !terrainImage);
    button.setAttribute("aria-pressed", String(Boolean(showGeography && geography && button.dataset.pattern === geographyStyle)));
  }
  byId("satellite-note").hidden = !showGeography || geographyStyle !== "satellite";
  const selectedStyle = ChartGeography.patterns.find(p => p.id === geographyStyle);
  const isTerrain = showGeography && selectedStyle.terrain !== undefined && terrainImage;
  byId("elevation-note").hidden = !isTerrain;
  byId("elevation-legend").hidden = geographyStyle === "relief";
  byId("relief-note").hidden = !isTerrain || geographyStyle === "elevation";
  for (const swatch of byId("elevation-legend").querySelectorAll("i")) swatch.style.opacity = String(geographyOpacity);
  byId("trough").setAttribute("aria-pressed", String(Boolean(showTrough && candidates)));
  byId("jet").setAttribute("aria-pressed", String(Boolean(showJet && candidates)));
  byId("zoom-in").disabled = !ready || (!fitView && zoomFactor >= 4);
  byId("zoom-out").disabled = !ready || (!fitView && zoomFactor <= 0.25);
  paper.dataset.strokes = String(history.length);
  paper.dataset.trough = String(Boolean(showTrough && candidates));
  paper.dataset.jet = String(Boolean(showJet && candidates));
  paper.dataset.wind = String(Boolean(showWind && windBands));
  paper.dataset.symbols = String(Boolean(showSymbols && symbols));
  paper.dataset.temperature = String(Boolean(showTemperature && isotherms));
  paper.dataset.temperature500 = String(Boolean(showTemperature500 && isotherms));
  paper.dataset.geography = showGeography && geography ? geographyStyle : "off";
  const layerCount = updateAnalysisPanel();
  const layers = [layerCount ? `解析${layerCount}項目` : "原図", paintCount ? `手描き${paintCount}筆` : ""].filter(Boolean);
  byId("status").textContent = loadingError || (!ready ? "図を読み込み中" : [geographyError, terrainError, symbolError, temperatureError, analysisError].filter(Boolean).join("・") || [currentSelection?.product.code, ...(layers.length ? layers : ["原図を表示中"])].filter(Boolean).join("・"));
}

function drawGeography() {
  geographyContext.clearRect(0, 0, geographyLayer.width, geographyLayer.height);
  if (!ready || !showGeography || !geography) return;
  const style = ChartGeography.patterns.find(p => p.id === geographyStyle);
  // A restored style can arrive before its independently validated image.
  if ((style.satellite && !satelliteImage) || (style.terrain !== undefined && !terrainImage)) return;
  ChartGeography.draw(geographyContext, geography, geographyStyle, geographyOpacity, satelliteImage, terrainImage);
}
for (const [index, style] of ChartGeography.patterns.entries()) {
  const button = document.createElement("button"), preview = document.createElement("canvas"), label = document.createElement("span");
  button.type = "button"; button.dataset.pattern = style.id; button.disabled = true; button.setAttribute("aria-pressed", "false");
  preview.width = 132; preview.height = 30; preview.setAttribute("aria-hidden", "true");
  ChartGeography.preview(preview, style.id, satelliteImage);
  label.textContent = `${index + 1}. ${style.label}`; button.append(preview, label);
  button.addEventListener("click", () => { geographyStyle = style.id; showGeography = true; drawGeography(); controls(); });
  byId("geography-patterns").append(button);
}
byId("geography-toggle").addEventListener("click", () => { showGeography = !showGeography; drawGeography(); controls(); });
byId("geography-opacity").addEventListener("input", (event) => { geographyOpacity = Number(event.target.value) / 100; drawGeography(); controls(); });

function line(ctx, points, width, color) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.stroke();
}
function drawAnalysis() {
  analysisContext.clearRect(0, 0, analysisLayer.width, analysisLayer.height);
  jetContext.clearRect(0, 0, jetLayer.width, jetLayer.height);
  if (!candidates) return;
  if (showJet) ChartAnalysis.drawJetAxes(jetContext, candidates.jets, windBands.bounds);
  if (showTrough) for (const points of candidates.troughs) {
    analysisContext.globalAlpha = 0.85;
    for (const sign of [-1, 1]) line(analysisContext, points.map((p, i) => {
      const left = points[Math.max(0, i - 1)], right = points[Math.min(points.length - 1, i + 1)];
      const dx = right[0] - left[0], dy = right[1] - left[1], length = Math.hypot(dx, dy) || 1;
      return [p[0] - sign * dy * 5 / length, p[1] + sign * dx * 5 / length];
    }), 4, "#9a4b16");
  }
  analysisContext.globalAlpha = 1;
}
const windLabels = ["40–60 kt", "60–80 kt", "80–100 kt", "100–120 kt", "120 kt以上"];
for (const [index, color] of ChartAnalysis.windPalette.entries()) {
  const entry = document.createElement("span"), swatch = document.createElement("i");
  entry.className = "wind-swatch"; swatch.style.backgroundColor = color;
  swatch.setAttribute("aria-hidden", "true"); entry.append(swatch, windLabels[index]);
  byId("wind-legend").append(entry);
}
function drawWind() {
  windContext.clearRect(0, 0, windLayer.width, windLayer.height);
  if (showWind && windBands) ChartAnalysis.drawWindBands(windContext, windBands);
}
byId("wind").addEventListener("click", () => {
  if (!ready || !windBands) return;
  showWind = !showWind; drawWind(); controls();
});
function drawSymbols() {
  symbolContext.clearRect(0, 0, symbolLayer.width, symbolLayer.height);
  if (!showSymbols || !symbols || !originalPixels) return;
  const output = symbolContext.createImageData(symbolLayer.width, symbolLayer.height);
  for (const symbol of symbols.symbols) {
    const [left, top, right, bottom] = symbol.bounds;
    const x0 = Math.floor(left - 4), y0 = Math.floor(top - 4), width = Math.ceil(right + 4) - x0, height = Math.ceil(bottom + 4) - y0;
    symbolMaskContext.clearRect(x0, y0, width, height);
    // A one-pixel selection tolerance captures the source renderer's ink fringe.
    // Only existing nonwhite ink can be recolored; the tolerance adds no paint.
    ChartAnalysis.drawSymbols(symbolMaskContext, { symbols: [{ ...symbol, strokes: symbol.strokes.map((s) => ({ ...s, width_px: s.width_px + 1 })) }] });
    const mask = symbolMaskContext.getImageData(x0, y0, width, height).data;
    const rgb = ChartAnalysis.symbolPalette[symbol.letter].slice(1).match(/../g).map((v) => parseInt(v, 16));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (mask[(y * width + x) * 4 + 3] <= 16) continue;
      const index = ((y0 + y) * symbolLayer.width + x0 + x) * 4;
      const gray = originalPixels.data[index];
      if (gray === 255) continue;
      for (let channel = 0; channel < 3; channel++) output.data[index + channel] = Math.round(gray + rgb[channel] * (1 - gray / 255));
      output.data[index + 3] = 255;
    }
  }
  symbolContext.putImageData(output, 0, 0);
}
byId("symbol-color").addEventListener("click", () => {
  if (!ready || !symbols) return;
  showSymbols = !showSymbols; drawSymbols(); controls();
});
for (const scale of ChartAnalysis.isothermScales) for (const [index, value] of scale.values.entries()) {
  const entry = document.createElement("span"), swatch = document.createElement("i");
  swatch.style.borderColor = scale.colors[index]; swatch.setAttribute("aria-hidden", "true");
  entry.append(swatch, `${value}℃`); byId(scale.pressure_hpa===300 ? "temperature-legend" : "temperature500-legend").append(entry);
}
function drawTemperature() {
  temperatureContext.clearRect(0, 0, temperatureLayer.width, temperatureLayer.height);
  if (ready && isotherms) ChartAnalysis.drawIsotherms(temperatureContext, isotherms, [showTemperature?300:null,showTemperature500?500:null]);
}
byId("temperature").addEventListener("click", () => {
  if (!ready || !isotherms) return;
  showTemperature = !showTemperature; drawTemperature(); controls();
});
byId("temperature500").addEventListener("click", () => {
  if (!ready || !isotherms) return;
  showTemperature500 = !showTemperature500; drawTemperature(); controls();
});
for (const id of ["analyze", "trough", "jet", "original"]) byId(id).addEventListener("click", () => {
  if (!ready || (id !== "original" && !candidates)) return;
  if (id === "analyze") showTrough = showJet = true;
  if (id === "trough") showTrough = !showTrough;
  if (id === "jet") showJet = !showJet;
  if (id === "original") showWind = showTrough = showJet = showSymbols = showGeography = showTemperature = showTemperature500 = false;
  drawAnalysis(); drawWind(); drawSymbols(); drawGeography(); drawTemperature(); controls();
});

function path(stroke) {
  strokeContext.clearRect(0, 0, ink.width, ink.height);
  if (stroke.kind === "clear") return;
  strokeContext.strokeStyle = stroke.color;
  strokeContext.fillStyle = stroke.color;
  strokeContext.lineWidth = stroke.width;
  strokeContext.lineCap = "round";
  strokeContext.lineJoin = "round";
  const [first, ...rest] = stroke.points;
  if (!rest.length) {
    strokeContext.beginPath();
    strokeContext.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
    strokeContext.fill();
  } else {
    strokeContext.beginPath();
    strokeContext.moveTo(first.x, first.y);
    for (const point of rest) strokeContext.lineTo(point.x, point.y);
    strokeContext.stroke();
  }
}

function apply(stroke) {
  if (stroke.kind === "clear") { context.clearRect(0, 0, ink.width, ink.height); return; }
  path(stroke);
  context.save();
  context.globalCompositeOperation = stroke.kind === "erase" ? "destination-out" : "source-over";
  context.globalAlpha = stroke.kind === "erase" ? 1 : stroke.opacity;
  context.drawImage(strokeLayer, 0, 0);
  context.restore();
}

function render() {
  context.clearRect(0, 0, ink.width, ink.height);
  for (const stroke of history) apply(stroke);
  if (active) apply(active);
}

function selectMode(next) {
  mode = next;
  ink.dataset.mode = mode;
  for (const id of ["paint", "erase", "move"]) byId(id).setAttribute("aria-pressed", String(id === mode));
  byId("hint").textContent = mode === "move" ? "拡大した図をドラッグして移動します。" : mode === "erase" ? "色塗りだけを消します。原図は残ります。" : "ドラッグして色を塗ります。原図の黒い線は残ります。";
}

function viewSize() {
  const style = getComputedStyle(viewport);
  return {
    width: Math.max(1, viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)),
    height: Math.max(1, viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom))
  };
}
function updateZoomLabel() {
  const exact = zoomSteps.find((step) => Math.abs(step - zoomFactor) < 0.0001);
  byId("custom-zoom").hidden = fitView || Boolean(exact);
  byId("custom-zoom").textContent = `${Math.round(zoomFactor * 100)}%`;
  byId("zoom").value = fitView ? "fit" : exact ? String(exact) : "custom";
}
function fit(anchor) {
  if (!ready || pointer !== null) return;
  const viewRect = viewport.getBoundingClientRect(), oldRect = paper.getBoundingClientRect();
  const focus = anchor || { x: viewRect.left + viewport.clientWidth / 2, y: viewRect.top + viewport.clientHeight / 2 };
  const center = { x: (focus.x - oldRect.left) / oldRect.width, y: (focus.y - oldRect.top) / oldRect.height };
  const size = viewSize();
  const width = fitView ? Math.min(size.width, size.height * ink.width / ink.height) : size.width * zoomFactor;
  paper.style.width = `${Math.floor(width)}px`;
  paper.style.height = `${Math.floor(width) * ink.height / ink.width}px`;
  if (fitView) { viewport.scrollTop = 0; viewport.scrollLeft = 0; zoomFactor = Math.floor(width) / size.width; }
  else { const rect = paper.getBoundingClientRect(); viewport.scrollLeft += rect.left + center.x * rect.width - focus.x; viewport.scrollTop += rect.top + center.y * rect.height - focus.y; }
  updateZoomLabel();
  controls();
}
function setZoom(factor, anchor) {
  if (!ready || pointer !== null) return;
  zoomFactor = Math.max(0.25, Math.min(4, factor)); fitView = false; fit(anchor);
}
function zoomBy(direction) {
  if (!ready || pointer !== null) return;
  setZoom(direction > 0 ? (zoomSteps.find((x) => x > zoomFactor + 0.005) || 4) : ([...zoomSteps].reverse().find((x) => x < zoomFactor - 0.005) || 0.25));
}
byId("zoom-in").addEventListener("click", () => zoomBy(1));
byId("zoom-out").addEventListener("click", () => zoomBy(-1));
byId("fit").addEventListener("click", () => { fitView = true; fit(); });
viewport.addEventListener("wheel", (event) => {
  if (!ready || pointer !== null || !event.deltaY) return;
  event.preventDefault();
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
  setZoom(zoomFactor * Math.exp(-Math.max(-120, Math.min(120, pixels)) * 0.0025), { x: event.clientX, y: event.clientY });
}, { passive: false });

function setPanel(open, focus = false) {
  if (pointer !== null) return;
  byId("workspace").classList.toggle("panel-collapsed", !open);
  byId("control-panel").hidden = !open;
  byId("panel-open").hidden = open;
  byId("panel-close").setAttribute("aria-expanded", String(open));
  byId("panel-open").setAttribute("aria-expanded", String(open));
  if (focus) byId(open ? "panel-close" : "panel-open").focus();
}
byId("panel-close").addEventListener("click", () => setPanel(false, true));
byId("panel-open").addEventListener("click", () => setPanel(true, true));
byId("choose-chart").addEventListener("click", () => { setPanel(true); byId("chart-select").scrollIntoView({ block: "nearest" }); byId("chart-select").focus(); });
const narrowView = matchMedia("(max-width: 720px)");
setPanel(!narrowView.matches);
narrowView.addEventListener("change", (event) => setPanel(!event.matches));
const compactLinks = matchMedia("(max-width: 1100px)");
byId("links").open = !compactLinks.matches;
compactLinks.addEventListener("change", (event) => { byId("links").open = !event.matches; });

function point(event) {
  const rect = ink.getBoundingClientRect();
  return { x: Math.max(0, Math.min(ink.width, (event.clientX - rect.left) * ink.width / rect.width)), y: Math.max(0, Math.min(ink.height, (event.clientY - rect.top) * ink.height / rect.height)) };
}

ink.addEventListener("pointerdown", (event) => {
  if (!ready || pointer !== null || event.button !== 0) return;
  pointer = event.pointerId;
  ink.setPointerCapture(pointer);
  ink.dataset.dragging = "true";
  if (mode === "move") {
    pan = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
  } else {
    active = { kind: mode, color, width: Number(byId("width").value) * ink.width / ink.getBoundingClientRect().width, opacity: Number(byId("opacity").value), points: [point(event)] };
    render();
  }
});

ink.addEventListener("pointermove", (event) => {
  if (event.pointerId !== pointer) return;
  if (pan) {
    viewport.scrollLeft = pan.left + pan.x - event.clientX;
    viewport.scrollTop = pan.top + pan.y - event.clientY;
  } else if (active) {
    const samples = event.getCoalescedEvents?.();
    for (const sample of samples?.length ? samples : [event]) active.points.push(point(sample));
    render();
  }
});

function finish(event) {
  if (event.pointerId !== pointer) return;
  if (active) {
    history.push(active); future.length = 0; active = null;
  }
  pointer = null; pan = null;
  ink.dataset.dragging = "false";
  render(); controls();
}
ink.addEventListener("pointerup", finish);
ink.addEventListener("pointercancel", finish);
ink.addEventListener("lostpointercapture", finish);

for (const id of ["paint", "erase", "move"]) byId(id).addEventListener("click", () => selectMode(id));
for (const swatch of document.querySelectorAll("[data-color]")) swatch.addEventListener("click", () => {
  color = swatch.dataset.color; byId("color").value = color; selectMode("paint");
  for (const button of document.querySelectorAll("[data-color]")) button.setAttribute("aria-pressed", String(button === swatch));
});
byId("color").addEventListener("input", (event) => {
  color = event.target.value; selectMode("paint");
  for (const button of document.querySelectorAll("[data-color]")) button.setAttribute("aria-pressed", "false");
});
byId("undo").addEventListener("click", () => { if (history.length && pointer === null) { future.push(history.pop()); render(); controls(); } });
byId("redo").addEventListener("click", () => { if (future.length && pointer === null) { history.push(future.pop()); render(); controls(); } });
byId("clear").addEventListener("click", () => byId("clear-dialog").showModal());
byId("clear-dialog").addEventListener("close", () => {
  if (byId("clear-dialog").returnValue === "clear") { history.push({ kind: "clear" }); future.length = 0; render(); controls(); }
});
byId("zoom").addEventListener("change", (event) => {
  if (event.target.value === "fit") { fitView = true; fit(); }
  else if (event.target.value !== "custom") setZoom(Number(event.target.value));
});
new ResizeObserver(() => fit()).observe(viewport);

byId("save").addEventListener("click", () => {
  if (!ready || featuresLoading || !currentSelection) return;
  const selected = currentSelection;
  const exportRevision = loadRevision;
  const output = document.createElement("canvas");
  const selectedGeography = ChartGeography.patterns.find(p => p.id === geographyStyle);
  const exportTerrain = Boolean(showGeography && geography && terrainImage && selectedGeography.terrain !== undefined);
  const exportTemperatures = isotherms ? ChartAnalysis.isothermScales.filter(s=>s.pressure_hpa===300 ? showTemperature : showTemperature500) : [];
  const footerHeight = exportTerrain ? 340 : 260;
  output.width = ink.width; output.height = ink.height + footerHeight + (exportTemperatures.length ? exportTemperatures.length*40+56 : 0);
  const ctx = output.getContext("2d");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(chart, 0, 0);
  ctx.globalCompositeOperation = "multiply"; ctx.drawImage(geographyLayer, 0, 0); ctx.drawImage(windLayer, 0, 0); ctx.drawImage(analysisLayer, 0, 0);
  ctx.globalCompositeOperation = "source-over"; ctx.drawImage(jetLayer, 0, 0);
  ctx.drawImage(temperatureLayer, 0, 0);
  ctx.drawImage(symbolLayer, 0, 0);
  ctx.globalCompositeOperation = "multiply"; ctx.drawImage(ink, 0, 0); ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#243247"; ctx.font = "24px sans-serif";
  ctx.fillText(`出典：気象庁 ${selected.product.code}（画像化） / ${chartLabel}`, 26, ink.height + 38, output.width - 52);
  ctx.fillText(`解析案：${showTrough ? "500hPaトラフ候補 " : ""}${showJet ? "300hPa強風軸候補" : ""}${!showTrough && !showJet ? "表示なし" : ""} / 手描き：利用者`, 26, ink.height + 76);
  if (showSymbols && symbols) for (const [index, letter] of ["L", "H", "C", "W"].entries()) {
    ctx.fillStyle = ChartAnalysis.symbolPalette[letter]; ctx.fillText(letter, 1610 + index * 90, ink.height + 76);
  }
  ctx.fillStyle = "#243247";
  ctx.font = "22px sans-serif"; ctx.fillText(showWind ? "風速（300hPa）" : "風速の色塗り：表示なし", 26, ink.height + 116);
  if (showWind) for (const [index, color] of ChartAnalysis.windPalette.entries()) {
    const x = 230 + index * 260;
    ctx.fillStyle = color; ctx.fillRect(x, ink.height + 95, 32, 24);
    ctx.fillStyle = "#243247"; ctx.fillText(windLabels[index], x + 42, ink.height + 116);
  }
  ctx.fillText(selected.variant.features === "reviewed-aupq35" ? "赤矢印：等風速線の強い帯の中心（流れの経路はこの1枚で確認）。トラフ：等高度線の曲がりから推定。" : `${selected.product.name}${selected.product.period ? " · " + selected.product.period : ""}`, 26, ink.height + 155, output.width - 52);
  ctx.fillText("利用者の着色・解析は気象庁の公式の解析ではありません。天気図解析マスター · Weather Chart Analysis Master · Bousai Wx Lab", 26, ink.height + 193, output.width - 52);
  const geoLabel = showGeography && geography ? `${ChartGeography.patterns.find(p => p.id === geographyStyle).label}（濃さ${Math.round(geographyOpacity * 100)}%）` : "表示なし";
  ctx.fillText(selected.variant.features === "reviewed-aupq35" ? `陸海：${geoLabel}${showGeography && geographyStyle === "satellite" ? " / NASA Earth Observatory・Reto Stoeckli / 2004年10月の地表画像（投影変換）" : ""}` : "自動更新なし。解析・予想の日時は原図内を確認してください。", 26, ink.height + 231, output.width - 52);
  if (exportTerrain) {
    ctx.fillText("地表標高：NOAA ETOPO 2022 / EGM2008基準 / 1分格子（南北約1.9km）/ 投影変換した広域表示", 26, ink.height + 268);
    if (geographyStyle === "relief") ctx.fillText("陰影の明暗は斜面の向き・傾き。北西からの照明で山の凹凸を強調しています。", 26, ink.height + 307);
    else for (const [index, label] of elevationData.legend.labels.entries()) {
      const x = 26 + index * 275;
      ctx.save(); ctx.globalAlpha = geographyOpacity; ctx.fillStyle = elevationData.legend.colors[index]; ctx.fillRect(x, ink.height + 287, 30, 24); ctx.restore();
      ctx.fillStyle = "#243247"; ctx.fillText(label, x + 39, ink.height + 307);
    }
  }
  if (exportTemperatures.length) {
    for (const [row,scale] of exportTemperatures.entries()) {
    const y = ink.height + footerHeight + 30 + row*40;
    ctx.fillStyle = "#243247"; ctx.font = "22px sans-serif"; ctx.fillText(`${scale.pressure_hpa}hPa 気温線`, 26, y);
    ctx.save(); ctx.setLineDash(scale.dash); ctx.lineDashOffset = 0;
    for (const [index, value] of scale.values.entries()) {
      const x = 230 + index * 170;
      const length = scale.pressure_hpa===500 ? 56 : 38;
      ctx.strokeStyle = scale.colors[index]; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x,y-8); ctx.lineTo(x+length,y-8); ctx.stroke();
      ctx.fillStyle = "#243247"; ctx.fillText(`${value}℃`,x+length+10,y);
    }
    ctx.restore();
    }
    ctx.fillText("原図の気温表示・破線をもとに滑らかにつなぐ補助線。気温の格子データから算出した線ではありません。", 26, ink.height+footerHeight+exportTemperatures.length*40+28, output.width-52);
  }
  output.toBlob((blob) => {
    if (loadRevision !== exportRevision || currentSelection?.key !== selected.key || !ready) return;
    if (!blob) { byId("status").textContent = "保存できませんでした"; return; }
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    exportUrl = URL.createObjectURL(blob);
    const link = byId("export-link");
    link.download = `${selected.variant.id}-p${selected.page.number}-colored.png`;
    link.href = exportUrl; link.hidden = false; link.click();
    byId("status").textContent = "PNGを書き出しました";
  }, "image/png");
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !["INPUT", "SELECT"].includes(event.target.tagName)) {
    event.preventDefault(); byId(event.shiftKey ? "redo" : "undo").click();
  }
});

function initialize(selected) {
  if (chart.naturalWidth !== selected.page.width || chart.naturalHeight !== selected.page.height) throw Error("Chart dimensions mismatch");
  for (const canvas of [ink, strokeLayer]) {
    canvas.width = chart.naturalWidth; canvas.height = chart.naturalHeight;
  }
  const reviewed = selected.variant.features === "reviewed-aupq35";
  for (const canvas of [analysisLayer, jetLayer, windLayer, geographyLayer, symbolLayer, symbolMask, temperatureLayer]) {
    canvas.width = reviewed ? chart.naturalWidth : 1;
    canvas.height = reviewed ? chart.naturalHeight : 1;
    canvas.hidden = !reviewed;
  }
  if (selected.variant.features === "reviewed-aupq35") {
    symbolMaskContext.drawImage(chart, 0, 0);
    originalPixels = symbolMaskContext.getImageData(0, 0, chart.naturalWidth, chart.naturalHeight);
    symbolMaskContext.clearRect(0, 0, symbolMask.width, symbolMask.height);
  }
  paper.style.aspectRatio = `${ink.width} / ${ink.height}`;
  ready = true; paper.hidden = false; paper.dataset.ready = "true"; paper.dataset.chart = selected.product.id; paper.dataset.source = selected.variant.id;
  selectMode(byId("manual").open ? "paint" : "move"); render(); drawAnalysis(); drawWind(); drawSymbols(); drawGeography(); drawTemperature(); fit(); controls();
}
async function fetchJSON(path, signal) {
  const response = await fetch(path, { cache: "no-store", signal });
  if (!response.ok) throw Error("Chart data unavailable");
  return response.json();
}
async function checkedImage(path, expectedHash, width, height, signal, retry = false, applyImage = null) {
  const response = await fetch(path, { signal, cache: retry ? "reload" : "default" });
  if (!response.ok) throw Error("Chart image unavailable");
  const bytes = await response.arrayBuffer();
  const actualHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  if (actualHash !== expectedHash) throw Error("Chart image hash mismatch");
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" })), image = new Image();
  try {
    image.src = url; await image.decode();
    if (image.naturalWidth !== width || image.naturalHeight !== height) throw Error("Chart image size mismatch");
    if (applyImage) await applyImage(image);
    return image;
  } finally { URL.revokeObjectURL(url); }
}
function keepDrawing() {
  if (!ready || !currentSelection) return;
  if (pointer !== null) finish({ pointerId: pointer });
  drawingStates.set(currentSelection.key, { history: [...history], future: [...future], showWind, showTrough, showJet, showSymbols, showGeography, geographyStyle, geographyOpacity, showTemperature, showTemperature500 });
}
function setOptions(select, records, value) {
  select.replaceChildren();
  for (const record of records) {
    const option = document.createElement("option"); option.value = record.id; option.textContent = record.label; select.append(option);
  }
  select.value = value || records[0].id; select.disabled = records.length < 2;
}
function selectProduct() {
  const product = catalog.products.find(p => p.id === byId("chart-select").value);
  setOptions(byId("source-select"), product.variants, product.variants[0].id);
  selectSource();
}
function selectSource() {
  const product = catalog.products.find(p => p.id === byId("chart-select").value);
  const variant = product.variants.find(v => v.id === byId("source-select").value);
  setOptions(byId("page-select"), variant.pages.map(page => ({ id: String(page.number), label: `${page.number} / ${variant.pages.length} ページ` })));
  byId("page-selection").hidden = variant.pages.length === 1;
  loadSelection();
}
byId("chart-select").addEventListener("change", selectProduct);
byId("source-select").addEventListener("change", selectSource);
byId("page-select").addEventListener("change", () => loadSelection());
byId("chart-retry").addEventListener("click", () => catalog ? loadSelection(true) : loadCatalog());
async function loadSelection(retry = false) {
  keepDrawing();
  const revision = ++loadRevision;
  loadController?.abort(); loadController = new AbortController();
  const signal = loadController.signal;
  const selected = ChartCatalog.selection(catalog, byId("chart-select").value, byId("source-select").value, Number(byId("page-select").value));
  currentSelection = selected; ready = false; paper.hidden = true; paper.dataset.ready = "false";
  active = pointer = pan = originalPixels = null;
  geography = satelliteImage = elevationData = terrainImage = symbols = windBands = candidates = isotherms = null;
  loadingError = geographyError = terrainError = symbolError = analysisError = temperatureError = "";
  history.length = future.length = 0;
  const state = drawingStates.get(selected.key);
  if (state) { history.push(...state.history); future.push(...state.future); }
  showWind = state?.showWind || false; showTrough = state?.showTrough || false; showJet = state?.showJet || false;
  showSymbols = state?.showSymbols ?? true; showGeography = state?.showGeography ?? true;
  showTemperature = state?.showTemperature ?? true;
  showTemperature500 = state?.showTemperature500 ?? true;
  geographyStyle = state?.geographyStyle || "dots"; geographyOpacity = state?.geographyOpacity ?? 0.4;
  byId("geography-opacity").value = String(Math.round(geographyOpacity * 100));
  fitView = true;
  if (exportUrl) { URL.revokeObjectURL(exportUrl); exportUrl = null; }
  byId("export-link").hidden = true; byId("export-link").removeAttribute("href");
  byId("chart-retry").hidden = true;
  const reviewed = selected.variant.features === "reviewed-aupq35";
  featuresLoading = reviewed;
  selectedDetail = null; activeOnly = false;
  byId("manual-only").hidden = reviewed;
  for (const section of document.querySelectorAll("[data-requires]")) section.hidden = !reviewed;
  const retrieved = new Date(selected.variant.retrieved_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  chartLabel = selected.variant.observation_label || `${selected.variant.label} · ${retrieved} JST取得`;
  byId("chart-name").textContent = `${selected.product.name}${selected.product.period ? " · " + selected.product.period : ""}`;
  byId("chart-info").textContent = chartLabel;
  byId("chart-note").textContent = reviewed ? "自動更新なし。上段300hPa・下段500hPa。自動の着色・解析候補も使えます。" : "自動更新なし。この図の自動着色・解析は未対応です。手描きで色を塗れます。解析・予想の日時は原図内を確認してください。";
  byId("source-link").href = selected.variant.source_url;
  byId("source-link").textContent = `気象庁 ${selected.product.code} 原図${selected.variant.source_url.endsWith(".pdf") ? "PDF" : "PNG"}`;
  controls();
  try {
    await checkedImage(selected.page.image_path, selected.page.image_sha256, selected.page.width, selected.page.height, signal, retry, async image => {
      if (revision !== loadRevision) return;
      chart.src = image.src; await chart.decode();
    });
    if (revision !== loadRevision) return;
    chart.alt = `気象庁 ${selected.product.code} · ${selected.product.name} · ${chartLabel}`;
    initialize(selected);
    if (reviewed) await loadFeatures(selected, revision, signal);
    if (revision === loadRevision) { featuresLoading = false; controls(); }
  } catch (error) {
    if (revision !== loadRevision || error.name === "AbortError") return;
    loadingError = "図を読み込めませんでした。「図を再読み込み」か別の天気図を選んでください。";
    byId("chart-retry").hidden = false; controls();
  }
}
async function loadFeatures(selected, revision, signal) {
  const current = () => revision === loadRevision;
  let data;
  try {
    data = await fetchJSON("chart.json", signal);
    if (data.image_path !== selected.page.image_path || data.image_sha256 !== selected.page.image_sha256 || data.source_sha256 !== selected.variant.source_sha256 || data.width !== selected.page.width || data.height !== selected.page.height) throw Error("Analysis source mismatch");
  } catch (error) {
    if (current() && error.name !== "AbortError") { analysisError = "自動着色・解析の資料を確認できません。原図の閲覧・手描きは使えます。"; controls(); }
    return;
  }
  await Promise.allSettled([
    (async () => {
      try {
        const checked = ChartAnalysis.validateIsotherms(await fetchJSON("isotherms.json", signal), data);
        if (current()) { isotherms = checked; drawTemperature(); controls(); }
      } catch (error) { if (current() && error.name !== "AbortError") { temperatureError = "気温線の資料を確認できません。原図の気温表示は残ります。"; controls(); } }
    })(),
    (async () => {
      try {
        const [contours, wind, guides] = await Promise.all(["contours.json", "wind-bands.json", "jet-guides.json"].map(path => fetchJSON(path, signal)));
        const checkedContours = ChartAnalysis.validate(contours, data), checkedWind = ChartAnalysis.validateWindBands(wind, data);
        const checkedGuides = ChartAnalysis.validateJetGuides(guides, data, checkedWind);
        const checkedCandidates = ChartAnalysis.analyze(checkedContours, checkedWind, checkedGuides);
        if (current()) { windBands = checkedWind; candidates = checkedCandidates; drawAnalysis(); drawWind(); controls(); }
      } catch (error) { if (current() && error.name !== "AbortError") { analysisError = "解析資料を確認できません。原図の閲覧・手描きは使えます。"; controls(); } }
    })(),
    (async () => {
      try {
        const checked = ChartAnalysis.validateSymbols(await fetchJSON("center-symbols.json", signal), data);
        if (current()) { symbols = checked; drawSymbols(); controls(); }
      } catch (error) { if (current() && error.name !== "AbortError") { symbolError = "文字の資料を確認できません。原図の文字を表示します。"; controls(); } }
    })(),
    (async () => {
      try {
        const checked = ChartGeography.validate(await fetchJSON("land-sea.json", signal), data);
        if (!current()) return;
        geography = checked; drawGeography(); controls();
        try {
          const image = await checkedImage(checked.satellite.path, checked.satellite.image_sha256, checked.satellite.width, checked.satellite.height, signal);
          if (current()) { satelliteImage = image; ChartGeography.preview(byId("geography-patterns").querySelector('[data-pattern="satellite"] canvas'), "satellite", image); drawGeography(); controls(); }
        } catch (error) { if (current() && error.name !== "AbortError") { geographyError = "衛星画像を確認できません。ほかの塗り方は使えます。"; controls(); } }
      } catch (error) { if (current() && error.name !== "AbortError") { geographyError = "陸海の資料を確認できません。ほかの色分けは使えます。"; controls(); } }
    })(),
    (async () => {
      try {
        const checked = ChartGeography.validateElevation(await fetchJSON("elevation.json", signal), data);
        const image = await checkedImage(checked.image.path, checked.image.sha256, checked.image.width, checked.image.height, signal);
        if (!current()) return;
        elevationData = checked; terrainImage = image;
        for (const style of ChartGeography.patterns.filter(p => p.terrain !== undefined)) ChartGeography.preview(byId("geography-patterns").querySelector(`[data-pattern="${style.id}"] canvas`), style.id, null, image);
        byId("elevation-legend").replaceChildren();
        for (const [index, label] of checked.legend.labels.entries()) {
          const entry = document.createElement("span"), swatch = document.createElement("i");
          swatch.style.backgroundColor = checked.legend.colors[index]; swatch.setAttribute("aria-hidden", "true"); entry.append(swatch, label); byId("elevation-legend").append(entry);
        }
        drawGeography(); controls();
      } catch (error) { if (current() && error.name !== "AbortError") { terrainError = "標高の資料を確認できません。ほかの塗り方は使えます。"; controls(); } }
    })()
  ]);
}
async function loadCatalog() {
  loadingError = ""; byId("chart-retry").hidden = true;
  try {
    catalog = ChartCatalog.validate(await fetchJSON("chart-catalog.json"));
    const picker = byId("chart-select"); picker.replaceChildren();
    for (const [id, label] of [["observation", "実況天気図"], ["forecast", "予想天気図"]]) {
      const group = document.createElement("optgroup"); group.label = label;
      for (const product of catalog.products.filter(p => p.group === id)) {
        const option = document.createElement("option"); option.value = product.id; option.textContent = `${product.code} · ${product.name}${product.period ? "（" + product.period + "）" : ""}`; group.append(option);
      }
      picker.append(group);
    }
    picker.disabled = false; picker.value = "aupq35";
    byId("chart-count").textContent = `実況${catalog.products.filter(p => p.group === "observation").length}・予想${catalog.products.filter(p => p.group === "forecast").length}`;
    selectProduct();
  } catch (_) {
    catalog = null; loadingError = "天気図の一覧を読み込めませんでした。「図を再読み込み」を押してください。";
    byId("chart-select").disabled = true; byId("chart-retry").hidden = false; controls();
  }
}
loadCatalog();
