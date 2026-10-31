import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { auditWebsite, renderPreview } from "./audit.js";
import { generateLeads } from "./leads.js";
import { findOwner } from "./contact.js";
import { draftMessage } from "./message.js";
import { searchWeb } from "./search.js";

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.text({ type: ["text/xml", "application/xml"], limit: "256kb" }));

const ownerCache = new Map();

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return String(url).toLowerCase(); }
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, name: "Rankr" });
});

app.post("/api/audit", async (req, res) => {
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url.trim()) && !/^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(url.trim())) {
    return res.status(400).json({ error: "A valid URL is required." });
  }
  try {
    const result = await auditWebsite(url, { timeoutMs: 20000 });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/render", async (req, res) => {
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url.trim()) && !/^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(url.trim())) {
    return res.status(400).json({ error: "A valid URL is required." });
  }
  try {
    const result = await renderPreview(url);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/leads", async (req, res) => {
  const { url, yourName, seed } = req.body || {};
  if (!url) return res.status(400).json({ error: "An audited URL is required." });
  try {
    const audit = await auditWebsite(url, { timeoutMs: 20000 });
    const leads = generateLeads(audit, { yourName, seed });
    res.json({ audit: stripScreens(audit), ...leads });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/owner", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "A URL is required." });
  try {
    const key = hostOf(url);
    if (ownerCache.has(key)) return res.json(ownerCache.get(key));
    const owner = await findOwner(url);
    ownerCache.set(key, owner);
    res.json(owner);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/message", async (req, res) => {
  const { url, yourName = "", yourPhone = "", audit: givenAudit, owner: givenOwner } = req.body || {};
  if (!url) return res.status(400).json({ error: "A URL is required." });
  const key = hostOf(url);
  try {
    const [audit, owner] = await Promise.all([
      givenAudit && givenAudit.findings ? Promise.resolve(givenAudit) : auditWebsite(url, { timeoutMs: 20000 }),
      givenOwner && givenOwner.ownerName ? Promise.resolve(givenOwner) : (ownerCache.get(key) || await findOwner(url).then((o) => (ownerCache.set(key, o), o))),
    ]);
    const message = draftMessage({ owner, audit, yourName, yourPhone, variant: Math.floor(Math.random() * 3) });
    res.json({ audit: stripScreens(audit), owner, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function stripScreens(audit) {
  return { ...audit, desktopScreenshotB64: "", mobileScreenshotB64: "" };
}

async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  const run = async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

app.post("/api/search", async (req, res) => {
  const { query } = req.body || {};
  if (!query || !String(query).trim()) return res.status(400).json({ error: "A search query is required." });
  try {
    const result = await searchWeb(String(query).trim(), { limit: 20, engines: ["all"] });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const DEFAULT_WHATS = ["dentist", "mechanic auto repair", "plumber", "roofing company", "hair salon", "law firm", "pest control", "hvac company", "electrician", "landscaping company", "realtor", "auto body shop"];

const DEFAULT_CITIES = [
  "new york", "los angeles", "chicago", "houston", "phoenix", "philadelphia", "san antonio", "san diego",
  "dallas", "san jose", "austin", "jacksonville", "fort worth", "columbus", "charlotte", "indianapolis",
  "san francisco", "seattle", "denver", "washington", "boston", "nashville", "oklahoma city", "el paso",
  "las vegas", "detroit", "portland", "memphis", "louisville", "baltimore", "milwaukee", "albuquerque",
  "tucson", "fresno", "sacramento", "kansas city", "mesa", "atlanta", "colorado springs", "raleigh",
  "omaha", "miami", "long beach", "virginia beach", "oakland", "minneapolis", "tampa", "arlington",
  "new orleans", "wichita", "cleveland", "bakersfield", "aurora", "anaheim", "honolulu", "santa ana",
  "riverside", "corpus christi", "lexington", "stockton", "henderson", "saint paul", "cincinnati",
  "st. louis", "pittsburgh", "greensboro", "anchorage", "lincoln", "plano", "orlando", "irvine",
  "newark", "durham", "chula vista", "toledo", "fort wayne", "st. petersburg", "laredo", "jersey city",
  "chandler", "madison", "buffalo", "lubbock", "scottsdale", "reno", "glendale", "gilbert",
  "winston-salem", "north las vegas", "norfolk", "chesapeake", "garland", "irving", "hialeah", "fremont",
  "boise", "richmond", "baton rouge", "spokane", "des moines",
];

const DEFAULT_STATES = [
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia", "ks", "ky",
  "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd",
  "oh", "ok", "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy",
];

function splitList(v, fallback) {
  if (v === undefined || v === null || String(v).trim() === "" || String(v).trim() === "*") {
    return fallback;
  }
  return String(v).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
}

const WHAT_SYNONYMS = {
  hair: ["hair salon", "hair stylist", "hairstylist", "beauty salon"],
  "hair salon": ["hair salon", "hair stylist", "hairstylist", "beauty salon"],
  dentist: ["dentist", "dentistry", "dental clinic", "dental care", "orthodontist"],
  mechanic: ["mechanic", "auto repair", "car repair shop", "auto mechanic"],
  "mechanic auto repair": ["auto repair", "mechanic", "car repair shop", "auto mechanic"],
  plumber: ["plumber", "plumbing", "plumbers", "emergency plumber"],
  "roofing company": ["roofing", "roofer", "roofers", "roof repair", "roofing contractor", "roof replacement"],
  roofing: ["roofing", "roofer", "roofers", "roof repair", "roofing contractor", "roof replacement"],
  "hair salon": ["hair salon", "hair stylist", "beauty salon", "salon"],
  "law firm": ["law firm", "lawyer", "attorney", "lawyers"],
  lawyer: ["lawyer", "attorney", "law firm", "lawyers"],
  "pest control": ["pest control", "exterminator", "pest control company", "termite control"],
  "hvac company": ["hvac", "heating and air", "ac repair", "air conditioning service"],
  electrician: ["electrician", "electrical contractor", "electricians"],
  "landscaping company": ["landscaping", "landscape design", "lawn care", "landscaper"],
  realtor: ["realtor", "real estate agent", "real estate broker", "realtors"],
  "auto body shop": ["auto body shop", "auto body repair", "collision repair", "body shop"],
};

function queryVariants(what, city, state) {
  const loc = city && state && state !== "*" ? `"${city}, ${state}"` : city ? `"${city}"` : "";
  const key = String(what).trim().toLowerCase();
  const seeds = WHAT_SYNONYMS[key] ? WHAT_SYNONYMS[key].slice(0, 6) : [what, `${what}s`];
  const out = [];
  for (const seed of seeds) {
    if (loc) {
      out.push(`${seed} in ${loc}`);
      out.push(`${seed} ${loc}`);
    } else {
      out.push(seed);
    }
  }
  return [...new Set(out)].slice(0, 10);
}

app.post("/api/hunt", async (req, res) => {
  const { query, what, city, state, count = 8, workers = 3, engine = "all" } = req.body || {};
  const maxCombos = 24;
  try {
    let combos;
    if (query && String(query).trim() && !what && !city && !state) {
      combos = [{ query: String(query).trim(), what: "", city: "", state: "" }];
    } else {
      const whats = splitList(what, DEFAULT_WHATS);
      const cities = splitList(city, DEFAULT_CITIES);
      const states = splitList(state, DEFAULT_STATES);
      const seen = new Set();
      combos = [];
      for (const w of whats) {
        for (const c of cities) {
          for (const s of states) {
            const loc = c && s && s !== "*" ? `"${c}, ${s}"` : c ? `"${c}"` : "";
            const q = loc ? `${w} in ${loc}` : w;
            const key = q.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            combos.push({ query: q, what: w, city: c, state: s });
            if (combos.length >= maxCombos) break;
          }
          if (combos.length >= maxCombos) break;
        }
        if (combos.length >= maxCombos) break;
      }
    }

  if (!combos.length) return res.status(400).json({ error: "A search query is required." });

  const targetAudits = Math.max(4, Math.min(Number(count) || 20, 150));
  const perCombo = Math.max(10, Math.min(60, Math.ceil((targetAudits * 1.5) / Math.max(1, combos.length))));

  const globalHosts = new Set();
  const tasks = [];
  let searched = 0;
  const comboStats = [];
  const searchErrors = [];

  const searchJobs = [];
  if (combos.length === 1) {
    const variants = queryVariants(combos[0].what, combos[0].city, combos[0].state).slice(0, 8);
    for (const v of variants) {
      searchJobs.push({ variant: v, ...combos[0] });
    }
  } else {
    for (const cb of combos) {
      searchJobs.push({ variant: cb.query, ...cb });
    }
  }

  await runPool(searchJobs, 6, async (job) => {
    if (tasks.length >= targetAudits * 1.5) return;
    let results = [];
    try {
      const search = await searchWeb(job.variant, {
        limit: perCombo,
        engines: [engine],
        strict: false,
        fast: true,
      });
      results = search.results || [];
      if (search.errors && search.errors.length) searchErrors.push({ query: job.variant, errors: search.errors });
    } catch (e) {
      searchErrors.push({ query: job.variant, errors: [String(e.message || e).slice(0, 120)] });
    }
    searched += results.length;
    let foundThis = 0;
    for (const r of results) {
      let host;
      try { host = new URL(r.url).hostname.replace(/^www\./, ""); } catch { continue; }
      if (globalHosts.has(host)) continue;
      globalHosts.add(host);
      tasks.push({ url: r.url, snippet: r.snippet || "", title: r.title || "", ...job });
      foundThis++;
      if (tasks.length >= targetAudits * 1.5) break;
    }
    comboStats.push({ query: job.query || job.variant, what: job.what, city: job.city, state: job.state, found: foundThis, audited: foundThis });
  });

  const tasksToAudit = tasks.slice(0, targetAudits);
  const poolWorkers = Math.min(10, Math.max(6, tasksToAudit.length));
  const audits = await runPool(tasksToAudit, poolWorkers, async (t) => {
    const audit = await auditWebsite(t.url, { timeoutMs: 5000, captureScreens: false });
    return { ...stripScreens(audit), snippet: t.snippet, searchTitle: t.title, query: t.query, what: t.what, city: t.city, state: t.state };
  });

    const leads = audits
      .filter((a) => a.statusCode !== null && a.statusCode < 500)
      .map((a) => ({
        id: a.finalUrl,
        domain: a.domain,
        url: a.finalUrl,
        businessName: a.businessName,
        title: a.title,
        industry: a.industryGuess,
        city: a.cityGuess,
        email: a.email,
        phone: a.phone,
        hasContactPage: a.hasContactPage,
        hasContactForm: a.hasContactForm,
        popupDetected: a.popupDetected,
        recommended: a.recommended,
        score: a.score,
        verdict: a.verdict,
        cms: a.cms || "",
        cmsVersion: a.cmsVersion || "",
        phpDetection: a.phpDetection,
        phpSecurity: a.phpSecurity,
        hackRisk: a.hackRisk || { level: "n/a", factors: [], cms: "", cmsVersion: "" },
        scores: a.scores,
        issuesFoundCount: a.issuesFoundCount,
        topIssues: [...a.findings].sort((x, y) => y.points - x.points).slice(0, 4).map((f) => f.message),
        findings: a.findings.map((f) => ({ category: f.category, points: f.points, message: f.message })),
        uiSummary: a.uiSummary,
        pitchAngle: a.pitchAngle,
        fixSuggestion: a.fixSuggestion,
        recommendationReason: a.recommendationReason,
        query: a.what ? `${a.what} · ${a.city}${a.state ? ", " + a.state : ""}` : a.query || "",
        checkedAt: a.checkedAt,
      }))
      .sort((x, y) => (x.score === null ? 1 : y.score === null ? -1 : x.score - y.score));

    const truncated = combos.length >= maxCombos;
    res.json({
      query: combos.length === 1 ? combos[0].query : `${combos.length} locations & business types`,
      combos: comboStats,
      probes: combos.length,
      truncated,
      engine: engine,
      searched,
      audited: audits.length,
      leads,
      failed: audits.filter((a) => a.statusCode === null || a.statusCode >= 500).map((a) => ({ url: a.url, reason: (a.recommendationReason || "").slice(0, 120) })),
      searchErrors,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ===== CRM Integration (Local CRM on http://localhost:3001) ===== */
app.get("/api/crm/status", async (req, res) => {
  const crmUrl = req.query.url || "http://localhost:3001";
  try {
    const r = await fetch(`${crmUrl.replace(/\/+$/, '')}/api/companies`, { signal: AbortSignal.timeout(2000) });
    res.json({ ok: r.ok, crmUrl, status: r.status });
  } catch (err) {
    res.json({ ok: false, crmUrl, error: err.message });
  }
});

app.post("/api/crm/push", async (req, res) => {
  const { lead, crmUrl = "http://localhost:3001" } = req.body || {};
  if (!lead || !lead.url) return res.status(400).json({ error: "Lead data with url is required." });

  try {
    const name = lead.businessName || lead.domain || lead.title || "Unknown Business";
    const companyPayload = {
      name,
      industry: lead.industry || lead.query || "Local Business",
      website: lead.url,
      phone: lead.phone || "",
      email: lead.email || "",
      address: lead.city ? `${lead.city}${lead.state ? ', ' + lead.state : ''}` : "",
      notes: [
        `Rankr Lead Score: ${lead.score !== null ? lead.score : 'N/A'}/100 (${lead.verdict || ''})`,
        lead.cms ? `CMS: ${lead.cms.toUpperCase()} ${lead.cmsVersion || ''}` : '',
        lead.hackRisk?.level ? `Hack Risk: ${lead.hackRisk.level.toUpperCase()} (${(lead.hackRisk.factors || []).join(', ')})` : '',
        Array.isArray(lead.topIssues) && lead.topIssues.length ? `Top Issues: ${lead.topIssues.join(' | ')}` : '',
        lead.query ? `Search Query: ${lead.query}` : '',
        `Audited at: ${lead.checkedAt || new Date().toISOString()}`,
      ].filter(Boolean).join('\n'),
    };

    const compRes = await fetch(`${crmUrl.replace(/\/+$/, '')}/api/companies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(companyPayload),
      signal: AbortSignal.timeout(6000),
    });

    if (!compRes.ok) {
      const errText = await compRes.text().catch(() => "");
      throw new Error(`CRM rejected company (${compRes.status}): ${errText || compRes.statusText}`);
    }

    const company = await compRes.json();

    let contact = null;
    const contactName = lead.ownerName || lead.businessName || "Business Owner";
    const contactPayload = {
      first_name: contactName,
      last_name: "",
      email: lead.email || "",
      phone: lead.phone || "",
      company_id: company.id || null,
      role: "Decision Maker / Owner",
      notes: `Lead from Rankr audit. Website: ${lead.url}`,
    };

    try {
      const contRes = await fetch(`${crmUrl.replace(/\/+$/, '')}/api/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactPayload),
        signal: AbortSignal.timeout(6000),
      });
      if (contRes.ok) contact = await contRes.json();
    } catch {}

    res.json({
      ok: true,
      companyId: company.id,
      companyName: company.name,
      message: `Added "${name}" to CRM!`,
      crmViewUrl: `http://localhost:5173/companies`,
    });
  } catch (err) {
    console.error("CRM Push error:", err);
    res.status(502).json({
      error: `Could not connect to CRM: ${err.message}. Make sure your CRM is running on ${crmUrl}`,
    });
  }
});

app.post("/api/crm/ignore", async (req, res) => {
  const { lead, reason = "Directory / Waste of Link", crmUrl = "http://localhost:3001" } = req.body || {};
  if (!lead || !lead.url) return res.status(400).json({ error: "Lead data with url is required." });

  try {
    const payload = {
      name: lead.businessName || lead.domain || "Unknown Lead",
      domain: lead.domain || new URL(lead.url).hostname.replace(/^www\./, ""),
      url: lead.url,
      score: lead.score !== undefined ? lead.score : null,
      verdict: lead.verdict || "",
      cms: lead.cms || "",
      hack_risk: lead.hackRisk?.level || "",
      reason,
      notes: `Ignored from Rankr hunt. Query: ${lead.query || ""}`,
    };

    const resp = await fetch(`${crmUrl.replace(/\/+$/, '')}/api/ignored`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`CRM Ignored API rejected (${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    res.json({
      ok: true,
      id: data.id,
      message: `Ignored "${payload.name}" and sent to CRM Ignored tab!`,
      crmIgnoredUrl: "http://localhost:5173/ignored",
    });
  } catch (err) {
    console.error("CRM Ignore error:", err);
    res.status(502).json({ error: `Could not save to CRM: ${err.message}` });
  }
});

/* ===== Demo business site (PrimeRoof Miami) — deliberately vulnerable WordPress surface =====
   Only reachable on this local server, emulates the "hacked.html" demo business. */
app.get("/readme.html", (req, res) => {
  res.set("Content-Type", "text/html");
  res.send(`<!DOCTYPE html><html><head><title>PrimeRoof Miami</title></head><body><h1>PrimeRoof Miami</h1><p>Just another WordPress site</p><hr/><h1>Version 5.8.3</h1><p>This file is public and discloses the CMS version.</p></body></html>`);
});
app.get("/wp-login.php", (req, res) => {
  res.set("Content-Type", "text/html");
  res.send(`<!DOCTYPE html><html><body><form action="/wp-login.php" method="post" style="font-family:sans-serif;max-width:300px;margin:60px auto"><h2>Log in &mdash; PrimeRoof Miami</h2><p style="color:#777">Synthetic WordPress-style login with intentionally weak demo credentials and no rate limiting or 2FA.</p><label>Username or Email</label><br/><input type="text" name="log" autocomplete="username" required /><br/><br/><label>Password</label><br/><input type="password" name="pwd" autocomplete="current-password" required /><br/><br/><button>Log In</button><p id="err" style="color:#a8071a"></p></form><script>if(location.search.includes("failed")){document.getElementById("err").textContent="ERROR: Incorrect username or password."}addEventListener("message",()=>{});</script></body></html>`);
});
app.post("/wp-login.php", (req, res) => {
  const log = String(req.body && req.body.log || "").trim();
  const pwd = String(req.body && req.body.pwd || "");
  if (log.toLowerCase() === "admin" && pwd === "letmein123") {
    res.set("Set-Cookie", "rankr_demo_session=authorized-synthetic-session; HttpOnly; SameSite=Lax; Path=/");
    res.redirect("/wp-admin/");
  } else {
    res.redirect("/wp-login.php?failed=1");
  }
});
app.post("/xmlrpc.php", (req, res) => {
  const xml = (req.body && String(req.body)) || "";
  const m = xml.match(/<methodName>([^<]+)<\/methodName>/) || xml.match(/<string>([^<]+)<\/string>/);
  const method = m ? m[1] : "unknown";
  res.set("Content-Type", "text/xml");
  if (method.startsWith("system.")) {
    res.send(`<?xml version="1.0"?><methodResponse><params><param><value><array><data><value><string>system.multicall</string></value><value><string>system.listMethods</string></value><value><string>wp.getUsersBlogs</string></value><value><string>pingback.ping</string></value></data></array></value></param></params></methodResponse>`);
  } else if (method === "pingback.ping") {
    res.send(`<?xml version="1.0"?><methodResponse><params><param><value><string>Pingback from 127.0.0.1 has been registered. Keep the web talking!</string></value></param></params></methodResponse>`);
  } else {
    res.send(`<?xml version="1.0"?><methodResponse><fault><value><struct><member><name>faultCode</name><value><int>403</int></value></member><member><name>faultString</name><value><string>Method &quot;${method}&quot; not enabled. Use system.listMethods to see what is active.</string></value></member></struct></value></fault></methodResponse>`);
  }
});
app.get("/xmlrpc.php", (req, res) => res.status(200).send("XML-RPC server accepts POST requests only."));
app.get("/wp-json/", (req, res) => res.json({
  name: "primeroofmiami.com",
  namespaces: ["core", "wp/v2", "simple-image-manipulation/v1", "shopper-rx/v1", "comments-plus"],
  routes: {
    "/wp/v2/users": { methods: ["GET"], namespace: "wp/v2" },
    "/wp/v2/users/(?P<id>[\\d]+)": { methods: ["GET"], namespace: "wp/v2" },
    "/simple-image-manipulation/v1/crop": { methods: ["POST"], namespace: "simple-image-manipulation/v1" },
    "/shopper-rx/v1/import": { methods: ["POST"], namespace: "shopper-rx/v1" },
  },
}));
app.get("/wp-json/wp/v2/users", (req, res) => res.json([
  { id: 1, name: "PrimeRoof Admin", slug: "admin", link: "https://primeroofmiami.test/?author=1" },
  { id: 2, name: "Maria R.", slug: "maria", first_name: "Maria", last_name: "R." },
]));
function demoAuthenticated(req) {
  return String(req.headers.cookie || "").includes("rankr_demo_session=authorized-synthetic-session");
}
function requireDemoAuth(req, res, next) {
  if (!demoAuthenticated(req)) return res.status(401).json({ error: "Synthetic demo authentication required" });
  next();
}
app.get("/wp-admin/", requireDemoAuth, (req, res) => res.send("<!DOCTYPE html><html><body style='font-family:sans-serif'><h1>Welcome to your synthetic WordPress dashboard</h1><p>Session active — you are logged in as <b>admin</b>.</p><p>No real WordPress installation, filesystem, or database exists behind this demo.</p><p><small>Rankr authorized demo server</small></p></body></html>"));
app.post("/wp-admin/async-upload.php", requireDemoAuth, (req, res) => res.json({ simulated: true, success: true, data: { url: "/synthetic-only/demo-upload.png", file: "demo-upload.png", type: "image/png" } }));
app.get("/wp-content/debug.log", (req, res) => {
  res.set("Content-Type", "text/plain");
  res.send([
    "[07-Sep-2026 02:11:19 UTC] PHP Fatal error: Uncaught TypeError: wp_remoting_upload(): Argument #1 ($crop) must be of type array, string given in /var/www/primeroof/wp-includes/class-wp-image-editor.php:88",
    "[07-Sep-2026 02:11:19 UTC] #0 /var/www/primeroof/wp-admin/async-upload.php(12): wp_remoting_upload()",
    "[07-Sep-2026 02:14:41 UTC] PHP Notice: file_put_contents(/var/www/primeroof/wp-content/uploads/2026/09/tmp-[REDACTED].php): failed to open stream: Permission denied in /var/www/primeroof/wp-includes/functions.php:1512",
    "",
  ].join("\n"));
});
app.get("/wp-content/readme.html", (req, res) => res.redirect("/readme.html"));
app.get("/favicon.ico", (req, res) => res.status(204).end());

app.use("/fixed", (req, res, next) => {
  res.set({
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'",
  });
  next();
});
app.get("/fixed/", (req, res) => res.sendFile(fileURLToPath(new URL("../../demo/fixed.html", import.meta.url))));
app.get("/fixed/wp-login.php", (req, res) => res.status(403).json({ error: "Login is protected by access control" }));
app.all("/fixed/xmlrpc.php", (req, res) => res.status(403).json({ error: "XML-RPC disabled" }));
app.get("/fixed/wp-json/wp/v2/users", (req, res) => res.status(404).json({ error: "Not found" }));
app.get("/fixed/wp-content/debug.log", (req, res) => res.status(404).json({ error: "Not found" }));
app.use("/demo", express.static(fileURLToPath(new URL("../../demo", import.meta.url)), { extensions: ["html"] }));

const frontendDist = fileURLToPath(new URL("../../frontend/dist", import.meta.url));
app.use(express.static(frontendDist));
app.get("*", (req, res) => res.sendFile(`${frontendDist}/index.html`));

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Rankr backend running on http://localhost:${PORT}`);
});