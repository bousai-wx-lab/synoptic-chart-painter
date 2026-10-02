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

function controls() {
  const afterClear = history.slice(history.map((s) => s.kind).lastIndexOf("clear") + 1);
  const paintCount = afterClear.filter((s) => s.kind === "paint").length;
  byId("undo").disabled = !history.length;
  byId("redo").disabled = !future.length;
  byId("clear").disabled = !paintCount;
  byId("save").disabled = !ready;
  for (const id of ["analyze", "trough", "jet"]) byId(id).disabled = !ready || !candidates;
  byId("original").disabled = !showTrough && !showJet;
  byId("trough").setAttribute("aria-pressed", String(showTrough));
  byId("jet").setAttribute("aria-pressed", String(showJet));
  byId("zoom-in").disabled = !ready || byId("zoom").value === "4";
  byId("zoom-out").disabled = !ready || byId("zoom").value === "0.25";
  paper.dataset.strokes = String(history.length);
  paper.dataset.trough = String(showTrough);
  paper.dataset.jet = String(showJet);
  const layers = [showTrough ? `トラフ候補${candidates.troughs.length}本` : "", showJet ? `強風軸候補${candidates.jets.length}本` : "", paintCount ? `手描き${paintCount}筆` : ""].filter(Boolean);
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
  if (!candidates) return;
  if (showJet) for (const points of candidates.jets) {
    analysisContext.globalAlpha = 0.16; line(analysisContext, points, 28, "#168449");
    analysisContext.globalAlpha = 0.85; line(analysisContext, points, 6, "#168449");
  }
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
for (const id of ["analyze", "trough", "jet", "original"]) byId(id).addEventListener("click", () => {
  if (!candidates || !ready) return;
  if (id === "analyze") showTrough = showJet = true;
  if (id === "trough") showTrough = !showTrough;
  if (id === "jet") showJet = !showJet;
  if (id === "original") showTrough = showJet = false;
  drawAnalysis(); controls();
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

function fit() {
  if (!ready || pointer !== null) return;
  const viewRect = viewport.getBoundingClientRect(), oldRect = paper.getBoundingClientRect();
  const center = { x: (viewRect.left + viewport.clientWidth / 2 - oldRect.left) / oldRect.width, y: (viewRect.top + viewport.clientHeight / 2 - oldRect.top) / oldRect.height };
  const zoom = byId("zoom").value;
  const base = Math.max(220, viewport.clientWidth - (innerWidth <= 640 ? 16 : 28));
  const width = zoom === "fit" ? Math.min(base, Math.max(150, viewport.clientHeight - 28) * ink.width / ink.height) : base * Number(zoom);
  paper.style.width = `${Math.floor(width)}px`;
  paper.style.height = `${Math.floor(width) * ink.height / ink.width}px`;
  if (zoom === "fit") { viewport.scrollTop = 0; viewport.scrollLeft = 0; }
  else { const rect = paper.getBoundingClientRect(); viewport.scrollLeft += rect.left + center.x * rect.width - viewRect.left - viewport.clientWidth / 2; viewport.scrollTop += rect.top + center.y * rect.height - viewRect.top - viewport.clientHeight / 2; }
  controls();
}
function zoomBy(direction) {
  if (!ready || pointer !== null) return;
  const base = Math.max(220, viewport.clientWidth - (innerWidth <= 640 ? 16 : 28));
  const factor = paper.offsetWidth / base;
  const steps = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
  byId("zoom").value = String(direction > 0 ? (steps.find((x) => x > factor + 0.005) || 4) : ([...steps].reverse().find((x) => x < factor - 0.005) || 0.25));
  fit();
}
byId("zoom-in").addEventListener("click", () => zoomBy(1));
byId("zoom-out").addEventListener("click", () => zoomBy(-1));
byId("fit").addEventListener("click", () => { byId("zoom").value = "fit"; fit(); });
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
byId("zoom").addEventListener("change", fit);
new ResizeObserver(fit).observe(viewport);

byId("save").addEventListener("click", () => {
  const output = document.createElement("canvas");
  output.width = ink.width; output.height = ink.height + 160;
  const ctx = output.getContext("2d");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(chart, 0, 0);
  ctx.globalCompositeOperation = "multiply"; ctx.drawImage(analysisLayer, 0, 0); ctx.drawImage(ink, 0, 0); ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#243247"; ctx.font = "24px sans-serif";
  ctx.fillText(`出典：気象庁 AUPQ35（画像化） / ${chartLabel}`, 26, ink.height + 38);
  ctx.fillText(`解析案：${showTrough ? "500hPaトラフ候補 " : ""}${showJet ? "300hPa強風軸候補" : ""}${!showTrough && !showJet ? "表示なし" : ""} / 手描き：利用者`, 26, ink.height + 76);
  ctx.fillText("候補は等高度線の形・密集から推定。風向・風速は未照合。気象庁の解析ではありません。", 26, ink.height + 114);
  ctx.font = "20px sans-serif"; ctx.fillText("専門天気図カラーノート · Bousai Wx Lab", 26, ink.height + 144);
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
  ready = true; paper.dataset.ready = "true"; selectMode("move"); drawAnalysis(); fit(); controls();
}
chart.addEventListener("load", initialize);
chart.addEventListener("error", () => { byId("status").textContent = "図を読み込めませんでした。再読み込みしてください。"; });
if (chart.complete) initialize();
async function loadAnalysis() {
  const responses = await Promise.all([fetch("chart.json", { cache: "no-store" }), fetch("contours.json", { cache: "no-store" })]);
  if (responses.some((r) => !r.ok)) throw new Error("解析資料を読み込めませんでした");
  const [data, contours] = await Promise.all(responses.map((r) => r.json()));
  chartLabel = data.observation_label;
  byId("chart-info").textContent = `AUPQ35 · 上段300hPa / 下段500hPa · ${chartLabel} · 自動更新なし`;
  candidates = ChartAnalysis.analyze(ChartAnalysis.validate(contours, data));
  drawAnalysis(); controls();
}
loadAnalysis().catch(() => { analysisError = "解析資料を確認できません。原図の閲覧・手描きは使えます。"; byId("chart-info").textContent = "AUPQ35 · 2026年10月2日 09:00 JST（00UTC）· 自動更新なし"; controls(); });
