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
import { Effect, Schema } from 'effect'
import {
  DevelopmentSimulationControlRequest,
  DevelopmentSimulationFailure,
  DevelopmentSimulationProjection,
  DevelopmentSimulationResponse,
  DevelopmentSimulationScenario,
  DevelopmentSimulationUnavailable,
} from '@astro-console/protocol'
import { useEffect, useState, type ChangeEvent } from 'react'
import { nightbookHref } from '../route-href'

type SimulationProjection = typeof DevelopmentSimulationProjection.Type
type UnavailableSimulation = typeof DevelopmentSimulationUnavailable.Type

type SimulationState =
  | { readonly _tag: 'loading' }
  | { readonly _tag: 'absent' }
  | {
      readonly _tag: 'available'
      readonly projection: SimulationProjection
    }
  | { readonly _tag: 'unavailable'; readonly value: UnavailableSimulation }

type SimulationControl = typeof DevelopmentSimulationControlRequest.Type

let knownSimulationState: Exclude<
  SimulationState,
  { readonly _tag: 'loading' | 'absent' }
> | null = null

export async function readSimulationProjection(): Promise<SimulationState> {
  const response = await fetch('/api/simulation')
  if (response.status === 404) return { _tag: 'absent' }
  const value: unknown = await response.json().catch(() => undefined)
  const decoded = await Effect.runPromise(
    Schema.decodeUnknownEffect(DevelopmentSimulationResponse)(value),
  ).catch(() => undefined)
  if (
    response.ok &&
    decoded !== undefined &&
    Schema.is(DevelopmentSimulationProjection)(decoded)
  )
    return { _tag: 'available', projection: decoded }
  if (
    decoded !== undefined &&
    Schema.is(DevelopmentSimulationUnavailable)(decoded)
  )
    return { _tag: 'unavailable', value: decoded }
  return { _tag: 'absent' }
}

export async function sendSimulationControl(
  control: SimulationControl,
): Promise<SimulationProjection> {
  const request = await Effect.runPromise(
    Schema.decodeUnknownEffect(DevelopmentSimulationControlRequest)(control),
  )
  const response = await fetch('/api/simulation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  const value: unknown = await response.json().catch(() => undefined)
  const decoded = await Effect.runPromise(
    Schema.decodeUnknownEffect(DevelopmentSimulationResponse)(value),
  ).catch(() => undefined)
  if (
    response.ok &&
    decoded !== undefined &&
    Schema.is(DevelopmentSimulationProjection)(decoded)
  )
    return decoded
  if (decoded !== undefined && Schema.is(DevelopmentSimulationFailure)(decoded))
    throw new Error(decoded.message)
  throw new Error('Simulation control is unavailable.')
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
  control?: (value: SimulationControl) => Promise<SimulationProjection>
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
      className="nightbook-simulation-strip"
      aria-label="Development simulation context"
      aria-busy={pending}
    >
      <div className="nightbook-simulation-identity">
        <strong>Simulation · not live hardware</strong>
        <span>{scenario}</span>
      </div>
      <div className="nightbook-simulation-evidence">
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
        <div className="nightbook-simulation-controls">
          <Field label="Scenario">
            <Select
              value={selectedScenario}
              disabled={pending}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                if (
                  Schema.is(DevelopmentSimulationScenario)(event.target.value)
                )
                  setSelectedScenario(event.target.value)
              }}
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
          <a href={nightbookHref('/plan')}>Plan</a>
          <a href={nightbookHref('/observe')}>Observe</a>
        </div>
      ) : (
        <span className="nightbook-simulation-protection">
          Controls require desktop.
        </span>
      )}
      <Flyout
        className="nightbook-simulation-details"
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
      <span className="nightbook-simulation-message" role="status">
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

function scenarioStatus(projection: SimulationProjection) {
  const driver = projection.guide.driver
  return driver._tag === 'Available'
    ? `${projection.guide.summary} Continue through Plan and Observe. Load selects simulator state only.`
    : `${projection.guide.summary} ${driver.reason}`
}
