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
const zoomSteps = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

function controls() {
  const afterClear = history.slice(history.map((s) => s.kind).lastIndexOf("clear") + 1);
  const paintCount = afterClear.filter((s) => s.kind === "paint").length;
  byId("undo").disabled = !history.length;
  byId("redo").disabled = !future.length;
  byId("clear").disabled = !paintCount;
  byId("save").disabled = !ready;
  for (const id of ["analyze", "trough", "jet"]) byId(id).disabled = !ready || !candidates;
  byId("wind").disabled = !ready || !windBands;
  byId("wind").setAttribute("aria-pressed", String(showWind));
  byId("wind").textContent = showWind ? "色塗りを外す" : "風速を色塗り";
  byId("original").disabled = !showWind && !showTrough && !showJet;
  byId("trough").setAttribute("aria-pressed", String(showTrough));
  byId("jet").setAttribute("aria-pressed", String(showJet));
  byId("zoom-in").disabled = !ready || (!fitView && zoomFactor >= 4);
  byId("zoom-out").disabled = !ready || (!fitView && zoomFactor <= 0.25);
  paper.dataset.strokes = String(history.length);
  paper.dataset.trough = String(showTrough);
  paper.dataset.jet = String(showJet);
  paper.dataset.wind = String(showWind);
  const layers = [showWind ? "300hPa 風速を色分け中" : "", showTrough ? `トラフ候補${candidates.troughs.length}本` : "", showJet ? `強風軸候補${candidates.jets.length}本` : "", paintCount ? `手描き${paintCount}筆` : ""].filter(Boolean);
  byId("status").textContent = analysisError || (layers.length ? layers.join("・") : "原図を表示中");
}

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
for (const id of ["analyze", "trough", "jet", "original"]) byId(id).addEventListener("click", () => {
  if (!candidates || !ready) return;
  if (id === "analyze") showTrough = showJet = true;
  if (id === "trough") showTrough = !showTrough;
  if (id === "jet") showJet = !showJet;
  if (id === "original") showWind = showTrough = showJet = false;
  drawAnalysis(); drawWind(); controls();
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
const narrowView = matchMedia("(max-width: 720px)");
setPanel(!narrowView.matches);
narrowView.addEventListener("change", (event) => setPanel(!event.matches));
const compactLinks = matchMedia("(max-width: 1100px)");
byId("links").open = !compactLinks.matches;
compactLinks.addEventListener("change", (event) => { byId("links").open = !event.matches; });
byId("manual").addEventListener("toggle", () => selectMode(byId("manual").open ? "paint" : "move"));

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
  const output = document.createElement("canvas");
  output.width = ink.width; output.height = ink.height + 220;
  const ctx = output.getContext("2d");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(chart, 0, 0);
  ctx.globalCompositeOperation = "multiply"; ctx.drawImage(windLayer, 0, 0); ctx.drawImage(analysisLayer, 0, 0);
  ctx.globalCompositeOperation = "source-over"; ctx.drawImage(jetLayer, 0, 0);
  ctx.globalCompositeOperation = "multiply"; ctx.drawImage(ink, 0, 0); ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#243247"; ctx.font = "24px sans-serif";
  ctx.fillText(`出典：気象庁 AUPQ35（画像化） / ${chartLabel}`, 26, ink.height + 38);
  ctx.fillText(`解析案：${showTrough ? "500hPaトラフ候補 " : ""}${showJet ? "300hPa強風軸候補" : ""}${!showTrough && !showJet ? "表示なし" : ""} / 手描き：利用者`, 26, ink.height + 76);
  ctx.font = "22px sans-serif"; ctx.fillText(showWind ? "風速（300hPa）" : "風速の色塗り：表示なし", 26, ink.height + 116);
  if (showWind) for (const [index, color] of ChartAnalysis.windPalette.entries()) {
    const x = 230 + index * 260;
    ctx.fillStyle = color; ctx.fillRect(x, ink.height + 95, 32, 24);
    ctx.fillStyle = "#243247"; ctx.fillText(windLabels[index], x + 42, ink.height + 116);
  }
  ctx.fillText("赤矢印：等風速線の強い帯の中心（流れの経路はこの1枚で確認）。トラフ：等高度線の曲がりから推定。", 26, ink.height + 155);
  ctx.fillText("気象庁の公式の着色・解析ではありません。専門天気図カラーノート · Bousai Wx Lab", 26, ink.height + 193);
  output.toBlob((blob) => {
    if (!blob) { byId("status").textContent = "保存できませんでした"; return; }
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    exportUrl = URL.createObjectURL(blob);
    const link = byId("export-link");
    link.href = exportUrl; link.hidden = false; link.click();
    byId("status").textContent = "PNGを書き出しました";
  }, "image/png");
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !["INPUT", "SELECT"].includes(event.target.tagName)) {
    event.preventDefault(); byId(event.shiftKey ? "redo" : "undo").click();
  }
});

function initialize() {
  if (ready || !chart.naturalWidth) return;
  ink.width = strokeLayer.width = chart.naturalWidth;
  ink.height = strokeLayer.height = chart.naturalHeight;
  analysisLayer.width = chart.naturalWidth; analysisLayer.height = chart.naturalHeight;
  jetLayer.width = chart.naturalWidth; jetLayer.height = chart.naturalHeight;
  windLayer.width = chart.naturalWidth; windLayer.height = chart.naturalHeight;
  ready = true; paper.dataset.ready = "true"; selectMode("move"); drawAnalysis(); drawWind(); fit(); controls();
}
chart.addEventListener("load", initialize);
chart.addEventListener("error", () => { byId("status").textContent = "図を読み込めませんでした。再読み込みしてください。"; });
if (chart.complete) initialize();
async function loadAnalysis() {
  const responses = await Promise.all([fetch("chart.json", { cache: "no-store" }), fetch("contours.json", { cache: "no-store" }), fetch("wind-bands.json", { cache: "no-store" }), fetch("jet-guides.json", { cache: "no-store" })]);
  if (responses.some((r) => !r.ok)) throw new Error("解析資料を読み込めませんでした");
  const [data, contours, wind, guides] = await Promise.all(responses.map((r) => r.json()));
  chartLabel = data.observation_label;
  byId("chart-info").textContent = `AUPQ35 · 上段300hPa / 下段500hPa · ${chartLabel} · 自動更新なし`;
  const checkedContours = ChartAnalysis.validate(contours, data);
  const checkedWind = ChartAnalysis.validateWindBands(wind, data);
  const checkedGuides = ChartAnalysis.validateJetGuides(guides, data, checkedWind);
  candidates = ChartAnalysis.analyze(checkedContours, checkedWind, checkedGuides);
  windBands = checkedWind;
  drawAnalysis(); drawWind(); controls();
}
loadAnalysis().catch(() => { analysisError = "解析資料を確認できません。原図の閲覧・手描きは使えます。"; byId("chart-info").textContent = "AUPQ35 · 2026年10月2日 09:00 JST（00UTC）· 自動更新なし"; controls(); });
