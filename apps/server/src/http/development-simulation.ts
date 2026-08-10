import { readFileSync } from 'node:fs'
import type { LocalIdentity } from '../auth/identity.ts'
import {
  alpacaSimulationScenarios,
  type AlpacaSimulationScenario,
} from '../simulator/alpaca-simulator.ts'

export type DevelopmentSimulationConfig = {
  readonly origin: string
  readonly launchScenario: AlpacaSimulationScenario
  readonly corpusRoot?: string
}

type SimulatorFrame = {
  readonly id: string
  readonly filename: string
  readonly purpose: string
}

type SimulatorSnapshot = {
  readonly scenario: AlpacaSimulationScenario
  readonly nowMs: number
  readonly generation: number
  readonly cameraPhase: 'idle' | 'exposing' | 'reading'
  readonly imageReady: boolean
  readonly evidence: {
    readonly sequenceLength: number
    readonly framesServed: number
    readonly lastFrame: SimulatorFrame | null
    readonly nextFrame: SimulatorFrame | null
  }
  readonly commandLog: ReadonlyArray<unknown>
}

export type DevelopmentSimulationProjection = {
  readonly mode: 'alpaca'
  readonly notice: 'SIMULATION · NOT LIVE HARDWARE'
  readonly scenario: AlpacaSimulationScenario
  readonly launchScenario: AlpacaSimulationScenario
  readonly scenarios: typeof alpacaSimulationScenarios
  readonly provenance: {
    readonly provider: 'Astro Console Alpaca development simulator'
    readonly transport: 'Server-mediated loopback'
  }
  readonly clock: {
    readonly nowMs: number
    readonly generation: number
  }
  readonly camera: {
    readonly phase: 'idle' | 'exposing' | 'reading'
    readonly imageReady: boolean
  }
  readonly evidence: {
    readonly sequenceLength: number
    readonly framesServed: number
    readonly lastFrame: DevelopmentSimulationFrame | null
    readonly nextFrame: DevelopmentSimulationFrame | null
  }
  readonly commandCount: number
  readonly guide: DevelopmentSimulationScenarioGuide
}

export type DevelopmentSimulationScenarioGuide = {
  readonly summary: string
  readonly driver:
    | {
        readonly _tag: 'Available'
        readonly action:
          'refresh-preflight' | 'capture-test-frame' | 'target-acquire'
        readonly label: string
      }
    | { readonly _tag: 'Unavailable'; readonly reason: string }
}

export type DevelopmentSimulationFrame = SimulatorFrame & {
  readonly sha256?: string
  readonly capture:
    | {
        readonly _tag: 'Available'
        readonly exposureSeconds: 15 | 120
        readonly capturedAt: string
        readonly filter: 'None'
        readonly binning: 1
        readonly frameType: 'light'
      }
    | { readonly _tag: 'Unavailable'; readonly reason: string }
}

export type DevelopmentSimulationControl =
  | { readonly action: 'select'; readonly scenario: AlpacaSimulationScenario }
  | { readonly action: 'reset' }
  | { readonly action: 'advance'; readonly milliseconds: number }

export async function readDevelopmentSimulation(
  config: DevelopmentSimulationConfig,
): Promise<DevelopmentSimulationProjection> {
  const response = await fetch(`${config.origin}/__sim/state`)
  if (!response.ok) throw new Error('The development simulator is unavailable.')
  return projectSnapshot(config, simulatorSnapshot(await response.json()))
}

