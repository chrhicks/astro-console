(() => {
  "use strict";

  const PEOPLE = Object.freeze({ owner: "You · Observatory desktop", friend: "Maya · Remote desktop", phone: "Your phone · Mobile Safari" });
  const scenarios = {
    baseline: scenario("Baseline · owner controls", {
      freshness: current("21:42:18", 41, "evt-8841"), runRevision: 12, leaseRevision: 4, controller: "owner", eligible: true,
      event: { type: "baseline" },
      history: [history("21:32", "Current run updated", "Dither cadence changed before capture"), history("21:14", "Run started", "Started from Monday plan")]
    }),
    future: scenario("Future edit · safe to apply", {
      freshness: current("21:42:18", 41, "evt-8841"), runRevision: 12, leaseRevision: 4, controller: "owner", eligible: true,
      event: { type: "mutation", impact: "nonDisruptive", title: "Add NGC 7000 after M27", change: "+6 × 180 s OIII exposures", consequences: ["Current M27 exposure and all captured evidence stay untouched", "Adds 18 minutes after the active M27 sequence", "Adds about 2.1 GB of storage"], resultingRevision: 13 },
      history: [history("Draft", "Local proposal", "Compared with the current run"), history("21:32", "Current run", "M27 capture continues unchanged")]
    }),
    notice: scenario("Forecast edit · review consequence", {
      freshness: current("21:42:18", 41, "evt-8841"), runRevision: 12, leaseRevision: 4, controller: "owner", eligible: true,
      event: { type: "mutation", impact: "notice", title: "Reorder two later targets", change: "Move NGC 7000 behind M31", consequences: ["Current M27 exposure stays untouched", "Expected completion moves 27 minutes later", "NGC 7000 loses 14 minutes of useful altitude"], resultingRevision: 13 },
      history: [history("Preview", "Forecast recalculated", "Compared with the current run"), history("21:32", "Current run", "M27 capture continues unchanged")]
    }),
    disruptive: scenario("Disruptive edit · approval required", {
      freshness: current("21:42:18", 41, "evt-8841"), runRevision: 12, leaseRevision: 4, controller: "owner", eligible: true,
      event: { type: "mutation", impact: "disruptive", title: "Switch to M31 now", change: "Replace the active M27 sequence", consequences: ["Abort 112 seconds of the current 180-second exposure", "Discard the incomplete frame", "Slew away from M27 and reacquire for about 6 minutes"], resultingRevision: 13 },
      history: [history("Preview", "Physical interruption classified", "Approval applies only while this preview is current"), history("21:40", "Frame 14 started", "112 s elapsed of 180 s")]
    }),
    conflict: scenario("Changed elsewhere · edit preserved", {
      freshness: current("21:42:26", 42, "evt-8850"), runRevision: 13, leaseRevision: 4, controller: "owner", eligible: true,
      event: { type: "runConflict", title: "The active run changed elsewhere", change: "Add NGC 7000 after M27", consequences: ["Another client changed later work after you opened this edit", "Your command made no change and reached no hardware", "Your local edit is preserved for review against the current run"] },
      history: [history("21:42", "Changed elsewhere", "A future calibration block was added"), history("Preserved", "Your local edit", "Ready to review against the current run")]
    }),
    disconnect: scenario("Disconnect · service run continues", {
      freshness: stale("21:42:18", "23 seconds ago", 41, "evt-8841"), runRevision: 12, leaseRevision: 4, controller: "owner", controllerState: "reconnecting · control retained", eligible: false,
      event: { type: "disconnect", consequences: ["This browser cannot confirm the current exposure state", "The observatory service continues the approved run", "No observing command will be buffered or sent automatically"] },
      history: [history("21:42:18", "Last confirmed", "Frame 14 was exposing"), history("Now", "Stream interrupted", "Attempting to reconnect")]
    }),
    reconnect: scenario("Reconnect · caught up", {
      freshness: current("21:44:06", 44, "evt-8873"), runRevision: 14, leaseRevision: 4, controller: "owner", eligible: true,
      event: { type: "reconnect", consequences: ["A fresh service snapshot replaced this browser's stale view", "Three durable changes were reconstructed before newer activity", "The run continued while this browser was away"] },
      history: [history("21:43", "Meridian-flip buffer added", "Later work changed"), history("21:43", "Future calibration block added", "Later work changed"), history("21:42", "Frame 14 accepted", "Capture continued during disconnect")]
    }),
    request: scenario("Control request · owner decides", {
      freshness: current("21:42:31", 42, "evt-8855"), runRevision: 12, leaseRevision: 4, controller: "owner", eligible: true,
      event: { type: "controlRequest", requester: "friend", consequences: ["Maya remains a viewer until you explicitly grant control", "Granting gives Maya authority for future observing commands", "Already accepted observing work continues unchanged"] },
      history: [history("21:42", "Control requested", "Maya · Remote desktop"), history("20:58", "You took control", "Observatory desktop")]
    }),
    grace: scenario("Controller grace · friend reconnecting", {
      freshness: current("21:42:44", 42, "evt-8858"), runRevision: 12, leaseRevision: 5, controller: "friend", controllerState: "reconnecting · 42 s left", eligible: true,
      event: { type: "controllerGrace", consequences: ["Maya keeps control during the visible 60-second grace period", "The run continues and control never transfers silently", "As owner, you may take control immediately; expiry leaves no controller"] },
      history: [history("21:42", "Controller disconnected", "Grace expires at 21:43:26"), history("21:41", "Control granted", "You granted control to Maya")]
    }),
    takeover: scenario("Owner takeover · control restored", {
      freshness: current("21:42:51", 43, "evt-8860"), runRevision: 12, leaseRevision: 6, controller: "owner", eligible: true,
      event: { type: "takeover", consequences: ["Control is restored to your observatory desktop", "Maya is now a viewer and cannot issue new observing mutations", "The active exposure continued uninterrupted"] },
      history: [history("21:42", "Control restored to you", "Run continued uninterrupted"), history("21:41", "Maya previously controlled", "Remote desktop")]
    }),
    staleController: scenario("Superseded control · in-flight command rejected", {
      freshness: current("21:43:03", 43, "evt-8864"), runRevision: 12, leaseRevision: 6, controller: "owner", eligible: false, currentClient: "friend",
      event: { type: "leaseConflict", consequences: ["Maya issued “Skip remaining M27 frames” while she still controlled the run", "Network delay meant the service received it only after owner takeover", "The service rejected its superseded control before any hardware action"] },
      history: [history("21:42:40", "Skip remaining M27 frames issued", "In flight from Maya while she controlled"), history("21:42:51", "Control restored to you", "Run continued uninterrupted"), history("21:43:03", "Delayed skip command rejected", "Received after takeover · no hardware action")]
    }),
    phone: scenario("Phone · useful and read-only", {
      freshness: current("21:43:12", 44, "evt-8868"), runRevision: 12, leaseRevision: 4, controller: "owner", eligible: false, currentClient: "phone",
      event: { type: "phone", consequences: ["This phone receives the same current snapshot as desktops", "It can monitor run, warnings, viewers, and controller", "It cannot mutate the run, request control, or hold control"] },
      history: [history("21:43", "Phone view current", "Read-only capability confirmed"), history("21:32", "Current run updated", "M27 capture continues")]
    })
  };

  const state = { scenario: "baseline", contextTab: "inspector", feedback: "" };
  const els = {
    scenario: document.querySelector("[data-scenario-control]") || { value: "", add() {}, addEventListener() {} }, runbar: document.querySelector("[data-runbar]"),
    content: document.querySelector("[data-authority-content]"), phone: document.querySelector("[data-authority-phone]"),
    context: document.querySelector("[data-authority-context]"), feedback: document.querySelector("[data-feedback]"),
    alertCount: document.querySelector("[data-alert-count]")
  };

  function scenario(label, values) { return { label, sourcePlanRevision: 7, currentClient: "owner", controllerState: "connected", progress: 58, ...values }; }
  function current(confirmedAt, snapshotVersion, eventCursor) { return { status: "current", label: "Current", confirmedAt, age: "just now", snapshotVersion, eventCursor }; }
  function stale(confirmedAt, age, snapshotVersion, eventCursor) { return { status: "stale", label: "Reconnecting", confirmedAt, age, snapshotVersion, eventCursor }; }
  function history(time, title, detail) { return { time, title, detail }; }
  function attention(priority, kind, tone, eyebrow, title, body, options = {}) { return { priority, kind, tone, eyebrow, title, body, ...options }; }

  function deriveAttention(model) {
    const event = model.event;
    if (event.type === "baseline") return attention(50, "decision", "normal", "Available action", "Run is proceeding as approved", "The current M27 exposure continues. You may edit later work in Plan.", { actionSummary: ["Plan change", "Edit remaining plan", "Open later targets without interrupting M27"], action: "Edit remaining plan", actionId: "edit-plan", feedback: "" });
    if (event.type === "mutation" && event.impact === "nonDisruptive") return attention(70, "decision", "normal", "Ready to apply", "Safe to add after M27", "The service checked this change against the current run. Current work and captured evidence remain untouched.", { actionSummary: ["Change being applied", "Add NGC 7000 after M27", "+6 × 180 s OIII exposures"], action: "Apply future change", actionId: "apply", feedback: "Applied synthetically · the current run would update" });
    if (event.type === "mutation" && event.impact === "notice") return attention(80, "decision", "notice", "Consequence review", "Review the forecast change", "Current work is safe, but the night outcome changes materially. Review that consequence before applying.", { actionSummary: ["Change being applied", "Move NGC 7000 behind M31", "Completion moves 27 minutes later · NGC 7000 loses 14 useful minutes"], action: "Apply after review", actionId: "apply", feedback: "Applied synthetically · the current run would update", alert: true });
    if (event.type === "mutation") return attention(100, "decision", "danger", "Approval required", "Approve the physical interruption", "Approval applies only while this preview is current. If the active run changes elsewhere, this approval cannot apply.", { actionSummary: ["Change awaiting approval", "Switch to M31 now", "Abort 112 s of the exposure, discard this frame, then slew and reacquire"], action: "Abort exposure and switch", actionId: "apply", feedback: "Approved synthetically · the current run would update", secondary: "Keep current run", alert: true });
    if (event.type === "runConflict") return attention(85, "decision", "notice", "Changed elsewhere", "No change was applied", "The active run refreshed safely. Review the preserved edit against what is current now before sending a new intent.", { actionSummary: ["Edit to review", "Add NGC 7000 after M27", "+6 × 180 s OIII exposures · preserved locally"], action: "Review against current run", actionId: "review", feedback: "Preserved edit opened against the current run", secondary: "Discard local edit", alert: true });
    if (event.type === "disconnect") return attention(90, "status", "notice", "Run continues remotely", "This browser is reconnecting", "The observatory service continues the approved run. No observing command will be buffered or sent automatically.");
    if (event.type === "reconnect") return attention(60, "status", "success", "Caught up", "Three changes while you were away", "The browser replaced its stale view with a fresh service snapshot before showing newer activity.", { details: model.history, action: "View run history", actionId: "history", actionStyle: "secondary", feedback: "Full synthetic run history opened" });
    if (event.type === "controlRequest") return attention(90, "decision", "notice", "Control request", "Maya is asking to control", "Grant only the named desktop. Maya gains authority for future commands; current work continues.", { actionSummary: ["Control change", "Grant Maya control", "Future observing commands come from Maya's remote desktop"], action: "Grant control to Maya", actionId: "grant", feedback: "Granted synthetically · Maya would control future actions", secondary: "Decline request", alert: true });
    if (event.type === "controllerGrace") return attention(80, "decision", "notice", "Controller reconnecting", "Maya may reconnect for 42 seconds", "You can wait without affecting the run, or explicitly take control now. No silent transfer occurs.", { actionSummary: ["Control change", "Take control now", "End Maya's reconnect grace; the active run continues"], action: "Take control now", actionId: "take-control", feedback: "Taken synthetically · control would return to you", secondary: "Keep waiting", alert: true });
    if (event.type === "takeover") return attention(60, "status", "success", "Control restored", "The run continued uninterrupted", "Your observatory desktop can issue future observing actions. The active exposure was not cancelled or restarted.");
    if (event.type === "leaseConflict") return attention(40, "info", "neutral", "For your information", "Maya's delayed skip command was rejected", "Maya issued “Skip remaining M27 frames” while she controlled. Network delay meant the service received it after owner takeover, so superseded control rejected it before hardware action.", { details: model.history });
    return attention(40, "info", "neutral", "Capability", "Monitoring only", "This phone is intentionally read-only. Continue from a control-capable desktop if action is needed.");
  }

  function deriveFreshnessAttention(model) {
    if (model.freshness.status === "stale") return attention(110, "status", "notice", "View freshness", "Last confirmed 23 seconds ago", "Current physical state is unknown to this browser. Observing actions stay unavailable until a complete current view arrives.");
    return attention(10, "status", "success", "View freshness", model.event.type === "reconnect" ? "Current · reconstruction complete" : "Current", `Service-confirmed at ${model.freshness.confirmedAt}.`);
  }

  function projectScenario(model) {
    const controllerName = PEOPLE[model.controller];
    const workspace = ["mutation", "runConflict"].includes(model.event.type) ? "plan" : "observe";
    const attentionItems = [deriveAttention(model), deriveFreshnessAttention(model)].sort((left, right) => right.priority - left.priority);
    const alerts = attentionItems.filter(item => item.alert).map(item => ({ critical: item.tone === "danger", title: item.title, body: model.event.consequences[0] }));
    const phoneFreshness = model.freshness.status === "current" ? model.freshness : current("21:42:41", 42, "evt-8848");
    const phoneAlert = model.event.type === "disconnect" ? { title: "Owner desktop reconnecting", body: "This phone is current. The observatory service continues the run." } : alerts[0];
    return { model, workspace, controllerName, attentionItems, alerts, phoneFreshness, phoneAlert };
  }

  function impactLabel(event) {
    if (event.type !== "mutation") return "Canonical result";
    return { nonDisruptive: "Non-disruptive", notice: "Forecast notice", disruptive: "Disruptive" }[event.impact];
  }
  function runStatus(view) {
    const prefix = view.workspace === "plan" ? "M27 continues" : view.model.freshness.status === "stale" ? "Last confirmed" : "Live";
    return `${prefix} · exposure 14 of 24${view.model.freshness.status === "current" ? " · 112 s / 180 s" : ""}`;
  }

  function renderWorkspace(view) {
    document.querySelectorAll("[data-workspace-item]").forEach(item => {
      const active = item.dataset.workspaceItem === view.workspace;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }

  function renderRunbar(view) {
    const freshnessClass = view.model.freshness.status === "current" ? "" : "stale";
    els.runbar.innerHTML = `<div class="desktop-runbar-view"><div class="composite-run-title"><span class="status-dot ${freshnessClass}"></span><span><strong>M27 · OIII capture</strong><small>${runStatus(view)}</small></span></div><div class="authority-run-facts"><span><small>Run</small><b>Current run</b></span><span><small>Controller</small><b>${view.controllerName}</b></span><span><small>Freshness</small><b class="${freshnessClass}">${view.model.freshness.label}</b></span></div></div><div class="phone-runbar-view"><div class="composite-run-title"><span class="status-dot"></span><span><strong>M27 · OIII capture</strong><small>Current service view · exposure in progress</small></span></div></div>`;
  }

  function historyCard(model) {
    return `<section class="authority-history"><div class="authority-section-heading"><div><p class="eyebrow">Run history</p><h3>${model.event.type === "reconnect" ? "Changed while away" : "Recent activity"}</h3></div><span>${model.history.length} items</span></div><ol>${model.history.map(item => `<li><time>${item.time}</time><div><strong>${item.title}</strong><small>${item.detail}</small></div></li>`).join("")}</ol></section>`;
  }

  function evidenceCard(view) {
    const model = view.model, event = model.event;
    const proposal = event.title ? `<section class="authority-proposal"><div class="authority-section-heading"><div><p class="eyebrow">${impactLabel(event)}</p><h3>${event.title}</h3></div>${event.impact ? `<span class="authority-impact ${event.impact}">${impactLabel(event)}</span>` : ""}</div>${event.change ? `<p class="authority-change">${event.change}</p>` : ""}${event.consequences ? `<ul class="authority-consequences">${event.consequences.map(item => `<li>${item}</li>`).join("")}</ul>` : ""}</section>` : "";
    const history = event.type === "reconnect" ? "" : historyCard(model);
    return `<div class="authority-evidence"><section class="authority-current"><div class="authority-section-heading"><div><p class="eyebrow">Current execution</p><h3>M27 · OIII frame 14 of 24</h3></div><span>Current run</span></div><div class="exposure-visual"><div class="exposure-ring"><strong>112 s</strong><small>of 180 s</small></div><div><strong>${model.freshness.status === "current" ? "Exposure in progress" : "Last confirmed exposure"}</strong><p>${model.freshness.status === "current" ? "Current service-confirmed state" : `Confirmed ${model.freshness.age}; current physical state unknown to this browser`}</p></div></div><div class="authority-contract"><span><small>Started from</small><b>Monday plan</b></span><span><small>Execution</small><b>Current run</b></span><span><small>View</small><b>${model.freshness.status === "current" ? "Current" : "Last confirmed"}</b></span></div></section>${proposal}${history}</div>`;
  }

  function attentionCard(item) {
    const details = item.details ? `<ul class="authority-attention-details">${item.details.map(detail => `<li><strong>${detail.title}</strong><span>${detail.detail}</span></li>`).join("")}</ul>` : "";
    const actionSummary = item.actionSummary ? `<div class="authority-action-summary"><small>${item.actionSummary[0]}</small><strong>${item.actionSummary[1]}</strong><span>${item.actionSummary[2]}</span></div>` : "";
    const actionClass = item.actionStyle === "secondary" ? "" : item.tone === "danger" ? "danger" : "primary";
    const actions = item.action ? `<div class="button-row"><button class="button ${actionClass}" type="button" data-attention-action="${item.actionId}" data-feedback="${item.feedback}">${item.action}</button>${item.secondary ? `<button class="button" type="button" data-secondary-action>${item.secondary}</button>` : ""}</div>` : "";
    return `<section class="authority-attention ${item.kind} ${item.tone}" data-priority="${item.priority}"><p class="eyebrow">${item.eyebrow}</p><h3>${item.title}</h3><p>${item.body}</p>${details}${actionSummary}${actions}</section>`;
  }

  function judgment(view) { return `<div class="authority-judgment">${view.attentionItems.map(attentionCard).join("")}</div>`; }

  function renderContent(view) {
    const workspaceLabel = view.workspace === "plan" ? "Plan / Active run change" : "Observe / Active run authority";
    els.content.innerHTML = `<header class="authority-phase-heading"><div><p class="eyebrow">${workspaceLabel}</p><h2>${view.model.label}</h2><p>One M27 run · three viewing clients · service-owned execution and control</p></div><span class="acquire-state ${view.model.freshness.status === "stale" ? "warning" : "success"}">${view.model.freshness.label} · Current run</span></header><div class="authority-focus">${evidenceCard(view)}${judgment(view)}</div>`;
  }

  function renderContext(view) {
    document.querySelectorAll("[data-context-tab]").forEach(button => {
      const active = button.dataset.contextTab === state.contextTab;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    els.alertCount.textContent = view.alerts.length;
    if (state.contextTab === "alerts") {
      els.context.innerHTML = `<div class="context-heading"><p class="eyebrow">Run alerts</p><h2>${view.alerts.length ? `${view.alerts.length} needs attention` : "No active alerts"}</h2><p>Only conditions that change a decision appear here.</p></div><div class="alert-list">${view.alerts.map(alert => `<article class="alert-item ${alert.critical ? "critical" : ""}"><span aria-hidden="true">${alert.critical ? "!" : "◆"}</span><div><strong>${alert.title}</strong><p>${alert.body}</p></div></article>`).join("") || `<p class="muted">Nothing needs a decision right now.</p>`}</div>`;
      return;
    }
    const model = view.model;
    els.context.innerHTML = `<div class="context-heading"><p class="eyebrow">Presence &amp; control</p><h2>${view.controllerName}</h2><p>Exclusive controller</p></div><div class="presence-list"><article class="${model.controller === "owner" ? "controller" : ""}"><span class="presence-dot ${model.controllerState.startsWith("reconnecting") && model.controller === "owner" ? "stale" : ""}"></span><div><strong>You</strong><small>Observatory desktop · ${model.currentClient === "owner" ? "this client" : "connected"}</small></div><em>${model.controller === "owner" ? "Controller" : "Owner viewer"}</em></article><article class="${model.controller === "friend" ? "controller" : ""}"><span class="presence-dot ${model.controllerState.startsWith("reconnecting") && model.controller === "friend" ? "stale" : ""}"></span><div><strong>Maya</strong><small>Remote desktop · ${model.controller === "friend" ? model.controllerState : "connected"}</small></div><em>${model.controller === "friend" ? "Controller" : "Viewer"}</em></article><article><span class="presence-dot"></span><div><strong>Your phone</strong><small>Mobile Safari · ${model.currentClient === "phone" ? "this client" : "connected"}</small></div><em>Read-only</em></article></div><dl class="context-details"><div><dt>Run</dt><dd>Current run</dd></div><div><dt>View</dt><dd>${model.freshness.label}</dd></div><div><dt>Last confirmed</dt><dd>${model.freshness.confirmedAt}</dd></div></dl><details class="authority-diagnostics"><summary>Technical diagnostics</summary><dl><div><dt>Source plan revision</dt><dd>${model.sourcePlanRevision}</dd></div><div><dt>Run revision</dt><dd>${model.runRevision}</dd></div><div><dt>Snapshot version</dt><dd>${model.freshness.snapshotVersion}</dd></div><div><dt>Event cursor</dt><dd>${model.freshness.eventCursor}</dd></div><div><dt>Control lease revision</dt><dd>${model.leaseRevision}</dd></div></dl></details>`;
  }

  function renderPhone(view) {
    const model = view.model;
    els.phone.innerHTML = `<div class="phone-mode-label"><span>Read-only monitor</span><small>No control actions</small></div><section class="phone-status"><p class="eyebrow">M27 · OIII capture</p><h2>Frame 14 of 24</h2><p>Current service view · exposure in progress</p><div class="progress-track"><span style="--progress:${model.progress}%"></span></div><div class="phone-stats"><span><small>Started from</small><b>Monday plan</b></span><span><small>Run</small><b>Current run</b></span><span><small>Freshness</small><b>${view.phoneFreshness.label}</b></span><span><small>Controller</small><b>${view.controllerName.replace(" · Observatory desktop", "").replace(" · Remote desktop", "")}</b></span><span><small>Viewers</small><b>3 clients</b></span></div></section>${view.phoneAlert ? `<section class="phone-alert"><span aria-hidden="true">!</span><div><strong>${view.phoneAlert.title}</strong><p>${view.phoneAlert.body}</p></div></section>` : ""}<section class="phone-authority-note"><p class="eyebrow">Capability</p><h3>Monitoring only</h3><p>This phone shows the same current run and controller, but cannot edit the run or request control.</p></section><section class="phone-recent"><p class="eyebrow">Recent run history</p>${model.history.slice(0, 2).map(item => `<article><span aria-hidden="true">✓</span><div><strong>${item.title}</strong><small>${item.time} · ${item.detail}</small></div></article>`).join("")}</section>`;
  }

  function render() {
    const view = projectScenario(scenarios[state.scenario]);
    document.body.dataset.authorityScenario = state.scenario;
    renderWorkspace(view);
    renderRunbar(view);
    renderContent(view);
    renderContext(view);
    renderPhone(view);
    els.feedback.hidden = !state.feedback;
    els.feedback.textContent = state.feedback;
  }

  function changeScenario(scenarioName) {
    state.scenario = scenarioName;
    state.feedback = "";
    els.scenario.value = scenarioName;
    render();
  }

  Object.entries(scenarios).forEach(([key, model]) => els.scenario.add(new Option(model.label, key)));
  els.scenario.value = state.scenario;
  els.scenario.addEventListener("change", () => changeScenario(els.scenario.value));
  document.addEventListener("click", event => {
    const tab = event.target.closest("[data-context-tab]");
    if (tab) {
      state.contextTab = tab.dataset.contextTab;
      render();
      return;
    }
    const action = event.target.closest("[data-attention-action]");
    if (action?.dataset.attentionAction === "edit-plan") {
      changeScenario("future");
      return;
    }
    if (action) {
      state.feedback = action.dataset.feedback;
      render();
      return;
    }
    if (event.target.closest("[data-secondary-action]")) {
      state.feedback = "Alternative selected synthetically · the current run remains unchanged";
      render();
    }
  });
  document.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !event.target.matches("[data-context-tab]")) return;
    state.contextTab = state.contextTab === "inspector" ? "alerts" : "inspector";
    render();
    document.querySelector(`[data-context-tab="${state.contextTab}"]`).focus();
  });

  render();
})();
