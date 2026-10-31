const NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

function exactPhpVersion(value) {
  const match = String(value || "").match(/\b(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.-]+)?\b/);
  return match ? match[1] : "";
}

export function detectPhpRuntime(sec = {}, finalUrl = "") {
  const evidence = [];
  const directEvidence = [];
  const inferredEvidence = [];
  const powered = String(sec.xPowered || "");
  const poweredMatch = powered.match(/(?:^|[\s,;])PHP(?:\/([0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[-+][0-9A-Za-z.-]+)?))?/i);
  let version = "";
  let confidence = "low";

  if (poweredMatch) {
    version = exactPhpVersion(poweredMatch[1]);
    directEvidence.push(`X-Powered-By: ${powered}`);
    confidence = "high";
  }
  if (sec.phpSignals?.sessionCookie) {
    directEvidence.push("PHPSESSID session cookie");
    if (confidence === "low") confidence = "medium";
  }
  if (sec.phpSignals?.errorSignature) {
    directEvidence.push("PHP error signature in response");
    confidence = "high";
  }
  if (sec.phpSignals?.contentMarker) {
    inferredEvidence.push("PHP-specific page marker");
    if (confidence === "low") confidence = "medium";
  }
  try {
    if (/\.php(?:\/|$)/i.test(new URL(finalUrl).pathname)) {
      inferredEvidence.push("Public URL uses a .php path");
      if (confidence === "low") confidence = "medium";
    }
  } catch {}

  const wpSignals = sec.wpSignals || {};
  const wordpressEvidence = [
    [wpSignals.loginOpen, "Live WordPress login form responded at /wp-login.php"],
    [wpSignals.xmlrpcOpen, "Live WordPress XML-RPC endpoint responded"],
    [wpSignals.usersOpen, "Live WordPress users REST endpoint responded"],
    [wpSignals.routesOpen, "Live WordPress REST route index responded"],
    [wpSignals.readmeOpen, "WordPress readme endpoint responded"],
    [wpSignals.debugOpen, "WordPress debug log endpoint exposed PHP traces"],
  ].filter(([present]) => present).map(([, label]) => label);
  inferredEvidence.push(...wordpressEvidence);
  if (!directEvidence.length && wordpressEvidence.length) {
    confidence = wordpressEvidence.length >= 2 ? "high" : "medium";
  }

  evidence.push(...directEvidence, ...inferredEvidence);
  const classification = directEvidence.length ? "confirmed" : inferredEvidence.length ? "likely" : "not_detected";

  return {
    detected: evidence.length > 0,
    classification,
    version,
    confidence: evidence.length ? confidence : "none",
    evidence: [...new Set(evidence)],
    versionSource: version ? "response_header" : "",
  };
}

export function nvdCpeForPhp(version) {
  const exact = exactPhpVersion(version);
  return exact ? `cpe:2.3:a:php:php:${exact}:*:*:*:*:*:*:*` : "";
}

function metricFor(cve = {}) {
  const metrics = cve.metrics || {};
  const candidates = [
    ...(metrics.cvssMetricV40 || []),
    ...(metrics.cvssMetricV31 || []),
    ...(metrics.cvssMetricV30 || []),
    ...(metrics.cvssMetricV2 || []),
  ];
  const primary = candidates.find((m) => m.type === "Primary") || candidates[0] || {};
  const data = primary.cvssData || {};
  return {
    cvss: Number(data.baseScore || 0),
    severity: String(data.baseSeverity || primary.baseSeverity || "UNKNOWN").toLowerCase(),
  };
}

export function parseNvdPhpCves(payload = {}) {
  const cves = (payload.vulnerabilities || []).map((entry) => {
    const cve = entry.cve || {};
    const description = (cve.descriptions || []).find((d) => d.lang === "en")?.value || "";
    return {
      id: cve.id || "",
      ...metricFor(cve),
      title: description.slice(0, 280),
      description,
      published: cve.published || "",
      lastModified: cve.lastModified || "",
      reference: cve.id ? `https://nvd.nist.gov/vuln/detail/${cve.id}` : "",
      source: "NVD CVE API 2.0",
      applicability: "potential_version_match",
      confirmed: false,
    };
  }).filter((item) => item.id);
  cves.sort((a, b) => b.cvss - a.cvss || a.id.localeCompare(b.id));
  return { total: Number(payload.totalResults || cves.length), cves };
}

async function fetchNvdPhp(version, options = {}) {
  const cpe = nvdCpeForPhp(version);
  if (!cpe) return { total: 0, cves: [] };
  const key = cpe.toLowerCase();
  const now = Date.now();
  const cached = cache.get(key);
  if (options.useCache !== false && cached && now - cached.createdAt < CACHE_TTL_MS) return cached.value;

  const url = new URL(NVD_URL);
  url.searchParams.set("cpeName", cpe);
  url.searchParams.set("isVulnerable", "");
  url.searchParams.set("noRejected", "");
  url.searchParams.set("resultsPerPage", "100");

  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 5000);
  try {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": "Rankr authorized website auditor/1.0",
        ...(process.env.NVD_API_KEY ? { apiKey: process.env.NVD_API_KEY } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`NVD returned HTTP ${response.status}`);
    const value = parseNvdPhpCves(await response.json());
    if (options.useCache !== false) cache.set(key, { createdAt: now, value });
    return value;
  } finally {
    clearTimeout(timer);
  }
}

export async function assessPhpSecurity(detection = {}, options = {}) {
  const base = {
    runtime: "php",
    detected: Boolean(detection.detected),
    classification: detection.classification || (detection.detected ? "confirmed" : "not_detected"),
    version: detection.version || "",
    confidence: detection.confidence || "none",
    evidence: detection.evidence || [],
    status: "no_php_evidence",
    advisories: [],
    advisoryCount: 0,
    source: "NVD CVE API 2.0",
    checkedAt: new Date().toISOString(),
    note: "No reliable PHP evidence was observed.",
  };
  if (!base.detected) return base;
  if (!nvdCpeForPhp(base.version)) {
    return {
      ...base,
      status: base.classification === "likely" ? "likely_version_unknown" : "detected_version_unknown",
      note: base.classification === "likely"
        ? "PHP is likely because live WordPress/PHP-style endpoints responded, but the runtime did not directly disclose itself or an exact version. Rankr did not guess a version or claim a CVE match."
        : "PHP was directly detected, but no exact version was disclosed. Rankr did not guess a version or claim a CVE match.",
    };
  }

  try {
    const result = await fetchNvdPhp(base.version, options);
    return {
      ...base,
      status: result.total ? "potentially_affected" : "version_checked_no_matches",
      advisories: result.cves,
      advisoryCount: result.total,
      note: result.total
        ? `${result.total} NVD CVE record(s) include PHP ${base.version} in their vulnerable CPE applicability. These are potential version matches, not confirmation that this server is exploitable; OS, SAPI, configuration, and vendor backports still matter.`
        : `NVD returned no vulnerable CPE matches for PHP ${base.version}. This does not prove the deployment is secure.`,
    };
  } catch (error) {
    return {
      ...base,
      status: "lookup_failed",
      lookupError: error?.name === "AbortError" ? "NVD request timed out" : String(error?.message || error),
      note: `PHP ${base.version} was detected, but the NVD lookup could not be completed. No vulnerability claim was made.`,
    };
  }
}
