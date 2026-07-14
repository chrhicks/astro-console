import { Schema } from 'effect'

const OptionalString = Schema.optional(Schema.String)
const OptionalNumber = Schema.optional(Schema.Number)
export const TargetSummarySchema = Schema.Struct({
  id: Schema.String,
  short: Schema.String,
  name: Schema.String,
  visibility: Schema.optional(Schema.Literal('up', 'later', 'blocked')),
  visibilityLabel: OptionalString,
  recommendedFilter: Schema.NullOr(Schema.Literal('clear', 'ir', 'lp')),
  type: Schema.Literal('dso', 'sun', 'moon', 'planet'),
  availableActions: Schema.Array(
    Schema.Literal('slew', 'stack', 'preview', 'filter'),
  ),
})
const LibraryAssetSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  capturedAt: Schema.String,
  kind: Schema.Literal('stack', 'sub', 'calibration', 'exposure'),
  frameKind: Schema.optional(Schema.Literal('light', 'dark')),
  saved: Schema.optional(Schema.Boolean),
  savedFileSize: OptionalNumber,
  hasPreview: Schema.optional(Schema.Boolean),
  previewFileSize: OptionalNumber,
  previewError: OptionalString,
  frameWidth: OptionalNumber,
  frameHeight: OptionalNumber,
  framePixelFormat: OptionalString,
})

export const DesktopStatusSchema = Schema.Struct({
  session: Schema.Struct({
    phase: Schema.Literal(
      'disconnected',
      'connecting',
      'connected',
      'disconnecting',
    ),
    host: OptionalString,
    productModel: OptionalString,
    discovering: Schema.Boolean,
    health: Schema.optional(
      Schema.Struct({
        state: Schema.Literal('healthy', 'stale', 'recovering', 'failed'),
        lastCheckedAt: OptionalString,
        lastError: OptionalString,
      }),
    ),
    reconnect: Schema.optional(
      Schema.Struct({
        active: Schema.Boolean,
        attempt: Schema.Number,
        nextRetryAt: OptionalString,
        lastError: OptionalString,
      }),
    ),
  }),
  pointing: Schema.Struct({
    phase: Schema.Literal('idle', 'slewing', 'arrived', 'failed'),
    target: Schema.NullOr(TargetSummarySchema),
    targetId: OptionalString,
    startedAt: OptionalString,
    step: OptionalString,
    lastError: OptionalString,
  }),
  capture: Schema.Struct({
    phase: Schema.Literal(
      'idle',
      'starting',
      'capturing',
      'stopped',
      'failed',
      'partial',
    ),
    mode: Schema.optional(Schema.Literal('native', 'external')),
    deviceState: Schema.optional(
      Schema.Literal('idle', 'exposing', 'reading', 'ready', 'error'),
    ),
    stacks: OptionalNumber,
    frames: OptionalNumber,
    elapsedSec: OptionalNumber,
    startedAt: OptionalString,
    lastError: OptionalString,
  }),
  preview: Schema.Struct({
    phase: Schema.Literal('none', 'starting', 'active', 'error'),
    source: Schema.Literal('none', 'native'),
    active: Schema.Boolean,
    lastError: OptionalString,
  }),
  device: Schema.Struct({
    pluginKind: Schema.optional(
      Schema.Literal('fake-seestar', 'seestar', 'alpaca-rig'),
    ),
    deviceId: OptionalString,
    displayName: OptionalString,
    host: OptionalString,
    productModel: OptionalString,
    canPark: Schema.optional(Schema.Boolean),
    canPoint: Schema.optional(Schema.Boolean),
    serialNumber: OptionalString,
    firmwareVersion: OptionalString,
    batteryPercent: OptionalNumber,
    deviceTempC: OptionalNumber,
    batteryTempC: OptionalNumber,
    tracking: Schema.optional(Schema.Boolean),
    mountClosed: Schema.optional(Schema.Boolean),
    connectedAt: OptionalString,
    location: Schema.optional(Schema.Struct({ lat: Schema.Number, lon: Schema.Number })),
    locationSource: Schema.optional(Schema.Literal('device', 'geoip')),
    deviceTime: Schema.optional(
      Schema.Struct({
        year: Schema.Number, mon: Schema.Number, day: Schema.Number,
        hour: Schema.Number, min: Schema.Number, sec: Schema.Number,
        timeZone: OptionalString,
      }),
    ),
    deviceTimeLooksStale: Schema.optional(Schema.Boolean),
    activity: Schema.optional(Schema.Literal('idle', 'previewing', 'capturing')),
    storageFreeMb: OptionalNumber,
    storageTotalMb: OptionalNumber,
    warnings: Schema.optional(Schema.Array(Schema.String)),
  }),
  library: Schema.Struct({
    scope: Schema.Literal('current_target', 'all_targets'),
    assets: Schema.Array(LibraryAssetSchema),
    polling: Schema.Boolean,
  }),
  workspace: Schema.Struct({
    state: Schema.Literal(
      'disconnected', 'idle_no_target', 'primed', 'ready_to_slew', 'slewing',
      'on_target', 'preview_starting', 'preview_active', 'preview_error',
      'capturing', 'parked',
    ),
    stateLabel: Schema.String,
    surface: Schema.Struct({
      kind: Schema.Literal('idle', 'scenery', 'solar', 'deepsky'),
      label: Schema.String,
    }),
    capabilities: Schema.Struct({
      preview: Schema.Literal('native', 'external', 'unsupported'),
      capture: Schema.Literal('native', 'external', 'unsupported'),
      darkExposure: Schema.Literal('yes', 'no'),
      autofocus: Schema.Literal('yes', 'no'),
      filterWheel: Schema.Literal('yes', 'no'),
      storage: Schema.Literal('yes', 'no'),
    }),
    actions: Schema.Array(
      Schema.Struct({
        id: Schema.Literal(
          'connect', 'select-target', 'retry-slew', 'retry-preview',
          'stop-preview', 'stop-capture', 'preview', 'capture',
        ),
        label: Schema.String,
        enabled: Schema.Boolean,
        active: Schema.optional(Schema.Boolean),
      }),
    ),
  }),
  camera: Schema.optional(Schema.Struct({ exposureSec: Schema.Number })),
  sequence: Schema.Struct({
    phase: Schema.Literal('idle', 'lights', 'awaiting-darks', 'darks', 'complete', 'stopped', 'failed'),
    plan: Schema.optional(Schema.Struct({ lightCount: Schema.Number, durationSec: Schema.Number, darkCount: Schema.Number })),
    frameKind: Schema.optional(Schema.Literal('light', 'dark')),
    currentIndex: OptionalNumber,
    completed: Schema.Number,
    failed: Schema.Number,
    lastError: OptionalString,
    target: Schema.optional(TargetSummarySchema),
  }),
  currentTarget: Schema.NullOr(TargetSummarySchema),
  statusRevision: Schema.Number,
  lastUpdatedAt: Schema.String,
  lastError: OptionalString,
})

