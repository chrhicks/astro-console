import './app-shell.css'
import { SessionBar } from '../features/session/session-bar'
import TargetsPanel from '../features/targets/targets-panel'
import WorkArea from '../features/work-area/work-area'
import InspectorPanel from '../features/inspector/inspector-panel'
import LibraryFilmstrip from '../features/library/library-filmstrip'
import { DevScenarioPanel } from '../features/dev/dev-scenario-panel'

export function AppShell() {
  return (
    <div className="app-shell">
      <div className="app-shell-header">
        <SessionBar />
      </div>
      <div className="workspace-grid" id="grid">
        <aside className="panel panel-left" id="leftPanel">
          <TargetsPanel />
        </aside>

        <section className="panel-center panel">
          <WorkArea />
        </section>

        <aside className="panel panel-right">
          <InspectorPanel />
        </aside>

        <LibraryFilmstrip />
      </div>
      <DevScenarioPanel />
    </div>
  )
}
