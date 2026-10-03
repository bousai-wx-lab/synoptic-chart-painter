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
    if (!data || data.schema_version !== 1 || data.source_sha256 !== chart.source_sha256 || data.image_sha256 !== chart.image_sha256 || data.observation_time !== chart.observation_time || data.width !== chart.width || data.height !== chart.height || !Array.isArray(data.symbols) || data.symbols.length !== 50) throw new Error("文字の資料が原図と一致しません");
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
    if (counts.L !== 7 || counts.H !== 8 || counts.C !== 18 || counts.W !== 17) throw new Error("文字の種類が原図と一致しません");
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
  const isothermScales = [
    { pressure_hpa:300, values:[-27,-33,-39,-45,-51], colors:["#a0d8fa","#74b9ef","#558ee0","#7460cb","#4c1d95"] },
    { pressure_hpa:500, values:[-3,-6,-9,-12,-15,-18,-21,-24,-27,-30], colors:["#a0d8fa","#85c5f1","#6aafe8","#5799df","#5485d7","#6071ce","#6d5dc4","#6847b3","#5932a4","#4c1d95"] }
  ];
  const isothermPalette = isothermScales[0].colors;
  function validateIsotherms(data, chart) {
    if (data?.schema_version !== 2 || data.source_sha256 !== chart.source_sha256 || data.image_sha256 !== chart.image_sha256 || data.observation_time !== chart.observation_time || data.width !== chart.width || data.height !== chart.height || data.unit !== "degC" || !Array.isArray(data.panels) || data.panels.length !== 2) throw Error("気温線の資料が原図と一致しません");
    const runCounts = [[1,1,1,1,2],[7,2,1,1,1,2,1,1,6,2]];
    const labelCounts = [[20,29,27,23,33],[5,2,1,1,1,1,1,1,3,2]];
    const closures = [[[true],[false],[false],[false],[false,false]], [Array(7).fill(true),[false,true],[false],[false],[false],[false,false],[false],[false],[false,true,true,true,true,true],[false,true]]];
    for (const [plane, panel] of data.panels.entries()) {
      if (panel.pressure_hpa !== isothermScales[plane].pressure_hpa || !Array.isArray(panel.bounds) || panel.bounds.length !== 4 || !panel.bounds.every(Number.isFinite) || !Array.isArray(panel.levels) || panel.levels.length !== isothermScales[plane].values.length) throw Error("気温線の気圧面を確認できません");
      const [left, top, right, bottom] = panel.bounds;
      if (!(left>0 && left<right && right<chart.width && top>0 && top<bottom && bottom<chart.height && (plane===0 ? bottom<chart.height/2 : top>chart.height/2))) throw Error("気温線の気圧面を確認できません");
      for (const [index, level] of panel.levels.entries()) {
        if (level.temperature_c !== isothermScales[plane].values[index] || !Array.isArray(level.lines) || level.lines.length !== runCounts[plane][index] || !Array.isArray(level.labels) || level.labels.length !== labelCounts[plane][index]) throw Error("気温線の値と並びを確認できません");
        const points = level.lines.flatMap(line=>line.points || []);
        for (const [run, line] of level.lines.entries()) {
          if (line.closed!==closures[plane][index][run] || !Array.isArray(line.points) || line.points.length < (line.closed?3:2) || line.points.length>1500 || (plane===0 && line.points.length!==[[20],[29],[27],[23],[30,3]][index][run]) || !line.points.every(p => Array.isArray(p) && p.length===2 && p.every(Number.isFinite) && p[0]>=left && p[0]<=right && p[1]>=top && p[1]<=bottom)) throw Error("気温線の位置を確認できません");
          const pairs = line.points.slice(1).map((q,i)=>[line.points[i],q]);
          if (line.closed) pairs.push([line.points.at(-1),line.points[0]]);
          for (const [p,q] of pairs) {
            const distance = Math.hypot(q[0]-p[0],q[1]-p[1]);
            if (distance<.1 || distance >= (plane===0?110:85)) throw Error("気温線の接続を確認できません");
          }
        }
        for (const box of level.labels) {
          if (!Array.isArray(box) || box.length!==4 || !box.every(Number.isFinite) || !(left<=box[0] && box[0]<box[2] && box[2]<=right && top<=box[1] && box[1]<box[3] && box[3]<=bottom && box[2]-box[0]<(plane===0?30:60) && box[3]-box[1]<(plane===0?15:30)) || !points.some(p=>Math.hypot(p[0]-(box[0]+box[2])/2,p[1]-(box[1]+box[3])/2)<.02)) throw Error("原図の気温表示との対応を確認できません");
        }
      }
    }
    return data;
  }
  function isothermSegments(points, closed=false) {
    const segments = [];
    for (let i = 1; i < points.length + Number(closed); i++) {
      const p = points[i-1], q = points[i%points.length];
      const before = points[i-2] || (closed?points.at(-1):p.map((v,k) => 2*v-q[k]));
      const after = points[i+1] || (closed?points[(i+1)%points.length]:q.map((v,k) => 2*v-p[k]));
      const a = Math.sqrt(Math.hypot(p[0]-before[0],p[1]-before[1]));
      const b = Math.sqrt(Math.hypot(q[0]-p[0],q[1]-p[1]));
      const c = Math.sqrt(Math.hypot(after[0]-q[0],after[1]-q[1]));
      // Centripetal Catmull-Rom. Shared stamp tangents remain continuous;
      // clipping individual handles would introduce corners at those stamps.
      const c1 = p.map((v,k) => v+b*((v-before[k])/a-(q[k]-before[k])/(a+b)+(q[k]-v)/b)/3);
      const c2 = q.map((v,k) => v-b*((v-p[k])/b-(after[k]-p[k])/(b+c)+(after[k]-v)/c)/3);
      segments.push({start:p,c1,c2,end:q});
    }
    return segments;
  }
  function drawIsotherms(ctx, data, pressures=[300,500]) {
    for (const panel of data.panels) {
    if (!pressures.includes(panel.pressure_hpa)) continue;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    const [left, top, right, bottom] = panel.bounds;
    // Leave the printed temperatures legible, including other levels' stamps.
    ctx.beginPath(); ctx.rect(left, top, right-left, bottom-top);
    for (const level of panel.levels) for (const [x0,y0,x1,y1] of level.labels) ctx.rect(x0-2,y0-2,x1-x0+4,y1-y0+4);
    ctx.clip("evenodd");
    ctx.lineWidth = 4.5; ctx.lineCap = ctx.lineJoin = "round";
    const scale = isothermScales.find(s=>s.pressure_hpa===panel.pressure_hpa);
    for (const [index, level] of panel.levels.entries()) for (const line of level.lines) {
      ctx.strokeStyle = scale.colors[index]; ctx.beginPath(); ctx.moveTo(...line.points[0]);
      for (const segment of isothermSegments(line.points,line.closed)) ctx.bezierCurveTo(...segment.c1,...segment.c2,...segment.end);
      ctx.stroke();
    }
    ctx.restore();
    }
  }
  return { validate, analyze, troughs, jets, validateWindBands, drawWindBands, windPalette, validateJetGuides, strongestCenter, drawJetAxes, symbolPalette, validateSymbols, drawSymbols, isothermPalette, isothermScales, validateIsotherms, drawIsotherms, isothermSegments };
})();
if (typeof module !== "undefined") module.exports = ChartAnalysis;
