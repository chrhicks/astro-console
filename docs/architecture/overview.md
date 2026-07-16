# Architecture Overview

Astro Console separates vendor protocol behavior from the desktop workflow and
renderer surfaces that operators use.

```text
Renderer
  -> typed desktop API and status projections
  -> Electron IPC with schema decoding
  -> Effect workflows and lifecycle services
  -> connected rig capabilities
  -> Seestar, fake Seestar, or Alpaca adapters
  -> vendor protocol and transport
```

## Boundaries

### SDK And Vendor Protocol

The SDK owns Seestar transport, authentication, protocol parsing, and
device-level command behavior. Alpaca transport helpers live below the desktop
rig boundary as adapter infrastructure.

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
