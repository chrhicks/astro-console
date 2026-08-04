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
}: {
  view: View
  submit?: (
    action: ObserveAction,
    key: typeof IdempotencyKey.Type,
  ) => Promise<ObserveCommandSubmission>
  refreshPreflight?: () => Promise<PreflightRefreshSubmission>
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
  return (
    <div className="workspace observe-workspace">
      <header className="workspace-heading">
        <div>
          <span>
            {view.detailAvailable
              ? view.source?.executor === 'fixture'
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
