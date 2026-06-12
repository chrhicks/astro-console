import './app-shell.css'
import { SessionBar } from '../features/session-bar'

export function AppShell() {
  return (
    <div className="app-shell">
      <div className="app-shell-header">
        <SessionBar />
      </div>
    </div>
  )
}