export const DesktopLogEntrySchema = Schema.Struct({
  ts: Schema.String,
  level: Schema.Literal('debug', 'info', 'warn', 'error'),
  event: Schema.String,
  component: Schema.String,
  summary: OptionalString,
  error: OptionalString,
  host: OptionalString,
  sessionId: OptionalString,
  data: Schema.optional(Schema.Unknown),
})

export const DesktopDiscoveredDeviceSchema = Schema.Struct({
  pluginKind: Schema.Literal('fake-seestar', 'seestar', 'alpaca-rig'),
  deviceId: Schema.String,
  displayName: Schema.String,
  host: OptionalString,
  productModel: OptionalString,
  serialNumber: OptionalString,
})

export const CatalogPageSchema = Schema.Struct({
  targets: Schema.Array(TargetSummarySchema),
  total: Schema.Number,
  offset: Schema.Number,
  limit: Schema.Number,
  visibilityAvailable: Schema.Boolean,
})

const OpenNgcObjectTypeSchema = Schema.Literal(
  'G', 'GPair', 'GTrpl', 'GGroup', 'OCl', 'GCl', 'Cl+N', 'PN', 'HII',
  'Neb', 'EmN', 'RfN', 'DrkN', 'SNR', '*Ass', 'Nova', 'Other',
)
export const TargetDetailsSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('dso'),
    designation: Schema.String,
    objectType: OpenNgcObjectTypeSchema,
    raHours: Schema.Number,
    decDeg: Schema.Number,
    constellation: Schema.String,
    visualMagnitude: OptionalNumber,
    surfaceBrightness: OptionalNumber,
    majorAxisArcmin: OptionalNumber,
  }),
  Schema.Struct({
    kind: Schema.Literal('solar-system'),
    designation: Schema.String,
    body: Schema.Literal(
      'sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn',
      'uranus', 'neptune',
    ),
  }),
)

export const FakeRuntimeSnapshotSchema = Schema.Struct({
  scenarios: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      description: Schema.String,
    }),
  ),
  activeScenarioId: Schema.String,
  connectOutcome: Schema.Literal('success', 'failure'),
  device: DesktopStatusSchema.fields.device,
  preview: DesktopStatusSchema.fields.preview,
  capture: DesktopStatusSchema.fields.capture,
  library: DesktopStatusSchema.fields.library,
})
