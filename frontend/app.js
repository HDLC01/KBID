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
    estimate: { sheet: "estimate", feeMode: "lump", rateSet: "current", rows: {}, lineOrder: ROLES.map((r) => r.id), customRows: [], rowLabels: {}, rateOverrides: {}, formulas: {}, sheetSizes: {}, budget: "", contingencyPct: 0, consultants: { Code: "", Architecture: "", MEP: "", Structural: "" }, roundStep: 250, result: null },
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
    ACTIVE_CELL = null;
    const a = app();
    a.removeAttribute("aria-busy");
    a.innerHTML = `
      <div class="app-shell">
        ${headerHTML()}
        <main class="content ${S.stage === "estimate" ? "wide" : ""}">${screenHTML()}</main>
        ${footerHTML()}
      </div>`;
    if (S.stage === "estimate") {
      ensureEstimateWorkbookState();
      requestAnimationFrame(() => { decorateEstimateSheet(); recalculateSheetFormulas(); });
      scheduleCompute();
    }
    if (S.stage === "intake") requestAnimationFrame(revealActiveIntakeStep);
    setSave(SAVE_STATE);
  }

  function revealActiveIntakeStep() {
    const nav = document.querySelector(".intake-step-nav");
    const active = nav?.querySelector(".intake-step-btn[aria-current='step']");
    if (!nav || !active) return;
    nav.scrollLeft = Math.max(0, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2);
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
  const hasValue = (v) => v !== null && v !== undefined && String(v).trim() !== "";
  const requiredMark = () => ` <span class="required-mark" aria-hidden="true">Required</span>`;
  function intakeRequirements() {
    const k = S.intake, c = k.client || {}, p = k.project || {}, commercial = isCommercial(k.projectType);
    const phaseRequirements = PHASES.filter((phase) => k.phases.includes(phase.id)).flatMap((phase) => {
      const m = k.meetings[phase.id] || {};
      return [m.meetings, m.weeks];
    });
    return [
      [],
      [k.projectType],
      [c.name, c.contact, c.title, c.address, c.phone, c.email, ...(commercial ? [c.signatory] : [])],
      [p.name, p.address, p.date, ...(commercial ? [p.gc] : [])],
      [k.architect],
      [k.context?.notes, k.context?.decision, k.context?.timeline],
      [k.scope?.text, k.scope?.kind],
      [k.phases.length ? "selected" : ""],
      [k.supplemental.length ? "selected" : ""],
      [k.phases.length ? "selected" : "", ...phaseRequirements, k.startWeeks],
      [],
    ].map((values) => values.filter((value) => !hasValue(value)).length);
  }
  function intakeStepNav(n) {
    const missing = intakeRequirements();
    return `<nav class="intake-step-nav" aria-label="Intake steps"><ol>${INTAKE_STEPS.map((name, i) => {
      const current = i === n, incomplete = missing[i] > 0;
      const state = current ? "current" : incomplete ? "incomplete" : "complete";
      const suffix = incomplete ? `, ${missing[i]} required item${missing[i] === 1 ? "" : "s"} missing` : ", complete";
      return `<li><button type="button" class="intake-step-btn ${state}" data-action="goIntakeStep" data-step="${i}" ${current ? 'aria-current="step"' : ""} aria-label="Step ${i + 1}: ${esc(name)}${suffix}"><span class="intake-step-num">${i + 1}</span><span>${esc(name)}</span>${incomplete ? '<span class="intake-step-alert" aria-hidden="true">!</span>' : ""}</button></li>`;
    }).join("")}</ol></nav>`;
  }
  function stepHead(n, title, lede) {
    return `${intakeStepNav(n)}
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
        `<div class="field"><label>Project type${requiredMark()}</label><div class="select-grid ${k.projectType ? "" : "required-choice"}">${PROJECT_TYPES.map((p) => selCard(k.projectType === p.id, p.label, p.desc, "pickType", `data-id="${p.id}"`)).join("")}</div></div>`;
    } else if (n === 2) {
      body = stepHead(2, "Client information") +
        field("Client / company name", "intake.client.name", c.name, "text", true) +
        `<div class="two-col">${field("Primary contact name", "intake.client.contact", c.contact, "text", true)}${field("Contact title", "intake.client.title", c.title, "text", true)}</div>` +
        field("Mailing address", "intake.client.address", c.address, "text", true) +
        `<div class="two-col">${field("Phone", "intake.client.phone", c.phone, "tel", true)}${field("Email", "intake.client.email", c.email, "email", true)}</div>` +
        (comm ? field("Signatory / authorized title", "intake.client.signatory", c.signatory, "text", true) : "");
    } else if (n === 3) {
      const p = k.project;
      body = stepHead(3, "Project details") +
        field("Project name / title", "intake.project.name", p.name, "text", true) +
        field("Project address", "intake.project.address", p.address, "text", true) +
        `<div class="two-col">${field("Proposal date", "intake.project.date", p.date, "date", true)}${field("Project number (optional)", "intake.project.number", p.number)}</div>` +
        (comm ? `<div class="two-col">${field("General contractor (or TBD)", "intake.project.gc", p.gc, "text", true)}${field("Building owner (if different)", "intake.project.owner", p.owner)}</div>${field("Architect of record (if applicable)", "intake.project.architect", p.architect)}` : "");
    } else if (n === 4) {
      body = stepHead(4, "Architect relationship", "This changes key language throughout the proposal.") +
        `<div class="field"><label>Architect relationship${requiredMark()}</label><div class="select-grid ${k.architect ? "" : "required-choice"}">${ARCHITECT_RELS.map((r) => selCard(k.architect === r.id, r.label, r.desc, "pickArchitect", `data-id="${r.id}"`)).join("")}</div></div>`;
    } else if (n === 5) {
      const ctx = k.context;
      body = stepHead(5, "What makes this project unique?", "The most important step for a proposal that feels custom.") +
        `<div class="field"><label>Free-form notes${requiredMark()}</label><textarea data-model="intake.context.notes" aria-invalid="${!hasValue(ctx.notes)}" class="${hasValue(ctx.notes) ? "" : "required-input"}" placeholder="Client personality, timeline pressures, budget sensitivity, past experiences, what needs to go right…">${esc(ctx.notes)}</textarea></div>
        <div class="field"><label>Client decision-making style${requiredMark()}</label><div class="chips ${hasValue(ctx.decision) ? "" : "required-choice"}">${DECISION_STYLES.map((d) => chip(ctx.decision === d, d, "pickDecision", `data-v="${esc(d)}"`)).join("")}</div></div>
        <div class="field"><label>Timeline urgency${requiredMark()}</label><div class="chips ${hasValue(ctx.timeline) ? "" : "required-choice"}">${TIMELINES.map((d) => chip(ctx.timeline === d, d, "pickTimeline", `data-v="${esc(d)}"`)).join("")}</div></div>
        ${field("Tone guidance (optional)", "intake.context.tone", ctx.tone)}`;
    } else if (n === 6) {
      body = stepHead(6, "Scope overview") +
        `<div class="field"><label>Scope description${requiredMark()}</label><textarea data-model="intake.scope.text" aria-invalid="${!hasValue(k.scope.text)}" class="${hasValue(k.scope.text) ? "" : "required-input"}" placeholder="What KBID is doing, which spaces, the goal, the deliverables…">${esc(k.scope.text)}</textarea></div>
        <div class="two-col">${field("Square footage (optional)", "intake.scope.sqft", k.scope.sqft, "number")}<div class="field"><label>Construction type${requiredMark()}</label><div class="chips ${hasValue(k.scope.kind) ? "" : "required-choice"}">${CONSTRUCTION_KINDS.map((v) => chip(k.scope.kind === v, v, "pickKind", `data-v="${esc(v)}"`)).join("")}</div></div></div>`;
    } else if (n === 7) {
      body = stepHead(7, "Design phases", "Choose the phases this engagement covers.") +
        `<div class="field"><label>Design phases${requiredMark()}</label><div class="select-grid ${k.phases.length ? "" : "required-choice"}">${PHASES.map((p) => selCard(k.phases.includes(p.id), p.label, "", "togglePhase", `data-id="${p.id}"`, true)).join("")}</div></div>`;
    } else if (n === 8) {
      body = stepHead(8, "Supplemental services") +
        `<div class="field"><label>Supplemental services${requiredMark()}</label><div class="select-grid ${k.supplemental.length ? "" : "required-choice"}">${SUPPLEMENTAL.map((p) => selCard(k.supplemental.includes(p.id), p.label, "", "toggleSupp", `data-id="${p.id}"`, true)).join("")}</div></div>`;
    } else if (n === 9) {
      const chosen = PHASES.filter((p) => k.phases.includes(p.id));
      body = stepHead(9, "Meetings & timeline", "For each phase, how many client meetings and how many weeks?") +
        (chosen.length ? chosen.map((p) => {
          const m = k.meetings[p.id] || {};
          const meetingsMissing = !hasValue(m.meetings), weeksMissing = !hasValue(m.weeks);
          return `<div class="field"><label>${esc(p.label)}${requiredMark()}</label><div class="two-col">
            <input type="number" min="0" step="1" data-model="intake.meetings.${p.id}.meetings" aria-invalid="${meetingsMissing}" class="${meetingsMissing ? "required-input" : ""}" value="${m.meetings ?? ""}" placeholder="# client meetings (e.g. 2)" />
            <input type="number" min="0" step="1" data-model="intake.meetings.${p.id}.weeks" aria-invalid="${weeksMissing}" class="${weeksMissing ? "required-input" : ""}" value="${m.weeks ?? ""}" placeholder="duration (weeks)" /></div></div>`;
        }).join("") : `<p class="lede">Select design phases in the previous step first.</p>`) +
        `<div class="field"><label>Weeks until KBID can start after signing${requiredMark()}</label><div class="chips ${hasValue(k.startWeeks) ? "" : "required-choice"}">${START_WEEKS.map((v) => chip(k.startWeeks === v, v, "pickStart", `data-v="${esc(v)}"`)).join("")}</div></div>`;
    } else if (n === 10) {
      const ex = exclusionsFor();
      body = stepHead(10, "Exclusions & notes", "Auto-filled by project type — tap × to remove any that don't apply.") +
        `<div class="pills">${ex.map((x, i) => `<span class="pill">${esc(x)} <button data-action="removeExcl" data-i="${i}" aria-label="remove">×</button></span>`).join("") || '<span class="lede">No exclusions.</span>'}</div>
        <div class="field" style="margin-top:16px"><label>Add a custom exclusion</label><div class="two-col" style="grid-template-columns:1fr auto"><input type="text" data-model="intake.customExclusion" value="${esc(k.customExclusion)}" placeholder="Type an exclusion and press Add" /><button class="btn" data-action="addExcl">Add</button></div></div>
        <div class="field"><label>Special notes</label><textarea data-model="intake.notes" placeholder="Anything else to capture…">${esc(k.notes)}</textarea></div>`;
    }
    return `<div class="card">${body}</div>`;
  }

  function field(label, model, val, type, required = false) {
    const missing = required && !hasValue(val);
    return `<div class="field"><label>${esc(label)}${required ? requiredMark() : ""}</label><input type="${type || "text"}" data-model="${model}" value="${esc(val)}" ${required ? `aria-invalid="${missing}" class="${missing ? "required-input" : ""}"` : ""} /></div>`;
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

  function ensureEstimateLineState() {
    const e = S.estimate;
    if (!Array.isArray(e.lineOrder)) e.lineOrder = ROLES.map((role) => role.id);
    if (!Array.isArray(e.customRows)) e.customRows = [];
    if (!e.rowLabels || typeof e.rowLabels !== "object") e.rowLabels = {};
    if (!e.rateOverrides || typeof e.rateOverrides !== "object") e.rateOverrides = {};
  }
  function ensureEstimateWorkbookState() {
    ensureEstimateLineState();
    const e = S.estimate;
    if (!e.formulas || typeof e.formulas !== "object") e.formulas = {};
    if (!e.sheetSizes || typeof e.sheetSizes !== "object") e.sheetSizes = {};
    const sheet = e.sheet || "estimate";
    if (!e.formulas[sheet] || typeof e.formulas[sheet] !== "object") e.formulas[sheet] = {};
    if (!e.sheetSizes[sheet] || typeof e.sheetSizes[sheet] !== "object") e.sheetSizes[sheet] = { cols: {}, rows: {} };
    if (!e.sheetSizes[sheet].cols) e.sheetSizes[sheet].cols = {};
    if (!e.sheetSizes[sheet].rows) e.sheetSizes[sheet].rows = {};
  }
  function estimateLineRows() {
    ensureEstimateLineState();
    const e = S.estimate, baseRates = RATE_SETS[e.rateSet] || RATE_SETS.current;
    return e.lineOrder.map((id) => {
      const base = ROLES.find((role) => role.id === id);
      const custom = e.customRows.find((row) => row.id === id);
      if (!base && !custom) return null;
      const label = Object.prototype.hasOwnProperty.call(e.rowLabels, id) ? e.rowLabels[id] : (base?.label || custom.label || "Estimate row");
      const rate = Object.prototype.hasOwnProperty.call(e.rateOverrides, id) ? Number(e.rateOverrides[id]) || 0 : (base ? baseRates[id] : Number(custom.rate) || 0);
      return { id, label, rate, custom: !!custom };
    }).filter(Boolean);
  }
  function insertEstimateLine(anchorId, after = false) {
    ensureEstimateLineState();
    const id = `custom_${uuid().replaceAll("-", "")}`;
    const index = Math.max(0, S.estimate.lineOrder.indexOf(anchorId));
    S.estimate.customRows.push({ id, label: "New estimate row", rate: 0 });
    S.estimate.rowLabels[id] = "New estimate row";
    S.estimate.rateOverrides[id] = 0;
    S.estimate.lineOrder.splice(index + (after ? 1 : 0), 0, id);
    estimateRows().forEach(({ row }) => { row.hpw[id] = 0; });
    touch(); render();
  }
  function deleteEstimateLine(id) {
    ensureEstimateLineState();
    if (S.estimate.lineOrder.length <= 1) { alert("The estimate must keep at least one billing row."); return; }
    S.estimate.lineOrder = S.estimate.lineOrder.filter((rowId) => rowId !== id);
    S.estimate.customRows = S.estimate.customRows.filter((row) => row.id !== id);
    delete S.estimate.rowLabels[id]; delete S.estimate.rateOverrides[id];
    estimateRows().forEach(({ row }) => { delete row.hpw[id]; });
    touch(); render();
  }

  const ESTIMATE_SHEETS = [
    { id: "project", label: "Project Setup" }, { id: "estimate", label: "Design Fee Estimate" },
    { id: "budget", label: "Project Budget" }, { id: "guide", label: "Proposal Guide" },
  ];
  let ACTIVE_CELL = null;
  let ROW_MENU_ID = null;
  let SHEET_RESIZE = null;
  let FORMULA_BAR_DIRTY = false;
  function colLetter(n) { let out = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + (n - 1) % 26) + out; return out; }
  function addressParts(address) { const m = String(address || "").match(/^([A-Z]+)(\d+)$/i); if (!m) return null; return { col: m[1].toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0), row: Number(m[2]) }; }
  function cellAttrs(address, label) { return `data-cell-address="${address}" data-cell-label="${esc(label)}"`; }
  function editCell(value, attrs, address, label, type = "number", step = "0.5") {
    const numeric = type === "number";
    return `<td class="sheet-cell sheet-edit"><input type="${numeric ? "text" : type}" ${numeric ? `inputmode="decimal" data-cell-numeric="true" data-number-step="${step}"` : ""} ${attrs} ${cellAttrs(address, label)} value="${esc(value)}" aria-label="${esc(label)}" /></td>`;
  }
  function modelCell(value, model, address, label, type = "text") { return editCell(value, `data-model="${model}"`, address, label, type, "any"); }
  function calcCell(value, id, address, label, blank = false) {
    return `<td class="sheet-cell sheet-calc num" tabindex="0" ${cellAttrs(address, label)} data-cell-readonly="true" data-cell-value="${esc(value)}" aria-label="${esc(label)}, calculated">${id ? `<span id="${id}">${esc(value)}</span>` : (blank ? "" : esc(value))}</td>`;
  }
  function formulaBarHTML() {
    return `<div class="formula-bar" role="group" aria-label="Cell editor"><input class="formula-name" id="formula-name" readonly value="" aria-label="Selected cell" /><span aria-hidden="true">fx</span><input class="formula-value" id="formula-value" data-formula-bar="true" disabled value="" aria-label="Selected cell value" /></div>`;
  }
  function workbookTabs(active) {
    return `<div class="workbook-tabs" role="tablist" aria-label="Estimate workbook sheets">${ESTIMATE_SHEETS.map((sheet) => `<button type="button" role="tab" class="workbook-tab ${sheet.id === active ? "active" : ""}" data-action="goEstimateSheet" data-sheet="${sheet.id}" aria-selected="${sheet.id === active}">${esc(sheet.label)}</button>`).join("")}</div>`;
  }
  function sheetColgroup(count) { return `<colgroup><col class="sheet-row-col" />${Array.from({ length: count }, (_, i) => `<col data-sheet-col="${i + 1}" />`).join("")}</colgroup>`; }
  function sheetColumns(count) { return `<tr class="sheet-columns"><th class="sheet-corner"></th>${Array.from({ length: count }, (_, i) => `<th data-col-index="${i + 1}">${colLetter(i + 1)}<span class="col-resize" data-col-index="${i + 1}" aria-hidden="true"></span></th>`).join("")}</tr>`; }
  function projectSheetHTML() {
    const c = S.intake.client || {}, p = S.intake.project || {};
    return `<table class="sheet-table simple-sheet">${sheetColgroup(2)}<thead>${sheetColumns(2)}<tr><th class="sheet-row">1</th><th colspan="2" class="sheet-title">KBID · Project Setup</th></tr></thead><tbody>
      <tr><th class="sheet-row">2</th><td class="sheet-label">Project name</td>${modelCell(p.name, "intake.project.name", "B2", "Project name", "text")}</tr>
      <tr><th class="sheet-row">3</th><td class="sheet-label">Client / company</td>${modelCell(c.name, "intake.client.name", "B3", "Client / company", "text")}</tr>
      <tr><th class="sheet-row">4</th><td class="sheet-label">Project address</td>${modelCell(p.address, "intake.project.address", "B4", "Project address", "text")}</tr>
      <tr><th class="sheet-row">5</th><td class="sheet-label">Proposal date</td>${modelCell(p.date, "intake.project.date", "B5", "Proposal date", "date")}</tr>
      <tr><th class="sheet-row">6</th><td class="sheet-label">Square footage</td>${modelCell(S.intake.scope?.sqft, "intake.scope.sqft", "B6", "Square footage", "number")}</tr>
    </tbody></table>`;
  }
  function budgetSheetHTML(e) {
    const v = (value) => value === "" || value == null ? "" : value;
    return `<table class="sheet-table simple-sheet">${sheetColgroup(2)}<thead>${sheetColumns(2)}<tr><th class="sheet-row">1</th><th colspan="2" class="sheet-title">KBID · Project Budget</th></tr></thead><tbody>
      <tr><th class="sheet-row">2</th><td class="sheet-label">Construction budget</td>${modelCell(v(e.budget), "estimate.budget", "B2", "Construction budget")}</tr>
      <tr><th class="sheet-row">3</th><td class="sheet-label">Contingency percent</td>${modelCell(v(e.contingencyPct), "estimate.contingencyPct", "B3", "Contingency percent")}</tr>
      <tr><th class="sheet-row">4</th><td class="sheet-label">Structural allowance</td>${modelCell(v(e.consultants.Structural), "estimate.consultants.Structural", "B4", "Structural allowance")}</tr>
      <tr><th class="sheet-row">5</th><td class="sheet-label">MEP allowance</td>${modelCell(v(e.consultants.MEP), "estimate.consultants.MEP", "B5", "MEP allowance")}</tr>
    </tbody></table>`;
  }
  function guideSheetHTML() {
    const result = S.estimate.result || {}, checks = result.checks || {};
    const fee = result.design_fee_rounded || result.total_fee_raw || 0;
    const pct = checks.fee_pct_of_budget == null ? "—" : `${(checks.fee_pct_of_budget * 100).toFixed(1)}%`;
    return `<table class="sheet-table simple-sheet">${sheetColgroup(2)}<thead>${sheetColumns(2)}<tr><th class="sheet-row">1</th><th colspan="2" class="sheet-title">KBID · Proposal Guide</th></tr></thead><tbody>
      <tr><th class="sheet-row">2</th><td class="sheet-label">Total design fee</td>${calcCell(money(fee), "guide-fee", "B2", "Total design fee")}</tr>
      <tr><th class="sheet-row">3</th><td class="sheet-label">Fee percentage of budget</td>${calcCell(pct, "guide-pct", "B3", "Fee percentage of budget")}</tr>
      <tr><th class="sheet-row">4</th><td class="sheet-label">Square-foot benchmark</td>${calcCell(checks.sf_benchmark_for_type ? money(checks.sf_benchmark_for_type) : "—", "guide-sf", "B4", "Square-foot benchmark")}</tr>
    </tbody></table>`;
  }
  function estimateGridHTML(rows, e) {
    const lineRows = estimateLineRows(), phaseColumns = rows.length * 3;
    const groupHeaders = rows.map(({ phase }) => `<th colspan="3" class="sheet-phase">${esc(phase.short)}</th>`).join("");
    const subHeaders = rows.map(() => `<th>hrs / wk</th><th>hours</th><th>fee</th>`).join("");
    const rowHead = (line, n) => `<th class="sheet-row editable-row-head"><button type="button" data-action="openEstimateRowMenu" data-rowid="${line.id}" aria-label="Actions for row ${n}, ${esc(line.label)}">${n}</button>${ROW_MENU_ID === line.id ? `<div class="row-menu"><button type="button" data-action="insertEstimateRowAbove" data-rowid="${line.id}">Insert row above</button><button type="button" data-action="insertEstimateRowBelow" data-rowid="${line.id}">Insert row below</button><button type="button" class="danger" data-action="deleteEstimateRow" data-rowid="${line.id}">Delete row</button></div>` : ""}</th>`;
    let rowNumber = 1;
    const duration = `<tr><th class="sheet-row">${rowNumber++}</th><td class="sheet-label muted">Duration (weeks)</td>${calcCell("", "", "B1", "Duration rate spacer", true)}${rows.map(({ phase, row }, i) => editCell(row.weeks ?? 0, `data-estweeks="${phase.id}"`, `${colLetter(3 + i * 3)}1`, `${phase.label} duration`, "number", "1") + calcCell("", "", `${colLetter(4 + i * 3)}1`, `${phase.label} duration spacer`, true) + calcCell("", "", `${colLetter(5 + i * 3)}1`, `${phase.label} duration spacer`, true)).join("")}</tr>`;
    const roleRows = lineRows.map((line) => {
      const cells = rows.map(({ phase, row }, i) => {
        const col = 3 + i * 3, value = row.hpw[line.id] ?? 0;
        return editCell(value, `data-estrow="${phase.id}" data-estrole="${line.id}"`, `${colLetter(col)}${rowNumber}`, `${phase.label} ${line.label} hours per week`) + calcCell("0", `hrs-${phase.id}-${line.id}`, `${colLetter(col + 1)}${rowNumber}`, `${phase.label} ${line.label} calculated hours`) + calcCell("$0", `fee-${phase.id}-${line.id}`, `${colLetter(col + 2)}${rowNumber}`, `${phase.label} ${line.label} calculated fee`);
      }).join("");
      const n = rowNumber;
      const out = `<tr data-estimate-line="${line.id}">${rowHead(line, n)}<td class="sheet-edit sheet-role-edit"><input type="text" data-rowlabel="${line.id}" ${cellAttrs(`A${n}`, `${line.label} row label`)} value="${esc(line.label)}" aria-label="Row ${n} label" /></td>${editCell(line.rate, `data-rowrate="${line.id}"`, `B${n}`, `${line.label} hourly rate`, "number", "1")}${cells}</tr>`;
      rowNumber++;
      return out;
    }).join("");
    const meetingRate = estimateLineRows().find((line) => line.id === "design_director")?.rate || 0;
    const meetings = `<tr><th class="sheet-row">${rowNumber}</th><td class="sheet-label">Meetings <span>prep + attend</span></td>${calcCell(money(meetingRate), "", `B${rowNumber}`, "Meeting hourly rate")}${rows.map(({ phase, row }, i) => { const col = 3 + i * 3; return editCell(row.meetings ?? 0, `data-estmtg="${phase.id}"`, `${colLetter(col)}${rowNumber}`, `${phase.label} meetings`) + calcCell("", "", `${colLetter(col + 1)}${rowNumber}`, `${phase.label} meetings spacer`, true) + calcCell("$0", `mfee-${phase.id}`, `${colLetter(col + 2)}${rowNumber}`, `${phase.label} meeting fee`); }).join("")}</tr>`;
    rowNumber++;
    const totals = `<tr class="sheet-total"><th class="sheet-row">${rowNumber}</th><td class="sheet-label">Phase subtotal</td>${calcCell("", "", `B${rowNumber}`, "Subtotal rate spacer", true)}${rows.map(({ phase }, i) => { const col = 3 + i * 3; return calcCell("", "", `${colLetter(col)}${rowNumber}`, `${phase.label} subtotal spacer`, true) + calcCell("", "", `${colLetter(col + 1)}${rowNumber}`, `${phase.label} subtotal spacer`, true) + calcCell("$0", `ptot-${phase.id}`, `${colLetter(col + 2)}${rowNumber}`, `${phase.label} subtotal`); }).join("")}</tr>`;
    return `<table class="sheet-table estimate-sheet">${sheetColgroup(phaseColumns + 2)}<thead>${sheetColumns(phaseColumns + 2)}<tr><th class="sheet-row"></th><th class="sheet-title">Role</th><th class="sheet-title">Rate</th>${groupHeaders}</tr><tr><th class="sheet-row"></th><th></th><th>$/hr</th>${subHeaders}</tr></thead><tbody>${duration}${roleRows}${meetings}${totals}</tbody></table>`;
  }
  function estimateHTML() {
    const rows = estimateRows(), e = S.estimate;
    const activeSheet = e.sheet || "estimate";
    const content = activeSheet === "project" ? projectSheetHTML() : activeSheet === "budget" ? budgetSheetHTML(e) : activeSheet === "guide" ? guideSheetHTML() : rows.length ? estimateGridHTML(rows, e) : `<div class="sheet-empty">Select design phases in Intake · Step 8 to populate this worksheet.</div>`;
    return `<section class="estimate-workspace">
      <div class="est-toolbar"><div class="seg"><button class="${e.feeMode === "lump" ? "on" : ""}" data-action="feeMode" data-v="lump">Lump sum per phase</button><button class="${e.feeMode === "hourly" ? "on" : ""}" data-action="feeMode" data-v="hourly">Hourly with ranges</button></div><div class="seg"><button class="${e.rateSet === "current" ? "on" : ""}" data-action="rateSet" data-v="current">Current rates</button><button class="${e.rateSet === "legacy" ? "on" : ""}" data-action="rateSet" data-v="legacy">Previous ($175 flat)</button></div><button class="btn" data-action="aiEstimate">✨ Auto-fill with AI</button>${activeSheet === "estimate" && rows.length ? '<button class="btn" data-action="appendEstimateRow">+ Add row</button>' : ""}<button class="btn sheet-round ${e.roundStep ? "on" : ""}" data-action="toggleRound">Round proposal fees</button></div>
      ${workbookTabs(activeSheet)}${formulaBarHTML()}<div class="sheet-viewport">${content}</div>
      <div class="estimate-total-bar"><div><span class="tb-label">Design fee</span><strong id="grand">$0</strong></div><div><span class="tb-label">Hours</span><span id="hours-sub">0 hours across ${rows.length} phases</span></div><div><span class="tb-label">Budget check</span><span id="pct-badge">—</span> <span id="pct-sub">of construction budget</span></div><div><span class="tb-label">$/SF check</span><span id="sf-bench">—</span></div></div>
    </section>`;
  }

  function buildComputeBody() {
    const rows = estimateRows();
    const lines = estimateLineRows();
    const cons = {};
    Object.entries(S.estimate.consultants).forEach(([k, v]) => { if (v !== "" && v != null) cons[k] = Number(v) || 0; });
    return {
      rate_set: "custom",
      roles: lines.map((line) => line.id),
      rates: Object.fromEntries(lines.map((line) => [line.id, line.rate])),
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
    const setCellText = (el, value) => {
      if (!el) return;
      el.textContent = value;
      const cell = el.closest("[data-cell-address]");
      if (cell) cell.dataset.cellValue = value;
    };
    const byName = {};
    r.phases.forEach((p) => (byName[p.name] = p));
    estimateRows().forEach(({ phase }) => {
      const p = byName[phase.label]; if (!p) return;
      estimateLineRows().forEach((line) => {
        const rl = p.roles[line.id] || {};
        const hEl = document.getElementById(`hrs-${phase.id}-${line.id}`); setCellText(hEl, (rl.hours || 0).toString());
        const fEl = document.getElementById(`fee-${phase.id}-${line.id}`); setCellText(fEl, money(rl.fee));
      });
      const mEl = document.getElementById(`mfee-${phase.id}`); setCellText(mEl, money(p.meeting_fee));
      const tEl = document.getElementById(`ptot-${phase.id}`); setCellText(tEl, money(p.total_raw));
    });
    const g = document.getElementById("grand"); if (g) g.textContent = money(r.design_fee_rounded || r.total_fee_raw);
    const guideFee = document.getElementById("guide-fee"); setCellText(guideFee, money(r.design_fee_rounded || r.total_fee_raw));
    const hs = document.getElementById("hours-sub"); if (hs) hs.textContent = `${Math.round(r.total_hours)} hours across ${r.phases.length} phases`;
    const pb = document.getElementById("pct-badge"), ps = document.getElementById("pct-sub");
    if (pb) {
      const pct = r.checks.fee_pct_of_budget;
      if (pct == null) { pb.className = ""; pb.textContent = "—"; if (ps) ps.textContent = "add a construction budget"; }
      else { const inband = r.checks.fee_pct_in_band; pb.className = inband ? "good" : "warn"; pb.textContent = (pct * 100).toFixed(1) + "% · " + (inband ? "within 5–12%" : "outside 5–12%"); if (ps) ps.textContent = "of construction budget"; }
      const guidePct = document.getElementById("guide-pct"); setCellText(guidePct, pct == null ? "—" : `${(pct * 100).toFixed(1)}%`);
    }
    const sf = document.getElementById("sf-bench");
    if (sf) { const v = r.checks.sf_benchmark_for_type; sf.textContent = v ? money(v) + " benchmark" : "add square footage"; }
    const guideSf = document.getElementById("guide-sf"); setCellText(guideSf, r.checks.sf_benchmark_for_type ? money(r.checks.sf_benchmark_for_type) : "—");
    requestAnimationFrame(recalculateSheetFormulas);
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

  // ---------- workbook formulas + sizing ----------
  function activeFormulaMap() {
    ensureEstimateWorkbookState();
    return S.estimate.formulas[S.estimate.sheet || "estimate"];
  }
  function formulaForCell(cell) { return cell?.dataset?.cellAddress ? activeFormulaMap()[cell.dataset.cellAddress] : null; }
  function displayNumber(value) {
    if (!Number.isFinite(value)) return "";
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
  }
  function spreadsheetLiteral(cell) {
    const raw = cell.dataset.cellValue ?? cell.value ?? cell.textContent.trim();
    if (cell.dataset.cellNumeric === "true") {
      const n = Number(String(raw).replaceAll(",", ""));
      return Number.isFinite(n) ? n : raw;
    }
    if (cell.dataset.cellReadonly === "true") {
      const text = String(raw).trim();
      if (/^-?\$?[\d,]+(?:\.\d+)?%?$/.test(text)) {
        const n = Number(text.replace(/[$,%]/g, ""));
        if (Number.isFinite(n)) return text.endsWith("%") ? n / 100 : n;
      }
    }
    return raw;
  }
  function setFormulaResultInState(cell, value) {
    let changed = false;
    const setNumber = (object, key) => {
      if (!object || !key) return;
      const old = Number(object[key]);
      if (!Number.isFinite(old) || Math.abs(old - value) > 1e-9) { object[key] = value; changed = true; }
    };
    if (cell.dataset.model) {
      const parts = cell.dataset.model.split(".");
      let target = S;
      for (let i = 0; i < parts.length - 1; i++) target = target?.[parts[i]];
      if (target) setNumber(target, parts[parts.length - 1]);
    }
    if (cell.dataset.rowrate) setNumber(S.estimate.rateOverrides, cell.dataset.rowrate);
    if (cell.dataset.estrow) setNumber(S.estimate.rows[cell.dataset.estrow]?.hpw, cell.dataset.estrole);
    if (cell.dataset.estmtg) setNumber(S.estimate.rows[cell.dataset.estmtg], "meetings");
    if (cell.dataset.estweeks) setNumber(S.estimate.rows[cell.dataset.estweeks], "weeks");
    return changed;
  }
  function recalculateSheetFormulas() {
    if (S.stage !== "estimate" || !window.HyperFormula) return;
    const formulas = activeFormulaMap();
    const formulaEntries = Object.entries(formulas);
    if (!formulaEntries.length) return;
    const cells = Array.from(document.querySelectorAll(".sheet-table [data-cell-address]"));
    if (!cells.length) return;
    let maxRow = 1, maxCol = 1;
    const byAddress = {};
    cells.forEach((cell) => {
      const parts = addressParts(cell.dataset.cellAddress);
      if (!parts) return;
      maxRow = Math.max(maxRow, parts.row); maxCol = Math.max(maxCol, parts.col);
      byAddress[cell.dataset.cellAddress.toUpperCase()] = cell;
    });
    const matrix = Array.from({ length: maxRow }, () => Array(maxCol).fill(null));
    Object.entries(byAddress).forEach(([address, cell]) => {
      const parts = addressParts(address);
      matrix[parts.row - 1][parts.col - 1] = formulas[address] || spreadsheetLiteral(cell);
    });
    let engine;
    try { engine = window.HyperFormula.buildFromArray(matrix, { licenseKey: "gpl-v3", smartRounding: true }); }
    catch (error) { console.warn("formula engine failed", error); return; }
    let stateChanged = false;
    formulaEntries.forEach(([address]) => {
      const cell = byAddress[address.toUpperCase()], parts = addressParts(address);
      if (!cell || !parts) return;
      let result;
      try { result = engine.getCellValue({ sheet: 0, row: parts.row - 1, col: parts.col - 1 }); }
      catch { result = "#ERROR!"; }
      const error = result && typeof result === "object" && "value" in result;
      const rendered = error ? String(result.value) : (typeof result === "number" ? displayNumber(result) : String(result ?? ""));
      cell.dataset.formulaResult = rendered;
      cell.dataset.cellValue = rendered;
      cell.closest(".sheet-edit")?.classList.toggle("formula-error", !!error);
      cell.closest(".sheet-edit")?.classList.add("formula-cell");
      if (typeof result === "number" && Number.isFinite(result)) stateChanged = setFormulaResultInState(cell, result) || stateChanged;
      if (document.activeElement !== cell && document.activeElement?.dataset?.formulaBar !== "true") cell.value = rendered;
    });
    if (stateChanged) { touch(); scheduleCompute(); }
  }
  function rowIndexForHeader(header) {
    const button = header.querySelector(":scope > button");
    const n = Number((button ? button.textContent : header.textContent).trim().match(/^\d+/)?.[0]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function decorateEstimateSheet() {
    const table = document.querySelector(".sheet-table");
    if (!table) return;
    table.querySelectorAll("th.sheet-row").forEach((header) => {
      const row = rowIndexForHeader(header);
      if (!row || header.querySelector(".row-resize")) return;
      header.dataset.rowIndex = String(row);
      const handle = document.createElement("span");
      handle.className = "row-resize"; handle.dataset.rowIndex = String(row); handle.setAttribute("aria-hidden", "true");
      header.appendChild(handle);
    });
    applyEstimateSheetSizes();
  }
  function applyEstimateSheetSizes() {
    const table = document.querySelector(".sheet-table");
    if (!table) return;
    ensureEstimateWorkbookState();
    const sizes = S.estimate.sheetSizes[S.estimate.sheet || "estimate"];
    Object.entries(sizes.cols).forEach(([index, width]) => {
      const col = table.querySelector(`col[data-sheet-col="${index}"]`);
      if (col) col.style.width = `${width}px`;
    });
    Object.entries(sizes.rows).forEach(([index, height]) => {
      const header = table.querySelector(`th.sheet-row[data-row-index="${index}"]`);
      if (header) header.closest("tr").style.height = `${height}px`;
    });
  }
  function finishSheetResize(event) {
    if (!SHEET_RESIZE) return;
    const r = SHEET_RESIZE;
    const delta = r.kind === "col" ? event.clientX - r.startX : event.clientY - r.startY;
    const value = Math.round(Math.max(r.kind === "col" ? 54 : 22, Math.min(r.kind === "col" ? 480 : 220, r.startSize + delta)));
    ensureEstimateWorkbookState();
    S.estimate.sheetSizes[S.estimate.sheet || "estimate"][r.kind === "col" ? "cols" : "rows"][r.index] = value;
    r.ghost.remove();
    document.body.classList.remove("resizing-sheet");
    document.body.style.cursor = "";
    SHEET_RESIZE = null;
    applyEstimateSheetSizes(); touch();
  }

  // ---------- events ----------
  function syncFormulaBar() {
    const name = document.getElementById("formula-name"), value = document.getElementById("formula-value");
    if (!name || !value) return;
    const cell = ACTIVE_CELL?.el;
    if (!cell || !cell.isConnected) { name.value = ""; value.value = ""; value.disabled = true; return; }
    name.value = cell.dataset.cellAddress || "";
    value.value = formulaForCell(cell) || cell.dataset.cellValue || cell.value || cell.textContent.trim();
    value.disabled = cell.dataset.cellReadonly === "true" || cell.tagName !== "INPUT";
  }
  document.addEventListener("focusin", (e) => {
    const cell = e.target.closest?.("[data-cell-address]");
    if (!cell) return;
    const formula = formulaForCell(cell);
    if (formula && cell.tagName === "INPUT") cell.value = formula;
    ACTIVE_CELL = { el: cell };
    syncFormulaBar();
  });
  document.addEventListener("focusout", (e) => {
    const cell = e.target.closest?.("input[data-cell-address]");
    if (!cell || e.relatedTarget?.dataset?.formulaBar === "true") return;
    const formula = formulaForCell(cell);
    if (formula) { recalculateSheetFormulas(); cell.value = cell.dataset.formulaResult || ""; }
  });
  document.addEventListener("contextmenu", (e) => {
    const row = e.target.closest?.("tr[data-estimate-line]");
    if (!row) return;
    e.preventDefault();
    ROW_MENU_ID = row.dataset.estimateLine;
    render();
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset?.formulaBar) {
      const cell = ACTIVE_CELL?.el;
      if (cell && cell.isConnected && cell.tagName === "INPUT" && !cell.disabled) {
        cell.value = t.value;
        cell.dispatchEvent(new Event("input", { bubbles: true }));
        FORMULA_BAR_DIRTY = true;
      }
      return;
    }
    if (t.dataset?.cellNumeric === "true" && String(t.value).trim().startsWith("=")) {
      t.dataset.cellValue = t.value;
      if (ACTIVE_CELL?.el === t) syncFormulaBar();
      return;
    }
    if (t.dataset?.cellAddress && activeFormulaMap()[t.dataset.cellAddress]) {
      delete activeFormulaMap()[t.dataset.cellAddress];
      delete t.dataset.formulaResult;
      t.closest(".sheet-edit")?.classList.remove("formula-cell", "formula-error");
    }
    if (t.dataset && t.dataset.model) { setPath(S, t.dataset.model, t.value); touch(); }
    if (t.dataset?.rowlabel) { ensureEstimateLineState(); S.estimate.rowLabels[t.dataset.rowlabel] = t.value; touch(); }
    if (t.dataset?.rowrate) { ensureEstimateLineState(); S.estimate.rateOverrides[t.dataset.rowrate] = Number(t.value) || 0; }
    if (t.dataset && (t.dataset.estrow || t.dataset.estmtg || t.dataset.estweeks || t.dataset.rowrate || t.dataset.model?.startsWith("estimate."))) {
      if (t.dataset.estrow) { const row = S.estimate.rows[t.dataset.estrow]; if (row) row.hpw[t.dataset.estrole] = Number(t.value) || 0; }
      if (t.dataset.estmtg) { const row = S.estimate.rows[t.dataset.estmtg]; if (row) row.meetings = Number(t.value) || 0; }
      if (t.dataset.estweeks) { const row = S.estimate.rows[t.dataset.estweeks]; if (row) row.weeks = Number(t.value) || 0; }
      touch(); scheduleCompute();
    }
    if (t.dataset?.cellAddress) {
      t.dataset.cellValue = t.value;
      if (ACTIVE_CELL?.el === t) syncFormulaBar();
      if (Object.keys(activeFormulaMap()).length) recalculateSheetFormulas();
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset?.cellNumeric !== "true" || !t.dataset.cellAddress) return;
    const raw = String(t.value).trim();
    if (raw.startsWith("=")) {
      activeFormulaMap()[t.dataset.cellAddress] = raw;
      t.closest(".sheet-edit")?.classList.add("formula-cell");
      touch(); recalculateSheetFormulas(); syncFormulaBar();
    } else {
      delete activeFormulaMap()[t.dataset.cellAddress];
      delete t.dataset.formulaResult;
      t.closest(".sheet-edit")?.classList.remove("formula-cell", "formula-error");
      recalculateSheetFormulas();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.dataset?.cellNumeric === "true" && e.key === "Enter") {
      e.preventDefault();
      e.target.dispatchEvent(new Event("change", { bubbles: true }));
      e.target.blur();
      return;
    }
    if (!e.target.dataset?.formulaBar || e.key !== "Enter") return;
    e.preventDefault();
    const cell = ACTIVE_CELL?.el;
    if (cell?.isConnected && !cell.disabled) {
      cell.dispatchEvent(new Event("change", { bubbles: true }));
      FORMULA_BAR_DIRTY = false;
      cell.focus();
    }
  });
  document.addEventListener("focusout", (e) => {
    if (!e.target.dataset?.formulaBar || !FORMULA_BAR_DIRTY) return;
    const cell = ACTIVE_CELL?.el;
    if (cell?.isConnected && !cell.disabled) cell.dispatchEvent(new Event("change", { bubbles: true }));
    FORMULA_BAR_DIRTY = false;
  });

  document.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest?.(".col-resize, .row-resize");
    if (!handle) return;
    const viewport = handle.closest(".sheet-viewport"), table = handle.closest(".sheet-table");
    if (!viewport || !table) return;
    const kind = handle.classList.contains("col-resize") ? "col" : "row";
    const index = Number(handle.dataset[kind === "col" ? "colIndex" : "rowIndex"]);
    const measured = kind === "col" ? handle.parentElement.getBoundingClientRect().width : handle.closest("tr").getBoundingClientRect().height;
    const rect = viewport.getBoundingClientRect(), ghost = document.createElement("div");
    ghost.className = `sheet-resize-ghost ${kind}`;
    if (kind === "col") ghost.style.left = `${e.clientX - rect.left + viewport.scrollLeft}px`;
    else ghost.style.top = `${e.clientY - rect.top + viewport.scrollTop}px`;
    viewport.appendChild(ghost);
    SHEET_RESIZE = { kind, index, startX: e.clientX, startY: e.clientY, startSize: measured, ghost, viewport, rect };
    document.body.classList.add("resizing-sheet"); document.body.style.cursor = kind === "col" ? "col-resize" : "row-resize";
    handle.setPointerCapture?.(e.pointerId); e.preventDefault();
  });
  document.addEventListener("pointermove", (e) => {
    if (!SHEET_RESIZE) return;
    const r = SHEET_RESIZE;
    if (r.kind === "col") r.ghost.style.left = `${e.clientX - r.rect.left + r.viewport.scrollLeft}px`;
    else r.ghost.style.top = `${e.clientY - r.rect.top + r.viewport.scrollTop}px`;
  });
  document.addEventListener("pointerup", finishSheetResize);

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]"); if (!b) return;
    const a = b.dataset.action, d = b.dataset;
    const actions = {
      goStage: () => { S.stage = d.stage; render(); },
      goIntakeStep: () => { S.stage = "intake"; S.step = Number(d.step); touch(); render(); window.scrollTo({ top: 0, behavior: "smooth" }); },
      goEstimateSheet: () => { ROW_MENU_ID = null; S.estimate.sheet = d.sheet; touch(); render(); },
      openEstimateRowMenu: () => { ROW_MENU_ID = ROW_MENU_ID === d.rowid ? null : d.rowid; render(); },
      appendEstimateRow: () => { const order = estimateLineRows(); insertEstimateLine(order[order.length - 1]?.id || "designer", true); },
      insertEstimateRowAbove: () => { ROW_MENU_ID = null; insertEstimateLine(d.rowid, false); },
      insertEstimateRowBelow: () => { ROW_MENU_ID = null; insertEstimateLine(d.rowid, true); },
      deleteEstimateRow: () => { ROW_MENU_ID = null; deleteEstimateLine(d.rowid); },
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
