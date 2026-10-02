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
