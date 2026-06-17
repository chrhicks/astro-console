import './library-filmstrip.css'

export default function LibraryFilmstrip() {
  return (
    <footer className="panel panel-filmstrip">
      <div className="panel-header filmstrip-header">
        <span>Library</span>
        <span className="panel-collapse-hint" id="filmstripHint">
          M42 · newest subs while capturing
        </span>
        <span className="spacer"></span>
        <button type="button" className="btn btn-sm" id="expandFilm">
          Expand strip
        </button>
        <button type="button" className="btn btn-sm" id="libraryScope">
          All targets
        </button>
      </div>
      <div className="filmstrip-body" id="filmstripBody"></div>
    </footer>
  )
}
