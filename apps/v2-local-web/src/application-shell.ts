const shellStyles = `:root{--night:#081014;--cyan:#41c3cf;--sky:#9de8ed;--line:#354851;--text:#e5f0f1;--muted:#9babad;--mono:ui-monospace,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--night);color:var(--text);font:14px system-ui}
main{max-width:1240px;margin:auto;padding:24px}
.anchor{display:grid;grid-template-columns:1fr auto 1fr;gap:18px;align-items:center;border-bottom:1px solid var(--line);padding-bottom:16px}
.brand{display:flex;gap:10px;align-items:center;font-size:18px;font-weight:750}
.brand img{width:30px}
.register{display:flex;gap:20px;color:var(--muted);font:12px var(--mono)}
.register b{display:block;color:var(--text)}
.truth{justify-self:end;color:var(--sky);font:700 11px var(--mono);letter-spacing:.12em;text-align:right}
.truth button{display:block;margin:8px 0 0 auto}
.nav{display:flex;gap:8px;margin:16px 0;border-bottom:1px solid var(--line)}
button{margin:4px;padding:10px 13px;border:0;border-radius:3px;background:var(--cyan);color:var(--night);font-weight:700}
button[hidden]{display:none}
button:focus-visible{outline:2px solid var(--sky);outline-offset:3px}
.nav button{background:none;color:var(--muted);font:12px var(--mono)}
.nav button[aria-current]{color:var(--sky);border-bottom:2px solid var(--cyan)}
.room{display:none;padding:20px;border:1px solid var(--line);border-radius:4px;background:#0d151a}
.room.active{display:block}
.ey{color:var(--sky);font:11px var(--mono);letter-spacing:.12em;text-transform:uppercase}
.facts{display:grid;grid-template-columns:repeat(2,1fr);border:1px solid var(--line)}
.facts span{padding:10px;color:var(--muted);font:12px var(--mono)}
.facts b{display:block;color:var(--text)}
#notice{min-height:22px;color:var(--sky)}
#evidence-surface{margin:16px 0}
.optical-frame{position:relative;min-height:220px;overflow:hidden;border:1px solid #3a4a57;border-radius:8px;background:radial-gradient(circle at 58% 42%,#17323a 0,#0e141a 35%,#080c10 78%);box-shadow:inset 0 0 0 1px #111920}
.optical-frame.exhausted{border-color:#f3bb62;background:radial-gradient(circle at 64% 35%,#332919 0,#0e141a 38%,#080c10 78%)}
.geometry{position:absolute;inset:0}
.geometry line{stroke:#67d5df;stroke-width:2}
.geometry circle{fill:#67d5df}
.geometry .solved{fill:none;stroke:#a2f3f4;stroke-width:2}
.geometry .uncertainty{fill:none;stroke:#8fb6ff;stroke-dasharray:4 4}
.geometry-label{position:absolute;left:12px;bottom:10px;font:12px var(--mono);color:#e9f0f4;background:#0e141acc;padding:6px}
.exhausted .geometry-label{color:#f3bb62}
#library-results{height:340px;overflow:auto}
.library-row{display:block;width:100%;margin:0;background:#111920;color:var(--text);text-align:left;font:12px var(--mono)}
@media(max-width:600px){main{padding:16px}
.anchor{grid-template-columns:1fr auto}
.register{grid-column:1/-1;justify-content:space-between;font-size:10px}
.truth{grid-column:2}
.facts{grid-template-columns:1fr}
}
`

