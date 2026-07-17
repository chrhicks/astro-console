import type {
  CaptureProjection,
  DeviceProjection,
  DesktopDiscoveredDeviceV2,
  FakeRuntimeSnapshot,
  FakeScenarioSummary,
  LibraryProjection,
  PointingProjection,
  PreviewProjection,
} from '../../../shared/api-v2'
import type { DeviceSessionRefresh } from './device-plugin'

export interface FakeScenarioConnectSuccess {
  readonly kind: 'success'
  readonly device: DeviceProjection
  readonly warnings: string[]
}

export interface FakeScenarioConnectFailure {
  readonly kind: 'failure'
  readonly error: string
}

export type FakeScenarioConnectOutcome =
  | FakeScenarioConnectSuccess
  | FakeScenarioConnectFailure

export interface FakeScenarioPointSuccess {
  readonly kind: 'success'
}

export interface FakeScenarioPointFailure {
  readonly kind: 'failure'
  readonly error: string
}

export type FakeScenarioPointOutcome =
  | FakeScenarioPointSuccess
  | FakeScenarioPointFailure

export interface FakeScenarioPreviewOutcome {
  readonly startOutcome: FakeScenarioPointOutcome
  readonly delayMs: number
}

export interface FakeScenarioCaptureOutcome {
  readonly startOutcome: FakeScenarioPointOutcome
  readonly delayMs: number
}

export interface FakeScenarioAfterPoint {
  readonly device?: DeviceProjection
  readonly preview: PreviewProjection
  readonly capture: CaptureProjection
  readonly library: LibraryProjection
}

export interface FakeScenario {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly discover: readonly DesktopDiscoveredDeviceV2[]
  readonly connect: {
    readonly delayMs: number
    readonly outcome: FakeScenarioConnectOutcome
  }
  readonly point: {
    readonly delayMs: number
    readonly outcome: FakeScenarioPointOutcome
  }
  // Projection state shown while connected before any slew. Defaults to no
  // preview, idle capture, empty library.
  readonly connected?: FakeScenarioAfterPoint
  readonly connectedPointing?: PointingProjection
  readonly supportsStopMotion?: boolean
  // Projection state applied after a successful pointToTarget on the fake
  // session. Omit for scenarios that only exercise connect/preflight.
  readonly afterPoint?: FakeScenarioAfterPoint
  // Outcome of a startPreview call on the fake session. Defaults to success.
  readonly preview?: FakeScenarioPreviewOutcome
  // Outcome of a startCapture call on the fake session. Defaults to success.
  readonly capture?: FakeScenarioCaptureOutcome
}

const FAKE_HOST = '192.168.1.100'
const FAKE_DEVICE_ID = 'fake-seestar-s30'
const FAKE_MODEL = 'Seestar S30 (fake)'
const FAKE_SERIAL_NUMBER = 'FAKE-S30-001'

const FRESH_DEVICE_TIME = { year: 2026, mon: 7, day: 3, hour: 21, min: 30, sec: 0 }
const STALE_DEVICE_TIME = { year: 1970, mon: 1, day: 1, hour: 0, min: 0, sec: 0 }

function discovered(): DesktopDiscoveredDeviceV2 {
  return {
    pluginKind: 'fake-seestar',
    deviceId: FAKE_DEVICE_ID,
    displayName: FAKE_MODEL,
    host: FAKE_HOST,
    productModel: FAKE_MODEL,
    serialNumber: FAKE_SERIAL_NUMBER,
  }
}

function baseDevice(overrides: DeviceProjection): DeviceProjection {
  return {
    pluginKind: 'fake-seestar',
    deviceId: FAKE_DEVICE_ID,
    displayName: FAKE_MODEL,
    host: FAKE_HOST,
    productModel: FAKE_MODEL,
    serialNumber: FAKE_SERIAL_NUMBER,
    firmwareVersion: '7.32',
    batteryPercent: 92,
    deviceTempC: 21,
    batteryTempC: 19,
    tracking: false,
    mountClosed: false,
    storageFreeMb: 8192,
    storageTotalMb: 16384,
    ...overrides,
  }
}

const NO_PREVIEW: PreviewProjection = {
  phase: 'none',
  source: 'none',
  active: false,
}

const NO_CAPTURE: CaptureProjection = { phase: 'idle' }

const NO_LIBRARY: LibraryProjection = {
  scope: 'current_target',
  assets: [],
  polling: false,
}

