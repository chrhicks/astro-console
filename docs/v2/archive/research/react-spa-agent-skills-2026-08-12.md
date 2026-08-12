# React And SPA Agent-Skill Candidates

Status: **research evidence — 2026-08-12; not current product authority**

## Question

Which public Agent Skills provide React, component, or single-page application
architecture guidance that can complement Astro Console's `codebase-design`
skill?

This review inspected each candidate's actual `SKILL.md` and its required
references at the commits named below. It did not rely on catalog descriptions.
The assessment is about reusable instructions, not proof that any skill improves
agent output in this repository.

## Recommendation

Do not install one broad frontend pack as the architecture authority. Adapt two
narrow sources into one project-local `react-app-design` skill:

1. Use Vercel's `composition-patterns` for React component-interface mechanics.
2. Use akillness's `state-management` for state-owner classification.
3. Keep this repository's `codebase-design` vocabulary and deletion/interface
   tests as the higher-level authority.
4. Route measured performance work to Vercel's `react-best-practices`; do not
   load it for every architecture decision.

This combination fills the real gap: `codebase-design` says how to place a deep
module and judge its interface, while the two React sources say how React
composition and state ownership realize that seam. A local adaptation must
replace conflicting terms and library-first defaults with the project's
**module**, **interface**, **seam**, **adapter**, **depth**, **leverage**, and
**locality** vocabulary.

## Ranked Candidates

### 1. Vercel `composition-patterns` — adopt as the component-interface source

