import type {
  LibraryAssetDetail,
  LibraryPage,
  LibraryQuery,
} from '../library-client'
import { useEffect, useState } from 'react'
import type { LibraryView as View } from '../presentation'
import type { Route } from '../routes'
import {
  ActionBar,
  AvailabilityStrip,
  EvidenceFrame,
  FactRegister,
  Panel,
  Status,
  availabilityLabel,
  availabilityTone,
} from '../components'

const roleOptions: readonly {
  value: LibraryQuery['role'] | undefined
  label: string
}[] = [
  { value: undefined, label: 'All roles' },
  { value: 'original', label: 'Original' },
  { value: 'linearMaster', label: 'Linear master' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'final', label: 'Final' },
  { value: 'preview', label: 'Preview' },
  { value: 'diagnostic', label: 'Diagnostic' },
]
const sortOptions: readonly { value: LibraryQuery['sort']; label: string }[] = [
  { value: 'capturedAtDescending', label: 'Newest first' },
  { value: 'sharpestFirst', label: 'Sharpest first' },
  { value: 'recentlyUpdated', label: 'Recently updated' },
]

/** Human reading of the contract's Unavailable reasons. */
const actionReasons: Record<string, string> = {
  AssetNotPublished: 'not published',
  AssetNotAvailableLocally: 'not available locally',
  PublicationUnavailable: 'publication unavailable',
}

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
  const [comparisonOpen, setComparisonOpen] = useState(false)
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
      setComparisonOpen(false)
    }
  }, [phoneComparison])
  useEffect(() => {
    if (comparisonIds.length !== 2) setComparisonOpen(false)
  }, [comparisonIds])

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
  const availability = detail?.availability ?? selected?.availability
  const download = detail?.actions.find(
    (action) => action.action === 'download',
  )
  const process = detail?.actions.find(
    (action) => action.action === 'openInProcess',
  )
  const nextCursor = page?.value?.nextCursor

  // Frame-review position inside the loaded page (wf-15 prev/next).
  const position = remoteAssets?.findIndex(
    (asset) => asset.assetId === selectedAssetId,
  )
  const prev =
    position !== undefined && position > 0
      ? remoteAssets?.[position - 1]
      : undefined
  const next =
    remoteAssets && position !== undefined && position >= 0
      ? remoteAssets[position + 1]
      : undefined

  // Review keyboard loop (wf-15): A/R decide, arrows move. Navigation goes
  // through the same anchors pointer users get — no second nav path.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isLibraryShortcutBlocked(event)) return
      if (event.key === 'ArrowLeft')
        document
          .querySelector<HTMLAnchorElement>('[data-library-nav="prev"]')
          ?.click()
      if (event.key === 'ArrowRight')
        document
          .querySelector<HTMLAnchorElement>('[data-library-nav="next"]')
          ?.click()
      if (readOnly || !onReview) return
      if (event.key === 'a' || event.key === 'A') onReview('accepted')
      if (event.key === 'r' || event.key === 'R') onReview('rejected')
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [readOnly, onReview, detail])

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

  const compared = comparisonIds
    .map((id) => remoteAssets?.find((asset) => asset.assetId === id))
    .filter((asset) => asset !== undefined)

  // Compare selection is browser-only view state, not a domain mutation:
  // it stays available in read-only monitoring (navigation, not control).
  const compareSelectable = remoteAssets !== undefined && !phoneComparison

  return (
    <div className="workspace library-workspace">
      <header className="workspace-heading">
        <div>
          <span>Library / durable evidence</span>
          <h1 tabIndex={-1}>Durable evidence</h1>
        </div>
        {availability !== undefined ? (
          <Status tone={availabilityTone(availability)}>
            {availabilityLabel(availability)}
          </Status>
        ) : null}
      </header>

      <Panel
        as="aside"
        className="library-browse"
        title="Browse"
        note="fixed facets — no query language"
      >
        <div className="facet-group">
          <span className="facet-group__label">Role</span>
          {roleOptions.map((option) => (
            <button
              key={option.label}
              type="button"
              className="facet"
              aria-pressed={(page?.query.role ?? undefined) === option.value}
              onClick={() => changeRole(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="facet-group">
          <span className="facet-group__label">Sort</span>
          {sortOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className="facet"
              aria-pressed={page?.query.sort === option.value}
              onClick={() => changeSort(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="facet-gap">
          Night, target, and review-status facets need service support —
          recorded gaps, not hidden ones. Lineage stays navigable through each
          record.
        </p>
      </Panel>

      <div className="library-center">
        {comparisonOpen && compared.length === 2 ? (
          <Panel
            className="library-compare"
            title="Compare"
            note="browser-only · originals and reviews unchanged"
          >
            <div className="library-compare__sides">
              {compared.map((asset) => (
                <div key={asset.assetId}>
                  <FactRegister
                    facts={[
                      { label: 'Record', value: asset.assetId },
                      {
                        label: 'Role',
                        value: `${asset.role} · ${asset.format}`,
                      },
                      {
                        label: 'Availability',
                        value: availabilityLabel(asset.availability),
                        tone: availabilityTone(asset.availability),
                      },
                    ]}
                  />
                  <a {...link({ kind: 'asset', assetId: asset.assetId })}>
                    Open record
                  </a>
                </div>
              ))}
            </div>
            <p className="library-compare__gap">
              Metric comparison needs both asset details loaded; open each
              record for its inspection facts. Both stay saved — “final” is a
              role, not a verdict.
            </p>
          </Panel>
        ) : null}

        <Panel
          className="library-assets"
          title="Assets"
          note={
            remoteAssets
              ? `${remoteAssets.length} records${nextCursor ? ' · more available' : ''}`
              : 'catalogue'
          }
        >
          {page?.message ? (
            <p className="action-result">{page.message}</p>
          ) : null}
          <div className="asset-grid" aria-label="Evidence records">
            {remoteAssets
              ? remoteAssets.map((asset) => (
                  <a
                    key={asset.assetId}
                    className="asset-cell"
                    data-selected={asset.assetId === selectedAssetId}
                    aria-current={
                      asset.assetId === assetId ? 'page' : undefined
                    }
                    {...link({ kind: 'asset', assetId: asset.assetId })}
                  >
                    <b>
                      {asset.role} · {asset.format}
                    </b>
                    <Status tone={availabilityTone(asset.availability)}>
                      {availabilityLabel(asset.availability)}
                    </Status>
                    {compareSelectable ? (
                      <button
                        type="button"
                        className="asset-cell__compare"
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
                      className="asset-cell"
                      data-selected={asset.id === selectedAssetId}
                      aria-current={asset.id === assetId ? 'page' : undefined}
                      {...link({ kind: 'asset', assetId: asset.id })}
                    >
                      <b>{asset.name}</b>
                      <Status tone="neutral">{asset.review}</Status>
                    </a>
                  ))}
          </div>
          {page && nextCursor && onQuery ? (
            <button
              type="button"
              className="library-more"
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
        </Panel>
      </div>

      {compareSelectable ? (
        <ActionBar
          className="library-selection"
          summary={
            comparisonIds.length > 0
              ? `${comparisonIds.length} selected`
              : 'Select two records to compare'
          }
          actions={[
            comparisonIds.length === 2
              ? {
                  label: 'Compare ▸',
                  tone: 'secondary' as const,
                  onClick: () => setComparisonOpen(true),
                }
              : {
                  label: 'Compare ▸',
                  tone: 'secondary' as const,
                  disabled: true as const,
                  disabledReason: 'select two records',
                },
          ]}
          note="selection is browser-only — originals and durable reviews never change"
        />
      ) : null}

      <div className="library-detail">
        {!assetId && remoteAssets ? (
          <p className="library-detail__hint">
            Select an asset to open detail.
          </p>
        ) : null}
        {detailState === 'loading' ? (
          <p className="library-detail__hint">Loading asset detail.</p>
        ) : null}
        {detailState === 'not-found' ? (
          <p className="library-detail__hint">Asset not found.</p>
        ) : null}
        {detailState === 'unavailable' ? (
          <p className="library-detail__hint">Asset detail is unavailable.</p>
        ) : null}

        {detail ? (
          <>
            <Panel title="Review" note="durable decision">
              {remoteAssets && position !== undefined && position >= 0 ? (
                <nav
                  className="library-review-nav"
                  aria-label="Frame review navigation"
                >
                  {prev ? (
                    <a
                      data-library-nav="prev"
                      {...link({ kind: 'asset', assetId: prev.assetId })}
                    >
                      ◂ Prev
                    </a>
                  ) : (
                    <span />
                  )}
                  <span>
                    {position + 1} / {remoteAssets.length}
                  </span>
                  {next ? (
                    <a
                      data-library-nav="next"
                      {...link({ kind: 'asset', assetId: next.assetId })}
                    >
                      Next ▸
                    </a>
                  ) : (
                    <span />
                  )}
                </nav>
              ) : null}
              <p className="library-review__status">
                <Status
                  tone={
                    detail.review?.decision === 'accepted'
                      ? 'safe'
                      : detail.review?.decision === 'rejected'
                        ? 'danger'
                        : 'neutral'
                  }
                >
                  {detail.review?.decision ?? 'unreviewed'}
                </Status>
              </p>
              {!readOnly && onReview ? (
                <ActionBar
                  actions={[
                    {
                      label: 'Accept',
                      tone: 'primary',
                      onClick: () => onReview('accepted'),
                    },
                    {
                      label: 'Reject',
                      tone: 'danger',
                      scope:
                        'this review decision only — the original and its acquisition evidence are untouched',
                      onClick: () => onReview('rejected'),
                    },
                  ]}
                  note="keys: A accept · R reject · ←/→ move"
                />
              ) : null}
            </Panel>

            <Panel
              title={`${detail.role} · ${detail.format}`}
              note={availabilityLabel(detail.availability)}
            >
              <AvailabilityStrip availability={detail.availability} />
              {detail.inspection?._tag === 'Available' ? (
                <>
                  <EvidenceFrame
                    className="library-evidence"
                    label={`Preview retained · ${detail.inspection.preview.format}`}
                    facts={[
                      `sharpness ${detail.inspection.metrics.sharpness}`,
                      `shape ${detail.inspection.metrics.shape}`,
                      `drift ${detail.inspection.metrics.driftArcsec}″`,
                      `clip ${detail.inspection.metrics.clippingPercent}%`,
                    ]}
                  />
                  <p className="library-automation">
                    <span>Automation said</span>
                    {detail.inspection.rationale.summary}
                  </p>
                </>
              ) : detail.inspection ? (
                <p>
                  {detail.inspection._tag === 'Failed'
                    ? `Inspection failed: ${detail.inspection.summary}`
                    : `Inspection unavailable: ${detail.inspection.summary}`}
                </p>
              ) : (
                <p>
                  Inspection has not been generated for this asset. Identity and
                  download remain — an unreadable preview is not a broken asset.
                </p>
              )}
              <FactRegister
                facts={[
                  { label: 'Stable asset', value: detail.assetId },
                  { label: 'Captured', value: detail.capturedAt },
                  ...(detail.capture
                    ? [
                        {
                          label: 'Exposure',
                          value: `${detail.capture.exposureSeconds}s · ${detail.capture.filter} · bin ${detail.capture.binning} · ${detail.capture.frameType}`,
                        },
                      ]
                    : []),
                  ...(detail.provenance
                    ? [
                        {
                          label: 'Checksum',
                          value: detail.provenance.checksum,
                        },
                      ]
                    : []),
                ]}
              />
              {detail.representations.length > 0 ? (
                <FactRegister
                  facts={detail.representations.map((representation) => ({
                    label: representation.label,
                    value: representation.state,
                  }))}
                />
              ) : null}
              <details className="library-provenance">
                <summary>Provenance details</summary>
                <p>Source: {detail.provenance?.source ?? 'Unavailable'}</p>
                <p>Checksum: {detail.provenance?.checksum ?? 'Unavailable'}</p>
                {detail.provenance?.fitsHeader ? (
                  <p>
                    FITS facts:{' '}
                    {Object.entries(detail.provenance.fitsHeader)
                      .map(([key, value]) => `${key}=${value}`)
                      .join(' · ')}
                  </p>
                ) : null}
                {detail.provenance?.imageBytesHeader ? (
                  <p>
                    ImageBytes facts:{' '}
                    {Object.entries(detail.provenance.imageBytesHeader)
                      .map(([key, value]) => `${key}=${value}`)
                      .join(' · ')}
                  </p>
                ) : null}
                <p>Source IDs: {detail.lineage.sourceAssetIds.join(', ')}</p>
                <p>Run: {detail.lineage.runId}</p>
                <p>Solve: {detail.lineage.solveAttemptId}</p>
              </details>
            </Panel>

            <Panel title="Get data" note="explicit intent">
              <ActionBar
                actions={[
                  download
                    ? download._tag === 'Eligible'
                      ? {
                          label: 'Download original',
                          tone: 'secondary' as const,
                          href: `/api/library/assets/${encodeURIComponent(detail.assetId)}/download`,
                        }
                      : {
                          label: 'Download original',
                          tone: 'secondary' as const,
                          disabled: true as const,
                          disabledReason:
                            actionReasons[download.reason] ?? download.reason,
                        }
                    : {
                        label: 'Download original',
                        tone: 'secondary' as const,
                        disabled: true as const,
                        disabledReason: 'unavailable',
                      },
                  ...(process && !readOnly
                    ? [
                        process._tag === 'Eligible'
                          ? {
                              label: 'Open in Process ▸',
                              tone: 'secondary' as const,
                              ...link({
                                kind: 'process-source' as const,
                                sourceAssetId: detail.assetId,
                              }),
                            }
                          : {
                              label: 'Open in Process ▸',
                              tone: 'secondary' as const,
                              disabled: true as const,
                              disabledReason:
                                actionReasons[process.reason] ?? process.reason,
                            },
                      ]
                    : []),
                ]}
                note="identity and the local original survive any staged-copy expiry"
              />
            </Panel>
          </>
        ) : fallback ? (
          <Panel title={fallback.name} note="catalogue projection">
            <Status tone="neutral">{fallback.review}</Status>
            <p className="library-detail__hint">
              Detail loads with the Library service projection.
            </p>
          </Panel>
        ) : assetId === undefined ? (
          <p className="library-detail__hint">No asset selected.</p>
        ) : null}
        <p className="action-result library-detail__readonly">
          Read-only monitoring. Durable local evidence is protected.
        </p>
      </div>
    </div>
  )
}

export function isLibraryShortcutBlocked(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'target'>,
) {
  if (event.altKey || event.ctrlKey || event.metaKey) return true
  const target = event.target as {
    readonly tagName?: string
    readonly isContentEditable?: boolean
  } | null
  return (
    target?.isContentEditable === true ||
    (target?.tagName !== undefined &&
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
  )
}
