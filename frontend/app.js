/* KBID Proposal Generator — vanilla single-page app.
   Ported from the approved Claude Design UI. Stages: Intake -> Estimate -> Proposal -> Files.
   Server-authoritative estimate (/api/estimate/compute); drafts persist to Postgres via ?d=<uuid>. */
(() => {
  "use strict";

  // ---------- tiny helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const app = () => document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + Math.round(n || 0).toLocaleString("en-US");
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "d" + Date.now() + Math.floor(Math.random() * 1e6));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function getPath(obj, path) { return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj); }
  function setPath(obj, path, val) {
    const keys = path.split("."); let o = obj;
    for (let i = 0; i < keys.length - 1; i++) { if (o[keys[i]] == null || typeof o[keys[i]] !== "object") o[keys[i]] = {}; o = o[keys[i]]; }
    o[keys[keys.length - 1]] = val;
  }

  // ---------- constants ----------
  const PROJECT_TYPES = [
    { id: "full_service_residential", label: "Full-service residential", desc: "New home, finishes, furniture, full drawings" },
    { id: "residential_remodel", label: "Residential remodel / addition", desc: "Targeted remodel of specific rooms or an addition" },
    { id: "commercial_office", label: "Commercial — office / corporate", desc: "Tenant finish, office build-out, corporate interiors" },
    { id: "commercial_medical", label: "Commercial — medical / wellness", desc: "Clinic, healthcare, spa, wellness center" },
    { id: "multi_family", label: "Multi-family residential", desc: "Apartment building, amenity spaces, unit finishes" },
    { id: "institutional", label: "Institutional / civic", desc: "Church, nonprofit, school, community space" },
    { id: "hospitality", label: "Hospitality / restaurant", desc: "Restaurant, bar, hotel, club" },
  ];
  const ARCHITECT_RELS = [
    { id: "none", label: "No architect involved", desc: "KBID produces all drawings and coordinates directly with the contractor" },
    { id: "kbid_lead", label: "KBID is the lead, architect consults", desc: "KBID contracts with the client; architect handles structural / envelope only" },
    { id: "kbid_sub", label: "KBID is a sub-consultant to the architect", desc: "Architect is the prime; KBID coordinates through the architect" },
    { id: "parallel", label: "Parallel equal team members", desc: "KBID and architect both contract directly with the client" },
    { id: "kbid_hires", label: "KBID needs to hire an architect", desc: "KBID will source and manage a permit / structural architect" },
  ];
  const PHASES = [
    { id: "pre_design", label: "Pre-Design", short: "Pre-Design", dur: 2, mtgs: 1, hpw: { owner_director: 1, design_director: 3, interior_designer: 12, designer: 0 } },
    { id: "schematic", label: "Schematic Design", short: "Schematic", dur: 3, mtgs: 2, hpw: { owner_director: 1, design_director: 4, interior_designer: 8, designer: 0 } },
    { id: "design_development", label: "Design Development", short: "Design Dev.", dur: 6, mtgs: 3, hpw: { owner_director: 1, design_director: 4.5, interior_designer: 5, designer: 5 } },
    { id: "construction_documents", label: "Construction Documents", short: "Const. Docs", dur: 3, mtgs: 1, hpw: { owner_director: 0, design_director: 4, interior_designer: 20, designer: 0 } },
    { id: "construction_observation", label: "Construction Observation", short: "Const. Obs.", dur: 0, mtgs: 0, hpw: { owner_director: 0, design_director: 1, interior_designer: 2, designer: 0 } },
  ];
  const SUPPLEMENTAL = [
    { id: "furniture_selection", label: "Furniture selection" },
    { id: "furniture_procurement", label: "Furniture procurement" },
    { id: "mep", label: "MEP engineering coordination" },
    { id: "revit", label: "Revit model production" },
    { id: "existing_conditions", label: "Existing-conditions report" },
    { id: "master_plan", label: "Interior design master plan" },
    { id: "none", label: "None — design services only" },
  ];
  const DECISION_STYLES = ["Decisive and fast", "Committee / multiple approvers", "Deliberate and detail-oriented", "Unknown — first time working together"];
  const TIMELINES = ["Aggressive with a hard deadline", "Normal pacing", "Flexible, no hard deadline"];
  const CONSTRUCTION_KINDS = ["New construction", "Existing / remodel", "Renovation + addition"];
  const START_WEEKS = ["2 weeks", "4 weeks", "4-6 weeks", "TBD"];
  const EXCLUSIONS_BY_TYPE = {
    full_service_residential: ["Decor selection & installation", "Architectural & engineering work (provided by others)", "Code plan & permitting (provided by others)", "Specialty consultants", "LEED / WELL certification", "Additional meetings beyond scope"],
    residential_remodel: ["Engineering work (provided by others)", "Specialty consultants", "Specification manual", "LEED / WELL certification", "Additional meetings beyond scope", "Additional renderings beyond scope"],
    commercial_office: ["Interior renderings beyond quantity included", "Engineering work — Design/Build MEP assumed", "Specialty consultants", "LEED / WELL certification", "Additional meetings beyond scope", "Architectural specification manual"],
    commercial_medical: ["Interior renderings beyond quantity included", "Specialty consultants (acoustic, code, medical)", "LEED / WELL certification", "Additional meetings beyond scope", "Architectural specification manual"],
    multi_family: ["Architectural & engineering work (provided by others)", "Code plan & permitting (provided by others)", "Specification manual (provided by architect)", "Branding & environmental signage", "Specialty consultants (provided by others)", "LEED / WELL certification", "Additional meetings beyond scope", "Contractor bidding coordination", "Construction value engineering changes"],
    institutional: ["Interior architectural & engineering work", "Construction drawings", "Construction administration services", "Furniture procurement & installation", "Specialty consultants", "LEED / WELL certification", "Additional meetings beyond scope", "Contractor bidding coordination"],
    hospitality: ["Interior renderings beyond quantity included", "Specialty consultants", "LEED / WELL certification", "Additional meetings beyond scope", "Architectural specification manual"],
  };
  const ROLES = [
    { id: "owner_director", label: "Owner / Director" },
    { id: "design_director", label: "Design Director" },
    { id: "interior_designer", label: "Interior Designer" },
    { id: "designer", label: "Designer" },
  ];
  const RATE_SETS = { current: { owner_director: 210, design_director: 200, interior_designer: 170, designer: 150 }, legacy: { owner_director: 175, design_director: 175, interior_designer: 175, designer: 175 } };
  const SF_BENCH = { residential: 10, commercial_ti: 3.5, commercial: 9.5 };
  const sfTypeFor = (pt) => (pt === "commercial_office" || pt === "commercial_medical") ? "commercial_ti" : (pt && pt.startsWith("full_service") || pt === "residential_remodel") ? "residential" : "commercial";
  const isCommercial = (pt) => pt && !pt.startsWith("full_service") && pt !== "residential_remodel";

  const STAGES = [{ id: "intake", label: "Intake" }, { id: "estimate", label: "Estimate" }, { id: "proposal", label: "Proposal" }, { id: "files", label: "Files" }];
  const INTAKE_STEPS = ["Smart paste", "Project type", "Client info", "Project details", "Architect", "Context", "Scope", "Design phases", "Supplemental", "Meetings", "Exclusions"];

  // ---------- state ----------
  let CONFIG = { devAuthBypass: true, clerkPublishableKey: "" };
  let TOKEN = null;
  let SAVE_STATE = "idle"; // idle | saving | saved
  const freshState = () => ({
    draftId: null,
    stage: "intake",
    step: 0,
    intake: {
      pasteText: "", projectType: "", client: {}, project: { date: new Date().toISOString().slice(0, 10) },
      architect: "", context: { notes: "", decision: "", timeline: "", tone: "" },
      scope: { text: "", sqft: "", kind: "" }, phases: [], supplemental: [],
      meetings: {}, startWeeks: "", exclusions: [], customExclusion: "", notes: "",
    },
    estimate: { feeMode: "lump", rateSet: "current", rows: {}, budget: "", contingencyPct: 0, consultants: { Code: "", Architecture: "", MEP: "", Structural: "" }, roundStep: 250, result: null },
    proposal: { sections: null },
  });
  let S = freshState();

  // ---------- API ----------
  async function api(path, opts = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    if (!res.ok) throw new Error(path + " -> " + res.status);
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res.text();
  }

  // ---------- draft persistence ----------
  const LS_KEY = "kbid.state";
  const saveNow = debounce(async () => {
    if (!S.draftId) return;
    try {
      setSave("saving");
      localStorage.setItem(LS_KEY, JSON.stringify(S));
      await api("/api/draft/" + encodeURIComponent(S.draftId), {
        method: "PUT",
        body: JSON.stringify({ data: S, title: S.intake.project.name || S.intake.client.name || "Untitled proposal" }),
      });
      setSave("saved");
    } catch (e) { console.warn("save failed", e); setSave("idle"); }
  }, 900);
  function setSave(st) { SAVE_STATE = st; const d = $(".save-dot"); const l = $(".save-label"); if (d) d.className = "save-dot " + st; if (l) l.textContent = st === "saving" ? "Saving…" : st === "saved" ? "Saved" : "Not saved yet"; }
  function touch() { localStorage.setItem(LS_KEY, JSON.stringify(S)); saveNow(); }

  let GENERATING = false;
  async function saveImmediate() {
    if (!S.draftId) return;
    try {
      await api("/api/draft/" + encodeURIComponent(S.draftId), {
        method: "PUT",
        body: JSON.stringify({ data: S, title: S.intake.project.name || S.intake.client.name || "Untitled proposal" }),
      });
    } catch (e) { console.warn("saveImmediate failed", e); }
  }
  async function downloadFile(path, body) {
    const headers = { "Content-Type": "application/json" };
    if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
    const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) { let msg = res.status; try { msg = (await res.json()).detail || msg; } catch {} alert("Download failed: " + msg); return; }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename="?([^"]+)"?/);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = m ? m[1] : "proposal"; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- boot ----------
  async function boot() {
    try { CONFIG = await api("/api/config"); } catch (e) { /* keep defaults */ }
    if (!CONFIG.devAuthBypass && CONFIG.clerkPublishableKey) {
      const ok = await initClerk(CONFIG.clerkPublishableKey);
      if (!ok) return; // Clerk handles the sign-in UI
    }
    await loadOrCreateDraft();
    render();
  }

  async function loadOrCreateDraft() {
    const url = new URL(location.href);
    let id = url.searchParams.get("d") || localStorage.getItem("kbid.draftId");
    if (id) {
      try {
        const d = await api("/api/draft/" + encodeURIComponent(id));
        if (d && d.data) { S = Object.assign(freshState(), d.data); S.draftId = id; }
      } catch (e) { /* stale id -> new draft */ id = null; }
    }
    if (!S.draftId) {
      id = id || uuid();
      S = freshState(); S.draftId = id;
    }
    localStorage.setItem("kbid.draftId", S.draftId);
    url.searchParams.set("d", S.draftId);
    history.replaceState(null, "", url.toString());
  }

  // ---------- Clerk (prod gate; skipped under dev bypass) ----------
  function frontendApiFromPk(pk) {
    try { const b64 = pk.split("_", 3)[2]; return atob(b64 + "===").replace(/\$$/, ""); } catch { return ""; }
  }
  async function initClerk(pk) {
    const host = frontendApiFromPk(pk);
    if (!host) return true;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.setAttribute("data-clerk-publishable-key", pk);
      s.async = true; s.crossOrigin = "anonymous";
      s.src = `https://${host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    }).catch(() => null);
    if (!window.Clerk) return true;
    await window.Clerk.load();
    if (window.Clerk.user) {
      try { TOKEN = await window.Clerk.session.getToken(); } catch {}
      return true;
    }
    app().innerHTML = `<div class="center-screen"><div class="mark">KBID</div><h1 class="title">Proposal Generator</h1><p class="lede">Please sign in to continue.</p><div id="clerk-signin"></div></div>`;
    window.Clerk.mountSignIn(document.getElementById("clerk-signin"));
    return false;
  }

  // ---------- render ----------
  function render() {
    const a = app();
    a.removeAttribute("aria-busy");
    a.innerHTML = `
      <div class="app-shell">
        ${headerHTML()}
        <main class="content ${S.stage === "estimate" ? "wide" : ""}">${screenHTML()}</main>
        ${footerHTML()}
      </div>`;
    if (S.stage === "estimate") scheduleCompute();
    setSave(SAVE_STATE);
  }

  function headerHTML() {
    const idx = STAGES.findIndex((s) => s.id === S.stage);
    const items = STAGES.map((s, i) => {
      const cur = i === idx, done = i < idx;
      return `<li><button class="stage-btn ${done ? "done" : ""}" data-action="goStage" data-stage="${s.id}" ${cur ? 'aria-current="true"' : ""}>
        <span class="stage-num">${done ? "✓" : i + 1}</span><span>${i + 1} · ${s.label}</span></button>
        ${i < STAGES.length - 1 ? '<span class="stage-sep"></span>' : ""}</li>`;
    }).join("");
    return `<header class="topbar"><div class="topbar-inner">
      <div class="brand"><span class="mark">KBID</span><span class="sub">Proposal Generator</span></div>
      <nav class="stages" aria-label="Stages"><ol>${items}</ol>
        <div class="mobile-stage">Stage ${idx + 1} of 4 · <b>${STAGES[idx].label}</b></div></nav>
      <div class="topbar-right"><span class="save-ind"><span class="save-dot"></span><span class="save-label">Not saved yet</span></span></div>
    </div></header>`;
  }

  function footerHTML() {
    const idx = STAGES.findIndex((s) => s.id === S.stage);
    let backLabel = "← Back", nextLabel = "Continue →", nextAction = "next";
    if (S.stage === "intake") { backLabel = S.step === 0 ? "← Back" : "← Back"; }
    if (S.stage === "files") { nextLabel = "Start new draft →"; nextAction = "newDraft"; }
    if (S.stage === "estimate") nextLabel = "Generate proposal →";
    return `<div class="footer-nav"><div class="footer-inner">
      <button class="btn" data-action="back" ${idx === 0 && S.step === 0 ? "disabled" : ""}>${backLabel}</button>
      <button class="btn primary" data-action="${nextAction}">${nextLabel}</button>
    </div></div>`;
  }

  function screenHTML() {
    if (S.stage === "intake") return intakeHTML();
    if (S.stage === "estimate") return estimateHTML();
    if (S.stage === "proposal") return proposalHTML();
    if (S.stage === "files") return filesHTML();
    return "";
  }

  // ---------- intake ----------
  function selCard(checked, title, desc, action, data, box) {
    return `<button class="select-card ${box ? "checkbox" : ""}" aria-pressed="${checked}" data-action="${action}" ${data}>
      <span class="tick">✓</span><span><span class="t">${esc(title)}</span>${desc ? `<span class="d">${esc(desc)}</span>` : ""}</span></button>`;
  }
  function stepHead(n, title, lede) {
    const bars = INTAKE_STEPS.map((_, i) => `<span class="${i <= n ? "on" : ""}"></span>`).join("");
    return `<div class="substep-bar">${bars}</div>
      <div class="step-head"><span class="eyebrow">Intake · Step ${n + 1} of ${INTAKE_STEPS.length}</span><span class="right">${esc(INTAKE_STEPS[n])}</span></div>
      <h1 class="title">${esc(title)}</h1>${lede ? `<p class="lede">${esc(lede)}</p>` : ""}`;
  }

  function intakeHTML() {
    const n = S.step, k = S.intake, c = S.intake.client, comm = isCommercial(k.projectType);
    let body = "";
    if (n === 0) {
      body = stepHead(0, "Start with what you already have.", "Paste a client email, text, or any message and I'll pre-fill the form.") +
        `<div class="field"><textarea data-model="intake.pasteText" placeholder='e.g. "Hi Kali — we just closed on a 1962 ranch in Prairie Village, about 3,400 SF, and want to rework the kitchen, primary suite and…"'>${esc(k.pasteText)}</textarea></div>
        <div class="dl-row" style="justify-content:flex-start"><button class="btn primary" data-action="smartPaste">Extract details</button><button class="btn ghost" data-action="next">Skip — I'll fill it in</button></div>`;
    } else if (n === 1) {
      body = stepHead(1, "What type of project is this?") +
        `<div class="select-grid">${PROJECT_TYPES.map((p) => selCard(k.projectType === p.id, p.label, p.desc, "pickType", `data-id="${p.id}"`)).join("")}</div>`;
    } else if (n === 2) {
      body = stepHead(2, "Client information") +
        field("Client / company name", "intake.client.name", c.name) +
        `<div class="two-col">${field("Primary contact name", "intake.client.contact", c.contact)}${field("Contact title", "intake.client.title", c.title)}</div>` +
        field("Mailing address", "intake.client.address", c.address) +
        `<div class="two-col">${field("Phone", "intake.client.phone", c.phone, "tel")}${field("Email", "intake.client.email", c.email, "email")}</div>` +
        (comm ? field("Signatory / authorized title", "intake.client.signatory", c.signatory) : "");
    } else if (n === 3) {
      const p = k.project;
      body = stepHead(3, "Project details") +
        field("Project name / title", "intake.project.name", p.name) +
        field("Project address", "intake.project.address", p.address) +
        `<div class="two-col">${field("Proposal date", "intake.project.date", p.date, "date")}${field("Project number (optional)", "intake.project.number", p.number)}</div>` +
        (comm ? `<div class="two-col">${field("General contractor (or TBD)", "intake.project.gc", p.gc)}${field("Building owner (if different)", "intake.project.owner", p.owner)}</div>${field("Architect of record (if applicable)", "intake.project.architect", p.architect)}` : "");
    } else if (n === 4) {
      body = stepHead(4, "Architect relationship", "This changes key language throughout the proposal.") +
        `<div class="select-grid">${ARCHITECT_RELS.map((r) => selCard(k.architect === r.id, r.label, r.desc, "pickArchitect", `data-id="${r.id}"`)).join("")}</div>`;
    } else if (n === 5) {
      const ctx = k.context;
      body = stepHead(5, "What makes this project unique?", "The most important step for a proposal that feels custom.") +
        `<div class="field"><label>Free-form notes</label><textarea data-model="intake.context.notes" placeholder="Client personality, timeline pressures, budget sensitivity, past experiences, what needs to go right…">${esc(ctx.notes)}</textarea></div>
        <div class="field"><label>Client decision-making style</label><div class="chips">${DECISION_STYLES.map((d) => chip(ctx.decision === d, d, "pickDecision", `data-v="${esc(d)}"`)).join("")}</div></div>
        <div class="field"><label>Timeline urgency</label><div class="chips">${TIMELINES.map((d) => chip(ctx.timeline === d, d, "pickTimeline", `data-v="${esc(d)}"`)).join("")}</div></div>
        ${field("Tone guidance (optional)", "intake.context.tone", ctx.tone)}`;
    } else if (n === 6) {
      body = stepHead(6, "Scope overview") +
        `<div class="field"><label>Scope description</label><textarea data-model="intake.scope.text" placeholder="What KBID is doing, which spaces, the goal, the deliverables…">${esc(k.scope.text)}</textarea></div>
        <div class="two-col">${field("Square footage (optional)", "intake.scope.sqft", k.scope.sqft, "number")}<div class="field"><label>Construction type</label><div class="chips">${CONSTRUCTION_KINDS.map((v) => chip(k.scope.kind === v, v, "pickKind", `data-v="${esc(v)}"`)).join("")}</div></div></div>`;
    } else if (n === 7) {
      body = stepHead(7, "Design phases", "Choose the phases this engagement covers.") +
        `<div class="select-grid">${PHASES.map((p) => selCard(k.phases.includes(p.id), p.label, "", "togglePhase", `data-id="${p.id}"`, true)).join("")}</div>`;
    } else if (n === 8) {
      body = stepHead(8, "Supplemental services") +
        `<div class="select-grid">${SUPPLEMENTAL.map((p) => selCard(k.supplemental.includes(p.id), p.label, "", "toggleSupp", `data-id="${p.id}"`, true)).join("")}</div>`;
    } else if (n === 9) {
      const chosen = PHASES.filter((p) => k.phases.includes(p.id));
      body = stepHead(9, "Meetings & timeline", "For each phase, how many client meetings and how many weeks?") +
        (chosen.length ? chosen.map((p) => {
          const m = k.meetings[p.id] || {};
          return `<div class="field"><label>${esc(p.label)}</label><div class="two-col">
            <input type="number" min="0" step="1" data-model="intake.meetings.${p.id}.meetings" value="${m.meetings ?? ""}" placeholder="# client meetings (e.g. 2)" />
            <input type="number" min="0" step="1" data-model="intake.meetings.${p.id}.weeks" value="${m.weeks ?? ""}" placeholder="duration (weeks)" /></div></div>`;
        }).join("") : `<p class="lede">Select design phases in the previous step first.</p>`) +
        `<div class="field"><label>Weeks until KBID can start after signing</label><div class="chips">${START_WEEKS.map((v) => chip(k.startWeeks === v, v, "pickStart", `data-v="${esc(v)}"`)).join("")}</div></div>`;
    } else if (n === 10) {
      const ex = exclusionsFor();
      body = stepHead(10, "Exclusions & notes", "Auto-filled by project type — tap × to remove any that don't apply.") +
        `<div class="pills">${ex.map((x, i) => `<span class="pill">${esc(x)} <button data-action="removeExcl" data-i="${i}" aria-label="remove">×</button></span>`).join("") || '<span class="lede">No exclusions.</span>'}</div>
        <div class="field" style="margin-top:16px"><label>Add a custom exclusion</label><div class="two-col" style="grid-template-columns:1fr auto"><input type="text" data-model="intake.customExclusion" value="${esc(k.customExclusion)}" placeholder="Type an exclusion and press Add" /><button class="btn" data-action="addExcl">Add</button></div></div>
        <div class="field"><label>Special notes</label><textarea data-model="intake.notes" placeholder="Anything else to capture…">${esc(k.notes)}</textarea></div>`;
    }
    return `<div class="card">${body}</div>`;
  }

  function field(label, model, val, type) {
    return `<div class="field"><label>${esc(label)}</label><input type="${type || "text"}" data-model="${model}" value="${esc(val)}" /></div>`;
  }
  function chip(on, label, action, data) { return `<button class="chip" aria-pressed="${on}" data-action="${action}" ${data}>${esc(label)}</button>`; }
  function exclusionsFor() {
    if (!S.intake.exclusions.__init && S.intake.projectType) {
      S.intake.exclusions = (EXCLUSIONS_BY_TYPE[S.intake.projectType] || []).slice();
      S.intake.exclusions.__init = true;
    }
    return Array.isArray(S.intake.exclusions) ? S.intake.exclusions : [];
  }

  // ---------- estimate ----------
  function estimateRows() {
    // ensure a row per selected phase, seeded from PHASE defaults + intake meetings/weeks
    const chosen = PHASES.filter((p) => S.intake.phases.includes(p.id));
    chosen.forEach((p) => {
      if (!S.estimate.rows[p.id]) {
        const m = S.intake.meetings[p.id] || {};
        S.estimate.rows[p.id] = {
          weeks: m.weeks != null && m.weeks !== "" ? Number(m.weeks) : p.dur,
          meetings: m.meetings != null && m.meetings !== "" ? Number(m.meetings) : p.mtgs,
          hpw: Object.assign({}, p.hpw),
        };
      }
    });
    return chosen.map((p) => ({ phase: p, row: S.estimate.rows[p.id] }));
  }

  function estimateHTML() {
    const rows = estimateRows();
    const e = S.estimate;
    if (!rows.length) {
      return `<div class="card"><h1 class="title">Estimate</h1><p class="lede">Pick design phases in Intake · Step 8 first, then the live fee calculator appears here.</p></div>`;
    }
    const rateSet = RATE_SETS[e.rateSet];
    const gridCols = rows.map(({ phase }) => `<th colspan="3" class="phase-h">${esc(phase.short)}</th>`).join("");
    const subCols = rows.map(() => `<th>%hrs/wk</th><th>hrs</th><th>fee</th>`).join("");
    const bodyRows = ROLES.map((role) => {
      const rate = rateSet[role.id];
      const cells = rows.map(({ phase, row }) => {
        const wph = row.hpw[role.id] ?? 0;
        return `<td><input type="number" min="0" step="0.5" data-est="${phase.phase ? "" : ""}" data-estrow="${phase.id}" data-estrole="${role.id}" value="${wph}" /></td>
                <td class="num" id="hrs-${phase.id}-${role.id}">0</td><td class="num" id="fee-${phase.id}-${role.id}">0</td>`;
      }).join("");
      return `<tr><td class="role">${esc(role.label)} <span style="color:var(--muted)">$${rate}</span></td>${cells}</tr>`;
    }).join("");
    const mtgRow = `<tr><td class="role">Meetings <span style="color:var(--muted)">prep + attend</span></td>${rows.map(({ phase, row }) => `<td><input type="number" min="0" step="0.5" data-estmtg="${phase.id}" value="${row.meetings ?? 0}" /></td><td></td><td class="num" id="mfee-${phase.id}">0</td>`).join("")}</tr>`;
    const durRow = `<tr><td class="role" style="color:var(--muted)">Duration (weeks)</td>${rows.map(({ phase, row }) => `<td colspan="3"><input type="number" min="0" step="1" data-estweeks="${phase.id}" value="${row.weeks ?? 0}" style="width:64px" /></td>`).join("")}</tr>`;
    const footRow = `<tr><td class="role">Phase subtotal</td>${rows.map(({ phase }) => `<td colspan="3" class="num" id="ptot-${phase.id}">$0</td>`).join("")}</tr>`;

    return `
      <div class="est-toolbar">
        <div class="seg">
          <button class="${e.feeMode === "lump" ? "on" : ""}" data-action="feeMode" data-v="lump">Lump sum per phase</button>
          <button class="${e.feeMode === "hourly" ? "on" : ""}" data-action="feeMode" data-v="hourly">Hourly with ranges</button>
        </div>
        <div class="seg">
          <button class="${e.rateSet === "current" ? "on" : ""}" data-action="rateSet" data-v="current">Current rates</button>
          <button class="${e.rateSet === "legacy" ? "on" : ""}" data-action="rateSet" data-v="legacy">Previous ($175 flat)</button>
        </div>
        <button class="btn" data-action="aiEstimate">✨ Auto-fill with AI</button>
      </div>
      <div class="est-layout">
        <div class="est-grid-wrap"><table class="est"><thead>
          <tr><th class="role">Role · rate</th>${gridCols}</tr>
          <tr><th class="role"></th>${subCols}</tr></thead>
          <tbody>${durRow}${bodyRows}${mtgRow}</tbody>
          <tfoot>${footRow}</tfoot></table></div>
        <div>
          <div class="summary">
            <div class="lab">Total design fee</div>
            <div class="big" id="grand">$0</div>
            <div class="sub" id="hours-sub">0 hours across ${rows.length} phases</div>
            <div><span class="badge" id="pct-badge">—</span> <span class="sub" id="pct-sub">of construction budget</span></div>
          </div>
          <div class="summary-extra">
            <div class="row"><span>Construction budget</span><input type="number" data-model="estimate.budget" value="${esc(e.budget)}" placeholder="$" /></div>
            <div class="row"><span>$/SF check <span style="color:var(--muted)">(${esc(sfTypeFor(S.intake.projectType))})</span></span><span class="num" id="sf-bench">—</span></div>
            <div class="row"><span>Contingency %</span><input type="number" data-model="estimate.contingencyPct" value="${esc(e.contingencyPct)}" style="width:70px" /></div>
            <div class="row"><span>Structural allowance</span><input type="number" data-model="estimate.consultants.Structural" value="${esc(e.consultants.Structural)}" placeholder="$" /></div>
            <div class="row"><span>MEP allowance</span><input type="number" data-model="estimate.consultants.MEP" value="${esc(e.consultants.MEP)}" placeholder="$" /></div>
            <div class="row"><span>Round to proposal numbers</span><button class="toggle ${e.roundStep ? "on" : ""}" data-action="toggleRound" aria-label="round"></button></div>
          </div>
        </div>
      </div>`;
  }

  function buildComputeBody() {
    const rows = estimateRows();
    const cons = {};
    Object.entries(S.estimate.consultants).forEach(([k, v]) => { if (v !== "" && v != null) cons[k] = Number(v) || 0; });
    return {
      rate_set: S.estimate.rateSet,
      phases: rows.map(({ phase, row }) => ({ name: phase.label, duration_weeks: Number(row.weeks) || 0, meetings: Number(row.meetings) || 0, hours_per_week: row.hpw })),
      contingency_pct: (Number(S.estimate.contingencyPct) || 0) / 100,
      consultants: cons,
      construction_budget: Number(S.estimate.budget) || 0,
      square_footage: Number(S.intake.scope.sqft) || 0,
      project_type: sfTypeFor(S.intake.projectType),
      round_step: S.estimate.roundStep || 0,
    };
  }
  const scheduleCompute = debounce(async () => {
    const rows = estimateRows(); if (!rows.length) return;
    try {
      const r = await api("/api/estimate/compute", { method: "POST", body: JSON.stringify(buildComputeBody()) });
      S.estimate.result = r; paintTotals(r);
    } catch (e) { console.warn("compute failed", e); }
  }, 250);

  function paintTotals(r) {
    const byName = {};
    r.phases.forEach((p) => (byName[p.name] = p));
    estimateRows().forEach(({ phase }) => {
      const p = byName[phase.label]; if (!p) return;
      ROLES.forEach((role) => {
        const rl = p.roles[role.id] || {};
        const hEl = document.getElementById(`hrs-${phase.id}-${role.id}`); if (hEl) hEl.textContent = (rl.hours || 0).toString();
        const fEl = document.getElementById(`fee-${phase.id}-${role.id}`); if (fEl) fEl.textContent = money(rl.fee);
      });
      const mEl = document.getElementById(`mfee-${phase.id}`); if (mEl) mEl.textContent = money(p.meeting_fee);
      const tEl = document.getElementById(`ptot-${phase.id}`); if (tEl) tEl.textContent = money(p.total_raw);
    });
    const g = document.getElementById("grand"); if (g) g.textContent = money(r.design_fee_rounded || r.total_fee_raw);
    const hs = document.getElementById("hours-sub"); if (hs) hs.textContent = `${Math.round(r.total_hours)} hours across ${r.phases.length} phases`;
    const pb = document.getElementById("pct-badge"), ps = document.getElementById("pct-sub");
    if (pb) {
      const pct = r.checks.fee_pct_of_budget;
      if (pct == null) { pb.className = "badge"; pb.textContent = "—"; if (ps) ps.textContent = "add a construction budget"; }
      else { const inband = r.checks.fee_pct_in_band; pb.className = "badge " + (inband ? "good" : "warn"); pb.textContent = (pct * 100).toFixed(1) + "% · " + (inband ? "within 5–12%" : "outside 5–12%"); if (ps) ps.textContent = "of construction budget"; }
    }
    const sf = document.getElementById("sf-bench");
    if (sf) { const v = r.checks.sf_benchmark_for_type; sf.textContent = v ? money(v) + " benchmark" : "add square footage"; }
  }

  // ---------- proposal + files ----------
  function proposalHTML() {
    const sec = S.proposal.sections;
    if (GENERATING) {
      return `<div class="card"><h1 class="title">Generating proposal…</h1>
        <p class="lede">Writing in KBID's voice from your intake + estimate. This takes about a minute.</p>
        <div class="spinner"></div></div>`;
    }
    if (!sec || typeof sec !== "object") {
      return `<div class="card"><h1 class="title">Proposal</h1>
        <p class="lede">Generate the full proposal in KBID's voice. Claude writes the cover letter, scope, and phase descriptions from your intake; the fee tables come from your estimate; the legal terms are KBID's standard language.</p>
        <div class="dl-row" style="justify-content:flex-start"><button class="btn primary" data-action="genProposal">Generate proposal</button></div></div>`;
    }
    return `<div class="card"><div class="est-toolbar"><h1 class="title" style="margin:0">Proposal</h1>
      <button class="btn" data-action="genProposal">↻ Regenerate</button></div>${proposalPreviewHTML(sec)}</div>`;
  }
  function proposalPreviewHTML(sec) {
    const m = sec.meta || {};
    const para = (t) => `<p>${esc(t)}</p>`;
    return `<div class="doc-preview">
      <p><b>DESIGNER:</b> ${esc((m.firm || {}).name || "")} &nbsp;·&nbsp; <b>CLIENT:</b> ${esc(m.client_name || "")}<br/>
        <span style="color:var(--muted)">${esc(m.re || "")} — ${esc(m.date || "")}</span></p>
      <p>Dear ${esc(m.client_contact || m.client_name || "")},</p>
      ${para(sec.cover_opener || "")}
      ${(sec.cover_body || []).map(para).join("")}
      <h3>Scope Overview</h3>${para(sec.scope_overview || "")}
      ${(sec.phases || []).map((p) => `<h3>${esc(p.name)}</h3>${para(p.description)}`).join("")}
      <h3>Exclusions, Qualifications, or Exceptions</h3><ul>${(sec.exclusions || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${sec.schedule ? `<h3>Schedule</h3>${para(sec.schedule)}` : ""}
      <h3>Fees &amp; Reimbursable Expenses</h3>${renderFeeLines(sec)}
      <h3>Payment</h3>${para(sec.payment || "")}
      <p style="color:var(--muted);font-size:12px;margin-top:14px">Additional Terms (Exhibit A), Reimbursable Expenses, Documents &amp; Photographs, Limitation on Liability, Notice to Proceed, and the signature block are all included in the downloaded document.</p>
    </div>`;
  }
  function renderFeeLines(sec) {
    const phases = (sec.estimate || {}).phases || [];
    if (!phases.length) return "<p style='color:var(--muted)'>Complete the estimate to populate fees.</p>";
    const rows = phases.map((p) => `<div style="display:flex;justify-content:space-between"><span>${esc(p.name)}</span><span>${money(p.total_rounded || p.total_raw || 0)}</span></div>`).join("");
    const total = phases.reduce((s, p) => s + (p.total_rounded || p.total_raw || 0), 0);
    return `<div style="margin-left:12px;max-width:420px">${rows}
      <div style="display:flex;justify-content:space-between;font-weight:600;border-top:1px solid var(--line);margin-top:4px;padding-top:4px"><span>Total Design Fee</span><span>${money(total)}</span></div></div>`;
  }
  function filesHTML() {
    const title = S.intake.project.name || "Your proposal";
    return `<div class="card files-center">
      <div class="check-circle">✓</div>
      <h1 class="title">${esc(title)} is ready.</h1>
      <p class="lede">${esc(S.intake.client.name || "")} · ${S.estimate.feeMode === "lump" ? "lump-sum" : "hourly"} fees</p>
      <div class="dl-row">
        <button class="btn primary" data-action="dlDocx">↓ Download .docx</button>
        <button class="btn" data-action="dlPdf">↓ Download PDF</button>
        <button class="btn" data-action="dlIndesign">↓ InDesign export</button>
      </div>
      <div class="feedback-grid">
        <div class="fb"><b>A · Tell me what you changed</b><textarea data-model="proposal.feedbackA" placeholder="e.g. I always soften the liability clause for residential clients…"></textarea><div style="margin-top:8px"><button class="btn" data-action="sendFeedback">Send feedback</button></div></div>
        <div class="fb"><b>B · Upload your final version</b><p class="lede" style="margin:6px 0 8px">Drop the edited .docx — I'll compare it against what I generated.</p><button class="btn" data-action="uploadFinal">Choose file</button></div>
      </div>
    </div>`;
  }

  // ---------- events ----------
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.model) { setPath(S, t.dataset.model, t.value); touch(); }
    if (t.dataset && (t.dataset.estrow || t.dataset.estmtg || t.dataset.estweeks || t.dataset.model?.startsWith("estimate."))) {
      if (t.dataset.estrow) { const row = S.estimate.rows[t.dataset.estrow]; if (row) row.hpw[t.dataset.estrole] = Number(t.value) || 0; }
      if (t.dataset.estmtg) { const row = S.estimate.rows[t.dataset.estmtg]; if (row) row.meetings = Number(t.value) || 0; }
      if (t.dataset.estweeks) { const row = S.estimate.rows[t.dataset.estweeks]; if (row) row.weeks = Number(t.value) || 0; }
      touch(); scheduleCompute();
    }
  });

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]"); if (!b) return;
    const a = b.dataset.action, d = b.dataset;
    const actions = {
      goStage: () => { S.stage = d.stage; render(); },
      back: () => { if (S.stage === "intake" && S.step > 0) S.step--; else { const i = STAGES.findIndex((s) => s.id === S.stage); if (i > 0) S.stage = STAGES[i - 1].id; } render(); },
      next: () => {
        if (S.stage === "intake") { if (S.step < INTAKE_STEPS.length - 1) { S.step++; } else { S.stage = "estimate"; } }
        else { const i = STAGES.findIndex((s) => s.id === S.stage); if (i < STAGES.length - 1) S.stage = STAGES[i + 1].id; }
        touch(); render();
      },
      pickType: () => { S.intake.projectType = d.id; S.intake.exclusions = { __init: false }; exclusionsFor(); touch(); render(); },
      pickArchitect: () => { S.intake.architect = d.id; touch(); render(); },
      pickDecision: () => { S.intake.context.decision = d.v; touch(); render(); },
      pickTimeline: () => { S.intake.context.timeline = d.v; touch(); render(); },
      pickKind: () => { S.intake.scope.kind = d.v; touch(); render(); },
      pickStart: () => { S.intake.startWeeks = d.v; touch(); render(); },
      togglePhase: () => { toggleArr(S.intake.phases, d.id); touch(); render(); },
      toggleSupp: () => { if (d.id === "none") S.intake.supplemental = ["none"]; else { S.intake.supplemental = S.intake.supplemental.filter((x) => x !== "none"); toggleArr(S.intake.supplemental, d.id); } touch(); render(); },
      removeExcl: () => { const arr = exclusionsFor(); arr.splice(Number(d.i), 1); touch(); render(); },
      addExcl: () => { const v = (S.intake.customExclusion || "").trim(); if (v) { exclusionsFor().push(v); S.intake.customExclusion = ""; touch(); render(); } },
      smartPaste: () => { alert("Smart-paste extraction (claude -p) lands in the next build phase — for now, Skip and fill the form."); },
      feeMode: () => { S.estimate.feeMode = d.v; touch(); render(); },
      rateSet: () => { S.estimate.rateSet = d.v; touch(); render(); },
      toggleRound: () => { S.estimate.roundStep = S.estimate.roundStep ? 0 : 250; touch(); render(); },
      aiEstimate: () => { alert("AI estimate auto-fill (claude -p) lands in the next build phase."); },
      genProposal: async () => {
        if (GENERATING) return;
        await saveImmediate();
        GENERATING = true; render();
        try {
          const r = await api("/api/proposal/generate", { method: "POST", body: JSON.stringify({ draft_id: S.draftId }) });
          S.proposal.sections = r.sections; localStorage.setItem(LS_KEY, JSON.stringify(S));
        } catch (e) { alert("Generation failed: " + e.message); }
        GENERATING = false; render();
      },
      newDraft: () => { const id = uuid(); S = freshState(); S.draftId = id; localStorage.setItem("kbid.draftId", id); const u = new URL(location.href); u.searchParams.set("d", id); history.replaceState(null, "", u); touch(); render(); },
      dlDocx: async () => { await saveImmediate(); await downloadFile("/api/proposal/docx", { draft_id: S.draftId }); },
      dlPdf: async () => { await saveImmediate(); await downloadFile("/api/proposal/pdf", { draft_id: S.draftId }); },
      dlIndesign: async () => { await saveImmediate(); await downloadFile("/api/proposal/indesign", { draft_id: S.draftId }); },
      sendFeedback: async () => {
        const text = (S.proposal.feedbackA || "").trim();
        if (!text) { alert("Type what you changed first."); return; }
        try { await api("/api/proposal/feedback", { method: "POST", body: JSON.stringify({ draft_id: S.draftId, text }) }); alert("Thanks — logged. This helps improve the template and questions."); }
        catch (e) { alert("Could not send feedback: " + e.message); }
      },
      uploadFinal: () => alert("Upload-and-diff (compare your edited .docx to the generated draft) lands in a later phase."),
    };
    if (actions[a]) actions[a]();
  });
  function toggleArr(arr, id) { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); else arr.push(id); }

  boot();
})();
