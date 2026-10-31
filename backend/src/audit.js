import { chromium } from "playwright";
import { INPAGE_SCRIPT } from "./inpage.js";
import { assessPhpSecurity, detectPhpRuntime } from "./php-security.js";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/g;
const GENERIC_EMAIL_PREFIXES = new Set(["info", "hello", "sales", "support", "admin", "office", "contact"]);
const SOCIAL_RE = /facebook\.com|instagram\.com|linkedin\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|pinterest\.com/i;

const BAD_COPY_PATTERNS = [
  [/lorem ipsum/i, 20, "Contains placeholder text"],
  [/coming soon/i, 16, "Contains 'coming soon'"],
  [/under construction/i, 16, "Contains 'under construction'"],
  [/best viewed in/i, 14, "Outdated browser-era phrasing"],
  [/click here/i, 8, "Generic CTA copy"],
  [/copyright\s+20(1[0-9]|2[0-4])/i, 8, "Old-looking copyright year"],
];

const INDUSTRY_KEYWORDS = {
  wedding: ["wedding", "bride", "groom", "venue", "planner", "photography", "florist"],
  restaurant: ["menu", "dinner", "lunch", "restaurant", "bar", "reservations", "catering"],
  medical: ["doctor", "clinic", "patient", "medical", "dental", "chiropractic", "care"],
  legal: ["attorney", "law firm", "lawyer", "legal", "practice areas"],
  real_estate: ["real estate", "homes", "property", "realtor", "listings"],
  fitness: ["gym", "fitness", "training", "workout", "wellness"],
  beauty: ["salon", "spa", "lashes", "hair", "beauty", "nails"],
  contractor: ["roofing", "plumbing", "hvac", "electrical", "remodel", "contractor"],
  church: ["church", "ministry", "worship", "sermon"],
  hotel_travel: ["hotel", "inn", "stay", "book a room", "travel", "resort"],
};

const CITY_PATTERNS = [
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s+(SC|NC|GA|FL|NY|CA|TX|VA|TN|OH|PA|MI|WA|IL|AZ)\b/,
  /\bCharleston\b/i,
  /\bMiami\b/i,
  /\bJames Island\b/i,
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function normalizeUrl(input) {
  const url = input.trim();
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function slugify(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9.-]+/g, "-");
    const path = u.pathname.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `${host}-${path}`.replace(/-+$/, "").slice(0, 120) || "site";
  } catch {
    return "site";
  }
}

