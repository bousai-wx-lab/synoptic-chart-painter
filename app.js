"use strict";
const byId = (id) => document.getElementById(id);
const chart = byId("chart");
const ink = byId("ink");
const context = ink.getContext("2d");
const paper = byId("paper");
const viewport = byId("viewport");
const strokeLayer = document.createElement("canvas");
const strokeContext = strokeLayer.getContext("2d");
const history = [];
const future = [];
let mode = "paint";
let color = "#2563eb";
let active = null;
let pointer = null;
let pan = null;
let ready = false;
let chartLabel = "AUPQ35";
let exportUrl = null;

function controls() {
  byId("undo").disabled = !history.length;
  byId("redo").disabled = !future.length;
  byId("clear").disabled = !history.length;
  byId("save").disabled = !ready;
  paper.dataset.strokes = String(history.length);
  byId("status").textContent = history.length ? `${history.length}筆` : "色塗りなし";
}

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
  const zoom = byId("zoom").value;
  const base = Math.max(220, viewport.clientWidth - (innerWidth <= 640 ? 16 : 28));
  const width = zoom === "fit" ? Math.min(base, Math.max(150, viewport.clientHeight - 28) * ink.width / ink.height) : base * Number(zoom);
  paper.style.width = `${Math.round(width)}px`;
  paper.style.height = `${Math.round(width * ink.height / ink.width)}px`;
  if (zoom === "fit") { viewport.scrollTop = 0; viewport.scrollLeft = 0; }
}

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
  output.width = ink.width; output.height = ink.height + 100;
  const ctx = output.getContext("2d");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(chart, 0, 0);
  ctx.globalCompositeOperation = "multiply"; ctx.drawImage(ink, 0, 0); ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#243247"; ctx.font = "24px sans-serif";
  ctx.fillText(`出典：気象庁 AUPQ35（画像化） / ${chartLabel}`, 26, ink.height + 38);
  ctx.fillText("着色：利用者 / 専門天気図カラーノート · Bousai Wx Lab", 26, ink.height + 76);
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
  ready = true; paper.dataset.ready = "true"; selectMode("paint"); fit(); controls();
}
chart.addEventListener("load", initialize);
chart.addEventListener("error", () => { byId("status").textContent = "図を読み込めませんでした。再読み込みしてください。"; });
if (chart.complete) initialize();
fetch("chart.json", { cache: "no-store" }).then((response) => { if (!response.ok) throw new Error("chart metadata unavailable"); return response.json(); }).then((data) => {
  chartLabel = data.observation_label;
  byId("chart-info").textContent = `AUPQ35 · 上段300hPa / 下段500hPa · ${chartLabel} · 自動更新なし`;
}).catch(() => { byId("chart-info").textContent = "AUPQ35 · 2026年10月2日 09:00 JST（00UTC）· 自動更新なし"; });
