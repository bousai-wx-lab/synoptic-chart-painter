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
assert.equal(analysis.jets(panel([500, 560, 620, 680, 740, 800])).length, 0, "uniform spacing has no distinguished core");
const jets = analysis.jets(panel([500, 580, 610, 640, 670, 790]));
assert.equal(jets.length, 1);
for (const point of jets[0]) assert.ok(Math.abs(Math.hypot(point[0] - pole[0], point[1] - pole[1]) - 625) < 0.000001, "axis must bisect the known close-spaced core");
assert.equal(analysis.jets(panel([500, 530, 560, 590])).length, 0, "four contours cannot establish core versus surroundings");
assert.deepEqual(analysis.analyze({ panels: [{ pole, curves: [] }, { pole, curves: [] }] }), { troughs: [], jets: [] });
analysis.validate(actual, chart);
for (const key of ["source_sha256", "image_sha256", "observation_time", "width", "height"]) assert.throws(() => analysis.validate({ ...actual, [key]: "mismatch" }, chart));
const invalid = structuredClone(actual); invalid.panels[0].curves[0][0][0] = Infinity;
assert.throws(() => analysis.validate(invalid, chart));
const result = analysis.analyze(actual);
assert.equal(result.troughs.length, 1); assert.equal(result.jets.length, 2);
for (const [name, index] of [["troughs", 1], ["jets", 0]]) {
  const [left, top, right, bottom] = actual.panels[index].bounds;
  for (const curve of result[name]) for (const [x, y] of curve) assert.ok(x >= left && x <= right && y >= top && y <= bottom, "candidate must stay inside its pressure panel");
}
console.log("ANALYSIS_GEOMETRY_OK synthetic_bends=checked density_core=checked insufficient_data=checked source_binding=checked reviewed_chart=checked");
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
