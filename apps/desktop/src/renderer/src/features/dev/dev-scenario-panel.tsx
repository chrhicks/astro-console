import { useEffect, useState } from 'react'
import type {
  FakeRuntimeSnapshot,
  SeestarDevFakeApi,
} from '../../../../shared/api-v2'
import { useProjectionStore } from '../../state/projection-store'
import './dev-scenario-panel.css'

// Development-only scenario control panel. Rendered only when the preload
// dev fake API (window.seestarDevFake) is present, which happens only in
// unpackaged builds, and no live device is connected. Not product UI.
export function DevScenarioPanel() {
  const pluginKind = useProjectionStore(
    (state) => state.status?.device.pluginKind ?? null,
  )
  const devFake = window.seestarDevFake
  if (!devFake) return null
  if (pluginKind && pluginKind !== 'fake-seestar') return null

  return <DevScenarioPanelBody devFake={devFake} />
}

function DevScenarioPanelBody({ devFake }: { devFake: SeestarDevFakeApi }) {
  const [snapshot, setSnapshot] = useState<FakeRuntimeSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void devFake
      .listScenarios()
      .then(setSnapshot)
      .catch((loadError: unknown) => setError(toMessage(loadError)))
  }, [devFake])

  function handleLoad(scenarioId: string) {
    setError(null)
    void devFake
      .loadScenario(scenarioId)
      .then(setSnapshot)
      .catch((loadError: unknown) => setError(toMessage(loadError)))
  }

  function handleReset() {
    setError(null)
    void devFake
      .reset()
      .then(setSnapshot)
      .catch((resetError: unknown) => setError(toMessage(resetError)))
  }

  if (!snapshot) {
    return (
      <div className="dev-scenario-panel">
        <div className="dev-scenario-header">Dev · Fake scenarios</div>
        <div className="dev-scenario-body">
          {error ? <span className="dev-scenario-error">{error}</span> : 'Loading…'}
        </div>
      </div>
    )
  }

  return (
    <div className="dev-scenario-panel">
      <div className="dev-scenario-header">
        Dev · Fake scenarios
        <button
          type="button"
          className="btn btn-sm"
          onClick={handleReset}
          title="Reset active scenario to its initial state"
        >
          Reset
        </button>
      </div>
      <div className="dev-scenario-body">
        <select
          value={snapshot.activeScenarioId}
          onChange={(event) => handleLoad(event.currentTarget.value)}
        >
          {snapshot.scenarios.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.label}
            </option>
          ))}
        </select>
        <span className="dev-scenario-active">
          {snapshot.connectOutcome === 'failure' ? 'connect fails' : 'connect ok'}
          {snapshot.preview.phase !== 'none' ? ` · preview ${snapshot.preview.phase}` : ''}
          {snapshot.capture.phase !== 'idle' ? ` · capture ${snapshot.capture.phase}` : ''}
          {snapshot.library.assets.length > 0
            ? ` · ${snapshot.library.assets.length} asset${snapshot.library.assets.length === 1 ? '' : 's'}`
            : ''}
        </span>
        {error ? <span className="dev-scenario-error">{error}</span> : null}
      </div>
    </div>
  )
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
