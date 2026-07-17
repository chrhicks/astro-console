# Architecture Overview

Astro Console separates vendor protocol behavior from the desktop workflow and
renderer surfaces that operators use.

```text
Renderer
  -> typed desktop API and status projections
  -> Electron IPC with schema decoding
  -> Effect workflows and lifecycle services
  -> desktop rig projection bridge
  -> SDK rig procedures
  -> Seestar or Alpaca vendor protocol and transport
```

## Boundaries

### SDK And Vendor Protocol

The SDK owns the provider-neutral rig procedure contract plus Seestar and
Alpaca transport, discovery, authentication, protocol parsing, capability
probing, and device-level command behavior. Direct provider clients remain
available to SDK consumers; desktop uses the normalized SDK rig session.

The desktop bridge maps SDK snapshots and callable procedures to desktop
projections. It owns Electron-specific configuration, session lifecycle,
operation leases, aggregate state, storage, IPC, and user-facing workflows; it
does not issue vendor endpoint calls.

### Rig Capabilities

Adapters assemble a `ConnectedRig` from callable capabilities. Mount, pointing,
preview, generic camera, native capture, focuser, filter wheel, and storage are
independent optional surfaces. A missing callable capability means the action
is unavailable.

### Workflows And State

Effect workflows orchestrate rig operations. The aggregate store is the
application-facing state; session identity and operation leases guard async
commits. Stop, park, and disconnect recoveries preempt ordinary work.

### Renderer

The renderer consumes typed status projections and invokes typed mutations. It
does not interpret vendor protocol state or construct device commands.

## Invariants

- Decode untrusted data at transport and IPC boundaries.
- Keep vendor quirks inside adapters.
- Keep capability decisions in callable rig surfaces.
- Keep generic external exposure distinct from vendor-native capture.
- Treat hardware state as authoritative only after an adapter refresh confirms
  it.
