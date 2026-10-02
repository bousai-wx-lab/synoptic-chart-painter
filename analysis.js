"use strict";
// Geometry-only axis candidates and separately reviewed printed isotach regions.
const ChartAnalysis = (() => {
  const median = (numbers) => {
    const sorted = [...numbers].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const radial = (point, pole) => ({ angle: Math.atan2(point[0] - pole[0], point[1] - pole[1]), radius: Math.hypot(point[0] - pole[0], point[1] - pole[1]) });
  const cartesian = (angle, radius, pole) => [pole[0] + radius * Math.sin(angle), pole[1] + radius * Math.cos(angle)];
  function validate(data, chart) {
    if (data.schema_version !== 1 || data.source_sha256 !== chart.source_sha256 || data.image_sha256 !== chart.image_sha256 || data.observation_time !== chart.observation_time || data.width !== chart.width || data.height !== chart.height || !Array.isArray(data.panels) || data.panels.length !== 2) throw new Error("解析資料が原図と一致しません");
    for (const [index, panel] of data.panels.entries()) {
      if (panel.pressure_hpa !== [300, 500][index] || panel.bounds.length !== 4 || panel.pole.length !== 2 || ![...panel.bounds, ...panel.pole].every(Number.isFinite) || !Array.isArray(panel.curves) || panel.curves.length > 100) throw new Error("解析資料の形式を確認できません");
      for (const curve of panel.curves) if (!Array.isArray(curve) || curve.length < 2 || curve.length > 1500 || !curve.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= 0 && p[0] <= data.width && p[1] >= 0 && p[1] <= data.height)) throw new Error("解析資料の線を確認できません");
    }
    return data;
  }
  function profiles(panel) {
    return panel.curves.filter((curve) => Math.hypot(curve[0][0] - curve.at(-1)[0], curve[0][1] - curve.at(-1)[1]) > 40)
      .map((curve) => curve.map((p) => radial(p, panel.pole)))
      .filter((curve) => Math.max(...curve.map((p) => p.angle)) - Math.min(...curve.map((p) => p.angle)) > 0.48);
  }
  function crossing(curve, angle) {
    const radii = [];
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1], b = curve[i];
      if ((a.angle <= angle && angle < b.angle) || (b.angle <= angle && angle < a.angle)) radii.push(a.radius + (b.radius - a.radius) * (angle - a.angle) / (b.angle - a.angle));
    }
    return radii.length ? Math.max(...radii) : null;
  }
  function troughs(panel) {
    const peaks = [];
    for (const [curveIndex, curve] of profiles(panel).entries()) {
      const samples = [];
      for (let angle = -1.05; angle <= 0.5; angle += 0.012) {
        const radius = crossing(curve, angle);
        if (radius !== null) samples.push({ angle, radius });
      }
      for (let i = 8; i < samples.length - 8; i++) {
        const p = samples[i], left = samples[i - 8], right = samples[i + 8];
        if (right.angle - left.angle > 0.20) continue;
        const local = samples.slice(i - 8, i + 9);
        if (p.radius !== Math.max(...local.map((v) => v.radius)) || p.radius - Math.max(left.radius, right.radius) < 7) continue;
        peaks.push({ ...p, curveIndex });
        i += 8;
      }
    }
    // Require bends on at least three distinct open contours, across 90 pixels.
    const groups = [];
    for (const peak of peaks.sort((a, b) => a.radius - b.radius)) {
      const group = groups.find((g) => Math.abs(g.at(-1).angle - peak.angle) < 0.18 && peak.radius - g.at(-1).radius < 210);
      if (group) group.push(peak); else groups.push([peak]);
    }
    return groups.filter((g) => new Set(g.map((p) => p.curveIndex)).size >= 3 && g.at(-1).radius - g[0].radius >= 90)
      .map((g) => g.map((p) => cartesian(p.angle, p.radius, panel.pole)));
  }
  function jets(panel) {
    const curves = profiles(panel), samples = [];
    for (let angle = -1.05; angle <= 0.5; angle += 0.018) {
      const levels = curves.map((curve) => ({ curve, radius: crossing(curve, angle) })).filter((p) => p.radius !== null).sort((a, b) => a.radius - b.radius);
      if (levels.length < 5) { samples.push(null); continue; }
      const gaps = levels.slice(1).map((p, i) => p.radius - levels[i].radius);
      let best = null;
      for (let i = 0; i <= gaps.length - 3; i++) {
        const span = gaps.slice(i, i + 3).reduce((a, b) => a + b) / 3;
        const outer = gaps.filter((v, j) => j < i || j >= i + 3);
        if (span < 10 || span > 90 || span >= median(outer) * 0.8) continue;
        if (!best || span < best.span) best = { span, radius: (levels[i + 1].radius + levels[i + 2].radius) / 2 };
      }
      samples.push(best ? { angle, ...best } : null);
    }
    const groups = [];
    let current = [];
    for (const p of samples) {
      if (!p || (current.length && Math.abs(p.radius - current.at(-1).radius) > 70)) { if (current.length) groups.push(current); current = []; }
      if (p) current.push(p);
    }
    if (current.length) groups.push(current);
    return groups.filter((g) => g.length >= 8).map((g) => g.map((p, i) => {
      const neighbors = g.slice(Math.max(0, i - 2), i + 3);
      return cartesian(p.angle, median(neighbors.map((v) => v.radius)), panel.pole);
    }));
  }
  function analyze(data) {
    return { troughs: troughs(data.panels[1]), jets: jets(data.panels[0]) };
  }
  const windPalette = ["#dcfce7", "#a7edbc", "#65d58d", "#2aaf63", "#087c3d"];
  function validateWindBands(data, chart) {
    if (data.schema_version !== 1 || data.source_sha256 !== chart.source_sha256 || data.image_sha256 !== chart.image_sha256 || data.observation_time !== chart.observation_time || data.width !== chart.width || data.height !== chart.height || data.pressure_hpa !== 300 || data.unit !== "kt" || !Array.isArray(data.bands) || data.bands.length !== 5 || !Array.isArray(data.bounds) || data.bounds.length !== 4 || !data.bounds.every(Number.isFinite)) throw new Error("風速の資料が原図と一致しません");
    const [left, top, right, bottom] = data.bounds;
    if (!(0 <= left && left < right && right <= chart.width && 0 <= top && top < bottom && bottom <= chart.height / 2)) throw new Error("風速の表示範囲が不正です");
    for (const [index, band] of data.bands.entries()) {
      if (band.min_kt !== 40 + index * 20 || !Array.isArray(band.rings) || !band.rings.length || band.rings.length > 10) throw new Error("風速の区分が不正です");
      for (const ring of band.rings) if (!Array.isArray(ring) || ring.length < 3 || ring.length > 2000 || !ring.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= left && p[0] <= right && p[1] >= top && p[1] <= bottom)) throw new Error("風速の境界を確認できません");
    }
    return data;
  }
  function drawWindBands(ctx, data) {
    ctx.save();
    const [left, top, right, bottom] = data.bounds;
    ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
    // Threshold regions overlap: the highest interval supplies one opaque color.
    // Even-odd filling leaves genuine weak-wind holes uncolored.
    for (const [index, band] of data.bands.entries()) {
      ctx.fillStyle = windPalette[index]; ctx.beginPath();
      for (const ring of band.rings) {
        ctx.moveTo(...ring[0]);
        for (const point of ring.slice(1)) ctx.lineTo(...point);
        ctx.closePath();
      }
      ctx.fill("evenodd");
    }
    ctx.restore();
  }
  return { validate, analyze, troughs, jets, validateWindBands, drawWindBands, windPalette };
})();
if (typeof module !== "undefined") module.exports = ChartAnalysis;
