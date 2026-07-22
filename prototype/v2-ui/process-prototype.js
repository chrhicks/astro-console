(() => {
  "use strict";

  const steps = [
    { id: "calibrate", phase: "build", label: "Calibration", detail: "42 lights · master dark", status: "complete" },
    { id: "debayer", phase: "build", label: "Debayer", detail: "RGGB · linear RGB", status: "complete" },
    { id: "register", phase: "build", label: "Registration", detail: "41 of 42 accepted", status: "complete" },
    { id: "stack", phase: "build", label: "Stack", detail: "32-bit linear FITS", status: "complete" },
    { id: "background", phase: "develop", label: "Background extraction", detail: "RBF correction", status: "complete" },
    { id: "color", phase: "develop", label: "Color calibration", detail: "Photometric", status: "complete" },
    { id: "stretch", phase: "develop", label: "Stretch", detail: "Generalized hyperbolic", status: "current" },
    { id: "curves", phase: "develop", label: "Curves", detail: "Not applied", status: "available" }
  ];
  const operationControls = {
    background: { tools: ["Siril · RBF", "RCAstro · GradientXTerminator", "GraXpert"], values: [{ id: "samples", label: "Sample density", min: 20, max: 80, value: 48, unit: "%" }, { id: "smoothing", label: "Smoothing", min: 0, max: 100, value: 34, unit: "%" }] },
    color: { tools: ["Siril · PCC", "Siril · SPCC"], values: [{ id: "neutral", label: "Background neutralization", min: 0, max: 100, value: 62, unit: "%" }, { id: "saturation", label: "Color saturation", min: 0, max: 100, value: 52, unit: "%" }] },
    stretch: { tools: ["Siril · GHS", "Siril · Asinh"], values: [{ id: "stretch", label: "Stretch factor", min: 0, max: 100, value: 58, unit: "%" }, { id: "black", label: "Black point", min: 0, max: 40, value: 9, unit: "%" }, { id: "highlights", label: "Highlight protection", min: 0, max: 100, value: 71, unit: "%" }] },
    curves: { tools: ["Siril · Curves"], values: [{ id: "contrast", label: "Midtone contrast", min: -30, max: 30, value: 8, unit: "" }, { id: "saturation", label: "Color saturation", min: 0, max: 100, value: 55, unit: "%" }] }
  };
  const scenarios = {
    editing: { label: "Develop · adjusting Stretch", status: "Ready · unsaved changes", selectedStep: "stretch", pressure: null, connected: true },
    previewing: { label: "Preview · settings computing", status: "Previewing Stretch · 68%", selectedStep: "stretch", progress: 68, pressure: null, connected: true },
    failed: { label: "Failed · retry Stretch only", status: "Stretch failed · checkpoint safe", selectedStep: "stretch", failed: true, pressure: null, connected: true },
    pressure: { label: "Throttled · measured disk pressure", status: "Preview throttled · storage writes 91%", selectedStep: "background", progress: 42, pressure: "Storage write pressure", connected: true },
    reconnected: { label: "Reconnected · current workspace", status: "Current · synced with service", selectedStep: "stretch", pressure: null, connected: true, reconnected: true },
    saved: { label: "Saved · Library artifacts", status: "Saved to Library", selectedStep: "curves", pressure: null, connected: true, saved: true },
    discarded: { label: "Discarded · sources preserved", status: "No active session · sources preserved", selectedStep: "stack", pressure: null, connected: true, discarded: true }
  };
  const dataSources = {
    ngc7000: { target: "NGC 7000 · North America Nebula", session: "New processing session", source: "67 accepted raw lights · captured Jul 19", startPhase: "Build", selectedStep: "calibrate", progressStep: "calibrate" },
    "m31-session": { target: "M31 · Andromeda Galaxy", session: "Natural color · resumed", source: "Unfinished session · 5 applied edits", startPhase: "Develop", selectedStep: "stretch", progressStep: "stretch" },
    "m27-stack": { target: "M27 · Dumbbell Nebula", session: "Linear master development", source: "32-bit RGB FITS · asset-stack-m27-041", startPhase: "Develop", selectedStep: "background", progressStep: "background" }
  };
  const defaultTools = Object.fromEntries(Object.entries(operationControls).map(([id, value]) => [id, value.tools[0]]));
  const defaultValues = Object.fromEntries(Object.entries(operationControls).flatMap(([stepId, value]) => value.values.map(control => [`${stepId}:${control.id}`, control.value])));
  const history = [
    { label: "Color calibrated", selectedStep: "stretch", toolByStep: { ...defaultTools }, values: { ...defaultValues, "stretch:stretch": 38, "stretch:black": 4 } },
    { label: "Initial stretch", selectedStep: "stretch", toolByStep: { ...defaultTools, stretch: "Siril · Asinh" }, values: { ...defaultValues, "stretch:stretch": 47, "stretch:black": 7 } },
    { label: "Protected highlights", selectedStep: "stretch", toolByStep: { ...defaultTools }, values: { ...defaultValues } }
  ];
  const state = {
    scenario: "editing", selectedStep: "stretch", toolByStep: { ...history.at(-1).toolByStep }, values: { ...history.at(-1).values }, history,
    appliedIndex: 2, comparing: false, contextTab: "operation", assistantVisible: true, assistantUnread: 1, proposalPreview: false,
    savedFormats: ["Processed FITS", "Preview PNG", "Full-resolution PNG"], feedback: "", pendingSource: null,
    data: { target: "M27 · Dumbbell Nebula", session: "Natural color", source: "41 accepted lights · current session", startPhase: "Develop", progressStep: "stretch" }
  };
  const els = {
    scenario: document.querySelector("[data-scenario-control]"), runbar: document.querySelector("[data-runbar]"), content: document.querySelector("[data-process-content]"),
    phone: document.querySelector("[data-process-phone]"), context: document.querySelector("[data-process-context]"), feedback: document.querySelector("[data-feedback]"),
    saveDialog: document.querySelector("[data-save-dialog]"), discardDialog: document.querySelector("[data-discard-dialog]"), sourceDialog: document.querySelector("[data-source-dialog]"),
    switchDialog: document.querySelector("[data-switch-dialog]"), diagnosticsDialog: document.querySelector("[data-diagnostics-dialog]")
  };

  function currentScenario() { return scenarios[state.scenario]; }
  function currentStep() { return steps.find(step => step.id === state.selectedStep); }
  function currentOperation() { return operationControls[state.selectedStep]; }
  function hasUnsavedWork() { return !currentScenario().saved && !currentScenario().discarded; }
  function restoreSnapshot(snapshot, restoreSelection = true) {
    state.toolByStep = { ...snapshot.toolByStep };
    state.values = { ...snapshot.values };
    if (restoreSelection) state.selectedStep = snapshot.selectedStep;
  }
  function markUnsaved() {
    if (!currentScenario().saved) return;
    state.scenario = "editing";
    els.scenario.value = state.scenario;
  }
  function resetHistory(selectedStep) {
    const initial = { label: "Source loaded", selectedStep, toolByStep: { ...defaultTools }, values: { ...defaultValues } };
    state.history.splice(0, state.history.length, initial);
    state.appliedIndex = 0;
    restoreSnapshot(initial);
  }
  function switchData(disposition) {
    const source = dataSources[state.pendingSource];
    if (!source) return;
    state.data = source;
    resetHistory(source.selectedStep);
    state.scenario = "editing";
    state.contextTab = "operation";
    state.proposalPreview = false;
    els.scenario.value = state.scenario;
    state.feedback = `${disposition}. ${source.target} opened at ${source.startPhase}; ${source.source}.`;
    state.pendingSource = null;
    render();
  }

  function renderRunbar(scenario) {
    els.runbar.innerHTML = `<div class="process-run-summary"><span class="run-icon" aria-hidden="true">◉</span><div><small>Active observing run · independent</small><strong>M27 · exposure 14 of 24</strong><span>Capturing continues normally</span></div></div><div class="process-run-health"><span><small>Observatory</small><b>Healthy</b></span><span><small>Process</small><b>${scenario.pressure ? "Throttled" : scenario.failed ? "Needs attention" : "Available"}</b></span><span><small>Storage</small><b>${scenario.pressure ? "Write pressure" : "1.7 TB free"}</b></span></div><div class="process-freshness"><small>Workspace state</small><strong>${scenario.reconnected ? "Reconnected · current" : "Current · server-owned"}</strong></div>`;
  }
  function renderStep(step) {
    const selected = step.id === state.selectedStep;
    const progressIndex = steps.findIndex(item => item.id === state.data.progressStep);
    const stepIndex = steps.findIndex(item => item.id === step.id);
    const status = stepIndex < progressIndex ? "complete" : stepIndex === progressIndex ? "current" : "available";
    const mark = status === "complete" ? "✓" : status === "current" ? "●" : "○";
    return `<li><button type="button" class="process-step ${selected ? "selected" : ""}" data-step-id="${step.id}" aria-current="${selected ? "step" : "false"}"><span class="process-step-mark ${status}" aria-hidden="true">${mark}</span><span><strong>${step.label}</strong><small>${step.detail}</small></span></button></li>`;
  }
  function renderNavigator(scenario) {
    const savedCount = state.savedFormats.length;
    const sessionState = scenario.saved ? `${savedCount} artifact${savedCount === 1 ? "" : "s"} saved to Library · session clean` : `${state.data.source} · unsaved session`;
    const actions = scenario.saved
      ? `<button type="button" class="button primary" data-open-source>Process another target</button><button type="button" class="button" data-sim-action="library-compare">Open saved artifacts</button><button type="button" class="button ghost" data-edit-result>Start another edit from this result</button>`
      : `<button type="button" class="button" data-open-source>Switch data</button><button type="button" class="button primary" data-open-save>Save to Library</button><button type="button" class="button ghost" data-open-discard>Discard</button>`;
    return `<aside class="process-navigator" aria-label="Processing steps"><div class="process-session-title"><p class="eyebrow">${state.data.target}</p><h2>${state.data.session}</h2><small>${sessionState}</small><button type="button" class="process-switch-data" data-open-source>Switch data</button></div><section><div class="process-phase-heading"><span>01</span><div><strong>Build image</strong><small>Evidence to linear master</small></div><em>${state.data.startPhase === "Build" ? "Current" : "Complete"}</em></div><ol>${steps.filter(step => step.phase === "build").map(renderStep).join("")}</ol></section><section><div class="process-phase-heading"><span>02</span><div><strong>Develop image</strong><small>Linear master to visual result</small></div><em>${scenario.saved ? "Saved" : state.data.startPhase === "Build" ? "Waiting" : "In progress"}</em></div><ol>${steps.filter(step => step.phase === "develop").map(renderStep).join("")}</ol></section><div class="process-session-actions">${actions}</div></aside>`;
  }
  function renderCanvas(scenario) {
    const comparing = state.comparing ? "is-comparing" : "";
    const previewing = scenario.progress ? "is-previewing" : "";
    const stretch = state.values["stretch:stretch"];
    const black = state.values["stretch:black"];
    const imageFilter = `brightness(${0.82 + stretch / 210}) contrast(${1.02 + black / 100}) saturate(${1.08 + stretch / 180})`;
    const status = scenario.saved ? `Saved to Library · ${state.savedFormats.length} artifact${state.savedFormats.length === 1 ? "" : "s"}` : scenario.status;
    return `<section class="process-canvas-area"><div class="process-canvas-toolbar"><div class="button-row"><button type="button" class="button ghost" data-history="undo" ${state.appliedIndex === 0 ? "disabled" : ""}>↶ Undo</button><button type="button" class="button ghost" data-history="redo" ${state.appliedIndex >= state.history.length - 1 ? "disabled" : ""}>↷ Redo</button></div><div class="canvas-mode" role="status"><span class="status-dot" aria-hidden="true"></span>${status}</div><div class="button-row"><button type="button" class="button ghost" data-sim-action="zoom">100%</button><button type="button" class="button ghost" data-sim-action="fit">Fit</button></div></div><div class="process-canvas ${comparing} ${previewing}" data-compare-canvas tabindex="0" role="button" aria-pressed="${state.comparing}" aria-label="Synthetic processed view of ${state.data.target}. Press and hold to reveal the linear stack reference; release to return to the current result."><div class="astro-image current-image" style="filter:${imageFilter}" aria-hidden="true"><span class="nebula-core"></span><span class="nebula-lobe lobe-one"></span><span class="nebula-lobe lobe-two"></span><i class="starfield"></i></div><div class="astro-image reference-image" aria-hidden="true"><span class="nebula-core"></span><span class="nebula-lobe lobe-one"></span><span class="nebula-lobe lobe-two"></span><i class="starfield"></i></div><div class="canvas-label current-label"><strong>${state.proposalPreview ? "Proposed preview" : "Current"}</strong><span>${currentStep().label} ${state.proposalPreview ? "63% · not applied" : "preview"}</span></div><div class="canvas-label reference-label"><strong>Linear reference</strong><span>Stack · before Develop</span></div>${scenario.progress ? `<div class="canvas-compute"><span class="activity-pulse" aria-hidden="true"></span><div><strong>${scenario.pressure ? "Preview throttled" : "Updating preview"}</strong><small>${scenario.pressure ? "Measured storage pressure · capture remains healthy" : "Previous valid image remains visible"}</small></div><b>${scenario.progress}%</b></div>` : ""}<div class="compare-hint"><span aria-hidden="true">◉</span><span><strong>Press and hold to compare</strong><small>Space or Enter also reveals the linear reference</small></span></div></div><div class="process-canvas-footer"><span><small>View</small><b>${state.comparing ? "Linear reference" : state.proposalPreview ? "Proposed Stretch preview" : "Current result"}</b></span><span><small>Image</small><b>6024 × 4024 · 32-bit RGB</b></span><span><small>Cursor</small><b>R 0.124 · G 0.118 · B 0.136</b></span></div></section>`;
  }
  function renderOperation(scenario) {
    const operation = currentOperation();
    if (!operation) return `<p class="eyebrow">${currentStep().phase} step</p><h2>${currentStep().label}</h2><p class="muted">This Build step produces a durable checkpoint. Its settings and exact provenance remain inspectable; changing it would invalidate only downstream work.</p><dl class="process-spec"><div><dt>Tool</dt><dd>Siril 1.4.3</dd></div><div><dt>Output</dt><dd>${currentStep().detail}</dd></div><div><dt>Checkpoint</dt><dd>Available</dd></div></dl><button class="button" type="button" data-open-inspector>Inspect provenance</button>`;
    if (scenario.failed && state.selectedStep === "stretch") return `<div class="process-controls-heading"><div><p class="eyebrow">Failed operation</p><h2>Stretch</h2></div><span class="process-state danger">Failed</span></div><div class="process-notice danger"><strong>No Stretch output was created</strong><p>The linear stack is safe. Retry resumes only Stretch; Build steps remain complete.</p></div><div class="process-apply"><button type="button" class="button danger" data-retry>Retry Stretch</button><button type="button" class="button" data-view-tool-output>View tool output</button><small>Attempt 2 · Siril 1.4.3 · checkpoint asset-stack-m27-041</small></div>`;
    const toolOptions = operation.tools.map(tool => `<option${tool === state.toolByStep[state.selectedStep] ? " selected" : ""}>${tool}</option>`).join("");
    const controls = operation.values.map(control => { const value = state.values[`${state.selectedStep}:${control.id}`]; return `<label class="process-range"><span><strong>${control.label}</strong><output for="operation-${control.id}">${value}${control.unit}</output></span><input id="operation-${control.id}" type="range" min="${control.min}" max="${control.max}" value="${value}" data-control-id="${control.id}" aria-label="${control.label}"></label>`; }).join("");
    const proposal = state.proposalPreview && state.selectedStep === "stretch" ? `<div class="process-parameter-diff" role="status"><strong>Assistant proposal · preview only</strong><span><del>Stretch 58%</del><b aria-hidden="true">→</b><ins>63%</ins></span><small>Review on the canvas. Apply explicitly or reset.</small></div>` : "";
    return `<div class="process-controls-heading"><div><p class="eyebrow">Selected operation</p><h2>${currentStep().label}</h2></div><span class="process-state activity">Preview</span></div>${proposal}<label class="process-field" for="operation-tool">Tool<select id="operation-tool" data-tool-select>${toolOptions}</select></label><div class="process-control-stack">${controls}</div><div class="process-apply"><button type="button" class="button primary" data-apply-operation>Apply step</button><button type="button" class="button" data-reset-preview>Reset preview</button><small>Preview changes are temporary until applied. Applying adds one undoable step.</small></div>`;
  }
  function renderCompletion(scenario) {
    const saved = scenario.saved;
    return `<section class="process-empty-state"><span aria-hidden="true">✓</span><p class="eyebrow">${saved ? "Saved to Library" : "Session discarded"}</p><h2>${saved ? `${state.savedFormats.length} related artifacts saved` : "Sources preserved in Library"}</h2><p>${saved ? "The saved result is available without closing off another interpretation of this data." : "Unsaved edit history and scratch were removed. Original sources and previously saved artifacts remain intact."}</p><div class="process-source-summary"><strong>${state.data.target}</strong><small>${saved ? state.savedFormats.join(" · ") : state.data.source}</small></div><div class="button-row"><button type="button" class="button primary" data-open-source>Process another target</button>${saved ? `<button type="button" class="button" data-sim-action="library-compare">Open saved artifacts</button><button type="button" class="button ghost" data-edit-result>Start another edit from this result</button>` : ""}</div></section>`;
  }
  function renderContent(scenario) {
    if (scenario.discarded || scenario.saved) { els.content.innerHTML = renderCompletion(scenario); return; }
    els.content.innerHTML = `<div class="process-editor">${renderNavigator(scenario)}${renderCanvas(scenario)}</div>`;
  }
  function renderContext() {
    document.querySelectorAll("[data-context-tab]").forEach(button => {
      const active = button.dataset.contextTab === state.contextTab;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    const badge = document.querySelector("[data-assistant-badge]");
    badge.hidden = state.assistantUnread === 0;
    badge.textContent = String(state.assistantUnread);
    badge.setAttribute("aria-label", `${state.assistantUnread} unread suggestion${state.assistantUnread === 1 ? "" : "s"}`);
    if (currentScenario().discarded || currentScenario().saved) {
      els.context.innerHTML = `<p class="eyebrow">Session complete</p><h3>${currentScenario().saved ? "Saved result" : "No active edit"}</h3><p class="muted">Choose the next bounded action from the completion surface. Original sources remain Library evidence.</p>`;
      return;
    }
    if (state.contextTab === "operation") { els.context.innerHTML = renderOperation(currentScenario()); return; }
    if (state.contextTab === "inspector") {
      els.context.innerHTML = `<p class="eyebrow">Inspector</p><h3>${currentStep().label}</h3><p class="muted">Exact provenance stays available without turning the editor into an event log.</p><dl class="process-inspector"><div><dt>Input</dt><dd>asset-stack-m27-041</dd></div><div><dt>Tool</dt><dd>${state.toolByStep[state.selectedStep] || "Siril 1.4.3"}</dd></div><div><dt>History</dt><dd>Step ${state.appliedIndex + 1} of ${state.history.length}</dd></div><div><dt>Working state</dt><dd>Server-owned · current</dd></div></dl><button class="button" type="button" data-sim-action="library-compare">Compare saved artifacts in Library</button>`;
      return;
    }
    els.context.innerHTML = `<p class="eyebrow">Optional analysis</p><h3>Evaluate this preview</h3><p class="muted">Suggestions remain here until reviewed. The assistant never changes the active operation or image automatically.</p>${state.assistantVisible ? `<article class="assistant-suggestion"><span aria-hidden="true">✦</span><div><strong>Highlights are well protected</strong><p>The nebula core retains structure. The outer shell could tolerate a slightly stronger stretch without clipping.</p><dl><div><dt>Suggestion</dt><dd>Stretch factor 63%</dd></div><div><dt>Current</dt><dd>Stretch factor 58%</dd></div><div><dt>Confidence</dt><dd>Moderate</dd></div></dl><button type="button" class="button" data-preview-suggestion>Preview suggestion</button></div></article>` : `<button type="button" class="button" data-request-analysis>Analyze current preview</button>`}<small class="simulation-note">Previewing loads a proposal into Operation. Applying remains a separate operator action.</small>`;
  }
  function renderPhone(scenario) {
    if (scenario.discarded || scenario.saved) {
      els.phone.innerHTML = `<div class="phone-mode-label"><span>Process monitor</span><small>Read-only phone</small></div><section class="phone-status"><p class="eyebrow">${state.data.target}</p><h2>${scenario.saved ? "Saved to Library" : "No active processing session"}</h2><p>${scenario.saved ? `${state.savedFormats.length} related artifacts are available in Library.` : "The unsaved session was discarded. Original sources remain available."}</p><div class="phone-stats"><span><small>Observatory</small><b>Healthy</b></span><span><small>Sources</small><b>Preserved</b></span><span><small>Process</small><b>Idle</b></span><span><small>Capability</small><b>Read-only</b></span></div></section>`;
      return;
    }
    const active = scenario.failed ? "Stretch failed" : scenario.progress ? `${currentStep().label} preview · ${scenario.progress}%` : "Ready for desktop";
    els.phone.innerHTML = `<div class="phone-mode-label"><span>Process monitor</span><small>Read-only phone</small></div><section class="phone-status"><p class="eyebrow">${state.data.target}</p><h2>${active}</h2><p>The server-owned processing session continues independently of this phone.</p>${scenario.progress ? `<div class="progress-track" aria-label="Preview ${scenario.progress}% complete"><span style="--progress:${scenario.progress}%"></span></div>` : ""}<div class="phone-stats"><span><small>Observatory</small><b>Healthy</b></span><span><small>Process</small><b>${scenario.pressure ? "Throttled" : scenario.failed ? "Failed" : "Available"}</b></span><span><small>Current step</small><b>${currentStep().label}</b></span><span><small>Workspace</small><b>Current</b></span></div></section>${scenario.pressure ? `<section class="phone-process-note notice"><p class="eyebrow">Measured pressure</p><h3>Storage writes are saturated</h3><p>The preview worker throttled itself. Active capture alone does not pause processing.</p></section>` : ""}<section><p class="eyebrow">Working result</p><h3>Unsaved processing session</h3><p class="muted">Continue on desktop to adjust tools and settings, compare, undo, save, discard, or switch data.</p></section><section class="phone-authority-note"><p class="eyebrow">Capability</p><h3>Monitoring only</h3><p>Phone clients cannot mutate processing state in the initial release.</p></section>`;
  }
  function render() {
    const scenario = currentScenario();
    renderRunbar(scenario); renderContent(scenario); renderContext(); renderPhone(scenario);
    els.feedback.hidden = !state.feedback;
    els.feedback.textContent = state.feedback;
  }
  function showFeedback(message) { state.feedback = message; els.feedback.hidden = false; els.feedback.textContent = message; }
  function stopComparing() {
    if (!state.comparing) return;
    state.comparing = false;
    const canvas = document.querySelector("[data-compare-canvas]");
    canvas?.classList.remove("is-comparing"); canvas?.setAttribute("aria-pressed", "false");
    const view = document.querySelector(".process-canvas-footer b");
    if (view) view.textContent = state.proposalPreview ? "Proposed Stretch preview" : "Current result";
  }
  function startComparing(canvas) {
    state.comparing = true; canvas.classList.add("is-comparing"); canvas.setAttribute("aria-pressed", "true");
    const view = document.querySelector(".process-canvas-footer b");
    if (view) view.textContent = "Linear reference";
  }

  Object.entries(scenarios).forEach(([id, scenario]) => els.scenario.add(new Option(scenario.label, id)));
  els.scenario.value = state.scenario;
  document.addEventListener("change", event => {
    if (event.target.matches("[data-scenario-control]")) {
      state.scenario = event.target.value; state.selectedStep = currentScenario().selectedStep; state.contextTab = "operation"; state.proposalPreview = false;
      state.feedback = currentScenario().reconnected ? "Reconnected. The latest server-owned workspace loaded normally and is current." : "";
      render(); return;
    }
    if (event.target.matches("[data-tool-select]")) { markUnsaved(); state.toolByStep[state.selectedStep] = event.target.value; state.feedback = `${event.target.value} selected for ${currentStep().label}. The change is preview-only until applied.`; render(); return; }
    if (event.target.matches("[data-save-dialog] input[type=checkbox]")) {
      const count = els.saveDialog.querySelectorAll("input[type=checkbox]:checked").length;
      els.saveDialog.querySelector("[data-confirm-save]").textContent = `Save ${count} artifact${count === 1 ? "" : "s"}`;
      return;
    }
  });
  document.addEventListener("input", event => {
    if (!event.target.matches("[data-control-id]")) return;
    markUnsaved(); state.proposalPreview = false;
    state.values[`${state.selectedStep}:${event.target.dataset.controlId}`] = Number(event.target.value);
    event.target.closest(".process-range").querySelector("output").textContent = `${event.target.value}${operationControls[state.selectedStep].values.find(control => control.id === event.target.dataset.controlId).unit}`;
    const image = document.querySelector(".current-image");
    if (image) image.style.filter = `brightness(${0.82 + state.values["stretch:stretch"] / 210}) contrast(${1.02 + state.values["stretch:black"] / 100}) saturate(${1.08 + state.values["stretch:stretch"] / 180})`;
    showFeedback(`${currentStep().label} preview updated. The current history is unchanged until Apply step.`);
  });
  document.addEventListener("pointerdown", event => { const canvas = event.target.closest("[data-compare-canvas]"); if (!canvas || event.button > 0) return; canvas.setPointerCapture?.(event.pointerId); startComparing(canvas); });
  document.addEventListener("pointerup", stopComparing); document.addEventListener("pointercancel", stopComparing); document.addEventListener("lostpointercapture", stopComparing, true);
  document.addEventListener("focusout", event => { if (event.target.matches("[data-compare-canvas]")) stopComparing(); }); window.addEventListener("blur", stopComparing);
  document.addEventListener("keydown", event => {
    if (event.target.matches("[data-compare-canvas]") && [" ", "Enter"].includes(event.key) && !event.repeat) { event.preventDefault(); startComparing(event.target); return; }
    const tab = event.target.closest("[data-context-tab]");
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll("[data-context-tab]")];
    const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[index].click(); tabs[index].focus();
  });
  document.addEventListener("keyup", event => { if (!event.target.matches("[data-compare-canvas]") || ![" ", "Enter"].includes(event.key)) return; event.preventDefault(); stopComparing(); });
  document.addEventListener("click", event => {
    const step = event.target.closest("[data-step-id]");
    if (step) { state.selectedStep = step.dataset.stepId; state.contextTab = "operation"; state.feedback = `${currentStep().label} selected. Operation controls are active; Assistant suggestions remain available.`; render(); return; }
    const tab = event.target.closest("[data-context-tab]");
    if (tab) { state.contextTab = tab.dataset.contextTab; if (state.contextTab === "assistant") state.assistantUnread = 0; render(); return; }
    if (event.target.closest("[data-open-inspector]")) { state.contextTab = "inspector"; render(); return; }
    const historyControl = event.target.closest("[data-history]");
    if (historyControl) { markUnsaved(); const next = historyControl.dataset.history === "undo" ? state.appliedIndex - 1 : state.appliedIndex + 1; state.appliedIndex = Math.max(0, Math.min(state.history.length - 1, next)); restoreSnapshot(state.history[state.appliedIndex]); state.proposalPreview = false; state.feedback = `${historyControl.dataset.history === "undo" ? "Undid" : "Redid"} to ${state.history[state.appliedIndex].label}.`; render(); return; }
    if (event.target.closest("[data-apply-operation]")) { markUnsaved(); state.history.splice(state.appliedIndex + 1); state.history.push({ label: `${currentStep().label} · ${state.toolByStep[state.selectedStep]}`, selectedStep: state.selectedStep, toolByStep: { ...state.toolByStep }, values: { ...state.values } }); state.appliedIndex = state.history.length - 1; state.proposalPreview = false; state.feedback = `${currentStep().label} applied. One undoable step was added.`; render(); return; }
    if (event.target.closest("[data-reset-preview]")) { restoreSnapshot(state.history[state.appliedIndex], false); state.proposalPreview = false; state.feedback = `${currentStep().label} preview reset to the applied state.`; render(); return; }
    if (event.target.closest("[data-retry]")) { state.scenario = "previewing"; state.feedback = "Retrying Stretch only from the valid linear checkpoint. Build remains complete."; els.scenario.value = state.scenario; render(); return; }
    if (event.target.closest("[data-view-tool-output]")) { els.diagnosticsDialog.showModal(); return; }
    if (event.target.closest("[data-copy-output]")) { showFeedback("Sanitized synthetic tool output copied for the observatory owner. No clipboard write occurs in this study."); return; }
    if (event.target.closest("[data-download-diagnostics]")) { showFeedback("A redacted synthetic diagnostics download was prepared. No file was created in this study."); return; }
    if (event.target.closest("[data-preview-suggestion]")) { markUnsaved(); state.values["stretch:stretch"] = 63; state.selectedStep = "stretch"; state.contextTab = "operation"; state.proposalPreview = true; state.feedback = "Assistant proposal loaded into Operation as a temporary Stretch 58% → 63% preview. It was not applied."; render(); return; }
    if (event.target.closest("[data-request-analysis]")) { state.assistantVisible = true; state.feedback = "Synthetic analysis completed. The suggestion remains in Assistant; no settings changed."; render(); return; }
    if (event.target.closest("[data-edit-result]")) { markUnsaved(); state.contextTab = "operation"; state.feedback = "Started another unsaved edit from the saved result. Saved Library artifacts remain unchanged."; render(); return; }
    if (event.target.closest("[data-open-source]")) { els.sourceDialog.showModal(); return; }
    const sourceChoice = event.target.closest("[data-source-choice]");
    if (sourceChoice) {
      if (sourceChoice.dataset.sourceChoice === "browse") { els.sourceDialog.close(); showFeedback("Library picker opened synthetically. No current work changed."); return; }
      state.pendingSource = sourceChoice.dataset.sourceChoice; els.sourceDialog.close();
      if (!hasUnsavedWork()) { switchData("Current session was already complete"); return; }
      els.switchDialog.querySelector("[data-pending-source]").textContent = dataSources[state.pendingSource].target; els.switchDialog.showModal(); return;
    }
    if (event.target.closest("[data-save-switch]")) { state.savedFormats = ["Processed FITS", "Preview PNG", "Full-resolution PNG"]; switchData("Saved M27 artifacts to Library, then switched"); return; }
    if (event.target.closest("[data-discard-switch]")) { switchData("Discarded unsaved M27 work, preserved sources, then switched"); return; }
    if (event.target.closest("[data-open-save]")) { els.saveDialog.showModal(); return; }
    if (event.target.closest("[data-open-discard]")) { els.discardDialog.showModal(); return; }
    if (event.target.closest("[data-confirm-save]")) {
      const formats = [...els.saveDialog.querySelectorAll("input[type=checkbox]:checked")].map(input => input.value);
      if (!formats.length) { event.preventDefault(); showFeedback("Choose at least one format before saving."); return; }
      state.savedFormats = formats; state.scenario = "saved"; state.selectedStep = scenarios.saved.selectedStep; els.scenario.value = state.scenario; state.feedback = `${formats.join(", ")} were saved as related Library artifacts.`; render(); return;
    }
    if (event.target.closest("[data-confirm-discard]")) { state.scenario = "discarded"; state.selectedStep = scenarios.discarded.selectedStep; els.scenario.value = state.scenario; state.feedback = "Unsaved derived work was discarded. Original sources and saved Library artifacts remain."; render(); return; }
    const simulation = event.target.closest("[data-sim-action]");
    if (simulation) { state.feedback = simulation.dataset.simAction === "library-compare" ? "Library opened synthetically with the saved artifacts." : "Synthetic view control only; no image changed."; render(); return; }
    const workspace = event.target.closest("[data-workspace]");
    if (workspace) { state.feedback = `${workspace.dataset.workspace} remains available; this prototype stays in Process.`; render(); }
  });

  window.ProcessPrototype = Object.freeze({ scenarios, steps, operationControls, dataSources });
  render();
})();