const CONNECTED_IDLE: FakeScenarioAfterPoint = {
  preview: NO_PREVIEW,
  capture: NO_CAPTURE,
  library: NO_LIBRARY,
}

const SCENARIOS: readonly FakeScenario[] = [
  {
    id: 'abort-slew-available',
    label: 'Abort slew available',
    description: 'Connects in a safe simulated slew with an available abort action.',
    discover: [discovered()],
    connect: {
      delayMs: 500,
      outcome: {
        kind: 'success',
        device: baseDevice({
          location: { lat: 37.7749, lon: -122.4194 },
          deviceTime: FRESH_DEVICE_TIME,
          deviceTimeLooksStale: false,
          activity: 'idle',
          warnings: [],
        }),
        warnings: [],
      },
    },
    point: { delayMs: 750, outcome: { kind: 'success' } },
    connectedPointing: {
      phase: 'slewing',
      target: {
        id: 'fake-m42',
        short: 'M42',
        name: 'Orion Nebula',
        recommendedFilter: null,
        type: 'dso',
        availableActions: ['slew', 'stack', 'preview', 'filter'],
      },
      targetId: 'fake-m42',
      startedAt: '2026-07-03T21:30:00.000Z',
      step: 'Slewing to target',
    },
    supportsStopMotion: true,
  },
  {
    id: 'clean-connect',
    label: 'Clean connect',
    description: 'Connects with fresh time, location set, and no warnings.',
    discover: [discovered()],
    connect: {
      delayMs: 500,
      outcome: {
        kind: 'success',
        device: baseDevice({
          location: { lat: 37.7749, lon: -122.4194 },
          deviceTime: FRESH_DEVICE_TIME,
          deviceTimeLooksStale: false,
          activity: 'idle',
          warnings: [],
        }),
        warnings: [],
      },
    },
    point: { delayMs: 750, outcome: { kind: 'success' } },
  },
  {
    id: 'stale-time',
    label: 'Stale device time',
    description: 'Connects but the device clock reads 1970 and time looks stale.',
    discover: [discovered()],
    connect: {
      delayMs: 500,
      outcome: {
        kind: 'success',
        device: baseDevice({
          location: { lat: 37.7749, lon: -122.4194 },
          deviceTime: STALE_DEVICE_TIME,
          deviceTimeLooksStale: true,
          activity: 'idle',
          warnings: ['Device time looks stale (1970-01-01 00:00 UTC)'],
        }),
        warnings: ['Device time looks stale (1970-01-01 00:00 UTC)'],
      },
    },
    point: { delayMs: 750, outcome: { kind: 'success' } },
  },
  {
    id: 'missing-location',
    label: 'Missing location',
    description: 'Connects without a user location set, with a warning.',
    discover: [discovered()],
    connect: {
      delayMs: 500,
      outcome: {
        kind: 'success',
        device: baseDevice({
          deviceTime: FRESH_DEVICE_TIME,
          deviceTimeLooksStale: false,
          activity: 'idle',
          warnings: ['User location is not available in device state'],
        }),
        warnings: ['User location is not available in device state'],
      },
    },
    point: { delayMs: 750, outcome: { kind: 'success' } },
  },
  {
    id: 'connect-failure',
    label: 'Connect failure',
    description: 'Connect fails with an authentication-style error.',
    discover: [discovered()],
    connect: {
      delayMs: 500,
      outcome: {
        kind: 'failure',
        error: 'Fake connect failure: authentication handshake rejected.',
      },
    },
    point: { delayMs: 750, outcome: { kind: 'success' } },
  },
  {
    id: 'point-failure',
    label: 'Point failure',
    description: 'Connects cleanly but pointing fails with a slew error.',
    discover: [discovered()],
    connect: {
      delayMs: 500,
      outcome: {
        kind: 'success',
        device: baseDevice({
          location: { lat: 37.7749, lon: -122.4194 },
          deviceTime: FRESH_DEVICE_TIME,
          deviceTimeLooksStale: false,
          activity: 'idle',
          warnings: [],
        }),
        warnings: [],
      },
    },
    point: {
      delayMs: 750,
      outcome: {
        kind: 'failure',
        error: 'Fake point failure: slew rejected by mount.',
      },
    },
  },
  {
    id: 'busy-view',
    label: 'Busy capturing',
    description: 'Connects but the device is already busy capturing.',
    discover: [discovered()],
    connect: {
      delayMs: 500,
      outcome: {
        kind: 'success',
        device: baseDevice({
          location: { lat: 37.7749, lon: -122.4194 },
          deviceTime: FRESH_DEVICE_TIME,
          deviceTimeLooksStale: false,
          activity: 'capturing',
          warnings: ['Device is already busy capturing'],
        }),
        warnings: ['Device is already busy capturing'],
      },
    },
    point: { delayMs: 750, outcome: { kind: 'success' } },
  },
  {
    id: 'preview-active',
    label: 'Preview active after slew',
    description:
      'Connects idle; after a successful slew, live preview goes active.',
    discover: [discovered()],
    connect: {
      delayMs: 500,
      outcome: {
        kind: 'success',
        device: baseDevice({
          location: { lat: 37.7749, lon: -122.4194 },
          deviceTime: FRESH_DEVICE_TIME,
          deviceTimeLooksStale: false,
          activity: 'idle',
          warnings: [],
        }),
        warnings: [],
      },
    },
    point: { delayMs: 750, outcome: { kind: 'success' } },
    afterPoint: {
      device: baseDevice({ activity: 'previewing' }),
      preview: { phase: 'active', source: 'native', active: true },
      capture: NO_CAPTURE,
      library: NO_LIBRARY,
    },
  },
  {
    id: 'preview-error',
    label: 'Preview error after slew',
    description:
      'Connects idle; after a successful slew, preview fails to start.',
    discover: [discovered()],
    connect: {
      delayMs: 500,
      outcome: {
        kind: 'success',
        device: baseDevice({
          location: { lat: 37.7749, lon: -122.4194 },
          deviceTime: FRESH_DEVICE_TIME,
          deviceTimeLooksStale: false,
          activity: 'idle',
          warnings: [],
        }),
        warnings: [],
      },
    },
    point: { delayMs: 750, outcome: { kind: 'success' } },
    preview: {
      delayMs: 400,
      startOutcome: {
        kind: 'failure',
        error: 'Fake preview error: preview handshake timed out.',
      },
    },
    afterPoint: {
      device: baseDevice({ activity: 'previewing' }),
      preview: NO_PREVIEW,
      capture: NO_CAPTURE,
      library: NO_LIBRARY,
    },
  },
  {
    id: 'capturing',
    label: 'Capturing stack after slew',
    description:
      'Connects idle; after a successful slew, stacking is active with frames and saved assets.',
    discover: [discovered()],
    connect: {
      delayMs: 500,
      outcome: {
        kind: 'success',
        device: baseDevice({
          location: { lat: 37.7749, lon: -122.4194 },
          deviceTime: FRESH_DEVICE_TIME,
          deviceTimeLooksStale: false,
          activity: 'idle',
          warnings: [],
        }),
        warnings: [],
      },
    },
    point: { delayMs: 750, outcome: { kind: 'success' } },
    afterPoint: {
      device: baseDevice({
        activity: 'capturing',
        tracking: true,
      }),
      preview: { phase: 'active', source: 'native', active: true },
      capture: {
        phase: 'capturing',
        stacks: 42,
        frames: 168,
        elapsedSec: 1260,
      },
      library: {
        scope: 'current_target',
        polling: true,
        assets: [
          {
            id: 'fake-asset-001',
            name: 'M42_stack_001.fits',
            capturedAt: '2026-07-03T21:45:00.000Z',
            kind: 'stack',
          },
          {
            id: 'fake-asset-002',
            name: 'M42_sub_0120.fits',
            capturedAt: '2026-07-03T21:50:00.000Z',
            kind: 'sub',
          },
        ],
      },
    },
  },
  {
    id: 'capture-failed',
    label: 'Capture failed after slew',
    description:
      'Connects idle; after a successful slew, the capture fails with an autofocus error.',
    discover: [discovered()],
    connect: {
      delayMs: 500,
      outcome: {
        kind: 'success',
        device: baseDevice({
          location: { lat: 37.7749, lon: -122.4194 },
          deviceTime: FRESH_DEVICE_TIME,
          deviceTimeLooksStale: false,
          activity: 'idle',
          warnings: [],
        }),
        warnings: [],
      },
    },
    point: { delayMs: 750, outcome: { kind: 'success' } },
    capture: {
      delayMs: 400,
      startOutcome: {
        kind: 'failure',
        error: 'Fake capture failure: autofocus timed out before stacking.',
      },
    },
    afterPoint: {
      device: baseDevice({ activity: 'idle' }),
      preview: NO_PREVIEW,
      capture: NO_CAPTURE,
      library: NO_LIBRARY,
    },
  },
]

