import type {
  LibraryAssetDetail,
  LibraryPage,
  LibraryQuery,
} from '../library-client'
import { useEffect, useState } from 'react'
import type { LibraryView as View } from '../presentation'
import type { Route } from '../routes'
import { Status } from './shared'

const roles = [
  'original',
  'linearMaster',
  'intermediate',
  'final',
  'preview',
  'diagnostic',
] as const
const sorts = [
  'capturedAtDescending',
  'sharpestFirst',
  'recentlyUpdated',
] as const

export function LibraryView({
  view,
  assetId,
  link,
  page,
  detail,
  detailState,
  onQuery,
  readOnly,
  onReview,
}: {
  view: View
  assetId: string | undefined
  link: (route: Exclude<Route, { kind: 'not-found' }>) => {
    href: string
    onClick: React.MouseEventHandler<HTMLAnchorElement>
  }
  page?: {
    readonly query: LibraryQuery
    readonly value?: LibraryPage
    readonly message?: string
  }
  detail?: LibraryAssetDetail
  detailState?: 'loading' | 'not-found' | 'unavailable'
  onQuery?: (query: LibraryQuery) => void
  readOnly?: boolean
  onReview?: (decision: 'accepted' | 'rejected') => void
}) {
  const [comparisonIds, setComparisonIds] = useState<readonly string[]>([])
  const [phoneComparison, setPhoneComparison] = useState(false)
  useEffect(() => {
    const query = matchMedia('(max-width: 600px)')
    const update = () => setPhoneComparison(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (phoneComparison) {
      setComparisonIds([])
    }
  }, [phoneComparison])
  const remoteAssets = page?.value?.results
  // The root catalogue gives the first bounded record visual placement, but
  // does not claim that its detail has been loaded.
  const selectedAssetId = assetId ?? remoteAssets?.[0]?.assetId
  const fallback = page
    ? undefined
    : (view.assets.find((asset) => asset.id === assetId) ?? view.assets[0])
  const selected = remoteAssets?.find(
    (asset) => asset.assetId === selectedAssetId,
  )
  const availability = detail?.availability ?? fallback?.review
  const download = detail?.actions.find(
    (action) => action.action === 'download',
  )
  const process = detail?.actions.find(
    (action) => action.action === 'openInProcess',
  )
  const nextCursor = page?.value?.nextCursor
  const changeRole = (role: LibraryQuery['role'] | undefined) => {
    if (!onQuery || !page) return
    onQuery({
      queryId: page.query.queryId,
      pageSize: page.query.pageSize,
      sort: page.query.sort,
      ...(role === undefined ? {} : { role }),
    })
  }
  const changeSort = (sort: LibraryQuery['sort']) => {
    if (!onQuery || !page) return
    onQuery({
      queryId: page.query.queryId,
      pageSize: page.query.pageSize,
      ...(page.query.role === undefined ? {} : { role: page.query.role }),
      sort,
    })
  }
  return (
    <div className="workspace library-workspace">
      <header className="workspace-heading">
        <div>
          <span>Library / durable evidence</span>
          <h1 tabIndex={-1}>Durable evidence</h1>
        </div>
        {page && onQuery ? (
          <div className="library-controls">
            <label>
              Role
              <select
                value={page.query.role ?? ''}
                onChange={(event) =>
                  changeRole(
                    event.target.value === ''
                      ? undefined
                      : (event.target.value as LibraryQuery['role']),
                  )
                }
              >
                <option value="">All roles</option>
                {roles.map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
            <label>
              Sort
              <select
                value={page.query.sort}
                onChange={(event) =>
                  changeSort(event.target.value as LibraryQuery['sort'])
                }
              >
                {sorts.map((sort) => (
                  <option key={sort}>{sort}</option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </header>
      <aside className="library-lineage">
        <span>Relationship</span>
        <b>
          {detail?.comparisonGroupId ??
            selected?.comparisonGroupId ??
            fallback?.lineage}
        </b>
        <small>
          Source IDs:{' '}
          {detail?.lineage.sourceAssetIds.join(', ') ?? 'Loading detail'}
        </small>
        <small>Run: {detail?.lineage.runId ?? 'Loading detail'}</small>
        <small>
          Solve: {detail?.lineage.solveAttemptId ?? 'Loading detail'}
        </small>
        <p>Originals are immutable. Related saved outputs are peers.</p>
      </aside>
      <section className="library-comparison" aria-label="Transient comparison">
        <span>Compare selected Library records</span>
        {phoneComparison || readOnly ? (
          <p>Comparison unavailable in read-only monitoring.</p>
        ) : comparisonIds.length === 2 ? (
          <p>
            <b>{comparisonIds[0]}</b> ↔ <b>{comparisonIds[1]}</b>. Browser-only
            selection; originals and durable reviews remain unchanged.
          </p>
        ) : (
          <p>
            {readOnly
              ? 'Comparison is unavailable in read-only monitoring.'
              : 'Select two records below to compare their saved evidence.'}
          </p>
        )}
      </section>
      <section className="frame-grid" aria-label="Evidence records">
        <div className="frame-grid__heading">
          <span>Capture chronology</span>
          <small>Metadata records / select for detail</small>
        </div>
        {page?.message ? <p className="action-result">{page.message}</p> : null}
        {remoteAssets
          ? remoteAssets.map((asset) => (
              <a
                key={asset.assetId}
                data-selected={asset.assetId === selectedAssetId}
                aria-current={asset.assetId === assetId ? 'page' : undefined}
                {...link({ kind: 'asset', assetId: asset.assetId })}
              >
                <b>
                  {asset.role} · {asset.format}
                </b>
                <small>{asset.availability}</small>
                {!readOnly && !phoneComparison ? (
                  <button
                    aria-label={`Compare ${asset.assetId}`}
                    onClick={(event) => {
                      event.preventDefault()
                      setComparisonIds((current) =>
                        current.includes(asset.assetId)
                          ? current.filter((id) => id !== asset.assetId)
                          : [...current, asset.assetId].slice(-2),
                      )
                    }}
                  >
                    {comparisonIds.includes(asset.assetId)
                      ? 'Remove compare'
                      : 'Compare'}
                  </button>
                ) : null}
              </a>
            ))
          : page
            ? null
            : view.assets.map((asset) => (
                <a
                  key={asset.id}
                  data-selected={asset.id === selectedAssetId}
                  aria-current={asset.id === assetId ? 'page' : undefined}
                  {...link({ kind: 'asset', assetId: asset.id })}
                >
                  <b>{asset.name}</b>
                  <small>{asset.review}</small>
                </a>
              ))}
        {page && nextCursor && onQuery ? (
          <button
            onClick={() =>
              onQuery({
                queryId: page.query.queryId,
                pageSize: page.query.pageSize,
                ...(page.query.role === undefined
                  ? {}
                  : { role: page.query.role }),
                sort: page.query.sort,
                cursor: nextCursor,
              })
            }
          >
            Next page
          </button>
        ) : null}
      </section>
      <aside className="library-inspector">
        {!assetId && remoteAssets ? (
          <p>Select an asset to open detail.</p>
        ) : null}
        {detailState === 'loading' ? <p>Loading asset detail.</p> : null}
        {detailState === 'not-found' ? <p>Asset not found.</p> : null}
        {detailState === 'unavailable' ? (
          <p>Asset detail is unavailable.</p>
        ) : null}
        <Status
          tone={
            availability === undefined
              ? 'neutral'
              : availability === 'published' ||
                  availability === 'availableLocally'
                ? 'safe'
                : 'danger'
          }
        >
          {availability ?? 'Select a record'}
        </Status>
        <h2>
          {detail
            ? `${detail.role} · ${detail.format}`
            : (fallback?.name ?? 'No asset selected')}
        </h2>
        {detail && download?._tag === 'Eligible' ? (
          <a
            href={`/api/library/assets/${encodeURIComponent(detail.assetId)}/download`}
          >
            Download original
          </a>
        ) : null}
        {!readOnly && detail && process?._tag === 'Eligible' ? (
          <a
            {...link({ kind: 'process-source', sourceAssetId: detail.assetId })}
          >
            Open source in Process
          </a>
        ) : null}
        <section className="library-review" aria-label="Review selected frame">
          <span>Review selected frame</span>
          <p>
            Asset {detail?.assetId ?? 'unavailable'} ·{' '}
            {detail?.review?.decision ?? 'unreviewed'}
          </p>
          {detail?.inspection?._tag === 'Available' ? (
            <>
              <div
                className="evidence-image"
                aria-label="Deterministic frame preview"
              >
                Preview retained · {detail.inspection.preview.format}
              </div>
              <p>{detail.inspection.rationale.summary}</p>
              <p>
                Sharpness {detail.inspection.metrics.sharpness} · shape{' '}
                {detail.inspection.metrics.shape} · drift{' '}
                {detail.inspection.metrics.driftArcsec} arcsec · clipping{' '}
                {detail.inspection.metrics.clippingPercent}%
              </p>
            </>
          ) : detail?.inspection ? (
            <p>
              {detail.inspection._tag === 'Failed'
                ? `Inspection failed: ${detail.inspection.summary}`
                : `Inspection unavailable: ${detail.inspection.summary}`}
            </p>
          ) : (
            <p>Inspection has not been generated for this selected frame.</p>
          )}
          {!readOnly && detail && onReview ? (
            <div className="library-controls">
              <button onClick={() => onReview('accepted')}>
                Accept this frame
              </button>
              <button onClick={() => onReview('rejected')}>
                Reject this frame
              </button>
            </div>
          ) : null}
        </section>
        <p>
          {detail?.representations
            .map(
              (representation) =>
                `${representation.label} (${representation.state})`,
            )
            .join(' · ') ?? 'Representation detail unavailable.'}
        </p>
        <dl>
          <div>
            <dt>Stable asset</dt>
            <dd>{detail?.assetId ?? selected?.assetId ?? fallback?.id}</dd>
          </div>
          <div>
            <dt>Captured</dt>
            <dd>{detail?.capturedAt ?? 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Download</dt>
            <dd>
              {download?._tag === 'Eligible'
                ? 'Eligible'
                : (download?.reason ?? 'Unavailable')}
            </dd>
          </div>
          <div>
            <dt>Process source</dt>
            <dd>
              {process?._tag === 'Eligible'
                ? 'Eligible'
                : (process?.reason ?? 'Unavailable')}
            </dd>
          </div>
        </dl>
        <p className="action-result">
          Read-only monitoring. Durable local evidence is protected.
        </p>
      </aside>
    </div>
  )
}
