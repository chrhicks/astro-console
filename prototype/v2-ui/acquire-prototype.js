(() => {
  "use strict";

  const POLICY = Object.freeze({ centeredArcsec: 45, automaticArcsec: 600, maxCorrections: 2, maxSolveAttempts: 3, polarArcmin: 2 });
  const scenarios = {
    "auto-correction": {
      label: "Correcting automatically", kind: "centering", state: "Correction in progress", tone: "activity",
      evidence: { id: "solve-003", solved: true, ra: 58, dec: -41, error: 71, uncertainty: 8, confidence: 99.2 }, corrections: 1,
      assessment: "The target is outside the centered tolerance, but the requested correction is inside the automatic bound. The final permitted automatic correction is now in progress.",
      attempts: [attempt("solve-001", "Solved", "187″ offset", "known"), attempt("move-001", "Corrected", "Accepted by mount", "known"), attempt("solve-003", "Solved", "71″ offset", "selected")],
      alerts: [{ title: "Verification still required", body: "A device-accepted correction is not acquisition success. The next image must prove the result." }]
    },
    "solve-failure": {
      label: "Retrying plate solve", kind: "centering", state: "Automatic retry", tone: "warning",
      evidence: { id: "frame-004", solved: false }, corrections: 1, solveAttempts: 1,
      assessment: "The latest frame produced no plate-solve solution. Its offset is unknown and no mount correction is available, but the automatic retry budget has not been exhausted.",
      attempts: [attempt("solve-002", "Solved", "187″ offset", "known"), attempt("move-001", "Corrected", "Accepted by mount", "known"), attempt("frame-004", "No solution", "Frame preserved · attempt 1 of 3", "selected", true)],
      alerts: [{ title: "Solve retry in progress", body: "Frame 004 is preserved with diagnostics. Automatic retry attempt 2 of 3 is starting." }]
    },
    "solve-exhausted": {
      label: "Solve retries exhausted", kind: "centering", state: "Acquire paused", tone: "danger",
      evidence: { id: "frame-006", solved: false }, corrections: 1, solveAttempts: 3,
      assessment: "Three consecutive frames produced no plate-solve solution. Every failed frame is preserved, the pointing offset remains unknown, and Acquire is paused for an operator recovery decision.",
      attempts: [attempt("frame-004", "No solution", "8 s · attempt 1 of 3", "known", true), attempt("frame-005", "No solution", "8 s · attempt 2 of 3", "known", true), attempt("frame-006", "No solution", "8 s · attempt 3 of 3", "selected", true)],
      alerts: [{ title: "Acquire paused", body: "The three-attempt solve budget is exhausted. Choose a recovery path; no mount correction will be issued.", critical: true }]
    },
    "approval-required": {
      label: "Outside automation bound", kind: "centering", state: "Approval required", tone: "danger",
      evidence: { id: "solve-002", solved: true, ra: 618, dec: -411, error: 742, uncertainty: 21, confidence: 98.6 }, corrections: 0,
      assessment: "The solution is trustworthy, but the requested 12.4′ mount correction exceeds the 10′ automatic limit. The run is paused at an explicit operator decision.",
      attempts: [attempt("frame-001", "Captured", "8.0 s exposure", "known"), attempt("solve-002", "Solved", "12.4′ offset", "selected")],
      alerts: [{ title: "Large pointing correction", body: "Approval is required for requested correction RA +10.3′, Dec −6.9′.", critical: true }]
    },
    centered: {
      label: "Centered and verified", kind: "centering", state: "Acquire complete", tone: "success",
      evidence: { id: "solve-005", solved: true, ra: 24, dec: -20, error: 31, uncertainty: 6, confidence: 99.6 }, corrections: 2,
      assessment: "The latest image independently verifies a 31″ center error, inside the 45″ tolerance. Acquire can hand off evidence to Capture.",
      attempts: [attempt("solve-001", "Solved", "187″ offset", "known"), attempt("solve-003", "Solved", "71″ offset", "known"), attempt("solve-005", "Verified", "31″ · in tolerance", "selected")],
      alerts: []
    },
    "polar-adjust": {
      label: "Polar adjustment required", kind: "polar", state: "Manual adjustment", tone: "warning",
      evidence: { id: "polar-002", alt: -11.2, az: 14.6, error: 18.4, uncertainty: 1.6, confidence: 97.0 },
      assessment: "The measured mount axis is 18.4′ from the celestial pole. This mount has no motorized Alt/Az adjusters; the operator must move the physical controls.",
      attempts: [attempt("polar-001", "Measured", "32.8′ error", "known"), attempt("adjust-001", "Operator adjusted", "Manual controls", "known"), attempt("polar-002", "Measured", "18.4′ error", "selected")],
      alerts: [{ title: "Manual action at mount", body: "Raise altitude 11.2′ and move azimuth left 14.6′, then capture another measurement." }]
    },
    "polar-complete": {
      label: "Polar alignment complete", kind: "polar", state: "Alignment verified", tone: "success",
      evidence: { id: "polar-004", alt: 0.7, az: -1.1, error: 1.3, uncertainty: 0.4, confidence: 99.0 },
      assessment: "The latest measurement puts the mount axis 1.3′ from the celestial pole, inside the 2′ alignment tolerance.",
      attempts: [attempt("polar-001", "Measured", "32.8′ error", "known"), attempt("polar-002", "Measured", "18.4′ error", "known"), attempt("polar-004", "Verified", "1.3′ · in tolerance", "selected")],
      alerts: []
    }
  };

  const state = { scenario: "auto-correction", contextTab: "inspector", inspectorSubject: "evidence", selectedAttempt: "solve-003", feedback: "" };
  const els = {
    scenario: document.querySelector("[data-scenario-control]"), runbar: document.querySelector("[data-runbar]"),
    content: document.querySelector("[data-acquire-content]"), phone: document.querySelector("[data-acquire-phone]"),
    context: document.querySelector("[data-acquire-context]"), feedback: document.querySelector("[data-feedback]"),
    alertCount: document.querySelector("[data-alert-count]")
  };

  function attempt(id, status, detail, selection, failed = false) { return { id, status, detail, selection, failed }; }
  function current() { return scenarios[state.scenario]; }
  function formatOffset(value, unit = "″") { return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(value % 1 ? 1 : 0)}${unit}`; }
  function centeringDecision(model) {
    const e = model.evidence;
    if (!e.solved && model.solveAttempts < POLICY.maxSolveAttempts) return { type: "retrying", title: "Retrying automatically", body: `Automatic retry attempt ${model.solveAttempts + 1} of ${POLICY.maxSolveAttempts} is starting with the failed frame preserved. Offset remains unknown; no mount correction will be issued.` };
    if (!e.solved) return { type: "recovery", title: "Choose a solve recovery", body: `All ${POLICY.maxSolveAttempts} solve attempts failed. Retry with a longer exposure to keep this target active, or skip M27 and continue the plan. No mount movement occurs from unknown pointing.` };
    if (e.error <= POLICY.centeredArcsec) return { type: "complete", title: "Begin Capture", body: `${e.error}″ is inside the ${POLICY.centeredArcsec}″ tolerance. Carry solve ${e.id} forward as the completion evidence.` };
    if (e.error <= POLICY.automaticArcsec && model.corrections < POLICY.maxCorrections) {
      const attemptNumber = model.corrections + 1;
      const attemptLabel = attemptNumber === POLICY.maxCorrections ? "Final automatic correction attempt" : "Automatic correction attempt";
      return { type: "automatic", title: "Correcting automatically", body: `Requested correction RA ${formatOffset(e.ra)}, Dec ${formatOffset(e.dec)} is being applied automatically. ${attemptLabel} · ${attemptNumber} of ${POLICY.maxCorrections}. A new image and solve will verify the result.` };
    }
    return { type: "approval", title: "Approve a large correction", body: `Requested correction: RA ${formatOffset(e.ra)}, Dec ${formatOffset(e.dec)} (${(e.error / 60).toFixed(1)}′ total). The mount may slew noticeably; a new image must verify the result.` };
  }
  function polarDecision(model) {
    const e = model.evidence;
    if (e.error <= POLICY.polarArcmin) return { type: "complete", title: "Accept alignment and continue", body: `${e.error.toFixed(1)}′ is inside the ${POLICY.polarArcmin}′ polar tolerance. Preserve ${e.id} as the verification measurement.` };
    return { type: "manual", title: "Adjust the mount, then measure again", body: `${e.alt < 0 ? "Raise" : "Lower"} altitude ${Math.abs(e.alt).toFixed(1)}′ and move azimuth ${e.az > 0 ? "left" : "right"} ${Math.abs(e.az).toFixed(1)}′. Software does not move these controls.` };
  }
  function decision(model) { return model.kind === "polar" ? polarDecision(model) : centeringDecision(model); }
  function polarInstructions(evidence) {
    return [
      { axis: "Altitude", glyph: evidence.alt < 0 ? "↑" : "↓", direction: evidence.alt < 0 ? "RAISE" : "LOWER", magnitude: `${Math.abs(evidence.alt).toFixed(1)}′` },
      { axis: "Azimuth", glyph: evidence.az > 0 ? "←" : "→", direction: evidence.az > 0 ? "LEFT" : "RIGHT", magnitude: `${Math.abs(evidence.az).toFixed(1)}′` }
    ];
  }

  function centerGeometry(e) {
    const magnitude = Math.max(e.error, 1);
    const length = Math.min(190, Math.max(62, e.error * 0.34));
    return { x: 400 - (e.ra / magnitude) * length, y: 250 + (e.dec / magnitude) * length };
  }
  function polarGeometry(e) {
    const magnitude = Math.max(e.error, 0.1);
    const length = Math.min(180, Math.max(55, e.error * 7));
    return { x: 400 + (e.az / magnitude) * length, y: 250 - (e.alt / magnitude) * length };
  }
  function stars() {
    return [[77,68,1],[132,172,1],[194,92,1.4],[248,309,1],[315,135,1],[356,390,1.3],[471,77,1],[522,348,1],[579,118,1.5],[637,287,1],[704,72,1],[746,402,1.2],[90,419,1],[672,435,1]].map(([x,y,r]) => `<circle cx="${x}" cy="${y}" r="${r}" class="acquire-star"/>`).join("");
  }
  function centerOverlay(model) {
    const e = model.evidence;
    if (!e.solved) return `<div class="acquire-overlay"><svg viewBox="0 0 800 500" role="img" aria-label="Preserved frame with no plate-solve solution">${stars()}<path class="acquire-nebula" d="M275 344c52-116 176-163 282-69 38 34 20 107-45 115-85 10-99-56-164-15-59 38-106 9-73-31z"/><g class="overlay-failure ${decision(model).type === "retrying" ? "advisory" : ""}"><path d="M348 203l104 104m0-104L348 307"/><text x="400" y="345">NO SOLUTION</text><text x="400" y="371">OFFSET UNKNOWN · FRAME PRESERVED</text></g></svg></div>`;
    const p = centerGeometry(e);
    return `<div class="acquire-overlay"><svg viewBox="0 0 800 500" role="img" aria-label="Desired center and solved center separated by ${e.error} arcseconds">${stars()}<path class="acquire-nebula" d="M275 344c52-116 176-163 282-69 38 34 20 107-45 115-85 10-99-56-164-15-59 38-106 9-73-31z"/><defs><marker id="center-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0l10 5-10 5z"/></marker></defs><g class="desired-mark"><circle cx="400" cy="250" r="22"/><path d="M400 212v76M362 250h76"/><text x="400" y="199">DESIRED CENTER</text></g><g class="solved-mark"><circle cx="${p.x}" cy="${p.y}" r="16"/><circle class="uncertainty" cx="${p.x}" cy="${p.y}" r="27"/><path d="M${p.x - 23} ${p.y}h46M${p.x} ${p.y - 23}v46"/><text x="${p.x}" y="${p.y + 47}">SOLVED CENTER</text></g><line class="offset-vector" x1="${p.x}" y1="${p.y}" x2="400" y2="250" marker-end="url(#center-arrow)"/><text class="vector-label" x="${(p.x + 400) / 2}" y="${(p.y + 250) / 2 - 12}">${e.error}″ correction</text></svg><div class="overlay-legend"><span><i class="desired"></i>Desired center</span><span><i class="solved"></i>Solved center</span><span><i class="vector"></i>Arrow is requested mount correction: solved → desired</span></div></div>`;
  }
  function polarOverlay(model) {
    const e = model.evidence, p = polarGeometry(e);
    return `<div class="acquire-overlay"><svg viewBox="0 0 800 500" role="img" aria-label="Measured mount axis ${e.error.toFixed(1)} arcminutes from the celestial pole">${stars()}<defs><marker id="polar-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0l10 5-10 5z"/></marker></defs><circle class="polar-orbit" cx="400" cy="250" r="118"/><g class="desired-mark"><circle cx="400" cy="250" r="20"/><path d="M400 208v84M358 250h84"/><text x="400" y="194">CELESTIAL POLE</text></g><g class="solved-mark"><circle cx="${p.x}" cy="${p.y}" r="17"/><circle class="uncertainty" cx="${p.x}" cy="${p.y}" r="28"/><path d="M${p.x - 24} ${p.y}h48M${p.x} ${p.y - 24}v48"/><text x="${p.x}" y="${p.y + 49}">MEASURED MOUNT AXIS</text></g><line class="offset-vector" x1="${p.x}" y1="${p.y}" x2="400" y2="250" marker-end="url(#polar-arrow)"/><text class="vector-label" x="${(p.x + 400) / 2}" y="${(p.y + 250) / 2 - 14}">${e.error.toFixed(1)}′</text></svg><div class="overlay-legend"><span><i class="desired"></i>Celestial pole</span><span><i class="solved"></i>Measured axis</span><span><i class="vector"></i>Vector shows physical adjustment toward pole</span></div></div>`;
  }

  function metric(label, value, detail = "") { return `<div><small>${label}</small><b>${value}</b>${detail ? `<span>${detail}</span>` : ""}</div>`; }
  function evidenceMetrics(model) {
    const e = model.evidence;
    if (!e.solved && model.kind === "centering") return metric("Solve", "No solution", "offset unknown") + metric("Evidence", e.id, "preserved") + metric("Correction", "Unavailable", "no known vector") + metric("Solve budget", `${model.solveAttempts}/${POLICY.maxSolveAttempts} used`, model.solveAttempts < POLICY.maxSolveAttempts ? `automatic retry ${model.solveAttempts + 1} of ${POLICY.maxSolveAttempts}` : "exhausted · Acquire paused");
    if (model.kind === "polar") return metric("Axis error", `${e.error.toFixed(1)}′`, `tolerance ≤ ${POLICY.polarArcmin}′`) + metric("Altitude", formatOffset(e.alt, "′"), e.alt < 0 ? "raise mount" : "lower mount") + metric("Azimuth", formatOffset(e.az, "′"), e.az > 0 ? "move left" : "move right") + metric("Solve quality", `${e.confidence.toFixed(1)}%`, `±${e.uncertainty.toFixed(1)}′`);
    const eligible = e.error > POLICY.centeredArcsec && e.error <= POLICY.automaticArcsec && model.corrections < POLICY.maxCorrections;
    return metric("Center error", `${e.error}″`, `tolerance ≤ ${POLICY.centeredArcsec}″`) + metric("Requested correction RA / Dec", `${formatOffset(e.ra)} / ${formatOffset(e.dec)}`, "solved → desired") + metric("Solve quality", `${e.confidence.toFixed(1)}%`, `±${e.uncertainty}″`) + metric("Automatic", eligible ? "Eligible" : "Not eligible", `bound ≤ ${POLICY.automaticArcsec / 60}′ · ${model.corrections}/${POLICY.maxCorrections} used`);
  }
  function decisionCard(model) {
    const d = decision(model), actions = {
      retrying: "",
      automatic: "",
      recovery: `<button class="button primary" type="button" data-sim-action="Longer-exposure solve recovery simulated">Retry with longer exposure</button><button class="button danger" type="button" data-sim-action="Skip-target confirmation simulated">Skip target…</button>`,
      approval: `<button class="button danger" type="button" data-sim-action="Large correction approved in synthetic state">Approve exact correction</button><button class="button" type="button" data-sim-action="Correction opened for revision">Revise</button>`,
      complete: `<button class="button primary" type="button" data-sim-action="Acquire completion accepted; Capture handoff simulated">${model.kind === "polar" ? "Accept alignment" : "Begin Capture"}</button>`,
      manual: `<button class="button primary" type="button" data-sim-action="Manual adjustment acknowledged; next measurement simulated">I adjusted the mount — measure again</button>`
    };
    const passive = d.type === "automatic" || d.type === "retrying";
    const guidance = d.type === "manual" ? `<div class="polar-instructions">${polarInstructions(model.evidence).map(item => `<article><small>${item.axis}</small><strong><span aria-hidden="true">${item.glyph}</span> ${item.direction} ${item.magnitude}</strong></article>`).join("")}</div><div class="manual-boundary"><strong>Physical action</strong><span>Software provides guidance only; it cannot turn the mount's Alt/Az controls.</span></div>` : "";
    return `<section class="acquire-decision ${d.type}"><p class="eyebrow">${passive ? "Activity now" : "One decision now"}</p><h3>${d.title}</h3><p>${d.body}</p>${passive ? `<div class="passive-activity"><span class="activity-pulse" aria-hidden="true"></span><strong>${d.type === "automatic" ? "Mount correction in progress" : `Automatic retry attempt ${model.solveAttempts + 1} of ${POLICY.maxSolveAttempts}`}</strong><small>No operator action required</small></div>` : ""}${guidance}${actions[d.type] ? `<div class="button-row">${actions[d.type]}</div>` : ""}</section>`;
  }
  function filmstrip(model) {
    return `<section class="acquire-history"><div class="acquire-section-heading"><div><p class="eyebrow">Durable evidence</p><h3>Acquire attempts</h3></div><span>${model.attempts.length} retained</span></div><div class="acquire-filmstrip">${model.attempts.map((a, index) => `<button type="button" class="acquire-attempt ${a.failed ? "failed" : ""} ${a.id === state.selectedAttempt ? "selected" : ""}" data-attempt-id="${a.id}"><span class="attempt-thumb">${a.failed ? "×" : index + 1}</span><strong>${a.status}</strong><small>${a.detail}</small><code>${a.id}</code></button>`).join("")}</div></section>`;
  }
  function renderContent() {
    const model = current(), polar = model.kind === "polar";
    els.content.innerHTML = `<header class="acquire-phase-heading"><div><p class="eyebrow">Observe / Acquire</p><h2>${model.label}</h2><p>${polar ? "Polar alignment measurement" : "Target centering with plate solving"} · synthetic M27 run</p></div><span class="acquire-state ${model.tone}">${model.state}</span></header><div class="acquire-focus ${decision(model).type}"><section class="acquire-evidence"><div class="acquire-section-heading"><div><p class="eyebrow">Latest image-derived evidence</p><h3>${polar ? "Pole and mount-axis overlay" : "Desired and solved center"}</h3></div><span class="mono">${model.evidence.id}</span></div>${polar ? polarOverlay(model) : centerOverlay(model)}<div class="acquire-metrics">${evidenceMetrics(model)}</div></section><div class="acquire-judgment"><section class="acquire-assessment"><p class="eyebrow">Assessment</p><h3>${model.state}</h3><p>${model.assessment}</p></section>${decisionCard(model)}</div></div>${filmstrip(model)}`;
  }
  function renderRunbar() {
    const model = current(), d = decision(model);
    els.runbar.innerHTML = `<div class="composite-run-title"><span class="status-dot"></span><span><strong>M27 · Acquire</strong><small>${model.kind === "polar" ? "Polar alignment" : "Target centering"} · ${model.state}</small></span></div><div class="composite-run-progress"><span><small>Gate</small><b>${d.type === "complete" ? "Verified" : d.type === "recovery" ? "Paused" : "In progress"}</b></span><div class="progress-track"><span style="--progress:${d.type === "complete" ? 100 : model.kind === "polar" ? 55 : 42}%"></span></div></div><div class="composite-run-actions desktop-only"><button class="button" type="button" data-policy>Inspect policy</button><button class="button danger" type="button" data-sim-action="Stop dialog simulated; run unchanged">Stop…</button></div>`;
  }
  function renderContext() {
    const model = current();
    document.querySelectorAll("[data-context-tab]").forEach(button => { const active = button.dataset.contextTab === state.contextTab; button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1; });
    els.alertCount.textContent = model.alerts.length;
    if (state.contextTab === "alerts") {
      els.context.innerHTML = `<div class="context-heading"><p class="eyebrow">Run alerts</p><h2>${model.alerts.length ? `${model.alerts.length} needs attention` : "No active alerts"}</h2><p>${model.alerts.length ? "Alerts reflect the current Acquire evidence." : "Acquire evidence currently satisfies its gate."}</p></div><div class="alert-list">${model.alerts.map(a => `<article class="alert-item ${a.critical ? "critical" : ""}"><span aria-hidden="true">${a.critical ? "!" : "△"}</span><div><strong>${a.title}</strong><p>${a.body}</p><small>Synthetic · current attempt</small></div></article>`).join("")}</div>`;
      return;
    }
    if (state.inspectorSubject === "policy") {
      els.context.innerHTML = `<div class="context-heading"><p class="eyebrow">Inspector / Policy</p><h2>Acquire boundaries</h2><p>One canonical rule set determines the visible recommendation.</p></div><dl class="context-details"><div><dt>Centered</dt><dd>≤ ${POLICY.centeredArcsec}″</dd></div><div><dt>Automatic correction</dt><dd>≤ ${POLICY.automaticArcsec / 60}′</dd></div><div><dt>Correction attempts</dt><dd>max ${POLICY.maxCorrections}</dd></div><div><dt>Solve attempts</dt><dd>max ${POLICY.maxSolveAttempts}</dd></div><div><dt>Polar aligned</dt><dd>≤ ${POLICY.polarArcmin}′</dd></div></dl><p class="fine">No solution means unknown offset. Automatic solve retries never move the mount. A command accepted by a mount is never proof of success; a subsequent image must verify it.</p>`;
      return;
    }
    const selected = model.attempts.find(a => a.id === state.selectedAttempt) || model.attempts.at(-1);
    els.context.innerHTML = `<div class="context-heading"><p class="eyebrow">Inspector / Evidence</p><h2>${selected.id}</h2><p>Immutable attempt record selected from the filmstrip.</p></div><dl class="context-details"><div><dt>Status</dt><dd>${selected.status}</dd></div><div><dt>Result</dt><dd>${selected.detail}</dd></div><div><dt>Scenario</dt><dd>${model.label}</dd></div><div><dt>Retention</dt><dd>Preserved</dd></div></dl><div class="context-frame-preview">${selected.failed ? "No solution · diagnostics retained" : "Selected evidence preview"}</div>`;
  }
  function renderPhone() {
    const model = current(), d = decision(model), e = model.evidence;
    const latest = !e.solved && model.kind === "centering" ? "No solution · offset unknown" : model.kind === "polar" ? `${e.error.toFixed(1)}′ axis error · ±${e.uncertainty.toFixed(1)}′` : `${e.error}″ center error · ±${e.uncertainty}″`;
    const guidance = d.type === "manual" ? `<section><p class="eyebrow">At the mount</p><div class="polar-instructions phone-polar-instructions">${polarInstructions(e).map(item => `<article><small>${item.axis}</small><strong><span aria-hidden="true">${item.glyph}</span> ${item.direction} ${item.magnitude}</strong></article>`).join("")}</div><p class="fine">Physical controls only · software cannot move Alt/Az.</p></section>` : "";
    els.phone.innerHTML = `<div class="phone-mode-label"><span>Read-only Acquire monitor</span><small>No controls</small></div><section class="phone-status"><p class="eyebrow">Observe / Acquire</p><h2>${model.state}</h2><p>${model.label}</p><div class="phone-stats"><span><small>Latest evidence</small><b>${e.id}</b></span><span><small>Result</small><b>${latest}</b></span></div></section>${guidance}<section class="phone-acquire-recommendation ${model.tone}"><p class="eyebrow">Current recommendation</p><h3>${d.title}</h3><p>${d.body}</p></section><section><p class="eyebrow">Attempts</p><div class="phone-recent">${model.attempts.map(a => `<article><span class="${a.failed ? "rejected" : ""}">${a.failed ? "×" : "✓"}</span><div><strong>${a.status}</strong><small>${a.id} · ${a.detail}</small></div></article>`).join("")}</div></section>`;
  }
  function render() {
    const model = current();
    if (!model.attempts.some(a => a.id === state.selectedAttempt)) state.selectedAttempt = model.attempts.at(-1).id;
    renderRunbar(); renderContent(); renderContext(); renderPhone();
    els.feedback.hidden = !state.feedback; els.feedback.textContent = state.feedback;
  }

  document.addEventListener("change", event => {
    if (!event.target.matches("[data-scenario-control]")) return;
    state.scenario = event.target.value; state.selectedAttempt = current().attempts.at(-1).id; state.inspectorSubject = "evidence"; state.feedback = ""; render();
  });
  document.addEventListener("click", event => {
    const tab = event.target.closest("[data-context-tab]");
    if (tab) { state.contextTab = tab.dataset.contextTab; render(); return; }
    const attemptButton = event.target.closest("[data-attempt-id]");
    if (attemptButton) { state.selectedAttempt = attemptButton.dataset.attemptId; state.inspectorSubject = "evidence"; state.contextTab = "inspector"; render(); return; }
    if (event.target.closest("[data-policy]")) { state.inspectorSubject = "policy"; state.contextTab = "inspector"; render(); return; }
    const action = event.target.closest("[data-sim-action]");
    if (action) { state.feedback = `${action.dataset.simAction}. No hardware or run state changed.`; render(); return; }
    const workspace = event.target.closest("[data-workspace]");
    if (workspace) { state.feedback = `${workspace.dataset.workspace} remains available in the full composite; this gate stays focused on Observe / Acquire.`; render(); }
  });

  window.AcquirePrototype = Object.freeze({ POLICY, centeringDecision, polarDecision, polarInstructions, centerGeometry, polarGeometry, decisionCard });
  render();
})();