const DEFAULT_SCENARIO_ID = 'clean-connect'

const state = {
  activeScenarioId: DEFAULT_SCENARIO_ID,
}

function findScenario(id: string): FakeScenario {
  const scenario = SCENARIOS.find((s) => s.id === id)
  if (!scenario) {
    throw new Error(`Unknown fake scenario: ${id}`)
  }
  return scenario
}

function activeScenario(): FakeScenario {
  return findScenario(state.activeScenarioId)
}

function toSummary(scenario: FakeScenario): FakeScenarioSummary {
  return {
    id: scenario.id,
    label: scenario.label,
    description: scenario.description,
  }
}

function snapshot(): FakeRuntimeSnapshot {
  const scenario = activeScenario()
  const connected = scenario.connected ?? CONNECTED_IDLE
  return {
    scenarios: SCENARIOS.map(toSummary),
    activeScenarioId: scenario.id,
    connectOutcome: scenario.connect.outcome.kind,
    device:
      scenario.connect.outcome.kind === 'success'
        ? scenario.connect.outcome.device
        : {},
    preview: connected.preview,
    capture: connected.capture,
    library: connected.library,
  }
}

export const fakeSeestarRuntime = {
  getActiveScenario: (): FakeScenario => activeScenario(),

  // Post-slew projection state for the active scenario, or null if the
  // scenario only exercises connect/preflight behavior.
  getAfterPointState: (): FakeScenarioAfterPoint | null =>
    activeScenario().afterPoint ?? null,

  // Outcome of a startPreview call on the active scenario. Defaults to
  // success when the scenario does not define a preview outcome.
  getPreviewStartOutcome: (): FakeScenarioPreviewOutcome =>
    activeScenario().preview ?? {
      delayMs: 400,
      startOutcome: { kind: 'success' },
    },

  // Outcome of a startCapture call on the active scenario. Defaults to
  // success when the scenario does not define a capture outcome.
  getCaptureStartOutcome: (): FakeScenarioCaptureOutcome =>
    activeScenario().capture ?? {
      delayMs: 400,
      startOutcome: { kind: 'success' },
    },

  // Derive device/preview/capture projections from the active scenario's
  // afterPoint state and the session's preview/capture/parked flags. Called by
  // the fake session's refresh after preview/capture/park commands succeed.
  refresh: (
    previewActive: boolean,
    captureActive: boolean,
    parked = false,
  ): DeviceSessionRefresh => {
    if (parked) {
      return {
        device: {
          activity: 'idle',
          tracking: false,
          mountClosed: true,
        },
        preview: { phase: 'none', source: 'none', active: false },
        capture: { phase: 'idle' },
      }
    }
    const afterPoint = activeScenario().afterPoint
    const baseDevice = afterPoint?.device
    if (captureActive) {
      return {
        device: {
          activity: baseDevice?.activity ?? 'capturing',
          tracking: baseDevice?.tracking ?? true,
          mountClosed: false,
        },
        preview: { phase: 'active', source: 'native', active: true },
        capture:
          afterPoint?.capture && afterPoint.capture.phase === 'capturing'
            ? afterPoint.capture
            : { phase: 'capturing' },
      }
    }
    if (previewActive) {
      return {
        device: {
          activity: baseDevice?.activity ?? 'previewing',
          tracking: false,
          mountClosed: false,
        },
        preview: { phase: 'active', source: 'native', active: true },
        capture: { phase: 'idle' },
      }
    }
    return {
      device: {
        activity: 'idle',
        tracking: false,
        mountClosed: false,
      },
      preview: { phase: 'none', source: 'none', active: false },
      capture: { phase: 'idle' },
    }
  },

  loadScenario: (id: string): FakeRuntimeSnapshot => {
    state.activeScenarioId = findScenario(id).id
    return snapshot()
  },

  reset: (): FakeRuntimeSnapshot => {
    // No evolved device state yet; reset returns the active scenario's
    // initial projection. Future state that evolves between commands should
    // clear itself here.
    return snapshot()
  },

  snapshot: (): FakeRuntimeSnapshot => snapshot(),
}