const shellMarkup = `</head>
<body>
<main>
<header class="anchor">
<div class="brand">
<img src="/assets/brand/alignment-aperture-light.svg" alt="Alignment Aperture V1">Astro Console</div>
<div class="register">
<span>Accepted run<b id="runfact">Loading</b>
</span>
<span>Controller<b id="controllerfact">Loading</b>
</span>
<span>Evidence age<b id="agefact">—</b>
</span>
</div>
<div class="truth">SERVICE TRUTH<button id="return" hidden>Return to Observe</button>
</div>
</header>
<nav class="nav" aria-label="Workspaces">
<button data-room="Plan">Plan</button>
<button data-room="Observe">Observe</button>
<button data-room="Library">Library</button>
<button data-room="Process">Process</button>
</nav>
<section class="room" id="Plan">
<p class="ey" id="plan-verdict">Observing plan</p>
<h1 id="plan-title">Loading plan</h1>
<div class="facts">
<span>Readiness<b id="plan-readiness">Loading</b>
</span>
<span>Sequences<b id="plan-sequence-count">—</b>
</span>
</div>
<p id="plan-summary" role="status"></p>
<div id="plan-sequences"></div>
<div id="plan-limitations" role="status"></div>
<div id="plan-actions">
</div>
</section>
<section class="room" id="Observe">
<p class="ey">Observe attention · owner: Observe</p>
<h1 id="observe-title">No active run</h1>
<p id="authority">
</p>
<section id="evidence-surface">
<p class="ey">Latest evidence · service owned</p>
<div id="optical-frame" class="optical-frame" role="img" aria-labelledby="evidence-frame evidence-geometry">
<svg class="geometry" viewBox="0 0 640 260" preserveAspectRatio="none" aria-hidden="true">
<line x1="320" y1="130" x2="380" y2="100">
</line>
<circle cx="320" cy="130" r="5">
</circle>
<circle class="solved" cx="380" cy="100" r="8">
</circle>
<circle class="uncertainty" cx="380" cy="100" r="22">
</circle>
</svg>
<div id="evidence-geometry" class="geometry-label">Desired center to solved center; uncertainty ring</div>
</div>
<h2 id="evidence-frame">Loading frame</h2>
<div class="facts">
<span>Desired<b id="evidence-desired">
</b>
</span>
<span>Solved<b id="evidence-solved">
</b>
</span>
<span>Uncertainty<b id="evidence-uncertainty">
</b>
</span>
<span>Stack source<b id="stack-source">
</b>
</span>
</div>
<p id="stack-trace" role="status">
</p>
<p id="correction-trace">
</p>
<p id="correction-protection">
</p>
<p id="pause-dispatch" hidden>
</p>
</section>
<p id="pause-consequence" role="status">
</p>
<div id="control-actions">
</div>
<p id="notice" role="status">
</p>
</section>
<section class="room" id="Library">
<p class="ey">Library chronology · bounded page</p>
<h1>Captured evidence and lineage</h1>
<p>Only a bounded page is installed. Select an asset for availability and immutable provenance.</p>
<div>
<button id="library-prev" aria-label="Previous Library results window" disabled>Previous assets</button>
<button id="library-next" aria-label="Next Library results window" disabled>Next assets</button>
</div>
<div id="library-results" aria-label="Library results">
</div>
<aside id="library-detail" aria-live="polite">Select an asset to inspect its lineage.</aside>
</section>
<section class="room" id="Process">
<p class="ey">Process</p>
<h1>Processing is not yet installed</h1>
</section>
</main>`

