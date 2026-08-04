import { useEffect, useRef, useState } from 'react'
import { IdempotencyKey } from '@astro-console/v2-contracts'
import {
  ObserveCommandSubmission,
  type ObserveAction,
} from '../observe-command-client'
import { PreflightRefreshSubmission } from '../preflight-refresh-client'
import {
  beginObserveOperation,
  isCurrentObserveOperation,
  type ObserveOperation,
} from '../observe-operation'
import type { ObserveView as View } from '../presentation'
import { Evidence, Status } from './shared'

export function ObserveView({
  view,
  submit,
  refreshPreflight,
  polarCommand,
  targetAcquisitionCommand,
  approvePointingCorrection,
  revisePointingCorrection,
}: {
  view: View
  submit?: (
    action: ObserveAction,
    key: typeof IdempotencyKey.Type,
  ) => Promise<ObserveCommandSubmission>
  refreshPreflight?: () => Promise<PreflightRefreshSubmission>
  polarCommand?: (
    action: 'capture' | 'accept',
    attemptId?: string,
  ) => Promise<void>
  targetAcquisitionCommand?: () => Promise<void>
  approvePointingCorrection?: (proposalId: string) => Promise<void>
  revisePointingCorrection?: (
    proposalId: string,
    rightAscensionArcsec: number,
    declinationArcsec: number,
  ) => Promise<void>
}) {
  const [result, setResult] = useState<{
    readonly runId: string
    readonly revision: number
    readonly message: string
  }>()
  const [pending, setPending] = useState(false)
  const operation = useRef<ObserveOperation | undefined>(undefined)
  const operationId = useRef(0)
  const current = view.source
  const polarAlignment = current?.acquire?.mode === 'polar'
  const targetAcquisition = current?.acquire?.acquisitionMethod
  const currentRef = useRef(current)
  currentRef.current = current
  useEffect(() => {
    if (
      result !== undefined &&
      (current === undefined || result.runId !== current.runId)
    )
      setResult(undefined)
  }, [current?.runId, current?.revision, result])
  const send = (action: ObserveAction) => {
    if (submit === undefined) return
    const currentOperation = beginObserveOperation(
      operation.current,
      current,
      operationId.current + 1,
    )
    if (currentOperation === undefined) return
    operationId.current = currentOperation.id
    operation.current = currentOperation
    setPending(true)
    void submit(action, IdempotencyKey.make(crypto.randomUUID())).then(
      (submission) => {
        if (operation.current?.id !== currentOperation.id) return
        operation.current = undefined
        setPending(false)
        if (
          !isCurrentObserveOperation(
            currentOperation,
            currentRef.current,
            currentOperation,
          )
        )
          return
        ObserveCommandSubmission.$match(submission, {
          Accepted: ({ message }) =>
            setResult({ ...currentOperation, message }),
          Rejected: ({ reason, safeNextAction }) =>
            setResult({
              ...currentOperation,
              message: `${reason} ${safeNextAction}`,
            }),
          Unavailable: ({ reason, safeNextAction }) =>
            setResult({
              ...currentOperation,
              message: `${reason} ${safeNextAction}`,
            }),
        })
      },
      () => {
        if (operation.current?.id !== currentOperation.id) return
        operation.current = undefined
        setPending(false)
        if (
          !isCurrentObserveOperation(
            currentOperation,
            currentRef.current,
            currentOperation,
          )
        )
          return
        setResult({
          ...currentOperation,
          message: 'The Observe command could not be completed.',
        })
      },
    )
  }
  const refresh = () => {
    if (refreshPreflight === undefined) return
    const currentOperation = beginObserveOperation(
      operation.current,
      current,
      operationId.current + 1,
    )
    if (currentOperation === undefined) return
    operationId.current = currentOperation.id
    operation.current = currentOperation
    setPending(true)
    void refreshPreflight().then(
      (submission) => {
        if (operation.current?.id !== currentOperation.id) return
        operation.current = undefined
        setPending(false)
        if (
          !isCurrentObserveOperation(
            currentOperation,
            currentRef.current,
            currentOperation,
          )
        )
          return
        PreflightRefreshSubmission.$match(submission, {
          Refreshed: ({ message }) =>
            setResult({ ...currentOperation, message }),
          Rejected: ({ message }) =>
            setResult({ ...currentOperation, message }),
          Unavailable: ({ message }) =>
            setResult({ ...currentOperation, message }),
        })
      },
      () => {
        if (operation.current?.id !== currentOperation.id) return
        operation.current = undefined
        setPending(false)
        if (
          !isCurrentObserveOperation(
            currentOperation,
            currentRef.current,
            currentOperation,
          )
        )
          return
        setResult({
          ...currentOperation,
          message: 'The preflight read could not be completed.',
        })
      },
    )
  }
  const polar = () => {
    if (polarCommand === undefined || current?.acquire === undefined) return
    const evidence = current.acquire.latestEvidence
    const action = evidence?._tag === 'PolarMeasurement' ? 'accept' : 'capture'
    setPending(true)
    void polarCommand(
      action,
      evidence?._tag === 'PolarMeasurement' ? evidence.attemptId : undefined,
    ).then(
      () => setPending(false),
      () => {
        setPending(false)
        setResult({
          runId: current.runId,
          revision: current.revision,
          message: 'The polar command could not be completed.',
        })
      },
    )
  }
  const acquireTarget = () => {
    if (
      targetAcquisitionCommand === undefined ||
      current?.acquire === undefined
    )
      return
    setPending(true)
    void targetAcquisitionCommand().then(
      () => setPending(false),
      () => {
        setPending(false)
        setResult({
          runId: current.runId,
          revision: current.revision,
          message: 'The target acquisition command could not be completed.',
        })
      },
    )
  }
  const approveCorrection = (proposalId: string) => {
    if (approvePointingCorrection === undefined || current === undefined) return
    setPending(true)
    void approvePointingCorrection(proposalId).then(
      () => setPending(false),
      () => {
        setPending(false)
        setResult({
          runId: current.runId,
          revision: current.revision,
          message: 'The pointing correction could not be approved.',
        })
      },
    )
  }
  return (
    <div className="workspace observe-workspace">
      <header className="workspace-heading">
        <div>
          <span>
            {view.detailAvailable
              ? polarAlignment
                ? 'Current polar alignment evidence'
                : targetAcquisition !== undefined
                  ? 'Current target acquisition evidence'
                  : view.source?.executor === 'fixture'
                    ? 'Current fixture lifecycle evidence'
                    : 'Current fake lifecycle evidence'
              : 'Detailed evidence unavailable'}
          </span>
          <h1 tabIndex={-1}>{view.target}</h1>
        </div>
        <Status tone={view.tone}>{view.status}</Status>
      </header>
      <section className="observe-image">
        {view.detailAvailable ? (
          <>
            <Evidence label={view.evidence} />
            <span>{view.annotation}</span>
          </>
        ) : (
          <p className="unavailable-evidence">{view.evidence}</p>
        )}
      </section>
      <aside className="observe-decision">
        <span>Decision now</span>
        {polarAlignment && (
          <PolarAlignment
            current={current}
            polarCommand={polarCommand}
            pending={pending}
            polar={polar}
          />
        )}
        {current !== undefined && targetAcquisition !== undefined && (
          <TargetAcquisition
            current={current}
            pending={pending}
            targetAcquisitionCommand={targetAcquisitionCommand}
            acquireTarget={acquireTarget}
            approvePointingCorrection={approvePointingCorrection}
            approveCorrection={approveCorrection}
            revisePointingCorrection={revisePointingCorrection}
          />
        )}
        {current?.phase === 'preflight' && (
          <section className="preflight-checklist" aria-label="Preflight">
            <span>Current preflight</span>
            {current.preflight === undefined ? (
              <p>No preflight facts have been read for this run.</p>
            ) : (
              <>
                <h2>{preflightVerdict(current.preflight.verdict)}</h2>
                <p>{current.preflight.nextAction}</p>
                <ul>
                  {current.preflight.checks.map((check) => (
                    <li key={check.key} data-state={check.state}>
                      <b>{check.key}</b>: {check.reason}{' '}
                      <time>{check.observedAt}</time>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {refreshPreflight !== undefined && (
              <button onClick={refresh} disabled={pending}>
                Refresh preflight
              </button>
            )}
          </section>
        )}
        {polarAlignment && (
          <span className="observe-secondary">Run lifecycle</span>
        )}
        <h2>{view.heading}</h2>
        <p>{view.trace.join(' ')}</p>
        <dl>
          {view.facts.map((fact, index) => (
            <div key={fact}>
              <dt>{index === 0 ? 'Evidence' : 'Assessment'}</dt>
              <dd>{fact}</dd>
            </div>
          ))}
        </dl>
        {view.recovery && (
          <p className="recovery">
            <b>Recovery:</b> {view.recovery}
          </p>
        )}
        {view.source && (
          <div className="observe-actions">
            {observeActions(view.source).map(({ action, label }) => (
              <button
                key={action}
                onClick={() => send(action)}
                disabled={pending}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {result && current?.runId === result.runId && (
          <p className="action-result" role="status">
            {result.message}
          </p>
        )}
      </aside>
      <footer className="lifecycle">
        {view.lifecycle.map((phase) => (
          <span key={phase} data-current={phase === view.phase || undefined}>
            {phase}
          </span>
        ))}
        <p>Lifecycle is current service truth, not navigation.</p>
      </footer>
    </div>
  )
}

function PolarAlignment({
  current,
  polarCommand,
  pending,
  polar,
}: {
  current: NonNullable<View['source']>
  polarCommand: Parameters<typeof ObserveView>[0]['polarCommand']
  pending: boolean
  polar: () => void
}) {
  const acquire = current.acquire
  if (acquire?.mode !== 'polar') return null
  const measurement = acquire.latestEvidence
  return (
    <section className="preflight-checklist" aria-label="Polar alignment">
      <span>Polar alignment</span>
      <h2>
        {acquire.phase === 'completed'
          ? 'Polar evidence accepted'
          : 'Manual Alt/Az guidance'}
      </h2>
      {measurement?._tag === 'PolarMeasurement' ? (
        <p>
          Altitude {measurement.altitudeErrorArcsec.toFixed(1)} arcsec; azimuth{' '}
          {measurement.azimuthErrorArcsec.toFixed(1)} arcsec; total{' '}
          {measurement.totalErrorArcsec.toFixed(1)} arcsec.{' '}
          {measurement.withinTolerance
            ? 'Within tolerance.'
            : 'Adjust manually, then capture another solved frame.'}
        </p>
      ) : (
        <p>
          Capture a solved frame to measure the mount axis. The service does not
          move Alt/Az motors.
        </p>
      )}
      {polarCommand !== undefined &&
        acquire.actions.length > 0 &&
        acquire.phase !== 'completed' && (
          <button onClick={polar} disabled={pending}>
            {measurement?._tag === 'PolarMeasurement'
              ? 'Accept polar evidence'
              : 'Capture polar measurement'}
          </button>
        )}
    </section>
  )
}

function TargetAcquisition({
  current,
  pending,
  targetAcquisitionCommand,
  acquireTarget,
  approvePointingCorrection,
  approveCorrection,
  revisePointingCorrection,
}: {
  current: NonNullable<View['source']>
  pending: boolean
  targetAcquisitionCommand: Parameters<
    typeof ObserveView
  >[0]['targetAcquisitionCommand']
  acquireTarget: () => void
  approvePointingCorrection: Parameters<
    typeof ObserveView
  >[0]['approvePointingCorrection']
  approveCorrection: (proposalId: string) => void
  revisePointingCorrection: Parameters<
    typeof ObserveView
  >[0]['revisePointingCorrection']
}) {
  const acquire = current.acquire
  if (acquire?.acquisitionMethod === undefined) return null
  const lunar = acquire.acquisitionMethod === 'lunarDiskLimb'
  const evidence = acquire.latestEvidence
  const proposal = acquire.pendingProposal
  const [rightAscensionArcsec, setRightAscensionArcsec] = useState(
    proposal?.correction.rightAscensionArcsec.toString() ?? '',
  )
  const [declinationArcsec, setDeclinationArcsec] = useState(
    proposal?.correction.declinationArcsec.toString() ?? '',
  )
  useEffect(() => {
    setRightAscensionArcsec(
      proposal?.correction.rightAscensionArcsec.toString() ?? '',
    )
    setDeclinationArcsec(
      proposal?.correction.declinationArcsec.toString() ?? '',
    )
  }, [proposal?.proposalId])
  return (
    <section className="preflight-checklist" aria-label="Target acquisition">
      <span>Target acquisition</span>
      <h2>{lunar ? 'Lunar disk and limb' : 'Deep-sky plate solve'}</h2>
      <p>
        {evidence?._tag === 'LunarDiskLimbMeasurement'
          ? `Lunar center error ${evidence.magnitudeArcsec.toFixed(1)} arcsec.`
          : evidence?._tag === 'Solved'
            ? `Plate-solve center error ${evidence.magnitudeArcsec.toFixed(1)} arcsec.`
            : lunar
              ? 'Measure the lunar disk and limb from a fresh frame. Star solving is not used.'
              : 'Capture and plate-solve a fresh deep-sky frame.'}
      </p>
      {acquire.correctionAttemptsRemaining !== undefined && (
        <p>
          {acquire.correctionAttemptsRemaining} correction attempt
          {acquire.correctionAttemptsRemaining === 1 ? '' : 's'} remain in this
          acquisition bound.
        </p>
      )}
      {proposal !== undefined && (
        <>
          <p>
            Proposed correction: RA{' '}
            {proposal.correction.rightAscensionArcsec.toFixed(1)} arcsec, Dec{' '}
            {proposal.correction.declinationArcsec.toFixed(1)} arcsec. It
            requires approval.
          </p>
          {approvePointingCorrection !== undefined &&
            acquire.actions.length > 0 && (
              <button
                onClick={() => approveCorrection(proposal.proposalId)}
                disabled={pending}
              >
                Approve pointing correction
              </button>
            )}
          {revisePointingCorrection !== undefined &&
            acquire.actions.length > 0 && (
              <div className="correction-revision">
                <label>
                  RA arcsec
                  <input
                    value={rightAscensionArcsec}
                    onChange={(event) =>
                      setRightAscensionArcsec(event.target.value)
                    }
                    inputMode="decimal"
                  />
                </label>
                <label>
                  Dec arcsec
                  <input
                    value={declinationArcsec}
                    onChange={(event) =>
                      setDeclinationArcsec(event.target.value)
                    }
                    inputMode="decimal"
                  />
                </label>
                <button
                  onClick={() => {
                    const rightAscension = Number(rightAscensionArcsec)
                    const declination = Number(declinationArcsec)
                    if (
                      Number.isFinite(rightAscension) &&
                      Number.isFinite(declination)
                    )
                      void revisePointingCorrection(
                        proposal.proposalId,
                        rightAscension,
                        declination,
                      )
                  }}
                  disabled={pending}
                >
                  Revise pointing correction
                </button>
              </div>
            )}
        </>
      )}
      {acquire.phase === 'verifying' && (
        <p>
          A provider acknowledgement is provisional. Verify it from a fresh
          solved frame.
        </p>
      )}
      {targetAcquisitionCommand !== undefined && acquire.actions.length > 0 && (
        <button onClick={acquireTarget} disabled={pending}>
          {lunar ? 'Capture lunar measurement' : 'Capture and plate solve'}
        </button>
      )}
    </section>
  )
}

function preflightVerdict(verdict: string) {
  return verdict === 'ready'
    ? 'Preflight ready'
    : verdict === 'blocked'
      ? 'Preflight blocked'
      : verdict === 'unavailable'
        ? 'Preflight unavailable'
        : 'Preflight unknown'
}

function observeActions(source: NonNullable<View['source']>) {
  const actions: readonly {
    readonly action: ObserveAction
    readonly label: string
    readonly eligible: boolean
  }[] = [
    {
      action: 'PauseRun',
      label: 'Pause run',
      eligible: source.actions.pause._tag === 'Eligible',
    },
    {
      action: 'ResumeRun',
      label: 'Resume run',
      eligible: source.actions.resume._tag === 'Eligible',
    },
    {
      action: 'StopRun',
      label: 'Stop run',
      eligible: source.actions.stop._tag === 'Eligible',
    },
    {
      action: 'SkipSequence',
      label: 'Skip sequence',
      eligible: source.actions.skip._tag === 'Eligible',
    },
    {
      action: 'RetryPhase',
      label: 'Retry phase once',
      eligible: source.actions.retry._tag === 'Eligible',
    },
    {
      action: 'RequestPark',
      label: 'Request park policy',
      eligible: source.actions.park._tag === 'Eligible',
    },
  ]
  return actions.filter(({ eligible }) => eligible)
}