- Maintainer: Vercel Labs; MIT declared in the skill and repository.
- Source: [`skills/composition-patterns/SKILL.md`](https://github.com/vercel-labs/agent-skills/blob/b8caa260a420a73042e35521de4b5c8baf6446cc/skills/composition-patterns/SKILL.md)
  and the [complete compiled rules](https://github.com/vercel-labs/agent-skills/blob/b8caa260a420a73042e35521de4b5c8baf6446cc/skills/composition-patterns/AGENTS.md).
- Substance: component-interface design, compound components, avoiding Boolean
  prop proliferation, explicit variants, provider-owned state, and a generic
  `state`/`actions`/`meta` context interface.
- Alignment: strong. Compound components can be deep modules; the context value
  is an interface at a React-tree seam; providers are adapters. Explicit
  variants improve locality by keeping each valid composition visible.
- Conflict: its phrase "component architecture" is narrower than this repo's
  architecture vocabulary. Its advice to create generic context interfaces can
  also create hypothetical seams; apply the repo's rule that two justified
  adapters make a real seam. Context is not a substitute for the existing
  `NightbookWorkspaceRuntime` interface.
- Quality caution: the current rules contain at least one inconsistent example
  (`Composer.Context` is referenced but not exported), recorded in upstream
  [issue #286](https://github.com/vercel-labs/agent-skills/issues/286). The skill
  also says React 19 replaces `useContext` with `use`, while React still documents
  [`useContext` as current](https://react.dev/reference/react/useContext); treat
  `use` as an option, not a required migration. React does confirm that
  [`forwardRef` is no longer necessary in React 19](https://react.dev/reference/react/forwardRef).
- Adoption: strongest source, but vendor selected rules into a local skill with
  attribution and corrections rather than copying it unchanged.

### 2. akillness `state-management` — adapt as the state-ownership router

- Maintainer: akillness; the skill declares MIT. The repository README claims
  MIT, but the inspected checkout had no root `LICENSE` file, so preserve the
  skill's attribution and verify licensing before redistributing copied text.
- Source: [`.agent-skills/state-management/SKILL.md`](https://github.com/akillness/jeo-skills/blob/78ba27412f4e019e937a65377942aadf918af81f/.agent-skills/state-management/SKILL.md)
  plus its [ownership packets](https://github.com/akillness/jeo-skills/blob/78ba27412f4e019e937a65377942aadf918af81f/.agent-skills/state-management/references/ownership-packets-and-route-outs.md)
  and [decision matrix](https://github.com/akillness/jeo-skills/blob/78ba27412f4e019e937a65377942aadf918af81f/.agent-skills/state-management/references/decision-matrix.md).
- Substance: classifies local UI, shared subtree, URL/navigation, form, server,
  and client-workflow state before choosing an owner. It explicitly rejects one
  universal store and duplicated server state.
- Alignment: very strong. "Choose the smallest owner" complements seam
  placement and locality. Its packet split prevents React state from becoming a
  second authority beside the service and workspace runtime.
- Conflict: it recommends TanStack Query, router data APIs, Zustand, Redux, and
  Jotai as defaults in categories. Astro Console currently needs none of them:
  service truth and `NightbookWorkspaceRuntime` already own remote/workflow
  state. A local adaptation should classify first and require evidence before a
  dependency or new seam.
- Adoption: best conceptual complement, but lower-maintenance confidence than
  Vercel and a license-file ambiguity make direct installation less attractive.

### 3. Vercel `react-best-practices` — install or reference only for performance

- Maintainer: Vercel Labs; MIT declared in the skill and repository.
- Source: [`skills/react-best-practices/SKILL.md`](https://github.com/vercel-labs/agent-skills/blob/b8caa260a420a73042e35521de4b5c8baf6446cc/skills/react-best-practices/SKILL.md)
  and its [complete rule catalog](https://github.com/vercel-labs/agent-skills/blob/b8caa260a420a73042e35521de4b5c8baf6446cc/skills/react-best-practices/AGENTS.md).
- Substance: 70 rules for waterfalls, bundle size, server/client behavior,
  rerenders, rendering, and JavaScript cost. It contains useful architectural
  effects such as starting independent work together, splitting combined hooks,
  deriving state during render, and conditional loading.
- Alignment: moderate. It can test whether a React seam creates excessive
  subscriptions or bundles, but it does not decide the app's authoritative
  modules or state owners.
- Conflict: Next.js and RSC rules do not apply to this Vite SPA. Several rules
  are optimization heuristics and must follow measurement. Loading the complete
  catalog during normal design would dilute `codebase-design`.
- Adoption: credible and well maintained. Keep it as a routed specialist after
  profiling or bundle evidence, not as the React architecture skill.

### 4. wshobson `react-state-management` — useful examples, reject as authority

- Maintainer: Seth Hobson / `wshobson/agents`; repository MIT license.
- Source: [`react-state-management/SKILL.md`](https://github.com/wshobson/agents/blob/c4b82b0ad771190355eb8e204b1329732a18449a/plugins/frontend-mobile-development/skills/react-state-management/SKILL.md)
  and [detailed examples](https://github.com/wshobson/agents/blob/c4b82b0ad771190355eb8e204b1329732a18449a/plugins/frontend-mobile-development/skills/react-state-management/references/details.md).
- Substance: state categories, selection criteria, selectors, normalization,
  derived-state avoidance, and worked Redux Toolkit, Zustand, Jotai, and React
  Query examples.
- Alignment: moderate. State categories are useful, but the skill moves quickly
  from category to library and store structure. It lacks an explicit seam,
  interface, or deletion test.
- Conflict: "small app -> Zustand or Jotai" is too library-forward for this
  project. It risks turning the existing Effect runtime into duplicated React
  state. Use only as implementation examples after ownership is settled.
- Adoption: established MIT repository, but redundant if candidate 2 is adapted.

### 5. Addy Osmani `frontend-ui-engineering` — broad QA checklist, not architecture

- Maintainer: Addy Osmani; repository MIT license.
- Source: [`skills/frontend-ui-engineering/SKILL.md`](https://github.com/addyosmani/agent-skills/blob/be42637c5af93fdc8526b68ec2f2651b930f316c/skills/frontend-ui-engineering/SKILL.md).
- Substance: colocated component files, composition over configuration,
  container/presentation separation, a simple state chooser, accessibility,
  responsive behavior, loading states, and verification.
- Alignment: weak to moderate. It gives sensible implementation and QA defaults,
  but "one thing" components and a 200-line red flag can work against deep
  modules by rewarding shallow extraction.
- Conflict: its fixed breakpoint checklist differs from Astro Console's required
  wide, compact, and 390 px proof. Its design guidance must not override
  Nightbook. Its accessibility and visual rules also overlap the existing
  Designer verification flow.
- Adoption: reputable and MIT, but do not add it as another broad authority.
  Select isolated verification ideas only.

## Candidates Rejected Before Ranking

- `wshobson/agents` `nextjs-app-router-patterns`: substantive framework guidance,
  but Astro Console uses Vite and a client SPA, not Next.js App Router, RSC, or
  Server Actions.
- Expo skills and React Native architecture skills: good first-party or
  framework-specific material, but their navigation, native module, and offline
  mobile seams do not match `apps/web`.
- Broad design-system and web-component skills: overlap Nightbook's visual and
  package authority and often prescribe configurable prop surfaces that conflict
  with deep-interface discipline.

## What `apps/web` Would Change

This research does not authorize a refactor. A likely first application would
be an interface change around `App.tsx`, not a new global store.

Today `App` owns the runtime subscription, route synchronization, seven command
function states, submission folding, navigation, and page composition. A local
React architecture skill would classify:

- service projections and workflow results as **runtime-owned remote state**;
- URL and route selection as **navigation state**;
- panel, draft, tab, and pending controls as **local UI state**;
- `NightbookWorkspaceRuntime.states` plus `submit(intent)` as the existing deep
  module interface and test surface.

The likely change is a thin React adapter such as
`NightbookWorkspaceProvider`/`useNightbookWorkspace()` that starts and disposes
the runtime, subscribes once, and exposes the existing state plus one typed
`submit(intent)` function. Route-specific adapter hooks can translate that one
function into Plan, Observe, Library, and Process props. `App` then selects a
route and composes a workspace; it no longer stores seven function values that
are initialized in an effect.

The change must **not** add Zustand, React Query, or a second workflow model.
Nightbook remains presentation authority, the service remains product-truth
authority, and the Effect runtime remains the external seam. Tests should cross
the provider/runtime interface and keep local component state local. The Vercel
composition guidance would help shape that adapter; `codebase-design` would
decide whether it is deep enough to exist.

## Primary Framework Checks

The local adaptation should retain these React-owned principles:

- avoid contradictory, redundant, duplicated, and deeply nested state
  ([React: Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure));
- lift shared state to the closest common owner
  ([React: Sharing State Between Components](https://react.dev/learn/sharing-state-between-components));
- use context for tree-wide access, while accounting for its subscription and
  rerender behavior ([React: `useContext`](https://react.dev/reference/react/useContext));
- keep event-driven work in event handlers and avoid effects used only to derive
  render state ([React: You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)).

These are framework facts. They do not by themselves decide Astro Console's
module seams.
