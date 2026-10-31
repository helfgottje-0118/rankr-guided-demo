import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import {
  assessPhpSecurity,
  detectPhpRuntime,
  nvdCpeForPhp,
  parseNvdPhpCves,
} from "../src/php-security.js";
import { auditWebsite, closeBrowser } from "../src/audit.js";

test("detects an exact PHP version from X-Powered-By", () => {
  const result = detectPhpRuntime({ xPowered: "PHP/8.1.12", phpSignals: {} }, "https://example.com/");
  assert.equal(result.detected, true);
  assert.equal(result.version, "8.1.12");
  assert.equal(result.confidence, "high");
  assert.match(result.evidence[0], /X-Powered-By/i);
});

test("detects PHP without inventing a version", () => {
  const result = detectPhpRuntime({ xPowered: "Express", phpSignals: { sessionCookie: true } }, "https://example.com/index.php");
  assert.equal(result.detected, true);
  assert.equal(result.version, "");
  assert.equal(result.confidence, "medium");
});

test("classifies multiple live WordPress endpoints as likely PHP when disclosure is hidden", () => {
  const result = detectPhpRuntime({
    xPowered: "",
    phpSignals: {},
    wpSignals: { loginOpen: true, xmlrpcOpen: true, routesOpen: true },
  }, "https://example.com/");

  assert.equal(result.detected, true);
  assert.equal(result.classification, "likely");
  assert.equal(result.version, "");
  assert.equal(result.confidence, "high");
  assert.match(result.evidence.join(" "), /WordPress login form/i);
});

test("keeps a lone WordPress runtime signal as likely rather than confirmed PHP", () => {
  const result = detectPhpRuntime({
    xPowered: "",
    phpSignals: {},
    wpSignals: { loginOpen: true },
  }, "https://example.com/");

  assert.equal(result.detected, true);
  assert.equal(result.classification, "likely");
  assert.equal(result.confidence, "medium");
  assert.equal(result.version, "");
});

test("builds an exact NVD PHP CPE", () => {
  assert.equal(
    nvdCpeForPhp("8.1.12"),
    "cpe:2.3:a:php:php:8.1.12:*:*:*:*:*:*:*",
  );
  assert.equal(nvdCpeForPhp("8.1"), "");
});

test("parses NVD records as potential version matches, not confirmed exploits", () => {
  const records = parseNvdPhpCves({
    totalResults: 1,
    vulnerabilities: [{ cve: {
      id: "CVE-2024-4577",
      published: "2024-06-09T10:15:09.220",
      descriptions: [{ lang: "en", value: "PHP CGI argument injection on affected configurations." }],
      metrics: { cvssMetricV31: [{ cvssData: { baseScore: 9.8, baseSeverity: "CRITICAL" } }] },
    } }],
  });
  assert.equal(records.total, 1);
  assert.equal(records.cves[0].id, "CVE-2024-4577");
  assert.equal(records.cves[0].applicability, "potential_version_match");
  assert.equal(records.cves[0].confirmed, false);
});

test("does not query NVD when PHP version is unknown", async () => {
  let called = false;
  const result = await assessPhpSecurity(
    { detected: true, version: "", confidence: "medium", evidence: ["PHPSESSID cookie"] },
    { fetchImpl: async () => { called = true; } },
  );
  assert.equal(called, false);
  assert.equal(result.status, "detected_version_unknown");
  assert.equal(result.advisories.length, 0);
});

test("reports no PHP evidence without claiming an unknown PHP version", async () => {
  const result = await assessPhpSecurity({ detected: false, version: "", confidence: "none", evidence: [] });
  assert.equal(result.status, "no_php_evidence");
  assert.equal(result.detected, false);
});

test("queries exact PHP versions on every assessment path", async () => {
  let requested = "";
  const result = await assessPhpSecurity(
    { detected: true, version: "8.1.12", confidence: "high", evidence: ["X-Powered-By: PHP/8.1.12"] },
    {
      useCache: false,
      fetchImpl: async (url) => {
        requested = String(url);
        return { ok: true, json: async () => ({ totalResults: 0, vulnerabilities: [] }) };
      },
    },
  );
  assert.match(requested, /cpeName=/);
  assert.match(requested, /isVulnerable=/);
  assert.equal(result.status, "version_checked_no_matches");
});

test("every website audit automatically assesses a disclosed PHP version", async (t) => {
  const server = createServer((_request, response) => {
    response.setHeader("X-Powered-By", "PHP/8.1.12");
    response.setHeader("Content-Type", "text/html");
    response.end("<!doctype html><title>PHP fixture</title><h1>PHP fixture</h1>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await closeBrowser();
    await new Promise((resolve) => server.close(resolve));
  });
  const { port } = server.address();
  const audit = await auditWebsite(`http://127.0.0.1:${port}/`, {
    captureScreens: false,
    phpSecurityOptions: {
      useCache: false,
      fetchImpl: async () => ({ ok: true, json: async () => ({
        totalResults: 1,
        vulnerabilities: [{ cve: { id: "CVE-TEST-0001", descriptions: [{ lang: "en", value: "Test record" }] } }],
      }) }),
    },
  });
  assert.equal(audit.phpDetection.version, "8.1.12");
  assert.equal(audit.phpSecurity.status, "potentially_affected");
  assert.equal(audit.phpSecurity.advisoryCount, 1);
  assert.equal(audit.phpSecurity.advisories[0].confirmed, false);
});
