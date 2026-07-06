import type { LibraryAsset } from '../../../../shared/api-v2'
import { useProjectionStore } from '../../state/projection-store'
import { selectLibraryModel } from '../../state/projection-selectors'
import './library-filmstrip.css'

export default function LibraryFilmstrip() {
  const { library, currentTarget } = useProjectionStore(selectLibraryModel)
  const scopeLabel =
    library.scope === 'all_targets' ? 'All targets' : currentTarget?.short ?? 'Current target'

  return (
    <footer className="panel panel-filmstrip">
      <div className="panel-header filmstrip-header">
        <span>Library</span>
        <span className="panel-collapse-hint" id="filmstripHint">
          {library.polling
            ? `${scopeLabel} · polling while capturing`
            : `${scopeLabel} · ${library.assets.length} asset${library.assets.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="filmstrip-body" id="filmstripBody">
        {library.assets.length === 0 ? (
          <div className="filmstrip-empty">No assets yet for this target.</div>
        ) : (
          library.assets.map((asset, index) => (
            <FilmstripThumb key={asset.id} asset={asset} newest={index === 0} />
          ))
        )}
      </div>
    </footer>
  )
}

function FilmstripThumb({
  asset,
  newest,
}: {
  asset: LibraryAsset
  newest: boolean
}) {
  return (
    <div className={`thumb-card${newest ? ' newest' : ''}`}>
      <div className="thumb-img" />
      <div className="thumb-meta">
        <div>{asset.name}</div>
        <div>{new Date(asset.capturedAt).toLocaleTimeString()}</div>
      </div>
    </div>
  )
}
