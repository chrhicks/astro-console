import {
  Button,
  DataList,
  DataListItem,
  Field,
  Flyout,
  Select,
  Stack,
  StatusIndicator,
  type FlyoutTriggerProps,
} from '@nightbook/ui'
import { useEffect, useState, type ChangeEvent } from 'react'

export type DevelopmentSimulationFrame = {
  readonly id: string
  readonly filename: string
  readonly purpose: string
  readonly sha256?: string
  readonly capture:
    | {
        readonly _tag: 'Available'
        readonly exposureSeconds: number
        readonly capturedAt: string
        readonly filter: string
        readonly binning: number
        readonly frameType: 'light' | 'dark' | 'flat' | 'bias'
      }
    | { readonly _tag: 'Unavailable'; readonly reason: string }
}

export type DevelopmentSimulationProjection = {
  readonly mode: 'alpaca'
  readonly notice: 'SIMULATION · NOT LIVE HARDWARE'
  readonly scenario: string
  readonly launchScenario: string
  readonly scenarios: readonly string[]
  readonly provenance: {
    readonly provider: string
    readonly transport: string
  }
  readonly clock: { readonly nowMs: number; readonly generation: number }
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
  readonly guide: {
    readonly summary: string
    readonly driver:
      | {
          readonly _tag: 'Available'
          readonly action:
            | 'refresh-preflight'
            | 'capture-test-frame'
            | 'target-acquire'
          readonly label: string
        }
      | { readonly _tag: 'Unavailable'; readonly reason: string }
  }
}

type UnavailableSimulation = {
  readonly mode: 'alpaca'
  readonly notice: 'SIMULATION · NOT LIVE HARDWARE'
  readonly state: 'unavailable'
  readonly launchScenario: string
  readonly message: string
}

type SimulationState =
  | { readonly _tag: 'loading' }
  | { readonly _tag: 'absent' }
  | {
      readonly _tag: 'available'
      readonly projection: DevelopmentSimulationProjection
    }
  | { readonly _tag: 'unavailable'; readonly value: UnavailableSimulation }

type SimulationControl =
  | { readonly action: 'select'; readonly scenario: string }
  | { readonly action: 'reset' }
  | { readonly action: 'advance'; readonly milliseconds: number }

let knownSimulationState: Exclude<
  SimulationState,
  { readonly _tag: 'loading' | 'absent' }
> | null = null

export async function readSimulationProjection(): Promise<SimulationState> {
  const response = await fetch('/api/simulation')
  if (response.status === 404) return { _tag: 'absent' }
  const value: unknown = await response.json().catch(() => undefined)
  if (response.ok && isProjection(value))
    return { _tag: 'available', projection: value }
  if (isUnavailable(value)) return { _tag: 'unavailable', value }
  return { _tag: 'absent' }
}

export async function sendSimulationControl(
  control: SimulationControl,
): Promise<DevelopmentSimulationProjection> {
  const response = await fetch('/api/simulation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(control),
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok || !isProjection(value))
    throw new Error(simulationFailureMessage(value))
  return value
}

export function DevelopmentSimulationStrip({
  readOnly,
}: {
  readOnly: boolean
}) {
  const [state, setState] = useState<SimulationState>(
    knownSimulationState ?? { _tag: 'loading' },
  )
  useEffect(() => {
    let current = true
    void readSimulationProjection().then(
      (value) => {
        if (!current) return
        if (value._tag === 'available' || value._tag === 'unavailable')
          knownSimulationState = value
        setState(value)
      },
      () => {
        if (current) setState({ _tag: 'absent' })
      },
    )
    return () => {
      current = false
    }
  }, [])
  if (state._tag === 'loading' || state._tag === 'absent') return null
  return <DevelopmentSimulationSurface state={state} readOnly={readOnly} />
}

