"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const analysis = require("../analysis.js");
const root = path.resolve(__dirname, "..");
const actual = JSON.parse(fs.readFileSync(path.join(root, "contours.json")));
const chart = JSON.parse(fs.readFileSync(path.join(root, "chart.json")));
const pole = [1400, -300];
function panel(radii, bend = 0) {
  return { pole, curves: radii.map((radius) => Array.from({ length: 81 }, (_, i) => {
    const angle = -0.8 + i * 0.02;
    const r = radius + bend * Math.exp(-angle * angle / 0.02);
    return [pole[0] + Math.sin(angle) * r, pole[1] + Math.cos(angle) * r];
  })) };
}
// Independent geometric expectations in polar coordinates, not chart snapshots.
assert.equal(analysis.troughs(panel([600, 660, 720, 780, 840])).length, 0);
const troughs = analysis.troughs(panel([600, 660, 720, 780, 840], 50));
assert.equal(troughs.length, 1);
assert.equal(troughs[0].length, 5);
for (const point of troughs[0]) assert.ok(Math.abs(point[0] - pole[0]) < 12, "trough must follow known southern bends");
assert.equal(analysis.troughs(panel([600, 660], 50)).length, 0, "two contours are insufficient");
assert.deepEqual(analysis.analyze({ panels: [{ pole, curves: [] }, { pole, curves: [] }] }), { troughs: [], jets: [] });
analysis.validate(actual, chart);
for (const key of ["source_sha256", "image_sha256", "observation_time", "width", "height"]) assert.throws(() => analysis.validate({ ...actual, [key]: "mismatch" }, chart));
const invalid = structuredClone(actual); invalid.panels[0].curves[0][0][0] = Infinity;
assert.throws(() => analysis.validate(invalid, chart));
const result = analysis.analyze(actual);
assert.equal(result.troughs.length, 1); assert.equal(result.jets.length, 0, "height contours alone must not create a strong-wind axis");
for (const [name, index] of [["troughs", 1]]) {
  const [left, top, right, bottom] = actual.panels[index].bounds;
  for (const curve of result[name]) for (const [x, y] of curve) assert.ok(x >= left && x <= right && y >= top && y <= bottom, "candidate must stay inside its pressure panel");
}
console.log("TROUGH_GEOMETRY_OK synthetic_bends=checked insufficient_data=checked source_binding=checked reviewed_chart=checked");
const wind = JSON.parse(fs.readFileSync(path.join(root, "wind-bands.json")));
analysis.validateWindBands(wind, chart);
for (const key of ["source_sha256", "image_sha256", "observation_time", "width", "height", "pressure_hpa", "unit"]) assert.throws(() => analysis.validateWindBands({ ...wind, [key]: "mismatch" }, chart));
for (const change of [
  (w) => { w.bands[0].min_kt = 20; },
  (w) => { w.bands[0].rings = []; },
  (w) => { w.bands[0].rings[0][0][1] = 2000; },
  (w) => { w.bands[0].rings[0][0][0] = NaN; },
  (w) => { w.bounds = [0, 0, chart.width, chart.height]; }
]) { const bad = structuredClone(wind); change(bad); assert.throws(() => analysis.validateWindBands(bad, chart)); }
// Independent ray casting checks region topology, including weak-wind holes.
function inRegion([x, y], rings) {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const intervalAt = (point) => wind.bands.filter((b) => inRegion(point, b.rings)).at(-1)?.min_kt || 0;
for (const [point, expected] of [[[1500,640],120],[[1850,390],100],[[735,330],80],[[1780,490],60],[[1880,550],40],[[1400,280],0],[[400,180],0],[[450,140],40],[[1000,1800],0]]) assert.equal(intervalAt(point),expected,"reviewed wind interval or weak-wind hole");
let samples = 0;
for (let x = 75; x < 1990; x += 20) for (let y = 135; y < 1440; y += 20) {
  const inside = wind.bands.map((b) => inRegion([x,y],b.rings));
  for (let i = 1; i < inside.length; i++) assert.ok(!inside[i] || inside[i-1],"higher-speed region must be inside lower threshold");
  samples++;
}
const luminance = (hex) => {
  const rgb = hex.slice(1).match(/../g).map((v) => parseInt(v,16)/255).map((v) => v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4);
  return rgb[0]*0.2126 + rgb[1]*0.7152 + rgb[2]*0.0722;
};
const lightness = analysis.windPalette.map(luminance);
for (let i = 1; i < lightness.length; i++) assert.ok(lightness[i] < lightness[i-1],"higher wind speeds must have darker colors");
const fills = [];
const ctx = { save(){},restore(){},beginPath(){},rect(){},clip(){},moveTo(){},lineTo(){},closePath(){},fill(rule){fills.push([this.fillStyle,rule]);} };
analysis.drawWindBands(ctx,wind);
assert.deepEqual(fills,analysis.windPalette.map((color) => [color,"evenodd"]));
console.log(`ISOTACH_BANDS_OK source_binding=checked units=checked malformed_data=blocked known_intervals=checked nested_samples=${samples} darkening=checked weak_holes=checked`);

const guides = JSON.parse(fs.readFileSync(path.join(root, "jet-guides.json")));
analysis.validateJetGuides(guides, chart, wind);
for (const key of ["source_sha256", "image_sha256", "observation_time", "width", "height", "pressure_hpa"]) assert.throws(() => analysis.validateJetGuides({ ...guides, [key]: "mismatch" }, chart, wind));
for (const change of [
  (g) => { g.axes[0].points[0][1] = 2000; },
  (g) => { g.axes[0].points[1] = [...g.axes[0].points[0]]; },
  (g) => { g.axes[0].points[0][0] = Infinity; },
  (g) => { g.axes[0].search_radius_px = 1000; }
]) { const bad = structuredClone(guides); change(bad); assert.throws(() => analysis.validateJetGuides(bad, chart, wind)); }
const rectangle = (y0, y1) => [[[0,y0],[400,y0],[400,y1],[0,y1]]];
const syntheticWind = { bounds:[0,0,400,400], bands:[{min_kt:40,rings:rectangle(120,280)},{min_kt:60,rings:rectangle(150,260)},{min_kt:80,rings:rectangle(210,230)}] };
const syntheticGuide = { axes:[{search_radius_px:90,points:[[50,200],[150,200],[250,200],[350,200]]}] };
for (const center of analysis.jets(syntheticWind,syntheticGuide)[0].centers) assert.equal(center.point[1],220,"known fastest strip, not the wider surrounding band's center");
const shiftedWind = structuredClone(syntheticWind); shiftedWind.bands[2].rings = rectangle(180,200);
for (const center of analysis.jets(shiftedWind,syntheticGuide)[0].centers) assert.equal(center.point[1],190,"moving the wind maximum moves the axis with an unchanged guide");
assert.equal(analysis.jets({...syntheticWind,bands:[]},syntheticGuide).length,0,"missing wind must not produce an axis by copying the guide");
const strongAxes = analysis.analyze(actual,wind,guides).jets;
assert.equal(strongAxes.length,3,"three separate downwind branches on the reviewed chart");
const bezier = (s,t) => [0,1].map(i => (1-t)**3*s.start[i]+3*(1-t)**2*t*s.c1[i]+3*(1-t)*t*t*s.c2[i]+t**3*s.end[i]);
let curveSamples = 0;
for (const axis of strongAxes) {
  for (const center of axis.centers) assert.equal(intervalAt(center.point),center.min_kt,"center must lie in the selected strongest wind interval");
  for (const [index, s] of axis.segments.entries()) {
    if (index) {
      const before = axis.segments[index-1];
      for (const i of [0,1]) assert.ok(Math.abs((before.end[i]-before.c2[i])-(s.c1[i]-s.start[i]))<1e-8,"shared curve tangents must not form corners");
    }
    for (let step=0; step<=50; step++) {
      const p=bezier(s,step/50);
      assert.ok(p[0]>=wind.bounds[0] && p[0]<=wind.bounds[2] && p[1]>=wind.bounds[1] && p[1]<=wind.bounds[3],"smooth axis must remain in the upper panel");
      assert.ok(intervalAt(p)>=40,"smooth axis must stay in a strong-wind band");
      curveSamples++;
    }
  }
}
assert.ok(strongAxes[0].segments.at(-1).end[0]>strongAxes[0].segments[0].start[0] && strongAxes[0].segments.at(-1).end[1]>strongAxes[0].segments[0].start[1],"western branch flows southeast");
assert.ok(strongAxes[1].segments.at(-1).end[1]>strongAxes[1].segments[0].start[1],"northern branch flows south then southeast");
assert.ok(strongAxes[2].segments.at(-1).end[0]>1900,"main branch flows into the eastern edge");
const drawCalls=[];
const jetCtx={save(){},restore(){},beginPath(){},rect(){},clip(){},moveTo(){},lineTo(){},stroke(){drawCalls.push(['stroke',this.strokeStyle]);},bezierCurveTo(){drawCalls.push(['curve']);}};
analysis.drawJetAxes(jetCtx,strongAxes,wind.bounds);
assert.equal(drawCalls.filter(c=>c[0]==='stroke').length,6,"one smooth shaft and one arrowhead per branch");
assert.ok(drawCalls.filter(c=>c[0]==='stroke').every(c=>c[1]==='#f02020'),"all axes and arrowheads use the same red");
console.log(`WIND_AXES_OK strongest_strip=checked shifted_maximum=checked no_height_only_axis=checked source_binding=checked branches=3 smooth_samples=${curveSamples} directions=checked arrows=checked`);
