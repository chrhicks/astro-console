import './targets-panel.css'

export default function TargetsPanel() {
  return (
    <div>
      <div className="panel-header targets-panel-header">
        <span>Targets</span>
        <span className="spacer"></span>
        <button
          type="button"
          className="btn btn-sm icon-btn"
          id="collapseLeft"
          title="Collapse panel"
        >
          ◧
        </button>
      </div>
      <div className="filter-row">
        <input
          type="search"
          id="targetSearch"
          placeholder="Search catalog…"
          autoComplete="off"
        />
        <button
          type="button"
          className="btn btn-sm icon-btn"
          id="btnFavorites"
          title="Favorites only"
        >
          ★
        </button>
        <button
          type="button"
          className="btn btn-sm"
          id="btnUpNow"
          title="Up now only"
        >
          Up now
        </button>
      </div>
      <div
        className="panel-body targets-panel-body"
        id="targetList"
      ></div>
    </div>
  )
}
