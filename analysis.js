"use strict";
// Height-contour trough candidates and wind-band centerlines on one reviewed chart.
const ChartAnalysis = (() => {
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
  function analyze(data, wind, guides) {
    return { troughs: troughs(data.panels[1]), jets: wind && guides ? jets(wind, guides) : [] };
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
  function validateJetGuides(data, chart, wind) {
    if (data.schema_version !== 1 || data.source_sha256 !== chart.source_sha256 || data.image_sha256 !== chart.image_sha256 || data.observation_time !== chart.observation_time || data.width !== chart.width || data.height !== chart.height || data.pressure_hpa !== 300 || !Array.isArray(data.axes) || !data.axes.length || data.axes.length > 6) throw new Error("強風軸の資料が原図と一致しません");
    const [left, top, right, bottom] = wind.bounds;
    for (const axis of data.axes) {
      if (!Number.isFinite(axis.search_radius_px) || axis.search_radius_px < 10 || axis.search_radius_px > 150 || !Array.isArray(axis.points) || axis.points.length < 3 || axis.points.length > 30 || !axis.points.every((p, i) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= left && p[0] <= right && p[1] >= top && p[1] <= bottom && (!i || Math.hypot(p[0] - axis.points[i - 1][0], p[1] - axis.points[i - 1][1]) >= 10))) throw new Error("強風軸の流れを確認できません");
    }
    return data;
  }
  function inside(point, rings) {
    const [x, y] = point;
    let found = false;
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) found = !found;
    }
    return found;
  }
  function strongestCenter(wind, point, normal, radius) {
    const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
    const at = (t) => [point[0] + normal[0] * t, point[1] + normal[1] * t];
    const inBounds = ([x, y]) => x >= wind.bounds[0] && y >= wind.bounds[1] && x <= wind.bounds[2] && y <= wind.bounds[3];
    // Intersect each threshold polygon with a section across the reviewed flow.
    // The highest occupied interval wins, not the closest-spaced height lines.
    for (const band of [...wind.bands].reverse()) {
      const hits = [-radius, radius];
      for (const ring of band.rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j], b = ring[i], edge = [b[0] - a[0], b[1] - a[1]], delta = [a[0] - point[0], a[1] - point[1]];
        const den = cross(normal, edge);
        if (Math.abs(den) < 1e-8) continue;
        const t = cross(delta, edge) / den, u = cross(delta, normal) / den;
        if (t > -radius && t < radius && u >= 0 && u < 1) hits.push(t);
      }
      hits.sort((a, b) => a - b);
      const intervals = [];
      for (let i = 1; i < hits.length; i++) {
        const mid = (hits[i - 1] + hits[i]) / 2;
        if (hits[i] - hits[i - 1] >= 4 && inBounds(at(mid)) && inside(at(mid), band.rings)) intervals.push(mid);
      }
      if (intervals.length) {
        const offset = intervals.sort((a, b) => Math.abs(a) - Math.abs(b))[0];
        return { point: at(offset), min_kt: band.min_kt };
      }
    }
    return null;
  }
  function smoothCurve(points) {
    // Cubic Hermite interpolation, expressed as Bézier segments. A shared
    // tangent at each join avoids corners; these are display coordinates.
    return points.slice(1).map((end, i) => {
      const start = points[i], before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 2)];
      return { start, c1: [start[0] + (end[0] - before[0]) / 6, start[1] + (end[1] - before[1]) / 6], c2: [end[0] - (after[0] - start[0]) / 6, end[1] - (after[1] - start[1]) / 6], end };
    });
  }
  function jets(wind, guides) {
    const axes = [];
    for (const guide of guides.axes) {
      const centers = guide.points.map((point, i) => {
        const before = guide.points[Math.max(0, i - 1)], after = guide.points[Math.min(guide.points.length - 1, i + 1)];
        const dx = after[0] - before[0], dy = after[1] - before[1], length = Math.hypot(dx, dy);
        return strongestCenter(wind, point, [-dy / length, dx / length], guide.search_radius_px);
      });
      // Missing wind support does not get replaced with the guide itself.
      if (centers.some((p) => !p)) continue;
      axes.push({ segments: smoothCurve(centers.map((p) => p.point)), centers });
    }
    return axes;
  }
  function drawJetAxes(ctx, axes, bounds) {
    ctx.save();
    ctx.beginPath(); ctx.rect(bounds[0], bounds[1], bounds[2] - bounds[0], bounds[3] - bounds[1]); ctx.clip();
    ctx.strokeStyle = "#f02020"; ctx.lineWidth = 10; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const axis of axes) {
      ctx.beginPath(); ctx.moveTo(...axis.segments[0].start);
      for (const segment of axis.segments) ctx.bezierCurveTo(...segment.c1, ...segment.c2, ...segment.end);
      ctx.stroke();
      const last = axis.segments.at(-1), tip = last.end;
      const dx = tip[0] - last.c2[0], dy = tip[1] - last.c2[1], length = Math.hypot(dx, dy);
      const tx = dx / length, ty = dy / length;
      ctx.beginPath(); ctx.moveTo(tip[0] - 30 * tx - 16 * ty, tip[1] - 30 * ty + 16 * tx);
      ctx.lineTo(...tip); ctx.lineTo(tip[0] - 30 * tx + 16 * ty, tip[1] - 30 * ty - 16 * tx); ctx.stroke();
    }
    ctx.restore();
  }
  const symbolPalette = Object.freeze({ L: "#dc2626", H: "#2563eb", C: "#38bdf8", W: "#f97316" });
  function validateSymbols(data, chart) {
    if (!data || data.schema_version !== 1 || data.source_sha256 !== chart.source_sha256 || data.image_sha256 !== chart.image_sha256 || data.observation_time !== chart.observation_time || data.width !== chart.width || data.height !== chart.height || !Array.isArray(data.symbols) || data.symbols.length !== 30) throw new Error("文字の資料が原図と一致しません");
    const counts = { L: 0, H: 0, C: 0, W: 0 };
    for (const symbol of data.symbols) {
      if (!Object.keys(symbolPalette).includes(symbol.letter) || ![300, 500].includes(symbol.pressure_hpa) || !Array.isArray(symbol.bounds) || symbol.bounds.length !== 4 || !symbol.bounds.every(Number.isFinite) || !Array.isArray(symbol.strokes) || symbol.strokes.length !== (symbol.letter === "H" ? 3 : 1)) throw new Error("文字の形式を確認できません");
      const [left, top, right, bottom] = symbol.bounds;
      const lower = symbol.pressure_hpa === 300 ? 0 : chart.height / 2;
      const upper = symbol.pressure_hpa === 300 ? chart.height / 2 : chart.height;
      if (!(0 <= left && left < right && right <= chart.width && lower <= top && top < bottom && bottom <= upper && right - left <= 30 && bottom - top <= 40)) throw new Error("文字の位置を確認できません");
      for (const stroke of symbol.strokes) {
        if (!Number.isFinite(stroke.width_px) || stroke.width_px < 1 || stroke.width_px > 4 || !["butt", "round", "square"].includes(stroke.line_cap) || !Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length > 10 || !stroke.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= left && p[0] <= right && p[1] >= top && p[1] <= bottom)) throw new Error("文字の線を確認できません");
      }
      counts[symbol.letter]++;
    }
    if (counts.L !== 7 || counts.H !== 8 || counts.C !== 9 || counts.W !== 6) throw new Error("文字の種類が原図と一致しません");
    return data;
  }
  function drawSymbols(ctx, data) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.lineJoin = "miter";
    for (const symbol of data.symbols) for (const stroke of symbol.strokes) {
      ctx.strokeStyle = symbolPalette[symbol.letter]; ctx.lineWidth = stroke.width_px; ctx.lineCap = stroke.line_cap;
      ctx.beginPath(); ctx.moveTo(...stroke.points[0]);
      for (const point of stroke.points.slice(1)) ctx.lineTo(...point);
      ctx.stroke();
    }
    ctx.restore();
  }
  return { validate, analyze, troughs, jets, validateWindBands, drawWindBands, windPalette, validateJetGuides, strongestCenter, drawJetAxes, symbolPalette, validateSymbols, drawSymbols };
})();
if (typeof module !== "undefined") module.exports = ChartAnalysis;
