import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appPath = new URL("../../frontend/src/App.jsx", import.meta.url);
const backendPath = new URL("../src/index.js", import.meta.url);

test("lead cards have expandable PHP and hackability buttons", async () => {
  const source = await readFile(appPath, "utf8");

  assert.match(source, /PHP:\s*\{php\.detected\s*\?\s*"Yes"\s*:\s*"No"\}/);
  assert.match(source, /Hackability:\s*\{risk\.level\}/);
  assert.match(source, /aria-expanded=\{openSecurityPanel\[phpPanelKey\]/);
  assert.match(source, /aria-expanded=\{openSecurityPanel\[hackPanelKey\]/);
  assert.match(source, /PHP evidence and version check/);
  assert.match(source, /Why this site may be hackable/);
});

test("hunt results retain PHP assessment data for the buttons", async () => {
  const source = await readFile(backendPath, "utf8");

  assert.match(source, /phpDetection:\s*a\.phpDetection/);
  assert.match(source, /phpSecurity:\s*a\.phpSecurity/);
});
