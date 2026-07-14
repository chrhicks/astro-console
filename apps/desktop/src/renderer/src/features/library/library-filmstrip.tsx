import { useEffect, useState } from 'react'
import type { LibraryAsset } from '../../../../shared/api-v2'
import { useProjectionStore } from '../../state/projection-store'
import { selectLibraryModel } from '../../state/projection-selectors'
import { electronApi } from '../../lib/electron-api'
import './library-filmstrip.css'

export default function LibraryFilmstrip() {
  const { library, currentTarget, captureMode } = useProjectionStore(selectLibraryModel)
  const isExternal = captureMode === 'external'
  const scopeLabel = isExternal
    ? 'Exposures'
    : library.scope === 'all_targets'
      ? 'All targets'
      : currentTarget?.short ?? 'Current target'
  const assetNoun = isExternal ? 'exposure' : 'asset'

  return (
    <footer className="panel panel-filmstrip">
      <div className="panel-header filmstrip-header">
        <span>Library</span>
        <span className="panel-collapse-hint" id="filmstripHint">
          {library.polling
            ? `${scopeLabel} · polling while capturing`
            : `${scopeLabel} · ${library.assets.length} ${assetNoun}${library.assets.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="filmstrip-body" id="filmstripBody">
        {library.assets.length === 0 ? (
          <div className="filmstrip-empty">
            {isExternal ? 'No exposures yet.' : 'No assets yet for this target.'}
          </div>
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
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(true)
  const assetId = asset.id

  useEffect(() => {
    if (!asset.hasPreview) {
      setPreviewLoading(false)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    electronApi
      .getSavedAssetPreview(assetId)
      .then((url) => {
        if (cancelled) return
        setPreview(url)
        setPreviewLoading(false)
      })
      .catch(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [asset.hasPreview, assetId])

  function run(action: 'open' | 'reveal') {
    if (!asset.saved) return
    setError(null)
    const promise =
      action === 'open'
        ? electronApi.openSavedAsset(assetId)
        : electronApi.revealSavedAsset(assetId)
    promise.catch((err) =>
      setError(err instanceof Error ? err.message : 'action failed'),
    )
  }

  return (
    <div className={`thumb-card${newest ? ' newest' : ''}`}>
      <div className="thumb-img">
        {preview ? (
          <img className="thumb-preview" src={preview} alt={asset.name} />
        ) : (
          <div className="thumb-preview-fallback">
            {previewLoading ? '...' : 'no preview'}
          </div>
        )}
        {asset.saved && (
          <div className="thumb-actions">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => run('open')}
            >
              Open
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => run('reveal')}
            >
              Reveal
            </button>
          </div>
        )}
      </div>
      <div className="thumb-meta">
        <div>{asset.name}</div>
        <div>{new Date(asset.capturedAt).toLocaleTimeString()}</div>
        {asset.savedFileSize != null && (
          <div className="thumb-saved">
            {formatBytes(asset.savedFileSize)}
            {asset.frameWidth != null && asset.frameHeight != null && (
              <>
                {' · '}
                {asset.frameWidth}×{asset.frameHeight}
              </>
            )}
            {asset.framePixelFormat && (
              <>
                {' · '}
                {asset.framePixelFormat}
              </>
            )}
          </div>
        )}
        {asset.previewError && <div className="thumb-error">Preview failed: {asset.previewError}</div>}
        {error && <div className="thumb-error">{error}</div>}
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`
  }
  return `${bytes} B`
}
