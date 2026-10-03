"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const catalog = require("../catalog.js");
const root = path.resolve(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "chart-catalog.json")));
const inventory = JSON.parse(fs.readFileSync(path.join(root, "release-allowlist.json")));
catalog.validate(data);
const expectedCodes = "AUPA20 AUPA25 AUPN30 AUPQ35 AUPQ78 AUXN50 AXFE578 FEAS/FEAS50 AXJP130/AXJP140 FUPA252 FUPA302 FUPA402 FUPA502 FXFE5782 FXFE5784 FXFE577 FXFE502 FXFE504 FXFE507 FEAS02/FEAS502 FEAS04/FEAS504 FEAS07/FEAS507 FEAS09/FEAS509 FEAS12/FEAS512 FEAS14/FEAS514 FEAS16/FEAS516 FEAS19/FEAS519 FEAS21/FEAS521 FEAS24/FEAS524 FEAS26/FEAS526 FXJP854 FEFE19 FZCX50 FXXN519 FCVX21 FCVX22 FCVX23 FCVX24 FCVX11 FCVX12 FCVX13 FCVX14 FCVX15".split(" ");
assert.deepEqual(data.products.map(p => p.code).sort(), expectedCodes.sort());
assert.equal(data.products.filter(p => p.group === "observation").length, 9);
assert.equal(data.products.filter(p => p.group === "forecast").length, 34);
let pages = 0, reviewed = 0;
for (const product of data.products) for (const variant of product.variants) for (const page of variant.pages) {
  const selection = catalog.selection(data, product.id, variant.id, page.number);
  assert.equal(selection.variant.source_url, variant.source_url);
  const bytes = fs.readFileSync(path.join(root, page.image_path));
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), page.image_sha256);
  assert.equal(bytes.readUInt32BE(16), page.width); assert.equal(bytes.readUInt32BE(20), page.height);
  const allowed = inventory.allowed_binary_assets.find(a => a.path === page.image_path);
  assert.ok(allowed && inventory.allowed_files.includes(page.image_path));
  assert.equal(allowed.sha256, page.image_sha256);
  pages++; if (variant.features === "reviewed-aupq35") reviewed++;
}
assert.equal(pages, 61); assert.equal(reviewed, 1);
const original = JSON.parse(fs.readFileSync(path.join(root, "chart.json")));
const selected = catalog.selection(data, "aupq35", "aupq35-reviewed", 1);
assert.equal(selected.page.image_sha256, original.image_sha256);
assert.equal(selected.variant.source_sha256, original.source_sha256);
assert.throws(() => catalog.selection(data, "aupq78", "aupq35-reviewed", 1));
for (const change of [
  d => { d.products[0].variants[0].source_url = ["https:", "", "example.invalid", "chart.pdf"].join("/"); },
  d => { d.products[0].variants[0].pages[0].image_path = "../chart.png"; },
  d => { d.products[0].variants[0].pages[0].width = 0; },
  d => { d.products[0].variants[0].source_sha256 = "changed"; },
  d => { d.products[0].variants[0].features = "reviewed-aupq35"; },
  d => { d.products.push(d.products[0]); },
  d => { d.products[0].variants.push(d.products[0].variants[0]); },
  d => { d.products[0].variants[0].retrieved_at = "unknown"; }
]) {
  const altered = structuredClone(data); change(altered); assert.throws(() => catalog.validate(altered));
}
console.log(`CATALOG_TESTS_OK products=${data.products.length} pages=${pages} original_analysis_binding=preserved invalid_sources=rejected`);
