import { useState, useEffect } from "react";
import ScoreGauge from "./components/ScoreGauge.jsx";

const CATEGORY_LABELS = {
  design: "Design",
  mobile: "Mobile",
  ux: "UX",
  performance: "Performance",
  trust: "Trust",
  conversion: "Conversion",
  security: "Security",
};

const VERDICT_COLORS = {
  "Excellent site": "#16a34a",
  "Good site": "#22c55e",
  "Needs work": "#d97706",
  "Prime lead": "#e11d48",
  "Unreachable": "#6b7280",
};

const STATE_NAMES = [
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy",
];

const EXAMPLE_HUNTS = [
  { label: "🦷 Dentist", what: "dentist", city: "charleston", state: "sc" },
  { label: "🔧 Mechanic", what: "mechanic auto repair", city: "austin", state: "tx" },
  { label: "💧 Plumber", what: "plumber", city: "phoenix", state: "az" },
  { label: "🏠 Roofer", what: "roofing company", city: "miami", state: "fl" },
  { label: "✂️ Hair salon", what: "hair salon", city: "boise", state: "id" },
  { label: "⚖️ Lawyer", what: "dUI lawyer", city: "denver", state: "co" },
];

export default function App() {
  const [tab, setTab] = useState("hunt");
  const [url, setUrl] = useState("");
  const [yourName, setYourName] = useState(() => localStorage.getItem("rankrName") || "Your Web Studio");
  const [yourPhone, setYourPhone] = useState(() => localStorage.getItem("rankrPhone") || "");
  const [state, setState] = useState("idle");
  const [audit, setAudit] = useState(null);
  const [leadsData, setLeadsData] = useState(null);
  const [chat, setChat] = useState(null);
  const [error, setError] = useState("");

  const [hunt, setHunt] = useState({ what: "dentist", city: "charleston", state: "sc", count: 20, engine: "all" });
  const [huntState, setHuntState] = useState("idle"); // idle | running | done
  const [huntResult, setHuntResult] = useState(null);
  const [huntError, setHuntError] = useState("");
  const [focused, setFocused] = useState(null); // drill-down lead detail

  const [crmAdded, setCrmAdded] = useState(() => {
    try { return JSON.parse(localStorage.getItem("rankr_crm_added") || "{}"); } catch { return {}; }
  });
  const [crmLoading, setCrmLoading] = useState({});
  const [bulkCrmLoading, setBulkCrmLoading] = useState(false);
  const [crmToast, setCrmToast] = useState(null);

  const [ignoredDomains, setIgnoredDomains] = useState(() => {
    try { return JSON.parse(localStorage.getItem("rankr_ignored_domains") || "{}"); } catch { return {}; }
  });
  const [ignoring, setIgnoring] = useState({});

  useEffect(() => {
    const target = new URLSearchParams(location.search).get("auditTarget");
    if (!target) return;
    const absolute = target.startsWith("/") ? `${location.origin}${target}` : target;
    setTab("audit");
    setUrl(absolute);
    history.replaceState(null, "", location.pathname);
  }, []);

  const ignoreLead = async (lead, reason = "Directory / Waste of Link") => {
    const key = lead.domain || lead.url;
    setIgnoring((p) => ({ ...p, [key]: true }));
    try {
      const res = await fetch("/api/crm/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to ignore lead");
      const next = { ...ignoredDomains, [key]: { at: new Date().toLocaleTimeString(), reason } };
      setIgnoredDomains(next);
      localStorage.setItem("rankr_ignored_domains", JSON.stringify(next));
      setCrmToast({ type: "success", text: `🚫 Ignored "${lead.businessName || lead.domain}" (Saved to CRM Ignored tab)!`, link: "http://localhost:5173/ignored" });
      setTimeout(() => setCrmToast(null), 5000);
    } catch (err) {
      setCrmToast({ type: "error", text: `Ignore error: ${err.message}` });
      setTimeout(() => setCrmToast(null), 7000);
    } finally {
      setIgnoring((p) => ({ ...p, [key]: false }));
    }
  };

  const unignoreLead = (lead) => {
    const key = lead.domain || lead.url;
    const next = { ...ignoredDomains };
    delete next[key];
    setIgnoredDomains(next);
    localStorage.setItem("rankr_ignored_domains", JSON.stringify(next));
  };

  const pushToCrm = async (lead) => {
    const key = lead.domain || lead.url;
    setCrmLoading((p) => ({ ...p, [key]: true }));
    try {
      const res = await fetch("/api/crm/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add lead to CRM");
      const next = { ...crmAdded, [key]: { at: new Date().toLocaleTimeString(), companyId: data.companyId } };
      setCrmAdded(next);
      localStorage.setItem("rankr_crm_added", JSON.stringify(next));
      setCrmToast({ type: "success", text: `✓ Added "${lead.businessName || lead.domain}" to your CRM!`, link: "http://localhost:5173" });
      setTimeout(() => setCrmToast(null), 5000);
    } catch (err) {
      setCrmToast({ type: "error", text: `CRM Error: ${err.message}` });
      setTimeout(() => setCrmToast(null), 7000);
    } finally {
      setCrmLoading((p) => ({ ...p, [key]: false }));
    }
  };

  const pushAllToCrm = async (leads) => {
    if (!Array.isArray(leads) || !leads.length) return;
    setBulkCrmLoading(true);
    let count = 0;
    for (const l of leads) {
      const key = l.domain || l.url;
      if (!crmAdded[key]) {
        try {
          await pushToCrm(l);
          count++;
        } catch {}
      }
    }
    setBulkCrmLoading(false);
    setCrmToast({ type: "success", text: `✓ Finished adding ${count} new leads to your CRM!`, link: "http://localhost:5173" });
    setTimeout(() => setCrmToast(null), 6000);
  };

  const runHunt = async (e) => {
    e && e.preventDefault();
    setHuntState("running");
    setHuntError("");
    setHuntResult(null);
    setFocused(null);
    try {
      const res = await fetch("/api/hunt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ what: hunt.what, city: hunt.city, state: hunt.state, count: hunt.count, workers: 4, engine: hunt.engine }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Hunt failed");
      setHuntResult(data);
      setHuntState("done");
    } catch (err) {
      setHuntError(err.message);
      setHuntState("idle");
    }
  };

  const loadLeadDetail = async (l) => {
    const detail = {
      source: "hunt-cache",
      inputUrl: l.url,
      finalUrl: l.url,
      url: l.url,
      domain: l.domain,
      statusCode: 200,
      title: l.title,
      businessName: l.businessName,
      email: l.email,
      phone: l.phone,
      hasContactPage: l.hasContactPage,
      hasContactForm: l.hasContactForm,
      socialLinksCount: 0,
      popupDetected: l.popupDetected,
      desktopScreenshotB64: "",
      mobileScreenshotB64: "",
      industryGuess: l.industry,
      cityGuess: l.city,
      uiSummary: l.uiSummary,
      pitchAngle: l.pitchAngle,
      fixSuggestion: l.fixSuggestion,
      whyItScoredHigh: l.uiSummary,
      confidenceScore: 0,
      issuesFoundCount: l.issuesFoundCount,
      scores: l.scores,
      rawScore: null,
      weightedScore: null,
      leadBoost: 0,
      score: l.score,
      verdict: l.verdict,
      cms: l.cms,
      cmsVersion: l.cmsVersion,
      hackRisk: l.hackRisk,
      recommended: l.recommended,
      recommendationReason: l.recommendationReason,
      findings: l.findings,
      checkedAt: l.checkedAt,
    };
    sessionStorage.setItem(`rankr:detail:${l.domain}`, JSON.stringify(detail));
    window.open(`${location.origin}${location.pathname}#/audit?domain=${encodeURIComponent(l.domain)}`, "_blank");
  };

  const refreshAudit = async () => {
    const target = (audit && (audit.finalUrl || audit.url)) || url.trim();
    if (!target) return;
    setState("running");
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      const a = await res.json();
      if (!res.ok || !a || a.error) throw new Error((a && a.error) || "Audit failed");
      setAudit(a);
      setError("");
      setState("done");
    } catch (err) {
      setError(err.message);
      setState("idle");
    }
  };

  const openAuditInNewTab = (a, autoDraft = false) => {
    if (!a || !a.domain) return;
    const { desktopScreenshotB64, mobileScreenshotB64, ...clean } = a;
    try {
      sessionStorage.setItem(`rankr:detail:${a.domain}`, JSON.stringify(clean));
    } catch {
      sessionStorage.removeItem(`rankr:detail:${a.domain}`);
    }
    window.open(
      `${location.origin}${location.pathname}#/audit?domain=${encodeURIComponent(a.domain)}${autoDraft ? "&draft=1" : ""}`,
      "_blank"
    );
  };

  useEffect(() => {
    const m = location.hash.match(/#\/audit\?domain=([^&]+)/);
    if (!m) return;
    const domain = decodeURIComponent(m[1]);
    const doDraft = /[?&]draft=1/.test(location.hash);
    setTab("audit");
    setHuntState("idle");
    const finalize = (auditObj) => {
      setAudit(auditObj);
      setState("done");
      setError("");
      fetch("/api/owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: auditObj.finalUrl || `https://${domain}` }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((owner) => {
          if (!owner) return;
          setChat({ kind: "owner", owner, fromCache: true });
          if (doDraft) {
            setChat({ kind: "info", text: "Drafting outreach message…" });
            const name = localStorage.getItem("rankrName") || "Your Web Studio";
            const phone = (localStorage.getItem("rankrPhone") || "").trim();
            const body = {
              url: auditObj.finalUrl || `https://${domain}`,
              yourName: name,
              ...(phone ? { yourPhone: phone } : {}),
            };
            if (owner.ownerName) body.owner = owner;
            if (Array.isArray(auditObj.findings) && auditObj.findings.length) {
              body.audit = {
                domain: auditObj.domain,
                businessName: auditObj.businessName,
                findings: auditObj.findings.map((f) => ({ category: f.category, points: f.points, message: f.message })),
                cms: auditObj.cms || "",
                cmsVersion: auditObj.cmsVersion || "",
                hackRisk: auditObj.hackRisk ? { level: auditObj.hackRisk.level, factors: auditObj.hackRisk.factors || [] } : undefined,
              };
            }
            fetch("/api/message", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })
              .then((r) => r.json())
              .then((d) => !d.error && setChat({ kind: "message", message: d.message, fromCache: true }))
              .catch(() => {});
          }
        })
        .catch(() => {});
    };
    const cached = sessionStorage.getItem(`rankr:detail:${domain}`);
    if (cached) {
      finalize(JSON.parse(cached));
      return;
    }
    fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `https://${domain}` }),
    })
      .then((r) => r.json())
      .then((a) => {
        if (!a || a.error) throw new Error((a && a.error) || "Audit failed");
        finalize(a);
      })
      .catch((err) => {
        setError(err.message);
        setState("idle");
      });
  }, []);

  const draftMessage = async (e) => {
    e && e.preventDefault();
    setChat({ kind: "info", text: "Drafting outreach message…" });
    const name = yourName.trim() || "Your Web Studio";
    const phone = yourPhone.trim();
    const body = {
      url: (audit && (audit.finalUrl || audit.url)) || url.trim(),
      yourName: name,
      ...(phone ? { yourPhone: phone } : {}),
    };
    if (chat && chat.kind === "owner" && chat.owner && chat.owner.ownerName) body.owner = chat.owner;
    if (audit && Array.isArray(audit.findings) && audit.findings.length) {
      body.audit = {
        domain: audit.domain,
        businessName: audit.businessName,
        findings: audit.findings.map((f) => ({ category: f.category, points: f.points, message: f.message })),
        cms: audit.cms || "",
        cmsVersion: audit.cmsVersion || "",
        hackRisk: audit.hackRisk ? { level: audit.hackRisk.level, factors: audit.hackRisk.factors || [] } : undefined,
      };
    }
    try {
      const res = await fetch("/api/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Draft failed");
      setChat({ kind: "message", message: data.message, fromCache: true });
    } catch (err) {
      setChat({ kind: "error", text: err.message });
    }
  };

  const runAudit = async (e) => {
    e && e.preventDefault();
    if (!url.trim()) return;
    setState("auditing");
    setAudit(null);
    setLeadsData(null);
    setChat(null);
    setError("");
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Audit failed");
      setAudit(data);
      setState("done");
    } catch (err) {
      setError(err.message);
      setState("idle");
    }
  };

  const generateLeads = async () => {
    setChat({ kind: "info", text: "Generating AI leads…" });
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: audit.finalUrl || url.trim(), yourName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lead generation failed");
      setLeadsData(data);
      setChat(null);
    } catch (err) {
      setChat({ kind: "error", text: err.message });
    }
  };

  const download = (filename, content, mime) => {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadHuntCSV = () => {
    const rows = [["score","verdict","company","domain","industry","query","city","email","phone","cms","cmsVersion","hackRisk","issues","top_fixes","pitch_angle","fix_suggestion"]];
    for (const l of huntResult.leads) {
      rows.push([
        l.score, l.verdict, l.businessName, l.domain, l.industry, l.query || "", l.city, l.email, l.phone,
        l.cms || "", l.cmsVersion || "", l.hackRisk && l.hackRisk.level || "",
        l.issuesFoundCount, l.topIssues.join(" | "), l.pitchAngle, l.fixSuggestion,
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    download("rankr-lead-hunt.csv", csv, "text/csv");
  };

  const downloadLeadsCSV = () => {
    const rows = [["company", "domain", "contact", "role", "email", "phone", "industry", "pain_points", "subject", "message"]];
    for (const l of leadsData.leads) {
      rows.push([
        l.company, l.domain, l.title, l.role, l.email, l.phone, l.industry,
        l.painPoints.join(" | "), l.outreach.subject, l.outreach.body,
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    download("rankr-leads.csv", csv, "text/csv");
  };

  const downloadAuditCSV = () => {
    const a = audit;
    const rows = [
      ["field", "value"],
      ["input_url", a.inputUrl],
      ["final_url", a.finalUrl],
      ["business_name", a.businessName],
      ["industry", a.industryGuess],
      ["city", a.cityGuess],
      ["email", a.email],
      ["phone", a.phone],
      ["status_code", a.statusCode],
      ["design_score", a.scores.design],
      ["mobile_score", a.scores.mobile],
      ["ux_score", a.scores.ux],
      ["performance_score", a.scores.performance],
      ["trust_score", a.scores.trust],
      ["conversion_score", a.scores.conversion],
      ["security_score", a.scores.security],
      ["cms", a.cms],
      ["cms_version", a.cmsVersion],
      ["hack_risk", a.hackRisk && a.hackRisk.level],
      ["hack_risk_factors", a.hackRisk && a.hackRisk.factors && a.hackRisk.factors.join(" | ")],
      ["raw_score", a.rawScore],
      ["weighted_score", a.weightedScore],
      ["lead_boost", a.leadBoost],
      ["final_score", a.score],
      ["verdict", a.verdict],
      ["recommended", a.recommended],
      ["ui_summary", a.uiSummary],
      ["pitch_angle", a.pitchAngle],
      ["fix_suggestion", a.fixSuggestion],
      ["why_it_scored_high", a.whyItScoredHigh],
      ["confidence_score", a.confidenceScore],
      ["issues_found_count", a.issuesFoundCount],
      ...a.findings.map((f) => [`finding_${f.category}`, `${f.points} pts — ${f.message}`]),
    ];
    const csv = rows.map((r) => `"${String(r[1] ?? "").replace(/"/g, '""')}"`).join("\n");
    download("rankr-audit.csv", csv, "text/csv");
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">R</span>
          <span>Rankr</span>
        </div>
        <nav className="tabs">
          <button className={`tab ${tab === "hunt" ? "active" : ""}`} onClick={() => setTab("hunt")}>
            🎯 Find leads
          </button>
          <button className={`tab ${tab === "audit" ? "active" : ""}`} onClick={() => setTab("audit")}>
            🔍 Audit a site
          </button>
        </nav>
        <span className="tagline">US-wide lead hunter · website scorecard 0–100</span>
      </header>

      <main className="wrap">
        {tab === "hunt" && (
          <HuntPanel
            hunt={hunt}
            setHunt={setHunt}
            state={huntState}
            runHunt={runHunt}
            result={huntResult}
            error={huntError}
            onDetail={loadLeadDetail}
            onExport={downloadHuntCSV}
            pushToCrm={pushToCrm}
            pushAllToCrm={pushAllToCrm}
            crmAdded={crmAdded}
            crmLoading={crmLoading}
            bulkCrmLoading={bulkCrmLoading}
            ignoreLead={ignoreLead}
            unignoreLead={unignoreLead}
            ignoredDomains={ignoredDomains}
            ignoring={ignoring}
          />
        )}

        {tab === "audit" && (
          <AuditPanel
            url={url} setUrl={setUrl}
            yourName={yourName} setYourName={setYourName}
            yourPhone={yourPhone} setYourPhone={setYourPhone}
            state={state} runAudit={runAudit}
            audit={audit} error={error}
            chat={chat} setChat={setChat}
            draftMessage={draftMessage}
            onOpenInNewTab={openAuditInNewTab}
            refreshAudit={refreshAudit}
            generateLeads={generateLeads}
            leadsData={leadsData}
            downloadAuditCSV={downloadAuditCSV}
            downloadLeadsCSV={downloadLeadsCSV}
            pushToCrm={pushToCrm}
            crmAdded={crmAdded}
            crmLoading={crmLoading}
          />
        )}
      </main>

      {crmToast && (
        <div style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 9999,
          background: crmToast.type === "error" ? "#b91c1c" : "#15803d",
          color: "#fff",
          padding: "12px 20px",
          borderRadius: 10,
          boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
          fontSize: 14,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}>
          <span>{crmToast.text}</span>
          {crmToast.link && (
            <a href={crmToast.link} target="_blank" rel="noreferrer" style={{ color: "#fff", textDecoration: "underline" }}>
              Open CRM (localhost:5173) →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function HuntPanel({ hunt, setHunt, state, runHunt, result, error, onDetail, onExport, pushToCrm, pushAllToCrm, crmAdded, crmLoading, bulkCrmLoading, ignoreLead, unignoreLead, ignoredDomains, ignoring }) {
  const [previews, setPreviews] = useState({});

  const loadPreview = async (l) => {
    if (previews[l.domain] && (previews[l.domain].loading || previews[l.domain].desktopScreenshotB64 || previews[l.domain].mobileScreenshotB64)) return;
    setPreviews((p) => ({ ...p, [l.domain]: { loading: true } }));
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: l.url || `https://${l.domain}` }),
      });
      const d = await res.json();
      if (!res.ok || !d || d.error) throw new Error((d && d.error) || "Preview failed");
      setPreviews((p) => ({ ...p, [l.domain]: { loading: false, ...d } }));
    } catch (err) {
      setPreviews((p) => ({ ...p, [l.domain]: { loading: false, error: err.message } }));
    }
  };
  return (
    <>
      <form className="card hunt-search" onSubmit={runHunt}>
        <div className="hunt-field hunt-what">
          <label>What do they do?</label>
          <input
            value={hunt.what}
            onChange={(e) => setHunt({ ...hunt, what: e.target.value })}
            placeholder="dentist, mechanic, plumber…"
          />
        </div>
        <div className="hunt-field">
          <label>City</label>
          <input
            value={hunt.city}
            onChange={(e) => setHunt({ ...hunt, city: e.target.value })}
            placeholder="charleston"
          />
        </div>
        <div className="hunt-field hunt-state">
          <label>State</label>
          <input
            value={hunt.state}
            maxLength={2}
            onChange={(e) => setHunt({ ...hunt, state: e.target.value.toLowerCase().replace(/"/g, "") })}
            placeholder="sc, fl, tx…  or blank = all"
          />
        </div>
        <div className="hunt-field hunt-count">
          <label>Sites to test</label>
          <select value={hunt.count} onChange={(e) => setHunt({ ...hunt, count: Number(e.target.value) })}>
            {[8, 20, 50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="hunt-field hunt-eng">
          <label>Search engine</label>
          <select value={hunt.engine} onChange={(e) => setHunt({ ...hunt, engine: e.target.value })}>
            <option value="all">All (Google + DDG + Bing + Brave)</option>
            <option value="google">Google</option>
            <option value="duckduckgo">DuckDuckGo</option>
            <option value="bing">Bing</option>
            <option value="brave">Brave</option>
          </select>
        </div>
        <button className="btn" disabled={state === "running"}>
          {state === "running" ? "Hunting the web…" : "🔎 Hunt for leads"}
        </button>
      </form>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Blank field = all {hunt.state === "*" || hunt.state === "" ? "states" : "locations"}. Use commas to list several{" "}
        (e.g. <code>dentist, plumber, mechanic</code>). <button className="chip chip-btn" onClick={() => setHunt({ ...hunt, state: "*", city: "" })}>🇺🇸 All US states + top cities</button>
      </p>

      <div className="example-chips">
        <span className="muted" style={{ fontSize: 12 }}>Try: </span>
        {EXAMPLE_HUNTS.map((ex) => (
          <button
            key={ex.label}
            className="chip chip-btn"
            onClick={() => setHunt({ what: ex.what, city: ex.city, state: ex.state, count: 20 })}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {state === "running" && (
        <div className="card loading-card">
          <div className="spinner" />
          <p><strong>Hunting local business leads…</strong></p>
          <p className="muted" style={{ fontSize: 13 }}>
            Fast multi-engine search in progress &bull; Auditing live sites in parallel &bull; Checking CMS, WordPress, and security exposures…
          </p>
        </div>
      )}

      {error && <div className="alert">{error}</div>}

      {result && (
        <>
          <div className="card result-head">
            <div>
              <h2>“{result.query}”</h2>
              <p className="muted">
                {result.engine} · {result.searched} found · {result.audited} audited · {result.leads.length} scored
                {result.probes > 1 && <span> · {result.probes} locations/business types tested</span>}
                {result.truncated && <span> · capped combos</span>}
                {result.failed.length > 0 && ` · ${result.failed.length} unreachable`}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                className="btn btn-crm"
                onClick={() => pushAllToCrm(result.leads)}
                disabled={bulkCrmLoading}
                style={{ background: "#2563eb", color: "#fff", display: "inline-flex", alignItems: "center", gap: 6 }}
                title="Save all found leads to your CRM (localhost:5173)"
              >
                {bulkCrmLoading ? "⏳ Adding to CRM…" : "💼 Add all leads to CRM"}
              </button>
              <button className="btn btn-secondary" onClick={onExport}>Export CSV</button>
              <a
                href="http://localhost:5173/companies"
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 13, color: "#2563eb", textDecoration: "none", fontWeight: 600 }}
              >
                Open CRM ↗
              </a>
            </div>
          </div>

          {result.leads.length === 0 && (
            <div className="card empty">
              <h3>No leads found</h3>
              <p className="muted">Try a different city/state or bump up the number of sites to test.</p>
            </div>
          )}

          {result.leads.map((l) => (
            ignoredDomains && ignoredDomains[l.domain] ? (
              <div
                className="card lead-row lead-ignored"
                key={l.domain}
                style={{
                  opacity: 0.65,
                  background: "#fef2f2",
                  border: "1px dashed #fca5a5",
                  padding: "14px 18px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <span style={{ fontWeight: 600, color: "#991b1b" }}>🚫 Ignored: {l.businessName || l.domain}</span>
                  <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>({l.domain}) &bull; Saved to CRM Ignored tab</span>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <a href="http://localhost:5173/ignored" target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#991b1b", textDecoration: "underline", fontWeight: 600 }}>
                    View in CRM Ignored Tab ↗
                  </a>
                  <button className="btn btn-sm btn-secondary" onClick={() => unignoreLead(l)}>Undo</button>
                </div>
              </div>
            ) : (
            <div className="card lead-row" key={l.domain}>
              <ScoreGauge score={l.score} />
              <div className="lead-row-main">
                <div className="lead-row-top">
                  <h3>{l.businessName}</h3>
                  <span className="verdict-badge" style={{ background: VERDICT_COLORS[l.verdict] || "#6b7280" }}>
                    {l.verdict}
                  </span>
                  {l.recommended && <span className="rec-badge rec-yes">Prime lead</span>}
                </div>
                <p className="muted">
                  {l.domain} · {l.industry} {l.city ? `· ${l.city}` : ""} {l.email ? `· ${l.email}` : ""} {l.phone ? `· ${l.phone}` : ""}
                </p>
                {l.query && <p className="muted" style={{ fontSize: 12 }}>📍 {l.query}</p>}
                {(l.cms || (l.hackRisk && l.hackRisk.level)) && (
                  <div className="tech-row">
                    {l.cms && <span className={`tech-chip ${l.cms === "wordpress" ? "wp" : ""}`}>CMS {l.cms}{l.cmsVersion ? ` ${l.cmsVersion}` : ""}</span>}
                    {l.hackRisk && l.hackRisk.level !== "n/a" && (
                      <span className={`risk-chip risk-${l.hackRisk.level}`}>
                        Hack risk: {l.hackRisk.level}{l.hackRisk.factors && l.hackRisk.factors.length ? ` — ${l.hackRisk.factors[0]}` : ""}
                      </span>
                    )}
                  </div>
                )}
                <div className="issues">
                  <strong>{l.issuesFoundCount} issues:</strong>{" "}
                  {l.topIssues.slice(0, 3).map((t, i) => <span key={i} className="issue">{t}</span>)}
                </div>
                <p className="muted" style={{ fontSize: 13 }}><strong>Pitch:</strong> {l.pitchAngle} — {l.fixSuggestion}</p>
                <div className="btn-row" style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button className="btn btn-sm" onClick={() => onDetail(l)}>Open full audit + found owner + draft email</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => loadPreview(l)} disabled={previews[l.domain] && previews[l.domain].loading}>
                    {previews[l.domain] && previews[l.domain].loading ? "Rendering desktop + mobile…" : "🖼️ Preview desktop + mobile"}
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => pushToCrm(l)}
                    disabled={crmLoading[l.domain]}
                    style={{
                      background: crmAdded[l.domain] ? "#16a34a" : "#2563eb",
                      color: "#fff",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4
                    }}
                    title="Add this lead to your CRM at http://localhost:5173"
                  >
                    {crmLoading[l.domain] ? "⏳ Adding to CRM…" : crmAdded[l.domain] ? "✓ Added to CRM" : "💼 Add to CRM"}
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => ignoreLead(l, "Directory / Waste of Link")}
                    disabled={ignoring && ignoring[l.domain]}
                    style={{
                      color: "#dc2626",
                      borderColor: "#fca5a5",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                    title="Ignore this link (waste of lead / directory) and send to CRM Ignored tab"
                  >
                    {ignoring && ignoring[l.domain] ? "⏳ Ignoring…" : "🚫 Ignore"}
                  </button>
                </div>
                {(previews[l.domain] && (previews[l.domain].desktopScreenshotB64 || previews[l.domain].mobileScreenshotB64)) && (
                  <div className="shot-compare lead-preview">
                    {previews[l.domain].desktopScreenshotB64 && (
                      <div className="device desktop-frame">
                        <div className="device-head">
                          <span className="dots"><i className="dot dot-red" /><i className="dot dot-yellow" /><i className="dot dot-green" /></span>
                          <span className="url">{previews[l.domain].finalUrl || l.domain}</span>
                        </div>
                        <div className="device-screen">
                          <img src={`data:image/png;base64,${previews[l.domain].desktopScreenshotB64}`} alt="Desktop preview" />
                        </div>
                        <div className="device-foot">Desktop · 1440×900</div>
                      </div>
                    )}
                    {previews[l.domain].mobileScreenshotB64 && (
                      <div className="device phone">
                        <div className="notch" />
                        <div className="device-screen">
                          <img src={`data:image/png;base64,${previews[l.domain].mobileScreenshotB64}`} alt="Mobile preview" />
                        </div>
                        <div className="device-foot">Mobile · 390×844 iPhone</div>
                      </div>
                    )}
                  </div>
                )}
                {previews[l.domain] && previews[l.domain].error && (
                  <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{previews[l.domain].error}</p>
                )}
              </div>
            </div>
            )
          ))}
        </>
      )}
    </>
  );
}

function AuditPanel({ url, setUrl, yourName, setYourName, yourPhone, setYourPhone, state, runAudit, audit, error, chat, setChat, draftMessage, onOpenInNewTab, refreshAudit, generateLeads, leadsData, downloadAuditCSV, downloadLeadsCSV, pushToCrm, crmAdded, crmLoading }) {
  return (
    <>
      <form className="audit-bar" onSubmit={runAudit}>
        <input
          className="url-input"
          placeholder="Enter a website to audit, e.g. acmecoffee.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          className="name-input"
          placeholder="Your brand (used in outreach)"
          value={yourName}
          onChange={(e) => {
            setYourName(e.target.value);
            localStorage.setItem("rankrName", e.target.value);
          }}
        />
        <input
          className="name-input"
          placeholder="Your phone (optional, for drafts)"
          value={yourPhone}
          onChange={(e) => {
            setYourPhone(e.target.value);
            localStorage.setItem("rankrPhone", e.target.value);
          }}
        />
        <button className="btn" disabled={state === "auditing"}>
          {state === "auditing" ? "Auditing…" : "Audit & Score"}
        </button>
      </form>

      {state === "auditing" && (
        <div className="card loading-card">
          <div className="spinner" />
          <p>Loading the page on a real desktop and mobile browser…</p>
        </div>
      )}

      {error && <div className="alert">{error}</div>}

      {audit && (
        <>
          <div className="card verdict-row">
            <ScoreGauge score={audit.score} />
            <div className="verdict-side">
              <div className="verdict-line">
                <span className="verdict-badge" style={{ background: VERDICT_COLORS[audit.verdict] || "#6b7280" }}>
                  {audit.verdict}
                </span>
                <span className={`rec-badge ${audit.recommended ? "rec-yes" : "rec-no"}`}>
                  {audit.recommended ? "Prime lead — weak site" : "Score acceptable"}
                </span>
              </div>
              <h2>{audit.businessName}</h2>
              <p className="muted"><a href={audit.finalUrl} target="_blank" rel="noreferrer">{audit.finalUrl}</a></p>
              {typeof audit.rawScore === "number" && (
                <p className="chip-row">
                  <span className="chip">Raw {audit.rawScore}</span>
                  <span className="chip">Weighted {audit.weightedScore}</span>
                  <span className="chip">Confidence {audit.confidenceScore}%</span>
                  <span className="chip">{audit.issuesFoundCount} issues</span>
                </p>
              )}
              {audit.cms || (audit.hackRisk && audit.hackRisk.level !== "n/a") ? (
                <div className="chip-row">
                  {audit.cms && <span className={`chip ${audit.cms === "wordpress" ? "wp-chip" : ""}`}>CMS: {audit.cms}{audit.cmsVersion ? ` ${audit.cmsVersion}` : ""}</span>}
                  {audit.hackRisk && audit.hackRisk.level !== "n/a" && (
                    <span className={`chip risk-chip risk-${audit.hackRisk.level}`}>
                      Hack risk: {audit.hackRisk.level}
                      {audit.hackRisk.factors && audit.hackRisk.factors.length ? ` — ${audit.hackRisk.factors.join(", ")}` : ""}
                    </span>
                  )}
                </div>
              ) : null}
              {audit.source === "hunt-cache" && (
                <p className="muted" style={{ fontSize: 12 }}>Opened instantly from hunt data — owner email is loading in the background.</p>
              )}
              {pushToCrm && (
                <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => pushToCrm({
                      url: audit.finalUrl,
                      domain: audit.domain || (new URL(audit.finalUrl).hostname.replace(/^www\./, '')),
                      businessName: audit.businessName,
                      industry: audit.industryGuess,
                      city: audit.cityGuess,
                      email: audit.email,
                      phone: audit.phone,
                      score: audit.score,
                      verdict: audit.verdict,
                      cms: audit.cms,
                      cmsVersion: audit.cmsVersion,
                      hackRisk: audit.hackRisk,
                      topIssues: Array.isArray(audit.findings) ? audit.findings.slice(0, 3).map((f) => f.message) : [],
                    })}
                    disabled={crmLoading && crmLoading[audit.domain]}
                    style={{
                      background: crmAdded && crmAdded[audit.domain] ? "#16a34a" : "#2563eb",
                      color: "#fff",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                    title="Push this business lead into your local CRM"
                  >
                    {crmLoading && crmLoading[audit.domain] ? "⏳ Adding to CRM…" : crmAdded && crmAdded[audit.domain] ? "✓ In CRM (localhost:5173)" : "💼 Add to CRM"}
                  </button>
                  {crmAdded && crmAdded[audit.domain] && (
                    <a href="http://localhost:5173/companies" target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>
                      View in CRM ↗
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>

          {chat && chat.kind === "owner" && chat.owner && (
            <div className="card">
              <div className="card-head">
                <h3>Site owner found</h3>
                <button className="btn btn-secondary" onClick={() => setChat(null)}>✕</button>
              </div>
              <div className="grid-2">
                <div>
                  <InfoRow k="Owner" v={chat.owner.ownerName || "unknown"} />
                  <InfoRow k="Role" v={chat.owner.role || "unknown"} />
                  <InfoRow k="Email" v={chat.owner.email || "not found"} />
                  <InfoRow k="Phone" v={chat.owner.phone || "not found"} />
                  <InfoRow k="Company" v={chat.owner.company || "unknown"} />
                  <InfoRow k="Source" v={chat.owner.source || "unknown"} />
                </div>
                <div>
                  <h4 style={{ marginBottom: 6 }}>Draft your outreach</h4>
                  <button className="btn" onClick={draftMessage}>✉️ Draft message</button>
                </div>
              </div>
            </div>
          )}

          {chat && chat.kind === "message" && chat.message && (
            <div className="card">
              <div className="card-head">
                <h3>Drafted outreach — {chat.message.toName || chat.message.to || audit.domain}</h3>
                <div className="btn-row">
                  <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(`${chat.message.subject}\n\n${chat.message.body}`)}>Copy</button>
                  {chat.message.to && <a className="btn btn-sm btn-secondary" href={`mailto:${chat.message.to}?subject=${encodeURIComponent(chat.message.subject)}&body=${encodeURIComponent(chat.message.body)}`}>Open in mail</a>}
                  <button className="btn btn-secondary" onClick={() => setChat(null)}>✕</button>
                </div>
              </div>
              <p className="subject">{chat.message.subject}</p>
              <pre className="outreach-pre">{chat.message.body}</pre>
              {chat.message.notes && <p className="muted" style={{ fontSize: 13 }}>{chat.message.notes}</p>}
            </div>
          )}

          {chat && chat.kind === "info" && <div className="info">{chat.text}</div>}
          {chat && chat.kind === "error" && <div className="alert">{chat.text}</div>}

          {audit.statusCode === null && (
            <div className="card empty">
              <h3>Site could not be reached</h3>
              <p className="muted">{audit.recommendationReason}</p>
            </div>
          )}

          {audit.statusCode !== null && (
            <>
              <div className="grid-2">
                <div className="card">
                  <h3>Category scores</h3>
                  {Object.entries(audit.scores).map(([key, val]) => (
                    <CatBar key={key} label={CATEGORY_LABELS[key] || key} value={val} />
                  ))}
                </div>

                <div className="card">
                  <h3>Lead intel</h3>
                  <InfoRow k="Industry" v={audit.industryGuess || "unknown"} />
                  <InfoRow k="City (guess)" v={audit.cityGuess || "unknown"} />
                  <InfoRow k="Email" v={audit.email || "not found"} />
                  <InfoRow k="Phone" v={audit.phone || "not found"} />
                  <InfoRow k="Contact page" v={audit.hasContactPage ? "yes" : "no"} />
                  <InfoRow k="Contact form" v={audit.hasContactForm ? "yes" : "no"} />
                  <InfoRow k="Social links" v={audit.socialLinksCount} />
                  <InfoRow k="Popup detected" v={audit.popupDetected ? "yes" : "no"} />
                </div>
              </div>

              {audit.desktopScreenshotB64 || audit.mobileScreenshotB64 ? (
                <div className="card">
                  <div className="card-head">
                    <h3>Rendered screenshots</h3>
                    <p className="muted" style={{ margin: 0, fontSize: 12 }}>Real renders — what visitors actually see on a phone vs a laptop</p>
                  </div>
                  <div className="shot-compare">
                    {audit.desktopScreenshotB64 && (
                      <div className="device desktop-frame">
                        <div className="device-head">
                          <span className="dots"><i className="dot dot-red" /><i className="dot dot-yellow" /><i className="dot dot-green" /></span>
                          <span className="url">{audit.finalUrl}</span>
                        </div>
                        <div className="device-screen">
                          <img src={`data:image/png;base64,${audit.desktopScreenshotB64}`} alt="Desktop screenshot" />
                        </div>
                        <div className="device-foot">Desktop · 1440×900</div>
                      </div>
                    )}

                    {audit.mobileScreenshotB64 && (
                      <div className="device phone">
                        <div className="notch" />
                        <div className="device-screen">
                          <img src={`data:image/png;base64,${audit.mobileScreenshotB64}`} alt="Mobile screenshot" />
                        </div>
                        <div className="device-foot">Mobile · 390×844 iPhone</div>
                      </div>
                    )}
                  </div>
                </div>
              ) : audit.source === "hunt-cache" ? (
                <div className="card empty">
                  <h3>Fast view — no screenshots yet</h3>
                  <p className="muted">This was opened instantly from hunt data, so the site wasn't re-rendered. Capture a live desktop + mobile render below.</p>
                  <div style={{ marginTop: 12 }}>
                    <button className="btn" onClick={refreshAudit} disabled={state === "running"}>
                      {state === "running" ? "Rendering desktop + mobile…" : "🔍 Capture screenshots (full audit)"}
                    </button>
                  </div>
                </div>
              ) : null}

              {audit.statusCode !== null && (
                <SecurityCard audit={audit} />
              )}

              <div className="grid-2">
                <div className="card">
                  <h3>Outreach summary</h3>
                  <p><strong>Pitch angle:</strong> {audit.pitchAngle}</p>
                  <p><strong>Recommended fix:</strong> {audit.fixSuggestion}</p>
                  <p><strong>Why it scored this way:</strong> {audit.whyItScoredHigh}</p>
                  <p><strong>Reason:</strong> {audit.recommendationReason}</p>
                </div>

                <div className="card">
                  <h3>Findings ({audit.findings.length})</h3>
                  {[...audit.findings].sort((x, y) => y.points - x.points).map((f, i) => (
                    <div className="finding" key={i}>
                      <span className={`pts pts-${f.points >= 20 ? "high" : f.points >= 10 ? "med" : "low"}`}>{f.points}</span>
                      <span className="cat">{f.category}</span>
                      <span>{f.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="card action-card">
            <h3>Outreach from this audit</h3>
            <p className="muted" style={{ fontSize: 13 }}>
              Find the site owner, draft a personalized email, and open it all in a new tab.
            </p>
            <div className="btn-row">
              <button className="btn" onClick={() => onOpenInNewTab(audit, true)}>✉️ Find owner + draft message (new tab)</button>
              <button className="btn btn-secondary" onClick={downloadAuditCSV}>Export audit CSV</button>
              <button className="btn btn-secondary" onClick={generateLeads} disabled={chat && chat.kind === "info"}>✦ Generate AI leads</button>
            </div>
          </div>

          {leadsData && (
            <>
              <div className="card">
                <div className="card-head">
                  <h3>Generated leads ({leadsData.leads.length}) — seed #{leadsData.seed}</h3>
                  <div className="btn-row">
                    <button className="btn btn-secondary" onClick={downloadLeadsCSV}>Export CSV</button>
                    <button className="btn btn-secondary" onClick={() => download("rankr-leads.json", JSON.stringify(leadsData.leads, null, 2), "application/json")}>
                      Export JSON
                    </button>
                    <button className="btn btn-secondary" onClick={generateLeads}>↻ Regenerate</button>
                  </div>
                </div>
                <p className="muted" style={{ fontSize: 13 }}>{leadsData.summary.audience}</p>
              </div>

              <div className="leads-grid">
                {leadsData.leads.map((lead, i) => (
                  <div className="card lead-card" key={i}>
                    <div className="lead-top">
                      <div>
                        <h4>{lead.company}</h4>
                        <span className="muted">{lead.domain}</span>
                      </div>
                      <span className="lead-score">{lead.score}</span>
                    </div>
                    <p><strong>{lead.title}</strong> · {lead.role}</p>
                    <p className="muted">{lead.email} · {lead.phone}</p>
                    <p className="muted">Niche: {lead.industry}</p>
                    <div className="pains">
                      {lead.painPoints.map((p, j) => (
                        <span className="pain" key={j}>{p}</span>
                      ))}
                    </div>
                    <div className="outreach">
                      <p className="subject">{lead.outreach.subject}</p>
                      <pre>{lead.outreach.body}</pre>
                      <button
                        className="btn btn-sm"
                        onClick={() => navigator.clipboard.writeText(`${lead.outreach.subject}\n\n${lead.outreach.body}`)}
                      >
                        Copy outreach
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {!audit && state === "idle" && (
        <div className="card empty">
          <h2>How it works</h2>
          <ol>
            <li>Enter any website URL.</li>
            <li>Rankr renders it twice — desktop and mobile — and scores design, mobile, UX, performance, trust, and conversion.</li>
            <li>You get concrete fixes (e.g. “works on PC but broken on mobile”), contact intel, and screenshots.</li>
            <li>Generate AI leads with outreach emails pitched to exactly what that site is missing.</li>
          </ol>
          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            Scores: <b>0–30 bad (prime leads)</b>, <b>30–60 needs work</b>, <b>60–90 great</b>.
          </p>
        </div>
      )}
    </>
  );
}

function CatBar({ label, value }) {
  return (
    <div className="catbar">
      <div className="catbar-label"><span>{label}</span><span>{value}/100</span></div>
      <div className="catbar-track"><div style={{ width: `${value}%` }} /></div>
    </div>
  );
}

function InfoRow({ k, v }) {
  return (
    <div className="inforow">
      <span className="k">{k}</span>
      <span className={String(v).includes("not found") || String(v).includes("unknown") ? "muted" : ""}>{v}</span>
    </div>
  );
}

const ATTACK_RULES = [
  { re: /xmlrpc/i, types: ["DDoS amplification", "credential brute-force"] },
  { re: /wp-login|login exposed/i, types: ["password brute-force", "account takeover"] },
  { re: /wp-json[\s\S]*users|user enumeration|username/i, types: ["admin account enumeration", "targeted phishing", "ransomware entry point"] },
  { re: /plain http|does not use https/i, types: ["on-path interception", "credential theft"] },
  { re: /x-frame-options|frame-ancestors|clickjacking/i, types: ["clickjacking"] },
  { re: /content-security-policy/i, types: ["cross-site scripting (XSS)", "malware injection"] },
  { re: /strict-transport|hsts/i, types: ["protocol downgrade", "session hijack"] },
  { re: /server reveals|stack disclosed|x-powered/i, types: ["targeted exploit intel"] },
];

function attackTypesFor(audit) {
  const seen = new Set();
  const add = (t) => t && seen.add(t);
  const secFindings = (audit.findings || []).filter((f) => f.category === "security");
  const haystack = [
    ...secFindings.map((f) => f.message),
    ...((audit.hackRisk && audit.hackRisk.factors) || []),
  ].join(" | ");
  for (const rule of ATTACK_RULES) {
    if (rule.re.test(haystack)) rule.types.forEach(add);
  }
  if (audit.cms === "wordpress") { add("malware & SEO spam"); if ((audit.hackRisk && audit.hackRisk.level) === "high") add("defacement / ransomware"); }
  return [...seen];
}

function SecurityCard({ audit }) {
  const risk = (audit.hackRisk && audit.hackRisk.level) || "n/a";
  const factors = (audit.hackRisk && audit.hackRisk.factors) || [];
  const secFindings = (audit.findings || []).filter((f) => f.category === "security");
  const php = audit.phpSecurity || null;
  const cmsLabel = audit.cms
    ? audit.cms.toLowerCase() === "wordpress"
      ? `WordPress${audit.cmsVersion ? ` ${audit.cmsVersion}` : ""}`
      : `${audit.cms}${audit.cmsVersion ? ` ${audit.cmsVersion}` : ""}`
    : "None detected (hand-coded or static site)";
  return (
    <div className="card sec-card">
      <div className="card-head">
        <h3>🛡️ Security &amp; can it be hacked?</h3>
        <span className={`risk-chip risk-${risk}`}>
          {risk === "n/a" ? "Uncheckable" : `${risk.toUpperCase()} HACK RISK`}
        </span>
      </div>
      <div className="grid-2">
        <div>
          <InfoRow k="Website platform" v={cmsLabel} />
          <InfoRow k="Uses WordPress?" v={audit.cms === "wordpress" ? "Yes" : audit.cms ? "No" : "Unknown"} />
          <InfoRow
            k="PHP runtime"
            v={!php || !php.detected ? "No reliable evidence" : php.version ? `Detected — ${php.version} (${php.confidence} confidence)` : `Detected — version not exposed (${php.confidence} confidence)`}
          />
          {php && php.detected && (
            <InfoRow
              k="PHP version check"
              v={php.status === "potentially_affected"
                ? `${php.advisoryCount} potential NVD version match${php.advisoryCount === 1 ? "" : "es"}`
                : php.status === "version_checked_no_matches"
                  ? "No vulnerable NVD CPE matches returned"
                  : php.status === "lookup_failed"
                    ? "NVD lookup unavailable"
                    : "Exact version unavailable — no CVE claim"}
            />
          )}
        </div>
        <div>
          <h4 style={{ marginBottom: 6 }}>Why this risk level</h4>
          {factors.length ? (
            <ul className="risk-list">
              {factors.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>No common exposures detected on this visit.</p>
          )}
        </div>
      </div>
      {php && php.detected && (
        <div className="attack-zone">
          <h4 style={{ marginBottom: 6 }}>PHP evidence and advisory check</h4>
          <p className="muted" style={{ fontSize: 13 }}>{php.note}</p>
          {Array.isArray(php.evidence) && php.evidence.length > 0 && (
            <p className="muted" style={{ fontSize: 12 }}><strong>Evidence:</strong> {php.evidence.join("; ")}</p>
          )}
          {Array.isArray(php.advisories) && php.advisories.length > 0 && (
            <ul className="risk-list">
              {php.advisories.slice(0, 8).map((cve) => (
                <li key={cve.id}>
                  <a href={cve.reference} target="_blank" rel="noreferrer"><strong>{cve.id}</strong></a>
                  {cve.cvss ? ` — CVSS ${cve.cvss}` : ""} — potential version match; exploitability not confirmed
                </li>
              ))}
              {php.advisories.length > 8 && <li>…and {php.advisories.length - 8} more returned records</li>}
            </ul>
          )}
        </div>
      )}
      {(() => {
        const attacks = attackTypesFor(audit);
        if (!attacks.length) return null;
        return (
          <div className="attack-zone">
            <h4 style={{ marginBottom: 6 }}>What attackers could actually do</h4>
            <div className="attack-pills">
              {attacks.map((a, i) => <span key={i} className="attack-pill">{a}</span>)}
            </div>
          </div>
        );
      })()}
      {(() => {
        const risk = audit.hackRisk && audit.hackRisk.level;
        if (risk !== "high" && risk !== "medium") return null;
        return (
          <div className="sec-fix">
            <h4 style={{ marginBottom: 6, color: "#096dd9" }}>Suggested fix (free): put it behind Cloudflare</h4>
            <ul className="risk-list" style={{ color: "var(--muted)" }}>
              <li>Cloudflare free plan hides your admin login behind an access rule</li>
              <li>Blocks XML-RPC floods and DDoS before they reach your host</li>
              <li>Wraps the site in free HTTPS</li>
            </ul>
          </div>
        );
      })()}
      {secFindings.length > 0 && (
        <>
          <h4 style={{ marginTop: 14, marginBottom: 8 }}>Security findings</h4>
          <ul className="risk-list">
            {secFindings.map((f, i) => <li key={i}><strong>{f.points} pts</strong> — {f.message}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}