export function DevelopmentSimulationSurface({
  state,
  readOnly,
  control = sendSimulationControl,
}: {
  state: Exclude<SimulationState, { readonly _tag: 'loading' | 'absent' }>
  readOnly: boolean
  control?: (
    value: SimulationControl,
  ) => Promise<DevelopmentSimulationProjection>
}) {
  const [current, setCurrent] = useState(state)
  const [selectedScenario, setSelectedScenario] = useState(
    state._tag === 'available'
      ? state.projection.scenario
      : state.value.launchScenario,
  )
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string>()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const phone = usePhoneProjection()
  const protectedControls = phone || readOnly
  const projection =
    current._tag === 'available' ? current.projection : undefined
  const unavailable = current._tag === 'unavailable' ? current.value : undefined
  const scenario = projection?.scenario ?? unavailable?.launchScenario ?? '—'
  const frame = projection?.evidence.lastFrame ?? projection?.evidence.nextFrame
  const shortSha = frame?.sha256?.slice(0, 10)
  const captureMetadata = projection?.evidence.nextFrame?.capture
  const apply = (value: SimulationControl, success: string) => {
    if (pending || protectedControls) return
    setPending(true)
    setMessage('Applying simulation control…')
    void control(value).then(
      (next) => {
        const state = { _tag: 'available' as const, projection: next }
        knownSimulationState = state
        setCurrent(state)
        setSelectedScenario(next.scenario)
        setPending(false)
        setMessage(`${success} ${scenarioStatus(next)}`)
      },
      (cause: unknown) => {
        setPending(false)
        setMessage(
          cause instanceof Error
            ? cause.message
            : 'Simulation control is unavailable.',
        )
      },
    )
  }
  return (
    <section
      className="beta-simulation-strip"
      aria-label="Development simulation context"
      aria-busy={pending}
    >
      <div className="beta-simulation-identity">
        <strong>Simulation · not live hardware</strong>
        <span>{scenario}</span>
      </div>
      <div className="beta-simulation-evidence">
        <span>
          {frame === undefined || frame === null
            ? 'Real FITS copy · no frame selected'
            : `Real FITS copy · ${frame.filename}${shortSha === undefined ? '' : ` · sha256 ${shortSha}`}`}
        </span>
        <span>
          {projection === undefined
            ? 'Deterministic clock unavailable'
            : `${elapsed(projection.clock.nowMs)} · step ${projection.evidence.framesServed}/${projection.evidence.sequenceLength}`}
        </span>
      </div>
      {!protectedControls && projection !== undefined ? (
        <div className="beta-simulation-controls">
          <Field label="Scenario">
            <Select
              value={selectedScenario}
              disabled={pending}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setSelectedScenario(event.target.value)
              }
            >
              {projection.scenarios.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            size="small"
            tone="quiet"
            disabled={pending || selectedScenario === projection.scenario}
            onClick={() =>
              apply(
                { action: 'select', scenario: selectedScenario },
                `Loaded ${selectedScenario}.`,
              )
            }
          >
            Load
          </Button>
          <Button
            size="small"
            tone="quiet"
            disabled={pending}
            onClick={() => apply({ action: 'reset' }, 'Scenario reset.')}
          >
            Reset
          </Button>
          <Button
            size="small"
            tone="quiet"
            disabled={pending}
            onClick={() =>
              apply(
                {
                  action: 'advance',
                  milliseconds:
                    captureMetadata?._tag === 'Available'
                      ? (captureMetadata.exposureSeconds + 1) * 1_000
                      : 16_000,
                },
                `Simulation clock advanced by ${captureMetadata?._tag === 'Available' ? captureMetadata.exposureSeconds + 1 : 16} seconds.`,
              )
            }
          >
            Advance{' '}
            {captureMetadata?._tag === 'Available'
              ? captureMetadata.exposureSeconds + 1
              : 16}
            s
          </Button>
          <a href="/plan?ui=beta">Plan</a>
          <a href="/observe?ui=beta">Observe</a>
        </div>
      ) : (
        <span className="beta-simulation-protection">
          Controls require desktop.
        </span>
      )}
      <Flyout
        className="beta-simulation-details"
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        label="Simulation details"
        placement="end"
        collisionBoundary="viewport"
        trigger={(props: FlyoutTriggerProps) => (
          <Button {...props} size="small" tone="quiet">
            Details
          </Button>
        )}
      >
        <Stack>
          <StatusIndicator
            tone={projection === undefined ? 'danger' : 'warning'}
            label="Simulation"
            detail={scenario}
          />
          <DataList>
            <DataListItem
              label="Provider"
              value={projection?.provenance.provider ?? 'Simulator unavailable'}
            />
            <DataListItem
              label="Transport"
              value={projection?.provenance.transport ?? 'Unavailable'}
            />
            <DataListItem
              label="Clock"
              value={
                projection === undefined
                  ? 'Unavailable'
                  : `${elapsed(projection.clock.nowMs)} · generation ${projection.clock.generation}`
              }
            />
            <DataListItem
              label="Camera"
              value={
                projection === undefined
                  ? 'Unavailable'
                  : `${projection.camera.phase} · image ${projection.camera.imageReady ? 'ready' : 'not ready'}`
              }
            />
            <DataListItem
              label="Frame"
              value={frame?.filename ?? 'No frame selected'}
              detail={frame?.sha256 ?? 'Checksum unavailable'}
            />
            <DataListItem
              label="Test capture"
              value={
                captureMetadata?._tag === 'Available'
                  ? `${captureMetadata.exposureSeconds}s · ${captureMetadata.frameType}`
                  : 'Unavailable'
              }
              detail={
                captureMetadata?._tag === 'Unavailable'
                  ? captureMetadata.reason
                  : captureMetadata?.capturedAt
              }
            />
            <DataListItem
              label="Scenario behavior"
              value={projection?.guide.summary ?? 'Unavailable'}
              detail={
                projection === undefined
                  ? undefined
                  : projection.guide.driver._tag === 'Available'
                    ? `Next: ${projection.guide.driver.label}`
                    : projection.guide.driver.reason
              }
            />
            <DataListItem
              label="Commands"
              value={String(projection?.commandCount ?? 0)}
            />
          </DataList>
          {unavailable !== undefined ? <p>{unavailable.message}</p> : null}
        </Stack>
      </Flyout>
      <span className="beta-simulation-message" role="status">
        {message ??
          (projection === undefined
            ? unavailable?.message
            : scenarioStatus(projection))}
      </span>
    </section>
  )
}