const shellClient = `let projection,plan;const q=s=>document.querySelector(s),nav=[...document.querySelectorAll('[data-room]')],library={results:[],start:0},libraryNode=q('#library-results'),libraryDetailNode=q('#library-detail'),libraryPrev=q('#library-prev'),libraryNext=q('#library-next');
function select(room){nav.forEach(x=>x.toggleAttribute('aria-current',x.dataset.room===room));document.querySelectorAll('.room').forEach(x=>x.classList.toggle('active',x.id===room))}nav.forEach(x=>x.onclick=()=>select(x.dataset.room));q('#return').onclick=()=>select('Observe');
function text(node,value){node.textContent=value}async function send(path,payload){if(projection.connection==='stale')return;const v=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(r=>r.json());text(q('#notice'),v.message||'The service did not accept this action.');if(v.snapshot)render(v.snapshot)}
function control(path){return send(path,{expectedLeaseRevision:projection.control.revision,idempotencyKey:crypto.randomUUID()})}
function action(label,fn){if(label==='Run plan')return document.createComment('Run plan deferred');const b=document.createElement('button');text(b,label);b.onclick=fn;return b}
const deterministicTwoSequenceDraft=[{sequenceId:'sequence-m27-luminance',target:'M27 · Dumbbell Nebula',capture:'24 × 180s · L',acquisition:'Solve, center, focus, then start capture.',stopCondition:'Stop at 24 verified frames or 01:02 local.',window:{startsAt:'2026-07-25T03:18:00.000Z',endsAt:'2026-07-25T05:02:00.000Z',usableMinutes:104,peakAltitudeDeg:62,horizonClearanceDeg:28},estimatedMinutes:72,storageForecastMb:1800,horizon:'clear',storage:'available'},{sequenceId:'sequence-m27-color',target:'M27 · Dumbbell Nebula',capture:'18 × 180s · RGB',acquisition:'Continue after luminance with the same solved center.',stopCondition:'Stop at 18 verified frames or window end.',window:{startsAt:'2026-07-25T03:18:00.000Z',endsAt:'2026-07-25T05:02:00.000Z',usableMinutes:104,peakAltitudeDeg:62,horizonClearanceDeg:28},estimatedMinutes:54,storageForecastMb:1350,horizon:'clear',storage:'available'}];
function renderPlanActions(){const actions=q('#plan-actions');actions.replaceChildren();if(!fixture||!projection||projection.identity.role!=='owner'||projection.identity.capability!=='controlCapable'||innerWidth<=600||projection.connection==='stale'||projection.run)return;actions.append(action('Save deterministic two-sequence draft',()=>send('/api/commands/save-plan-draft',{planId:plan.planId,expectedPlanRevision:plan.revision,idempotencyKey:crypto.randomUUID(),sequences:deterministicTwoSequenceDraft})))}
function renderPlan(){if(!plan)return;text(q('#plan-verdict'),'Observing plan · '+plan.readiness);text(q('#plan-title'),plan.sequences[0]?.target||'Observation plan');text(q('#plan-readiness'),plan.readiness);text(q('#plan-sequence-count'),String(plan.sequences.length));text(q('#plan-summary'),plan.readinessSummary);q('#plan-sequences').replaceChildren(...plan.sequences.map((x,i)=>{const row=document.createElement('p');text(row,(i+1)+'. '+x.capture+' · '+x.window.usableMinutes+' min window · '+x.window.peakAltitudeDeg+'° peak · '+x.window.horizonClearanceDeg+'° clearance · '+x.estimatedMinutes+' min estimated · '+x.storageForecastMb+' MB forecast · '+x.viability);return row}));q('#plan-limitations').replaceChildren(...plan.limitations.map(value=>{const row=document.createElement('p');text(row,value);return row}));queueMicrotask(renderPlanActions)}
function render(s){projection=s;renderPlan();q('#return').hidden=!s.run;text(q('#runfact'),s.run?'M27 · '+s.run.phase:'No run');text(q('#controllerfact'),s.control.holderClientId||'No controller');text(q('#agefact'),s.connection==='current'?'current':'connection lost · last confirmed');text(q('#observe-title'),s.run?s.run.phase==='stopped'?'Stopped · M27 will not resume':s.run.phase==='paused'?'Paused · M27 awaits Resume':'Capture · M27 is continuing':'No active run');text(q('#authority'),s.connection==='current'?'Lease '+s.control.state+' · controller '+(s.control.holderClientId||'unheld'):'Disconnected from service · actions are disabled until a fresh snapshot arrives.');q('#optical-frame').classList.toggle('exhausted',s.evidence.correction.state==='exhausted');text(q('#evidence-frame'),s.evidence.frameId+' · '+s.evidence.quality+' · '+s.evidence.capturedAt);text(q('#evidence-geometry'),'Desired '+s.evidence.desired+' to solved '+s.evidence.solved+'; uncertainty '+s.evidence.uncertaintyArcsec+' arcsec.');text(q('#evidence-desired'),s.evidence.desired);text(q('#evidence-solved'),s.evidence.solved);text(q('#evidence-uncertainty'),s.evidence.uncertaintyArcsec+' arcsec');const stack=s.evidence.stack;text(q('#stack-source'),stack?stack.availability+' · '+stack.frameCount+' frames':'not observed');text(q('#stack-trace'),stack?('Stack observed '+stack.observedAt+' · '+stack.message):'No Stack observation has been received.');text(q('#correction-trace'),s.evidence.correction.state+' correction · '+s.evidence.correction.evidence+' '+s.evidence.correction.bound);const correctionProtection=s.run?.phase==='stopped'?'Latest solve evidence is preserved. This run is terminally stopped; no automatic correction or capture will continue.':s.run?.phase==='paused'?'Latest solve evidence is preserved while capture is paused. No automatic correction or capture will continue until Resume is accepted.':s.run?.phase==='capture'?s.evidence.correction.protection:'Latest solve evidence is retained; no active capture is running.';text(q('#correction-protection'),correctionProtection);text(q('#pause-dispatch'),'');const planActions=q('#plan-actions'),controls=q('#control-actions');text(q('#pause-consequence'),s.identity.capability==='controlCapable'&&s.run?.phase==='capture'&&s.control.holderClientId===s.identity.clientId?'Pause preserves this deterministic managed run; it does not send hardware work.':s.identity.capability==='controlCapable'&&s.run?.phase==='paused'&&s.control.holderClientId===s.identity.clientId?'Resume restores the preserved deterministic phase; it does not send hardware work.':s.identity.capability==='controlCapable'&&s.run?.phase!=='stopped'&&s.control.holderClientId===s.identity.clientId?'Stop is terminal: this managed run cannot be resumed. It does not send hardware work.':s.run?.phase==='stopped'?'This managed run is terminally stopped and cannot be resumed.':'' );planActions.replaceChildren();controls.replaceChildren();if(s.identity.capability==='readOnly')return;if(innerWidth<=600)return;if(s.connection==='stale')return;if(!s.run&&s.plan.readiness==='ready')planActions.append(action('Run plan',()=>send('/api/commands/start-run',{_tag:'StartRunFromPlan',planId:'plan-m27',expectedPlanRevision:s.plan.revision,expectedLeaseRevision:s.control.revision,idempotencyKey:crypto.randomUUID()})));if(s.identity.role==='owner')controls.append(action('Grant control',()=>control('/api/commands/grant-control')),action('Take control',()=>control('/api/commands/take-control')));else if(s.control.holderClientId!==s.identity.clientId)controls.append(action('Request control',()=>control('/api/commands/request-control')));if(s.run&&s.run.phase==='capture'&&s.control.holderClientId===s.identity.clientId)controls.append(action('Pause capture',()=>send('/api/commands/pause-run',{_tag:'PauseRun',expectedLeaseRevision:s.control.revision,expectedRunRevision:s.run.revision,idempotencyKey:crypto.randomUUID()})));if(s.run&&s.run.phase==='paused'&&s.control.holderClientId===s.identity.clientId)controls.append(action('Resume capture',()=>send('/api/commands/resume-run',{_tag:'ResumeRun',expectedLeaseRevision:s.control.revision,expectedRunRevision:s.run.revision,idempotencyKey:crypto.randomUUID()})));if(s.run&&s.run.phase!=='stopped'&&s.control.holderClientId===s.identity.clientId)controls.append(action('Stop run',()=>send('/api/commands/stop-run',{expectedLeaseRevision:s.control.revision,expectedRunRevision:s.run.revision,idempotencyKey:crypto.randomUUID()})))}
function libraryRow(asset){const row=action(asset.role+' · '+asset.format+' · '+asset.availability+' · '+asset.assetId,async()=>{const detail=await fetch('/api/library/assets/'+encodeURIComponent(asset.assetId)).then(response=>response.json());text(libraryDetailNode,'Availability: '+detail.availability+' · Lineage: '+detail.lineage.sourceAssetIds.join(', ')+' · Run: '+detail.lineage.runId+' · Solve: '+detail.lineage.solveAttemptId)});row.className='library-row';return row}
function renderLibraryWindow(){libraryNode.replaceChildren();const end=Math.min(library.results.length,library.start+12),spacer=document.createElement('div'),tail=document.createElement('div');spacer.style.height=(library.start*34)+'px';tail.style.height=((library.results.length-end)*34)+'px';libraryNode.append(spacer,...library.results.slice(library.start,end).map(libraryRow),tail);libraryPrev.disabled=library.start===0;libraryNext.disabled=end===library.results.length}async function loadLibrary(){if(library.results.length)return;const page=await fetch('/api/library?queryId=library-m27&pageSize=40&sort=capturedAtDescending').then(response=>response.json());library.results=page.results;renderLibraryWindow()}libraryNode.onscroll=()=>{const next=Math.max(0,Math.floor(libraryNode.scrollTop/34)-2);if(next!==library.start){library.start=next;renderLibraryWindow()}};libraryPrev.onclick=()=>{library.start=Math.max(0,library.start-10);renderLibraryWindow()};libraryNext.onclick=()=>{library.start=Math.min(Math.max(0,library.results.length-1),library.start+10);renderLibraryWindow()};q('[data-room="Library"]').addEventListener('click',loadLibrary);
function eventProjection(event){const payload=JSON.parse(event.data);return payload.snapshot||payload}async function loadPlan(){plan=await fetch('/api/workspaces/plan').then(r=>r.json());renderPlan()}async function load(){render(await fetch('/api/snapshot').then(r=>r.json()));await loadPlan();select('Plan');const e=new EventSource('/api/events');['snapshot','RunStarted','ProjectionChanged','PlanDraftSaved'].forEach(type=>e.addEventListener(type,async event=>{render(eventProjection(event));await loadPlan()}))}addEventListener('resize',()=>{if(projection){render(projection);renderPlanActions()}});addEventListener('orientationchange',()=>{if(projection){render(projection);renderPlanActions()}});load()/* detail.availability==='availableLocally'; no action will be replayed; temporarily unavailable and cannot open in Process */`

export function applicationShell({ fixture }: { readonly fixture: boolean }) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Astro Console</title><style>${shellStyles}</style>${shellMarkup}<script>const fixture=${JSON.stringify(fixture)};${shellClient}</script></body></html>`
}
