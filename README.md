# Rankr

Website auditor + US-wide local-business lead hunter. Renders any site in a real
browser twice (desktop + mobile), scores it 0–100, finds the business owner, and
drafts outreach pitched at exactly what's wrong with their site.

The premise: a bad website is a sales lead. A dentist whose site is broken on
mobile, serves over plain HTTP, and has no contact form is a dentist who needs
you — and Rankr finds them, proves it, and writes the email.

---

## Live deployment

The current public deployment is available at `http://74.208.115.187:3212`.

| Site or endpoint | Public URL |
|---|---|
| Rankr application | [http://74.208.115.187:3212/](http://74.208.115.187:3212/) |
| Guided security demo | [http://74.208.115.187:3212/demo/](http://74.208.115.187:3212/demo/) |
| Vulnerable PrimeRoof fixture | [http://74.208.115.187:3212/demo/hacked.html](http://74.208.115.187:3212/demo/hacked.html) |
| Safe exposure walkthrough | [http://74.208.115.187:3212/demo/hackplay.html](http://74.208.115.187:3212/demo/hackplay.html) |
| Hardened comparison fixture | [http://74.208.115.187:3212/fixed/](http://74.208.115.187:3212/fixed/) |
| Synthetic WordPress-style login | [http://74.208.115.187:3212/wp-login.php](http://74.208.115.187:3212/wp-login.php) |
| WordPress version disclosure | [http://74.208.115.187:3212/readme.html](http://74.208.115.187:3212/readme.html) |
| Exposed REST route index | [http://74.208.115.187:3212/wp-json/](http://74.208.115.187:3212/wp-json/) |
| Synthetic user enumeration | [http://74.208.115.187:3212/wp-json/wp/v2/users](http://74.208.115.187:3212/wp-json/wp/v2/users) |
| Synthetic debug-log disclosure | [http://74.208.115.187:3212/wp-content/debug.log](http://74.208.115.187:3212/wp-content/debug.log) |
| XML-RPC fixture | [http://74.208.115.187:3212/xmlrpc.php](http://74.208.115.187:3212/xmlrpc.php) |
| API health check | [http://74.208.115.187:3212/api/health](http://74.208.115.187:3212/api/health) |

The login fixture accepts the synthetic credentials `admin` / `letmein123`.
It creates only a fake demo session; no real WordPress installation, customer
data, shell, database, or writable filesystem is attached.

> The deployment currently uses plain HTTP. Do not enter real credentials or
> sensitive data. Only scan systems you own or have permission to test.

---

## Quick start

Two servers, run them in separate terminals.

```bash
# 1. Backend (Express + Playwright) — port 3002
cd backend
npm install
npx playwright install chromium   # required once, downloads the browser
npm start

# 2. Frontend (Vite + React) — port 5174
cd frontend
npm install
npm run dev
```

Open http://localhost:5174. The Vite dev server proxies `/api` to
`http://localhost:3002`, so there is nothing else to configure.

Build the frontend for production with `npm run build` (output in `dist/`).

### Requirements

- Node 18+ (developed on 26.8.1)
- Playwright's Chromium — `npx playwright install chromium`

---

## What it does

### Score a single site

Enter any URL. Rankr loads it in headless Chromium, then:

1. Renders at **1440×900 desktop**, screenshots it
2. Re-renders the same page at **390×844 mobile**, screenshots it
3. Runs an in-page script (`inpage.js`) to extract viewport meta, tap target
   sizes, fixed/sticky bars, horizontal overflow, CTA presence, hero copy,
   image counts, font and framework fingerprints, popups, social links
4. Probes for CMS fingerprints, security headers, exposed login and XML-RPC
   endpoints, and known CVEs for the detected version
5. Scores seven categories, then combines them into one 0–100 number

### The score

Seven sub-scores, each 0–100:

| Category | Weight | Looks at |
|---|---|---|
| Design | 0.18 | Layout, visual polish, image quality |
| Mobile | 0.22 | Viewport meta, tap targets, overflow, fixed bars |
| UX | 0.22 | Navigation depth, CTA presence, friction |
| Performance | 0.08 | Asset weight, request count, render blocking |
| Trust | 0.05 | Contact info, social proof, business details |
| Conversion | 0.10 | Forms, phone/email visibility, popups |
| Security | 0.15 | HTTPS, headers, CMS exposure, CVEs |

The weighted score alone flatters weak sites, so the final number is
deliberately harsher:

```
problemScore = (weighted × 0.7) + severity + findingPressure
finalScore   = 100 - problemScore
```

`severity` adds up to 40 points on top, driven by the mobile and UX sub-scores —
a site that renders fine on a laptop and falls apart on a phone gets punished
hard. That's the whole point: most small businesses have a desktop-only site
and don't know it.

Verdicts: **Prime lead** (0–29), **Needs work** (30–59), **Good site** (60–79),
**Excellent site** (80+), **Unreachable**.

A `confidenceScore` (40–100) reports how much signal the crawl actually got.
A site that timed out early and returned no findings is not a clean bill of
health — it's an incomplete read, and the score says so.

### Hunt for leads

Pick a trade, a city, and a state — or paste a list (`dentist, plumber`,
`charleston, columbia`, `sc` or `*` for all states). Rankr:

- Expands the trade into synonyms (`roofing` → roofer, roof repair, roofing
  contractor, …)
- Runs the resulting queries across Google, DuckDuckGo, Bing, and Brave
  in parallel
- Dedupes by hostname, drops directories and social links
- Audits each surviving site concurrently (up to 10 at once)
- Sorts worst-first, because worst sites are the leads

Results are filterable and exportable as CSV, with a one-click push into a CRM.

### Owner lookup and outreach

For a chosen lead, `contact.js` reads the site's own pages for a person — not
just an address — pulling emails and phone numbers, discarding role addresses
(`info@`, `contact@`) and registrar privacy proxies, and matching names against
page titles to guess who the owner is. WHOIS fills in registrant details when
the site doesn't publish them.

`message.js` then drafts the outreach from the audit itself. It reads the real
findings and writes about them — including, when a site has known exploitable
CVEs, a plain-language note on what an attacker could actually do with it
(credential brute-force, admin enumeration, clickjacking, and so on). Three
randomized variants so you're not sending identical mail all day.

---

## API

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness check |
| `POST` | `/api/audit` | Audit one URL, returns full JSON + screenshots |
| `POST` | `/api/render` | Screenshots only (desktop + mobile), no scoring |
| `POST` | `/api/search` | Single query across all engines |
| `POST` | `/api/hunt` | Full pipeline: query → search → audit → scored leads |
| `POST` | `/api/leads` | Generate synthetic outreach leads from an audit |
| `POST` | `/api/owner` | Find a human owner at a domain |
| `POST` | `/api/message` | Draft a personalized outreach message |
| `GET` | `/api/crm/status` | Check whether the CRM is reachable |
| `POST` | `/api/crm/push` | Push a lead to the CRM as company + contact |
| `POST` | `/api/crm/ignore` | Log a lead as junk in the CRM's Ignored tab |

```bash
curl -X POST localhost:3002/api/audit \
  -H 'content-type: application/json' \
  -d '{"url":"example.com"}'
```

The hunt endpoint takes `{ what, city, state, count, engine }` where each of
`what`/`city`/`state` accepts a comma-separated list and `"*"` means "all".

---

## CRM integration

Optional. Rankr pushes leads to a local CRM on `http://localhost:3001`
(`/api/companies`, `/api/contacts`, `/api/ignored`), with its UI on
`http://localhost:5173`. Point it elsewhere with a `crmUrl` field in the
request body.

CRM state in the UI — added and ignored domains — lives in `localStorage`, so it
survives reloads but is per-browser.

---

## Demo: vulnerable and hardened fixtures

The backend serves a deliberately broken WordPress-looking business site so you
can exercise the scanner without touching anyone else's website.

| Public URL | What it demonstrates |
|---|---|
| [Guided demo](http://74.208.115.187:3212/demo/) | Guided audit, evidence, simulation, and comparison flow |
| [Vulnerable fixture](http://74.208.115.187:3212/demo/hacked.html) | Fictional business with observable WordPress-style exposures |
| [Safe walkthrough](http://74.208.115.187:3212/demo/hackplay.html) | Evidence-based `PASSED`, `FAILED`, and `SIMULATED` outcomes |
| [Hardened fixture](http://74.208.115.187:3212/fixed/) | Same fictional business with application controls enabled |
| [Version disclosure](http://74.208.115.187:3212/readme.html) | Synthetic WordPress version disclosure (`5.8.3`) |
| [Login fixture](http://74.208.115.187:3212/wp-login.php) | Weak synthetic credentials with no rate limiting or 2FA |
| [XML-RPC fixture](http://74.208.115.187:3212/xmlrpc.php) | Open XML-RPC method discovery and pingback signal |
| [User enumeration](http://74.208.115.187:3212/wp-json/wp/v2/users) | Unauthenticated synthetic user list |
| [Debug log](http://74.208.115.187:3212/wp-content/debug.log) | Synthetic PHP errors leaking example server paths |

The mock login accepts `admin` / `letmein123`. It grants a fake session cookie
and nothing else — there is no real WordPress behind it, no shell, no file
system access. It's a scanner target, not a working exploit.

Audit it against yourself:

```bash
curl -X POST localhost:3002/api/audit -H 'content-type: application/json' \
  -d '{"url":"http://localhost:3002/demo/hacked.html"}'
```

---

## Project layout

```
backend/
  src/
    index.js     Express app, all routes, the hunt pipeline, demo site
    audit.js     Playwright crawl, in-page analysis, scoring, CMS/CVE detection
    inpage.js    Script injected into the page to collect DOM signals
    search.js    Multi-engine search (Google, DDG, Bing, Brave) + result filtering
    contact.js   Owner/email/phone extraction, WHOIS
    message.js   Outreach message drafting
    leads.js     Synthetic lead generation with per-category pain points
    cves.js      WordPress CVE table and version matching
  dbg-uitest.mjs Debug harness for the in-page script
frontend/
  src/
    App.jsx             Both tabs, all panels, CSV export, CRM actions
    components/
      ScoreGauge.jsx    SVG radial score gauge
demo/            Insecure WordPress fixture + writeup
```

---

## Notes and limits

- **Scraping.** Search results are parsed by HTML selector. Engines change their
  markup regularly; expect breakage. There is no API key and no rate limiting
  beyond concurrency caps.
- **Owner lookup is a guess.** It reads what the site publishes. If nobody is
  listed, you get nothing. Names and roles are inferred, not verified — don't
  put a wrong name in an email.
- **Scores are opinionated, not a standard.** The weights and the severity
  penalty are tuned to find weak small-business sites. They are not a
  Lighthouse score and shouldn't be presented to a client as one.
- **CVE matching is version-string based.** A site reporting an old WP version
  is flagged whether or not it's actually exploitable. It's a lead signal.
- **Playwright's Chromium is shared and reused** across audits via a cached
  browser instance, with a fresh context per request.

---

## Intended use

Auditing and scoring websites, finding business contact details, and writing
outreach. The security features exist to identify sites that need help and to
tell a prospect honestly what they're exposed to.

Don't use this to break into anything, and don't point the scanner at
infrastructure you don't own or have permission to test.