export async function controlDevelopmentSimulation(
  config: DevelopmentSimulationConfig,
  identity: LocalIdentity,
  raw: unknown,
): Promise<DevelopmentSimulationProjection> {
  if (identity.capability !== 'controlCapable')
    throw new DevelopmentSimulationControlRejected(
      403,
      'Desktop control is required for simulation controls.',
    )
  const current = await readDevelopmentSimulation(config)
  const control = simulationControl(raw)
  const request =
    control.action === 'select' || control.action === 'reset'
      ? {
          path: '/__sim/scenario',
          body: {
            scenario:
              control.action === 'select' ? control.scenario : current.scenario,
          },
        }
      : {
          path: '/__sim/advance',
          body: { milliseconds: control.milliseconds },
        }
  const response = await fetch(`${config.origin}${request.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request.body),
  })
  if (!response.ok)
    throw new DevelopmentSimulationControlRejected(
      response.status >= 400 && response.status < 500 ? 400 : 503,
      'The development simulator rejected the requested control.',
    )
  return projectSnapshot(config, simulatorSnapshot(await response.json()))
}

export class DevelopmentSimulationControlRejected extends Error {
  readonly _tag = 'DevelopmentSimulationControlRejected'
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function simulationControl(value: unknown): DevelopmentSimulationControl {
  if (typeof value !== 'object' || value === null || !('action' in value))
    throw invalidControl()
  if (value.action === 'reset') return { action: 'reset' }
  if (
    value.action === 'select' &&
    'scenario' in value &&
    isScenario(value.scenario)
  )
    return { action: 'select', scenario: value.scenario }
  if (
    value.action === 'advance' &&
    'milliseconds' in value &&
    typeof value.milliseconds === 'number' &&
    Number.isFinite(value.milliseconds) &&
    value.milliseconds > 0 &&
    value.milliseconds <= 180_000
  )
    return { action: 'advance', milliseconds: value.milliseconds }
  throw invalidControl()
}

function invalidControl() {
  return new DevelopmentSimulationControlRejected(
    400,
    'Simulation controls require a known scenario, reset, or an advance from 1 to 180000 ms.',
  )
}

function simulatorSnapshot(value: unknown): SimulatorSnapshot {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('scenario' in value) ||
    !isScenario(value.scenario) ||
    !('nowMs' in value) ||
    typeof value.nowMs !== 'number' ||
    !('generation' in value) ||
    typeof value.generation !== 'number' ||
    !('cameraPhase' in value) ||
    (value.cameraPhase !== 'idle' &&
      value.cameraPhase !== 'exposing' &&
      value.cameraPhase !== 'reading') ||
    !('imageReady' in value) ||
    typeof value.imageReady !== 'boolean' ||
    !('evidence' in value) ||
    !isEvidence(value.evidence) ||
    !('commandLog' in value) ||
    !Array.isArray(value.commandLog)
  )
    throw new Error('The development simulator returned an invalid state.')
  return {
    scenario: value.scenario,
    nowMs: value.nowMs,
    generation: value.generation,
    cameraPhase: value.cameraPhase,
    imageReady: value.imageReady,
    evidence: value.evidence,
    commandLog: value.commandLog,
  }
}

function isEvidence(value: unknown): value is SimulatorSnapshot['evidence'] {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sequenceLength' in value &&
    typeof value.sequenceLength === 'number' &&
    'framesServed' in value &&
    typeof value.framesServed === 'number' &&
    'lastFrame' in value &&
    isNullableFrame(value.lastFrame) &&
    'nextFrame' in value &&
    isNullableFrame(value.nextFrame)
  )
}

function isNullableFrame(value: unknown): value is SimulatorFrame | null {
  return (
    value === null ||
    (typeof value === 'object' &&
      'id' in value &&
      typeof value.id === 'string' &&
      'filename' in value &&
      typeof value.filename === 'string' &&
      'purpose' in value &&
      typeof value.purpose === 'string')
  )
}

function projectSnapshot(
  config: DevelopmentSimulationConfig,
  snapshot: SimulatorSnapshot,
): DevelopmentSimulationProjection {
  return {
    mode: 'alpaca',
    notice: 'SIMULATION · NOT LIVE HARDWARE',
    scenario: snapshot.scenario,
    launchScenario: config.launchScenario,
    scenarios: alpacaSimulationScenarios,
    provenance: {
      provider: 'Astro Console Alpaca development simulator',
      transport: 'Server-mediated loopback',
    },
    clock: { nowMs: snapshot.nowMs, generation: snapshot.generation },
    camera: {
      phase: snapshot.cameraPhase,
      imageReady: snapshot.imageReady,
    },
    evidence: {
      sequenceLength: snapshot.evidence.sequenceLength,
      framesServed: snapshot.evidence.framesServed,
      lastFrame: frame(snapshot.evidence.lastFrame),
      nextFrame: frame(snapshot.evidence.nextFrame),
    },
    commandCount: snapshot.commandLog.length,
    guide: scenarioGuide(snapshot.scenario, config.launchScenario),
  }
}

function scenarioGuide(
  scenario: AlpacaSimulationScenario,
  launchScenario: AlpacaSimulationScenario,
): DevelopmentSimulationScenarioGuide {
  if (scenario !== launchScenario) return restartRequiredGuide(scenario)
  switch (scenario) {
    case 'ready-rig':
      return {
        summary: 'All configured simulator devices report ready.',
        driver: {
          _tag: 'Available',
          action: 'refresh-preflight',
          label: 'Run preflight test',
        },
      }
    case 'optional-device-unavailable':
      return {
        summary: 'The configured focuser is absent from simulator inventory.',
        driver: {
          _tag: 'Available',
          action: 'refresh-preflight',
          label: 'Run preflight test',
        },
      }
    case 'exposure-success':
      return {
        summary:
          'One 15-second M101 exposure reaches Verify with a retained Library original and preview.',
        driver: {
          _tag: 'Available',
          action: 'capture-test-frame',
          label: 'Capture test frame',
        },
      }
    case 'abort-exposure':
      return unavailableGuide(
        'Camera abort clears the active exposure without an image.',
      )
    case 'provider-error':
      return unavailableGuide(
        'Camera start returns a simulated Alpaca provider error.',
      )
    case 'reconciliation-failure':
      return unavailableGuide(
        'Camera start is acknowledged, then state reconciliation fails.',
      )
    case 'retrieval-failure':
      return unavailableGuide('Image retrieval returns a simulated failure.')
    case 'retrieval-oversize':
      return unavailableGuide(
        'Image retrieval exceeds the supported camera byte boundary.',
      )
    case 'restart-no-replay':
      return unavailableGuide(
        'Simulator restart preserves the command log without replay.',
      )
    case 'target-evidence-progression':
      return {
        summary:
          'Two retained NGC 7000 frames drive correction approval, later solved verification, and one 120-second capture.',
        driver: {
          _tag: 'Available',
          action: 'target-acquire',
          label: 'Continue through Plan and Observe',
        },
      }
    case 'solve-success-no-solution':
      return {
        summary:
          'Clouded M101 evidence exhausts the first solve series; a changed 15-second recovery uses the pinned good frame.',
        driver: {
          _tag: 'Available',
          action: 'target-acquire',
          label: 'Continue through Plan and Observe',
        },
      }
    case 'focus-quality-degradation':
      return unavailableGuide(
        'Two NGC 7000 frames preserve severe-focus quality facts.',
      )
  }
}

function restartRequiredGuide(
  scenario: AlpacaSimulationScenario,
): DevelopmentSimulationScenarioGuide {
  return {
    summary:
      'Load changed simulator state only. The installed Plan and target provider still belong to the launch scenario.',
    driver: {
      _tag: 'Unavailable',
      reason: `Restart with npm run dev:sim:inspect -- --scenario=${scenario} to install this workflow.`,
    },
  }
}

function unavailableGuide(summary: string): DevelopmentSimulationScenarioGuide {
  return {
    summary,
    driver: {
      _tag: 'Unavailable',
      reason:
        'The Nightbook UI driver is not implemented yet; Load changes simulator state only.',
    },
  }
}

function frame(
  value: SimulatorFrame | null,
): DevelopmentSimulationFrame | null {
  if (value === null) return null
  const sha256 = checksumFor(value.filename)
  return {
    ...value,
    ...(sha256 === undefined ? {} : { sha256 }),
    capture: developmentCaptureMetadata(value.filename),
  }
}

export function developmentCaptureMetadata(
  filename: string,
): DevelopmentSimulationFrame['capture'] {
  if (filename === 'm101-good-light.fits')
    return {
      _tag: 'Available',
      exposureSeconds: 15,
      capturedAt: '2026-06-22T02:38:07.417Z',
      filter: 'None',
      binning: 1,
      frameType: 'light',
    }
  if (filename === 'm101-clouded-light.fits')
    return {
      _tag: 'Available',
      exposureSeconds: 15,
      capturedAt: '2026-06-22T02:59:31.277Z',
      filter: 'None',
      binning: 1,
      frameType: 'light',
    }
  if (
    filename === 'ngc7000-first-light.fits' ||
    filename === 'ngc7000-dithered-light.fits'
  )
    return {
      _tag: 'Available',
      exposureSeconds: 120,
      capturedAt:
        filename === 'ngc7000-first-light.fits'
          ? '2026-08-07T04:05:52.458Z'
          : '2026-08-07T04:18:48.362Z',
      filter: 'None',
      binning: 1,
      frameType: 'light',
    }
  return {
    _tag: 'Unavailable',
    reason:
      'This frame is not eligible for the 15-second test capture. NGC 7000 frames require 120 seconds, beyond the current 60-second camera command bound.',
  }
}

function isScenario(value: unknown): value is AlpacaSimulationScenario {
  return alpacaSimulationScenarios.some((scenario) => scenario === value)
}

let checksumByFilename: ReadonlyMap<string, string> | undefined

function checksumFor(filename: string) {
  checksumByFilename ??= new Map(
    corpusManifest().entries.map((entry) => [
      entry.copiedFilename,
      entry.sha256,
    ]),
  )
  return checksumByFilename.get(filename)
}

function corpusManifest(): {
  readonly entries: ReadonlyArray<{
    readonly copiedFilename: string
    readonly sha256: string
  }>
} {
  const path = new URL(
    '../../simulation/alpaca-corpus-manifest.json',
    import.meta.url,
  )
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (
    typeof value !== 'object' ||
    value === null ||
    !('entries' in value) ||
    !Array.isArray(value.entries)
  )
    throw new Error('The Alpaca corpus manifest is invalid.')
  const entries = value.entries.filter(
    (entry): entry is { copiedFilename: string; sha256: string } =>
      typeof entry === 'object' &&
      entry !== null &&
      'copiedFilename' in entry &&
      typeof entry.copiedFilename === 'string' &&
      'sha256' in entry &&
      typeof entry.sha256 === 'string',
  )
  return { entries }
}
