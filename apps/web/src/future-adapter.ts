import type { Projection } from './presentation'

export const unavailableProjection: Projection = {
  shell: {
    service: 'Service unavailable',
    environment: 'Environment unavailable',
    attention: 'attention',
    readOnly: true,
    activeRun: 'No authoritative run',
    phase: 'Unavailable',
    progress: 'No last-confirmed progress evidence',
    progressValue: 0,
    progressMax: 1,
    sequenceProgress: 'Sequence unavailable',
    freshness: 'No authoritative snapshot',
    controller: 'Controller unknown',
    capability: 'Read-only / mutations unavailable',
    protection:
      'Protected: commands are unavailable until a current service snapshot arrives.',
  },
  plan: {
    title: 'Plan unavailable',
    readiness: 'Readiness unavailable without a service snapshot.',
    sequences: [],
  },
  observe: {
    target: 'Observe unavailable',
    phase: 'Unavailable',
    status: 'No authoritative run evidence',
    tone: 'attention',
    evidence: 'Reconnect to load a complete service snapshot.',
    annotation: 'No image-derived evidence is available.',
    heading: 'Current run truth is unavailable',
    trace: ['No service lifecycle trace is available.'],
    facts: ['Rig, control, and recovery facts are unavailable.'],
    lifecycle: [
      'Preflight',
      'Acquire',
      'Capture',
      'Verify',
      'Recover',
      'Complete',
    ],
  },
  library: { assets: [] },
  process: {
    sessionId: 'Unavailable',
    label: 'No processing session',
    source: 'No source asset',
    steps: [
      { label: 'Build', status: 'Unavailable' },
      { label: 'Develop', status: 'Unavailable' },
    ],
    preview: 'Preview unavailable',
    checkpoint: 'No checkpoint',
    diagnostics: 'No diagnostics',
  },
}