function uniquePreserve(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (item && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function extractBestEmail(emails) {
  const unique = uniquePreserve(emails);
  if (!unique.length) return "";
  const rank = (email) => {
    const local = email.split("@")[0].toLowerCase();
    const generic = GENERIC_EMAIL_PREFIXES.has(local) ? 1 : 0;
    const placeholder = /example\.com|email\.com|domain\.com/i.test(email) ? 1 : 0;
    return generic + placeholder;
  };
  return unique.sort((a, b) => rank(a) - rank(b) || a.length - b.length)[0];
}

function extractBestPhone(phones) {
  return uniquePreserve(phones)[0] || "";
}

function classify(score) {
  if (score === null || score === undefined) return "Unreachable";
  if (score >= 80) return "Excellent site";
  if (score >= 60) return "Good site";
  if (score >= 30) return "Needs work";
  return "Prime lead";
}

function guessIndustry(text, title) {
  const blob = `${title}\n${text}`.toLowerCase();
  let best = "unknown";
  let bestScore = 0;
  for (const [industry, words] of Object.entries(INDUSTRY_KEYWORDS)) {
    const score = words.reduce((s, w) => s + (blob.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = industry;
    }
  }
  return best;
}

function guessCity(text) {
  for (const pat of CITY_PATTERNS) {
    const m = pat.exec(text);
    if (m) {
      if (m[1] && m[2]) return `${m[1]}, ${m[2]}`;
      return m[0];
    }
  }
  return "";
}

function businessName(desktop, url) {
  const title = (desktop.title || "").trim();
  if (title) {
    const parts = title.split(/[|\-–•:]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length && parts[0].length >= 2 && parts[0].length <= 80) return parts[0];
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const finding = [];
const CATEGORIES = ["design", "mobile", "ux", "performance", "trust", "conversion", "seo", "content", "marketing", "accessibility", "navigation", "animations", "code", "reliability", "security"];

let _browserPromise = null;
export function getBrowser() {
  if (!_browserPromise) {
    _browserPromise = chromium.launch({ headless: true });
  }
  return _browserPromise;
}

export async function closeBrowser() {
  if (_browserPromise) {
    const b = await _browserPromise;
    await b.close().catch(() => {});
    _browserPromise = null;
  }
}

export async function browserContext(opts) {
  const attempt = async () => (await getBrowser()).newContext(opts);
  try {
    return await attempt();
  } catch (err) {
    _browserPromise = null;
    await getBrowser().catch(() => {});
    _browserPromise = null;
    return await attempt();
  }
}

async function renderSite(url, timeoutMs, captureScreens = true) {
  const normalized = normalizeUrl(url);
  const slug = slugify(normalized);
  const tmpDir = mkdtempSync(join(tmpdir(), "rankr-"));
  const out = { inputUrl: url, finalUrl: "", statusCode: null, desktop: {}, mobile: {}, desktopScreenshotB64: "", mobileScreenshotB64: "" };
  const waitMs = captureScreens ? 800 : 250;

  const ctx = await browserContext({
    viewport: { width: 1440, height: 900 },
    ignore_https_errors: true,
    user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    locale: "en-US",
  });

  try {
    const page = await ctx.newPage();
    let response = null;
    try {
      response = await page.goto(normalized, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForTimeout(waitMs);
      if (captureScreens) {
        try { await page.waitForLoadState("networkidle", { timeout: 1500 }); } catch {}
      }
    } catch (e) {
      out.loadError = e.message;
    }

    out.finalUrl = page.url() || normalized;
    out.statusCode = response ? response.status() : null;
    try { out.desktop = await page.evaluate(`(${INPAGE_SCRIPT})()`); } catch { out.desktop = {}; }

    if (captureScreens) {
      const desktopShotPath = join(tmpDir, `${slug}-desktop.png`);
      await page.screenshot({ path: desktopShotPath, fullPage: true });
      out.desktopScreenshotB64 = readFileSync(desktopShotPath).toString("base64");
    }

    // Switch to mobile viewport on the same rendered page (instant, no 2nd network download)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(waitMs);
    try { out.mobile = await page.evaluate(`(${INPAGE_SCRIPT})()`); } catch { out.mobile = {}; }

    if (captureScreens) {
      const mobileShotPath = join(tmpDir, `${slug}-mobile.png`);
      await page.screenshot({ path: mobileShotPath, fullPage: true });
      out.mobileScreenshotB64 = readFileSync(mobileShotPath).toString("base64");
    }
  } finally {
    await ctx.close().catch(() => {});
  }
  return out;
}

async function probeSecurity(normalized) {
  const out = { headers: {}, wpSignals: {}, phpSignals: {}, server: "", xPowered: "", xFrameOptions: false, xXss: false, csp: false, hsts: false };
  try {
    const target = new URL(normalized);
    const origin = target.origin;
    // The built-in remediated fixture is intentionally namespaced so its probes
    // cannot bleed into the vulnerable fixture on the same demo origin.
    const probeBase = target.pathname.startsWith("/fixed") ? `${origin}/fixed` : origin;
    const probes = [
      ["origin", target.pathname.startsWith("/fixed") ? `${probeBase}/` : target.href],
      ["login", `${probeBase}/wp-login.php`],
      ["xmlrpc", `${probeBase}/xmlrpc.php`],
      ["users", `${probeBase}/wp-json/wp/v2/users`],
      ["routes", `${probeBase}/wp-json/`],
      ["debug", `${probeBase}/wp-content/debug.log`],
      ["readme", `${probeBase}/wp-content/readme.html`],
    ];
    const settled = await Promise.allSettled(probes.map(async ([k, u]) => {
      const r = await fetch(u, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: k === "users" || k === "routes" ? "application/json, text/plain, */*" : "text/html, */*",
        },
        signal: AbortSignal.timeout(2500),
      });
      const h = {};
      r.headers.forEach((v, k2) => { h[k2.toLowerCase()] = v; });
      let body = "";
      try {
        if (r.status === 200 || r.status === 405) {
          body = await r.text();
        }
      } catch {}
      return { k, status: r.status, headers: h, body: (body || "").slice(0, 4000) };
    }));
    for (const s of settled) {
      if (s.status !== "fulfilled") continue;
      const r = s.value;
      const h = r.headers;
      out.headers[r.k] = r.status;
      out.server = out.server || h.server || "";
      out.xPowered = out.xPowered || h["x-powered-by"] || "";
      if (/\bPHPSESSID=/i.test(h["set-cookie"] || "")) out.phpSignals.sessionCookie = true;
      if (/PHP\s+(?:Fatal error|Warning|Notice|Parse error)/i.test(r.body)) out.phpSignals.errorSignature = true;
      if (r.k === "origin" && /(?:href|src|action)=["'][^"']*\.php(?:[?#"'])/i.test(r.body)) out.phpSignals.contentMarker = true;
      out.xFrameOptions = out.xFrameOptions || !!h["x-frame-options"];
      out.xXss = out.xXss || !!h["x-xss-protection"];
      out.csp = out.csp || !!h["content-security-policy"];
      out.hsts = out.hsts || !!h["strict-transport-security"];

      // 1. Login open: must be HTTP 200 (NOT redirect) and contain actual WordPress login form markers
      if (r.k === "login" && r.status === 200) {
        if (
          r.body.includes('name="log"') ||
          r.body.includes('id="user_login"') ||
          r.body.includes('id="loginform"') ||
          r.body.includes("wp-submit")
        ) {
          out.wpSignals.loginOpen = true;
        }
      }

      // 2. XML-RPC open: must be 200 or 405 and contain XML-RPC server signature
      if (r.k === "xmlrpc" && (r.status === 200 || r.status === 405)) {
        if (
          r.body.includes("XML-RPC server accepts POST requests only") ||
          r.body.includes("<methodResponse>") ||
          r.body.includes("<fault>")
        ) {
          out.wpSignals.xmlrpcOpen = true;
        }
      }

      // 3. User enumeration: must be HTTP 200, JSON content-type, and return an array of user objects with real usernames
      if (r.k === "users" && r.status === 200 && (h["content-type"] || "").includes("json")) {
        try {
          const parsed = JSON.parse(r.body);
          if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && (parsed[0].slug || parsed[0].name) && !parsed.code) {
            out.wpSignals.usersOpen = true;
            out.wpSignals.usernames = parsed.slice(0, 3).map((u) => u.slug || u.name).filter(Boolean);
          }
        } catch {}
      }

      // 4. Readme: must be 200 and contain WordPress Version
      if (r.k === "readme" && r.status === 200 && r.body.includes("WordPress")) {
        out.wpSignals.readmeOpen = true;
        const v = r.body.match(/Version\s*(\d+\.\d+(?:\.\d+)?)/i);
        if (v) out.wpSignals.wpVersion = v[1];
      }

      // 5. REST Routes: must be 200, JSON, and contain routes/namespaces
      if (r.k === "routes" && r.status === 200 && (h["content-type"] || "").includes("json")) {
        try {
          const parsed = JSON.parse(r.body);
          if (parsed && (parsed.namespaces || parsed.routes)) {
            out.wpSignals.routesOpen = true;
          }
        } catch {}
      }

      // 6. Debug log: must be 200 and contain actual PHP error traces
      if (r.k === "debug" && r.status === 200) {
        if (
          r.body.includes("PHP Fatal error") ||
          r.body.includes("PHP Notice") ||
          r.body.includes("PHP Warning") ||
          /\[\d{2}-[A-Za-z]{3}-\d{4}/.test(r.body)
        ) {
          out.wpSignals.debugOpen = true;
        }
      }

      if (r.k === "origin") out.wpSignals.originStatus = r.status;
    }
  } catch {}
  return out;
}

function analyze(url, rendered, sec = {}) {
  const findings = [];
  const add = (category, points, message) => findings.push({ category, points, message });

  const finalUrl = rendered.finalUrl || normalizeUrl(url);
  const status = rendered.statusCode;
  const desktop = rendered.desktop || {};
  const mobile = rendered.mobile || {};
  const text = desktop.textSample || "";

  if (status !== null && status >= 500) add("reliability", 40, `Server error: HTTP ${status}`);
  else if (status !== null && status >= 400) add("reliability", 30, `Client error: HTTP ${status}`);
  if (finalUrl.startsWith("http://")) add("security", 25, "Site does not use HTTPS");

  if (!desktop.title) add("seo", 12, "Missing page title");
  else if (String(desktop.title).length < 10) add("seo", 6, "Very short page title");
  if (desktop.descMissing) add("seo", 10, "Missing meta description");

  const h1 = Number(desktop.h1Count) || 0;
  if (h1 === 0) add("content", 8, "Missing H1 heading");
  else if (h1 > 1) add("content", 4, "Multiple H1 headings");

  const bodyLen = Number(desktop.bodyTextLength) || 0;
  if (bodyLen > 0 && bodyLen < 250) add("content", 8, "Very little readable text on the page");
  else if (bodyLen < 700) add("content", 4, "Low amount of readable content");

  for (const [pattern, points, message] of BAD_COPY_PATTERNS) {
    if (pattern.test(text)) add("content", points, message);
  }

  const emails = desktop.emails || [];
  const phones = desktop.phones || [];
  const email = extractBestEmail([...emails, ...(text.match(EMAIL_RE) || [])]);
  const phone = extractBestPhone([...phones, ...(text.match(PHONE_RE) || [])]);

  if (!email && !phone) add("trust", 14, "No obvious email or phone found");
  else if (!email) add("trust", 8, "No obvious email found");
  else if (!phone) add("trust", 6, "No obvious phone found");

  if ((desktop.socialLinks || 0) === 0) add("marketing", 4, "No social profile links found");

  const probeOk = typeof sec.headers.origin === "number";
  const desktopCms = String(desktop.cmsName || "");
  const wpByProbe = Boolean(sec.wpSignals && (sec.wpSignals.xmlrpcOpen || sec.wpSignals.readmeOpen || sec.wpSignals.loginOpen || sec.wpSignals.usersOpen));
  const cms = desktopCms || (wpByProbe ? "wordpress" : "");
  const cmsGenerator = String(desktop.cmsGenerator || "").trim();
  const cmsVersion = cmsGenerator.match(/wordpress\s*(\d[\d.]*)|drupal\s*(\d[\d.]*)|joomla!?\s*(\d[\d.]*)/i)?.[0]?.match(/\d[\d.]*/)?.[0] || (sec.wpSignals && sec.wpSignals.wpVersion) || "";
  const phpDetection = detectPhpRuntime(sec, finalUrl);

  if (cms === "wordpress") {
    if (sec.wpSignals.loginOpen) add("security", 14, "WordPress login exposed at /wp-login.php");
    if (sec.wpSignals.xmlrpcOpen) add("security", 12, "/xmlrpc.php is open — a known WordPress brute-force & DDoS vector");
    if (sec.wpSignals.usersOpen) add("security", 20, "/wp-json/wp/v2/users exposes admin usernames for brute-forcing");
    if (sec.wpSignals.readmeOpen) add("security", 8, `readme.html discloses the WordPress version${cmsVersion ? ` (${cmsVersion})` : ""}`);
  }
  if (probeOk) {
    if (sec.server) add("security", 3, `Web server reveals its identity (${sec.server})`);
    if (sec.xPowered) add("security", 4, `Stack disclosed via headers (${sec.xPowered})`);
    if (!sec.xFrameOptions) add("security", 8, "Missing X-Frame-Options / CSP frame-ancestors header (clickjacking risk)");
    if (!sec.csp) add("security", 5, "Missing Content-Security-Policy header");
    if (!sec.hsts) add("security", 5, "Missing Strict-Transport-Security (HSTS) header");
  }

  const hackRisk = (() => {
    if (/^http:/.test(finalUrl)) return { level: "high", factors: ["served over plain HTTP"], cms, cmsVersion };
    if (sec.wpSignals.usersOpen) return { level: "high", factors: ["admin user enumeration open"], cms, cmsVersion };
    if (sec.wpSignals.xmlrpcOpen && sec.wpSignals.loginOpen) return { level: "high", factors: ["xmlrpc + login exposed"], cms, cmsVersion };
    if (cms === "wordpress") return { level: "medium", factors: ["WordPress attack surface"], cms, cmsVersion };
    if (probeOk && (!sec.xFrameOptions || !sec.csp)) return { level: "medium", factors: ["missing security headers"], cms, cmsVersion };
    return { level: "low", factors: ["no common exposures detected"], cms, cmsVersion };
  })();

  if (!desktop.viewportContent) add("mobile", 18, "Missing mobile viewport meta tag");
  else if (!desktop.hasResponsiveViewport) add("mobile", 10, "Viewport may not be configured for responsive mobile width");
  if (desktop.zoomRestricted) add("accessibility", 8, "Viewport appears to restrict pinch zoom");

  if (mobile.horizontalOverflow) add("mobile", mobile.overflowAmount > 80 ? 18 : 12, `Mobile layout has horizontal overflow (${mobile.overflowAmount}px)`);
  const offscreenM = Number(mobile.offscreenElements) || 0;
  if (offscreenM >= 5) add("mobile", 16, `Multiple elements appear off-screen on mobile (${offscreenM})`);
  else if (offscreenM >= 2) add("mobile", 8, `Some elements appear off-screen on mobile (${offscreenM})`);

  if ((mobile.largeFixedWidthSignals || 0) >= 20) add("mobile", 12, "Multiple large fixed-width elements detected");
  if ((desktop.tableCount || 0) >= 8) add("mobile", 10, `Heavy table usage can hurt mobile layout (${desktop.tableCount} tables)`);
  if ((mobile.smallFontBlocks || 0) >= 15) add("mobile", 10, `Several mobile text blocks look too small (${mobile.smallFontBlocks})`);
  if (mobile.mobileMenuBroken) add("mobile", 14, "Mobile navigation toggle appears broken or ineffective");

  const tinyButtons = Number(mobile.tinyButtons) || 0;
  if (tinyButtons >= 8) add("ui_ux", 10, `Several tap targets are too small on mobile (${tinyButtons})`);
  else if (tinyButtons > 0) add("ui_ux", 4, `Some tap targets are too small on mobile (${tinyButtons})`);
  if ((mobile.closeButtons || 0) >= 2) add("ui_ux", 8, "Buttons or links appear too close together on mobile");

  const overlaps = Number(mobile.overlappingPairs) || 0;
  if (overlaps >= 6) add("ui_ux", 16, `Layout overlap signals detected on mobile (${overlaps})`);
  else if (overlaps >= 2) add("ui_ux", 7, `Minor overlap signals detected on mobile (${overlaps})`);
  if ((mobile.clippedTextBlocks || 0) >= 2) add("ui_ux", 12, `Text appears clipped or cut off (${mobile.clippedTextBlocks})`);

  if (desktop.heroMissingCTA) add("conversion", 12, "No clear call-to-action above the fold");

  const internalLinks = Number(desktop.internalLinksGuess) || 0;
  if (internalLinks <= 2) add("navigation", 10, "Very few internal links");
  else if (internalLinks <= 5) add("navigation", 4, "Low internal link count");

  const placeholderLinks = Number(desktop.placeholderLinks) || 0;
  if (placeholderLinks >= 3) add("navigation", 12, `${placeholderLinks} placeholder or dead-style links found`);
  else if (placeholderLinks > 0) add("navigation", 5, `${placeholderLinks} placeholder link(s) found`);

  if (desktop.navLinkCount && desktop.navLinkCount <= 2) add("navigation", 6, "Navigation appears very thin");
  if (desktop.longForm) add("ui_ux", 6, "Long form may create friction");

  const genericCtas = Number(desktop.genericCtas) || 0;
  if (genericCtas >= 2) add("ui_ux", 8, `Several generic CTA labels found (${genericCtas})`);

  const fontVariety = Number(desktop.fontSizeVariety) || 0;
  if (fontVariety >= 10) add("design", 10, `High font-size inconsistency detected (${fontVariety} sizes)`);
  else if (fontVariety >= 7) add("design", 5, `Moderate font-size inconsistency detected (${fontVariety} sizes)`);

  const colorVariety = Number(desktop.colorVariety) || 0;
  if (colorVariety >= 20) add("design", 8, `Very high color variety detected (${colorVariety} colors)`);
  else if (colorVariety >= 12) add("design", 4, `High color variety detected (${colorVariety} colors)`);

  const imgsMissingAlt = Number(desktop.imgsMissingAlt) || 0;
  const imagesCount = Number(desktop.imagesCount) || 0;
  if (imagesCount >= 3) {
    const ratio = imgsMissingAlt / imagesCount;
    if (ratio >= 0.7) add("accessibility", 10, `Most images missing alt text (${imgsMissingAlt}/${imagesCount})`);
    else if (ratio >= 0.3) add("accessibility", 5, `Several images missing alt text (${imgsMissingAlt}/${imagesCount})`);
  }

  const unlabeled = Number(desktop.unlabeledClickables) || 0;
  if (unlabeled >= 2) add("accessibility", 8, `Clickable elements without clear labels found (${unlabeled})`);

  if ((desktop.marqueeCount || 0) > 0) add("animations", 18, "Uses outdated marquee/blink animation tags");
  const infinite = Number(desktop.infiniteAnimations) || 0;
  if (infinite >= 3) add("animations", 10, `Several infinite animation signals found (${infinite})`);
  if ((desktop.transitions || 0) >= 40) add("animations", 8, "Heavy animation / transition usage detected");
  if ((desktop.autoplayMedia || 0) >= 1) add("ui_ux", 12, "Autoplay media detected");

  if ((desktop.frameCount || 0) > 0) add("ui_ux", 18, "Uses old frame-based layout");
  if ((desktop.inlineStyleCount || 0) >= 20) add("code", 8, `Heavy inline styling (${desktop.inlineStyleCount} elements)`);
  if ((desktop.scriptCount || 0) > 25) add("performance", 6, `High script count (${desktop.scriptCount})`);

  const htmlKb = (Number(desktop.htmlBytes) || 0) / 1024;
  if (htmlKb > 1000) add("performance", 12, `Very large rendered HTML document (${htmlKb.toFixed(0)} KB)`);
  else if (htmlKb > 400) add("performance", 6, `Large rendered HTML document (${htmlKb.toFixed(0)} KB)`);

  const loadMs = desktop.loadMs;
  const fcp = desktop.fcp;
  const dcl = desktop.domContentLoadedMs;
  if (loadMs !== null && Number(loadMs) > 6000) add("performance", 10, `Slow load event (${Number(loadMs).toFixed(0)} ms)`);
  else if (loadMs !== null && Number(loadMs) > 3500) add("performance", 5, `Moderate load delay (${Number(loadMs).toFixed(0)} ms)`);
  if (fcp !== null && Number(fcp) > 3000) add("performance", 8, `Slow first contentful paint (${Number(fcp).toFixed(0)} ms)`);
  if (dcl !== null && Number(dcl) > 4000) add("performance", 6, `Late DOM ready timing (${Number(dcl).toFixed(0)} ms)`);

  const popupDetected = Boolean(desktop.popupDetected) || Boolean(mobile.popupDetected);
  if (popupDetected) add("ui_ux", 10, "Popup or overlay detected early on page");
  if ((mobile.topFixed || 0) + (mobile.bottomFixed || 0) >= 2) add("ui_ux", 8, "Multiple fixed bars may crowd the mobile viewport");
  if (mobile.chatWidgetDetected && (mobile.heroMissingCTA || tinyButtons > 0)) add("ui_ux", 6, "Chat widget may compete with key calls-to-action");

  if (!desktop.reviewsSignals) add("conversion", 4, "No obvious review or testimonial signal found");
  if (!desktop.hoursSignals && !desktop.addressSignals) add("trust", 4, "No obvious hours or address signal found");

  const hasContactPage = Boolean(desktop.contactPage);
  const hasContactForm = Boolean(desktop.contactForm);
  const socialLinksCount = Number(desktop.socialLinks) || 0;

  const pointsFor = (...cats) => findings.filter((f) => cats.includes(f.category)).reduce((s, f) => s + f.points, 0);

  const design_score = Math.min(100, pointsFor("design", "content", "seo"));
  const mobile_score = Math.min(100, pointsFor("mobile"));
  const ux_score = Math.min(100, pointsFor("ui_ux", "navigation", "animations", "accessibility"));
  const performance_score = Math.min(100, pointsFor("performance"));
  const trust_score = Math.min(100, pointsFor("trust"));
  const conversion_score = Math.min(100, pointsFor("conversion", "marketing"));
  const security_score = Math.min(100, pointsFor("security"));

  const raw_score = Math.min(100, findings.reduce((s, f) => s + f.points, 0));

  const weighted = design_score * 0.18 + mobile_score * 0.22 + ux_score * 0.22 + performance_score * 0.08 + trust_score * 0.05 + conversion_score * 0.1 + security_score * 0.15;
  const weighted_score = Math.round(clamp(weighted, 0, 100));

  let lead_boost = 0;
  if (mobile_score >= 15) lead_boost += 12;
  if (ux_score >= 15) lead_boost += 12;
  if (design_score >= 15) lead_boost += 8;
  if (status !== null && status >= 400) lead_boost += 15;
  if (finalUrl.startsWith("http://")) lead_boost += 10;
  if (!email && !phone) lead_boost += 8;
  if (desktop.heroMissingCTA) lead_boost += 8;
  if (mobile.horizontalOverflow) lead_boost += 12;
  if (popupDetected) lead_boost += 8;
  lead_boost += hasContactPage || hasContactForm ? 0 : 4;

  const severity =
      (mobile_score >= 70 ? 25 : mobile_score >= 45 ? 15 : mobile_score >= 25 ? 7 : 0) +
      (ux_score >= 60 ? 15 : ux_score >= 40 ? 9 : ux_score >= 22 ? 4 : 0);

  const problemScore = Math.round(clamp(
    Math.round(weighted_score * 0.7) + severity + (raw_score > 85 ? 8 : raw_score > 65 ? 3 : 0),
    0, 100
  ));
  const finalScore = Math.round(clamp(100 - problemScore, 0, 100));

  const scoreFor = (p) => Math.round(clamp(100 - p, 0, 100));

  let recommended = false;
  const reasons = [];
  if (finalScore <= 30) { recommended = true; reasons.push("weak site, needs a rebuild"); }
  if (mobile_score >= 20 || ux_score >= 24) { recommended = true; reasons.push("clear UI/UX problems"); }
  if (status !== null && status >= 400) { recommended = true; reasons.push("site reliability issue"); }
  if (finalUrl.startsWith("http://")) reasons.push("no HTTPS");
  if (popupDetected) reasons.push("popup friction");
  if (!email && !phone) reasons.push("no visible contact info");
  reasons.push(hasContactPage || hasContactForm ? "contact path exists" : "weak lead-access path");
  const recommendation_reason = reasons.slice(0, 4).join(", ") || "manual review";

  const sorted = [...findings].sort((a, b) => b.points - a.points);
  const topMessages = sorted.slice(0, 4).map((f) => f.message);
  const ui_summary = topMessages.slice(0, 3).join("; ") || "No major obvious issues found";

  let pitch_angle;
  if (mobile_score >= Math.max(ux_score, design_score)) pitch_angle = "mobile usability and conversion improvements";
  else if (ux_score >= Math.max(mobile_score, design_score)) pitch_angle = "cleaner UX and stronger calls-to-action";
  else if (performance_score >= 12) pitch_angle = "speed and perceived performance improvements";
  else pitch_angle = "modern redesign and trust-building improvements";

  let fix_suggestion;
  if (mobile.horizontalOverflow || offscreenM >= 2) fix_suggestion = "Rebuild the layout mobile-first to eliminate overflow, cramped spacing, and off-screen elements.";
  else if (popupDetected) fix_suggestion = "Reduce early-page interruptions and simplify the first-screen experience so users can act faster.";
  else if (desktop.heroMissingCTA) fix_suggestion = "Add a clear above-the-fold value proposition with one strong call-to-action.";
  else fix_suggestion = "Tighten layout consistency, simplify navigation, and improve trust and conversion signals.";

  const why_it_scored_high = topMessages.join("; ") || "Manual review suggested";

  const issueCount = findings.length;
  let confidence_score = 40;
  if (issueCount >= 8) confidence_score += 20;
  else if (issueCount >= 5) confidence_score += 10;
  if (offscreenM >= 2 || mobile.horizontalOverflow) confidence_score += 15;
  if (popupDetected) confidence_score += 8;
  if (status !== null) confidence_score += 5;
  confidence_score = Math.min(100, confidence_score);

  const industry_guess = guessIndustry(text, desktop.title || "");
  const city_guess = guessCity(text);

  return {
    inputUrl: url,
    finalUrl,
    url,
    domain: (() => { try { return new URL(finalUrl).hostname; } catch { return finalUrl; } })(),
    statusCode: status,
    title: desktop.title || "",
    businessName: businessName(desktop, finalUrl),
    email,
    phone,
    hasContactPage,
    hasContactForm,
    socialLinksCount,
    popupDetected,
    desktopScreenshotB64: rendered.desktopScreenshotB64,
    mobileScreenshotB64: rendered.mobileScreenshotB64,
    industryGuess: industry_guess,
    cityGuess: city_guess,
    uiSummary: ui_summary,
    pitchAngle: pitch_angle,
    fixSuggestion: fix_suggestion,
    whyItScoredHigh: why_it_scored_high,
    confidenceScore: confidence_score,
    issuesFoundCount: issueCount,
    analysisMode: "browser_rendered",
    scores: { design: scoreFor(design_score), mobile: scoreFor(mobile_score), ux: scoreFor(ux_score), performance: scoreFor(performance_score), trust: scoreFor(trust_score), conversion: scoreFor(conversion_score), security: scoreFor(security_score) },
    cms,
    cmsVersion,
    phpDetection,
    hackRisk,
    rawScore: raw_score,
    weightedScore: weighted_score,
    leadBoost: lead_boost,
    score: finalScore,
    verdict: classify(finalScore),
    recommended,
    recommendationReason: recommendation_reason,
    findings,
    checkedAt: new Date().toISOString(),
  };
}

export async function renderPreview(url) {
  try {
    const r = await renderSite(url, 20000, true);
    return {
      finalUrl: r.finalUrl,
      title: (r.desktop && r.desktop.title) || (r.mobile && r.mobile.title) || "",
      desktopScreenshotB64: r.desktopScreenshotB64,
      mobileScreenshotB64: r.mobileScreenshotB64,
    };
  } catch (err) {
    throw new Error(String(err.message || err));
  }
}

export async function auditWebsite(url, options = {}) {
  try {
    const normalized = normalizeUrl(url);
    const [rendered, sec] = await Promise.all([
      renderSite(url, options.timeoutMs || 15000, options.captureScreens !== false),
      probeSecurity(normalized),
    ]);
    const audit = analyze(url, rendered, sec);
    audit.phpSecurity = await assessPhpSecurity(audit.phpDetection, options.phpSecurityOptions || {});
    return audit;
  } catch (err) {
    return {
      renderFailed: true,
      inputUrl: url,
      finalUrl: "",
      url,
      domain: "",
      statusCode: null,
      title: "",
      businessName: (() => { try { return new URL(normalizeUrl(url)).hostname.replace(/^www\./, ""); } catch { return url; } })(),
      email: "",
      phone: "",
      hasContactPage: false,
      hasContactForm: false,
      socialLinksCount: 0,
      popupDetected: false,
      desktopScreenshotB64: "",
      mobileScreenshotB64: "",
      industryGuess: "unknown",
      cityGuess: "",
      uiSummary: "Could not render site",
      pitchAngle: "site reliability and accessibility fix",
      fixSuggestion: "Verify the site can load consistently, then review the front-end experience.",
      whyItScoredHigh: "Could not render site",
      confidenceScore: 85,
      issuesFoundCount: 1,
      analysisMode: "browser_rendered",
      scores: { design: 0, mobile: 0, ux: 0, performance: 0, trust: 0, conversion: 0, security: 0 },
      cms: "",
      cmsVersion: "",
      phpDetection: { detected: false, version: "", confidence: "low", evidence: [] },
      phpSecurity: { runtime: "php", detected: false, status: "no_evidence", advisories: [], advisoryCount: 0, note: "No reliable PHP evidence was observed." },
      hackRisk: { level: "n/a", factors: [], cms: "", cmsVersion: "" },
      rawScore: 0,
      weightedScore: 0,
      leadBoost: 0,
      score: null,
      verdict: "Unreachable",
      recommended: false,
      recommendationReason: `Could not render site: ${err.message}`,
      findings: [{ category: "access", points: 80, message: `Could not render site: ${err.message}` }],
      checkedAt: new Date().toISOString(),
    };
  }
}