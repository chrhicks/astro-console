import { Schema } from 'effect'
import { NonNegativeInt, PositiveNumber } from './primitives.js'

export const DevelopmentSimulationScenario = Schema.Literals([
  'ready-rig',
  'optional-device-unavailable',
  'exposure-success',
  'abort-exposure',
  'provider-error',
  'reconciliation-failure',
  'retrieval-failure',
  'retrieval-oversize',
  'restart-no-replay',
  'target-evidence-progression',
  'solve-success-no-solution',
  'focus-quality-degradation',
])

const DevelopmentSimulationCapture = Schema.TaggedUnion({
  Available: {
    exposureSeconds: PositiveNumber,
    capturedAt: Schema.NonEmptyString,
    filter: Schema.NonEmptyString,
    binning: NonNegativeInt,
    frameType: Schema.Literals(['light', 'dark', 'flat', 'bias']),
  },
  Unavailable: { reason: Schema.NonEmptyString },
})

const DevelopmentSimulationFrame = Schema.Struct({
  id: Schema.NonEmptyString,
  filename: Schema.NonEmptyString,
  purpose: Schema.NonEmptyString,
  sha256: Schema.optionalKey(Schema.NonEmptyString),
  capture: DevelopmentSimulationCapture,
})

const DevelopmentSimulationDriver = Schema.TaggedUnion({
  Available: {
    action: Schema.Literals([
      'refresh-preflight',
      'capture-test-frame',
      'target-acquire',
    ]),
    label: Schema.NonEmptyString,
  },
  Unavailable: { reason: Schema.NonEmptyString },
})

export const DevelopmentSimulationProjection = Schema.Struct({
  mode: Schema.Literal('alpaca'),
  notice: Schema.Literal('SIMULATION · NOT LIVE HARDWARE'),
  scenario: DevelopmentSimulationScenario,
  launchScenario: DevelopmentSimulationScenario,
  scenarios: Schema.Array(DevelopmentSimulationScenario),
  provenance: Schema.Struct({
    provider: Schema.NonEmptyString,
    transport: Schema.NonEmptyString,
  }),
  clock: Schema.Struct({ nowMs: NonNegativeInt, generation: NonNegativeInt }),
  camera: Schema.Struct({
    phase: Schema.Literals(['idle', 'exposing', 'reading']),
    imageReady: Schema.Boolean,
  }),
  evidence: Schema.Struct({
    sequenceLength: NonNegativeInt,
    framesServed: NonNegativeInt,
    lastFrame: Schema.NullOr(DevelopmentSimulationFrame),
    nextFrame: Schema.NullOr(DevelopmentSimulationFrame),
  }),
  commandCount: NonNegativeInt,
  guide: Schema.Struct({
    summary: Schema.NonEmptyString,
    driver: DevelopmentSimulationDriver,
  }),
})

export interface DevelopmentSimulationProjection extends Schema.Schema.Type<
  typeof DevelopmentSimulationProjection
> {}

const SelectSimulation = Schema.Struct({
  action: Schema.Literal('select'),
  scenario: DevelopmentSimulationScenario,
})
const ResetSimulation = Schema.Struct({ action: Schema.Literal('reset') })
const AdvanceSimulation = Schema.Struct({
  action: Schema.Literal('advance'),
  milliseconds: PositiveNumber.check(Schema.isLessThanOrEqualTo(180_000)),
})

export const DevelopmentSimulationControlRequest = Schema.Union([
  SelectSimulation,
  ResetSimulation,
  AdvanceSimulation,
]).pipe(Schema.toTaggedUnion('action'))

export type DevelopmentSimulationControlRequest =
  typeof DevelopmentSimulationControlRequest.Type

export const DevelopmentSimulationUnavailable = Schema.Struct({
  mode: Schema.Literal('alpaca'),
  notice: Schema.Literal('SIMULATION · NOT LIVE HARDWARE'),
  state: Schema.Literal('unavailable'),
  launchScenario: DevelopmentSimulationScenario,
  message: Schema.NonEmptyString,
})

export interface DevelopmentSimulationUnavailable extends Schema.Schema.Type<
  typeof DevelopmentSimulationUnavailable
> {}

export const DevelopmentSimulationControlFailure = Schema.Struct({
  outcome: Schema.Literal('rejected'),
  reason: Schema.Literals([
    'ControlRequired',
    'InvalidInput',
    'SimulatorUnavailable',
  ]),
  message: Schema.NonEmptyString,
})

export interface DevelopmentSimulationControlFailure extends Schema.Schema.Type<
  typeof DevelopmentSimulationControlFailure
> {}

export const DevelopmentSimulationFailure = Schema.Union([
  DevelopmentSimulationUnavailable,
  DevelopmentSimulationControlFailure,
])

export type DevelopmentSimulationFailure =
  typeof DevelopmentSimulationFailure.Type

export const DevelopmentSimulationResponse = Schema.Union([
  DevelopmentSimulationProjection,
  DevelopmentSimulationFailure,
])

export type DevelopmentSimulationResponse =
  typeof DevelopmentSimulationResponse.Type
