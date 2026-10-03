"use strict";
const ChartGeography = (() => {
  const patterns = Object.freeze([
    { id: "dots", label: "細かなドット", land: "dots" },
    { id: "elevation", label: "標高で色分け", terrain: 0 },
    { id: "diagonal", label: "斜線", land: "diagonal" },
    { id: "relief", label: "地形の陰影", terrain: 1 },
    { id: "cross", label: "クロスハッチ", land: "cross" },
    { id: "elevation-relief", label: "標高＋陰影", terrain: 2 },
    { id: "waves", label: "陸は点・海は波", land: "dots", sea: "waves" },
    { id: "paper", label: "紙の質感", land: "paper", sea: "sea-paper" },
    { id: "sand", label: "砂と水面", land: "sand", sea: "ripples" },
    { id: "satellite", label: "衛星写真", satellite: true }
  ].map(Object.freeze));
  const tiles = new Map();
  function validate(data, chart) {
    if (!data || data.schema_version !== 1) throw Error("Invalid geography schema");
    for (const key of ["source_sha256", "image_sha256", "observation_time", "width", "height"])
      if (data[key] !== chart[key]) throw Error("Geography source mismatch");
    const expected = [[55, 121.3, 1990.96, 1441.63], [55, 1537.68, 1990.96, 2858]];
    const equal = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => Number.isFinite(v) && Math.abs(v - b[i]) < 0.001);
    if (!equal(data.bounds, expected[0]) || !Array.isArray(data.panels) || data.panels.length !== 2) throw Error("Invalid geography panels");
    data.panels.forEach((p, i) => {
      if (p.pressure_hpa !== [300, 500][i] || p.offset_y !== [0, 1416.38][i] || !equal(p.bounds, expected[i])) throw Error("Invalid geography panel");
    });
    if (!Array.isArray(data.rings) || data.rings.length !== 77) throw Error("Incomplete coast rings");
    for (const ring of data.rings) {
      if (!Array.isArray(ring) || ring.length < 4 || !equal(ring[0], ring.at(-1))) throw Error("Open coast ring");
      for (const p of ring) if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || p[0] < 54.97 || p[0] > 1990.99 || p[1] < 121.27 || p[1] > 1441.66) throw Error("Invalid coast coordinate");
    }
    const s = data.satellite;
    if (!s || s.path !== "assets/blue-marble-chart.png" || s.width !== 2048 || s.height !== 1322 || s.top_y !== 121.3 || s.period !== "October 2004" || !/^[a-f0-9]{64}$/.test(s.image_sha256)) throw Error("Invalid satellite reference");
    return data;
  }
  function tile(kind) {
    if (tiles.has(kind)) return tiles.get(kind);
    const canvas = document.createElement("canvas");
    const texture = ["paper", "sea-paper", "sand", "ripples"].includes(kind);
    const size = texture ? 192 : 16;
    canvas.width = canvas.height = size;
    const c = canvas.getContext("2d");
    c.strokeStyle = c.fillStyle = "#8b6f52"; c.lineWidth = 2;
    if (kind === "dots") {
      c.beginPath(); c.arc(size / 2, size / 2, 2.5, 0, Math.PI * 2); c.fill();
    } else if (["diagonal", "cross"].includes(kind)) {
      c.beginPath();
      if (kind === "diagonal" || kind === "cross") for (const x of [-16, 0, 16]) { c.moveTo(x, 16); c.lineTo(x + 16, 0); }
      if (kind === "cross") for (const x of [-16, 0, 16]) { c.moveTo(x, 0); c.lineTo(x + 16, 16); }
      c.stroke();
    } else if (kind === "waves") {
      c.strokeStyle = "#6190ad"; c.beginPath(); c.moveTo(0, 8); c.bezierCurveTo(4, 2, 4, 2, 8, 8); c.bezierCurveTo(12, 14, 12, 14, 16, 8); c.stroke();
    } else {
      c.fillStyle = { paper: "#ede0cb", "sea-paper": "#e1edf3", sand: "#ebd7b8", ripples: "#dcecf3" }[kind]; c.fillRect(0, 0, size, size);
      let seed = 137;
      const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
      for (let n = 0; n < (kind === "sand" ? 1900 : 900); n++) {
        const x = random() * size, y = random() * size;
        c.globalAlpha = 0.08 + random() * 0.3;
        c.fillStyle = kind === "sea-paper" || kind === "ripples" ? "#668eaa" : "#8c7457";
        c.fillRect(x, y, kind === "sand" ? 1.5 : 1 + random() * 10, 1 + random() * 1.5);
      }
      c.globalAlpha = 0.6;
      if (kind === "ripples") {
        c.strokeStyle = "#fff"; c.lineWidth = 2;
        for (let y = 8; y < size; y += 16) {
          c.beginPath(); c.moveTo(0, y);
          for (let x = 0; x < size; x += 24) c.bezierCurveTo(x + 8, y - 4, x + 16, y + 4, x + 24, y);
          c.stroke();
        }
      }
    }
    tiles.set(kind, canvas); return canvas;
  }
  function ringPath(ctx, rings, offset) {
    for (const ring of rings) {
      ctx.moveTo(ring[0][0], ring[0][1] + offset);
      for (const p of ring.slice(1)) ctx.lineTo(p[0], p[1] + offset);
      ctx.closePath();
    }
  }
  function draw(ctx, data, id, opacity, satellite, terrainImage) {
    const style = patterns.find(p => p.id === id);
    if (!style || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw Error("Invalid geography style");
    if (!opacity) return;
    if (style.satellite && (!satellite || satellite.naturalWidth !== 2048 || satellite.naturalHeight !== 1322)) throw Error("Satellite image unavailable");
    if (style.terrain !== undefined && (!terrainImage || terrainImage.naturalWidth !== 2048 || terrainImage.naturalHeight !== 3966)) throw Error("Elevation image unavailable");
    ctx.save(); ctx.globalAlpha = opacity;
    for (const panel of data.panels) {
      const [left, top, right, bottom] = panel.bounds;
      ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
      if (style.satellite) ctx.drawImage(satellite, 0, data.satellite.top_y + panel.offset_y);
      else if (style.terrain !== undefined) {
        ctx.beginPath(); ringPath(ctx, data.rings, panel.offset_y); ctx.clip("evenodd");
        ctx.drawImage(terrainImage, 0, style.terrain * 1322, 2048, 1322, 0, data.satellite.top_y + panel.offset_y, 2048, 1322);
      }
      else for (const region of ["sea", "land"]) {
        if (!style[region]) continue;
        ctx.save(); ctx.beginPath();
        if (region === "sea") ctx.rect(left, top, right - left, bottom - top);
        ringPath(ctx, data.rings, panel.offset_y); ctx.clip("evenodd");
        ctx.fillStyle = ctx.createPattern(tile(style[region]), "repeat"); ctx.fillRect(left, top, right - left, bottom - top); ctx.restore();
      }
      ctx.restore();
    }
    ctx.restore();
  }
  function preview(canvas, id, satellite, terrainImage) {
    const c = canvas.getContext("2d"), style = patterns.find(p => p.id === id);
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = "white"; c.fillRect(0, 0, canvas.width, canvas.height);
    if (style.satellite) { if (satellite) c.drawImage(satellite, 480, 230, 1000, 700, 0, 0, canvas.width, canvas.height); return; }
    if (style.terrain !== undefined) { if (terrainImage) c.drawImage(terrainImage, 120, style.terrain * 1322 + 220, 1050, 700, 0, 0, canvas.width, canvas.height); return; }
    c.scale(0.6, 0.6);
    const w = canvas.width / 0.6, h = canvas.height / 0.6;
    if (style.sea) { c.fillStyle = c.createPattern(tile(style.sea), "repeat"); c.fillRect(0, 0, w, h); }
    c.beginPath(); c.moveTo(0, 0); c.lineTo(w * 0.7, 0); c.lineTo(w * 0.45, h * 0.55); c.lineTo(w * 0.6, h); c.lineTo(0, h); c.closePath();
    c.fillStyle = "white"; c.fill(); c.fillStyle = c.createPattern(tile(style.land), "repeat"); c.fill(); c.strokeStyle = "#64748b"; c.lineWidth = 1; c.stroke();
    c.resetTransform();
  }
  function validateElevation(data, chart) {
    if (!data || data.schema_version !== 1) throw Error("Invalid elevation schema");
    for (const key of ["source_sha256", "image_sha256", "observation_time", "width", "height"])
      if (data[key] !== chart[key]) throw Error("Elevation source mismatch");
    const image = data.image;
    if (!image || image.path !== "assets/elevation-chart.png" || image.width !== 2048 || image.height !== 3966 || image.tile_height !== 1322 || image.top_y !== 121.3 || !/^[a-f0-9]{64}$/.test(image.sha256)) throw Error("Invalid elevation image");
    if (data.source?.units !== "metres" || data.source?.vertical_datum !== "EGM2008 geoid" || data.source?.native_resolution_arc_seconds !== 60) throw Error("Invalid elevation units");
    const boundaries = [200, 500, 1000, 2000, 4000, 6000];
    const colors = ["#f5eee0", "#ead9bb", "#dbc097", "#c7a679", "#ab855e", "#8f684d", "#76523c"];
    if (!data.legend || JSON.stringify(data.legend.boundaries_m) !== JSON.stringify(boundaries) || JSON.stringify(data.legend.colors) !== JSON.stringify(colors) || !Array.isArray(data.legend.labels) || data.legend.labels.length !== 7 || !data.legend.labels.every(s => typeof s === "string" && s.length <= 20)) throw Error("Invalid elevation legend");
    if (JSON.stringify(data.styles) !== JSON.stringify([{id:"elevation",row:0},{id:"relief",row:1},{id:"elevation-relief",row:2}])) throw Error("Invalid elevation bands");
    return data;
  }
  return { patterns, validate, validateElevation, draw, preview };
})();
if (typeof module !== "undefined") module.exports = ChartGeography;