function usePhoneProjection() {
  const query = '(max-width: 600px)'
  const [phone, setPhone] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia(query).matches,
  )
  useEffect(() => {
    const media = matchMedia(query)
    const update = () => setPhone(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return phone
}

function elapsed(nowMs: number) {
  const seconds = Math.max(0, Math.floor(nowMs / 1_000))
  const minutes = Math.floor(seconds / 60)
  return `T+${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function isProjection(
  value: unknown,
): value is DevelopmentSimulationProjection {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mode' in value &&
    value.mode === 'alpaca' &&
    'notice' in value &&
    value.notice === 'SIMULATION · NOT LIVE HARDWARE' &&
    'scenario' in value &&
    typeof value.scenario === 'string' &&
    'launchScenario' in value &&
    typeof value.launchScenario === 'string' &&
    'scenarios' in value &&
    Array.isArray(value.scenarios) &&
    value.scenarios.every((scenario) => typeof scenario === 'string') &&
    'provenance' in value &&
    hasStringFields(value.provenance, ['provider', 'transport']) &&
    'clock' in value &&
    hasNumberFields(value.clock, ['nowMs', 'generation']) &&
    'camera' in value &&
    isCamera(value.camera) &&
    'evidence' in value &&
    isEvidence(value.evidence) &&
    'commandCount' in value &&
    typeof value.commandCount === 'number' &&
    'guide' in value &&
    isScenarioGuide(value.guide)
  )
}

function isScenarioGuide(value: unknown) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !hasStringFields(value, ['summary']) ||
    !('driver' in value) ||
    typeof value.driver !== 'object' ||
    value.driver === null ||
    !('_tag' in value.driver)
  )
    return false
  if (value.driver._tag === 'Unavailable')
    return hasStringFields(value.driver, ['reason'])
  return (
    value.driver._tag === 'Available' &&
    'action' in value.driver &&
    hasStringFields(value.driver, ['action', 'label']) &&
    (value.driver.action === 'refresh-preflight' ||
      value.driver.action === 'capture-test-frame' ||
      value.driver.action === 'target-acquire')
  )
}

function scenarioStatus(projection: DevelopmentSimulationProjection) {
  const driver = projection.guide.driver
  return driver._tag === 'Available'
    ? `${projection.guide.summary} Continue through Plan and Observe. Load selects simulator state only.`
    : `${projection.guide.summary} ${driver.reason}`
}

function isUnavailable(value: unknown): value is UnavailableSimulation {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mode' in value &&
    value.mode === 'alpaca' &&
    'notice' in value &&
    value.notice === 'SIMULATION · NOT LIVE HARDWARE' &&
    'state' in value &&
    value.state === 'unavailable' &&
    'launchScenario' in value &&
    typeof value.launchScenario === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

function isCamera(value: unknown) {
  return (
    typeof value === 'object' &&
    value !== null &&
    'phase' in value &&
    (value.phase === 'idle' ||
      value.phase === 'exposing' ||
      value.phase === 'reading') &&
    'imageReady' in value &&
    typeof value.imageReady === 'boolean'
  )
}

function isEvidence(value: unknown) {
  return (
    typeof value === 'object' &&
    value !== null &&
    hasNumberFields(value, ['sequenceLength', 'framesServed']) &&
    'lastFrame' in value &&
    isNullableFrame(value.lastFrame) &&
    'nextFrame' in value &&
    isNullableFrame(value.nextFrame)
  )
}

function isNullableFrame(value: unknown) {
  return value === null || isFrame(value)
}

function isFrame(value: unknown) {
  return (
    typeof value === 'object' &&
    value !== null &&
    hasStringFields(value, ['id', 'filename', 'purpose']) &&
    (!('sha256' in value) || typeof value.sha256 === 'string') &&
    'capture' in value &&
    isCapture(value.capture)
  )
}

function isCapture(value: unknown) {
  if (typeof value !== 'object' || value === null || !('_tag' in value))
    return false
  if (value._tag === 'Unavailable')
    return 'reason' in value && typeof value.reason === 'string'
  return (
    value._tag === 'Available' &&
    'exposureSeconds' in value &&
    typeof value.exposureSeconds === 'number' &&
    'capturedAt' in value &&
    typeof value.capturedAt === 'string' &&
    'filter' in value &&
    typeof value.filter === 'string' &&
    'binning' in value &&
    typeof value.binning === 'number' &&
    'frameType' in value &&
    (value.frameType === 'light' ||
      value.frameType === 'dark' ||
      value.frameType === 'flat' ||
      value.frameType === 'bias')
  )
}

function hasStringFields(value: unknown, fields: readonly string[]) {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return fields.every((field) => typeof record[field] === 'string')
}

function hasNumberFields(value: unknown, fields: readonly string[]) {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return fields.every((field) => typeof record[field] === 'number')
}

function simulationFailureMessage(value: unknown) {
  if (typeof value !== 'object' || value === null)
    return 'Simulation control is unavailable.'
  if ('message' in value && typeof value.message === 'string')
    return value.message
  if ('summary' in value && typeof value.summary === 'string')
    return value.summary
  return 'Simulation control is unavailable.'
}
