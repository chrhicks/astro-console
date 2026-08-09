import {
  ActionPanel,
  AttentionCard,
  Button,
  DataList,
  DataListItem,
  EvidenceViewport,
  MetricOverlay,
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
  StatusIndicator,
  Tabs,
  Toolbar,
  type ActionDescriptor,
  type Tone,
} from '@nightbook/ui'
import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import type {
  LibraryAssetDetail,
  LibraryPage,
  LibraryQuery,
} from '../library-client'
import type { Projection } from '../presentation'
import { BetaCommandBar } from './BetaObserveApp'
import '@nightbook/ui/styles.css'
import './beta-observe.css'
import './beta-library.css'

type DetailState = 'loading' | 'not-found' | 'unavailable'

export type BetaLibraryAppProps = {
  projection: Projection
  loading: boolean
  assetId?: string
  page: {
    readonly query: LibraryQuery
    readonly value?: LibraryPage
    readonly message?: string
  }
  detail?: LibraryAssetDetail
  detailState?: DetailState
  onSelectAsset: (assetId: string) => void
  onReview?: (decision: 'accepted' | 'rejected') => Promise<void>
}

const titleCase = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())

const reviewTone = (
  decision: LibraryAssetDetail['review'] extends infer Review
    ? Review extends { decision: infer Decision }
      ? Decision
      : never
    : never,
): Tone =>
  decision === 'accepted'
    ? 'positive'
    : decision === 'rejected'
      ? 'danger'
      : 'neutral'

const usePhoneProjection = () => {
  const query = '(max-width: 600px)'
  const [phone, setPhone] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia(query).matches,
  )
  useEffect(() => {
    const media = matchMedia(query)
    const update = () => setPhone(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return phone
}

const detailMessage = (
  state: DetailState | undefined,
  pageMessage: string | undefined,
) => {
  if (state === 'loading') return 'Loading the selected asset.'
  if (state === 'not-found') return 'The selected asset was not found.'
  if (state === 'unavailable') return 'Asset detail is unavailable.'
  return pageMessage ?? 'Select an asset to review its durable evidence.'
}

const previewFallback = (detail: LibraryAssetDetail, failed: boolean) => {
  if (failed)
    return 'The preview could not be displayed. The durable asset and its download state are unchanged.'
  if (detail.inspection?._tag === 'Failed')
    return `Inspection failed: ${detail.inspection.summary}`
  if (detail.inspection?._tag === 'Unavailable')
    return `Inspection unavailable: ${detail.inspection.summary}`
  return 'No inspection preview is available. The durable asset remains recorded.'
}

function AssetNavigator({
  page,
  selectedAssetId,
  onSelectAsset,
}: Pick<BetaLibraryAppProps, 'page' | 'onSelectAsset'> & {
  selectedAssetId: string | undefined
}) {
  const assets = page.value?.results ?? []
  if (assets.length === 0)
    return page.message ? (
      <p className="beta-library-message" role="status">
        {page.message}
      </p>
    ) : null
  const position = assets.findIndex(
    (asset) => asset.assetId === selectedAssetId,
  )
  const previous = position > 0 ? assets[position - 1] : undefined
  const next = position >= 0 ? assets[position + 1] : undefined
  const follow = (event: MouseEvent<HTMLAnchorElement>, assetId: string) => {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    event.preventDefault()
    onSelectAsset(assetId)
  }
  return (
    <nav className="beta-library-assets" aria-label="Frame review navigation">
      {previous ? (
        <a
          href={`/library/assets/${encodeURIComponent(previous.assetId)}?ui=beta`}
          onClick={(event) => follow(event, previous.assetId)}
        >
          Previous
        </a>
      ) : (
        <span aria-disabled="true">Previous</span>
      )}
      <div aria-current="page">
        {position >= 0
          ? `${position + 1} / ${assets.length}`
          : 'Selected asset'}
      </div>
      {next ? (
        <a
          href={`/library/assets/${encodeURIComponent(next.assetId)}?ui=beta`}
          onClick={(event) => follow(event, next.assetId)}
        >
          Next
        </a>
      ) : (
        <span aria-disabled="true">Next</span>
      )}
    </nav>
  )
}

function LineagePanel({ detail }: { detail: LibraryAssetDetail }) {
  return (
    <Panel as="aside" className="beta-library-lineage">
      <PanelHeader title="Lineage" meta="Immutable evidence" />
      <PanelBody>
        <DataList aria-label="Asset lineage">
          <DataListItem label="Stable asset" value={detail.assetId} />
          {detail.checksum ? (
            <DataListItem label="Checksum" value={detail.checksum} />
          ) : null}
          <DataListItem label="Captured" value={detail.capturedAt} />
          {detail.equipment ? (
            <>
              <DataListItem label="Rig" value={detail.equipment.rigId} />
              <DataListItem
                label="Camera"
                value={detail.equipment.cameraDeviceId}
              />
            </>
          ) : null}
          {detail.lineage.runId ? (
            <DataListItem label="Run" value={detail.lineage.runId} />
          ) : null}
          {detail.lineage.solveAttemptId ? (
            <DataListItem label="Solve" value={detail.lineage.solveAttemptId} />
          ) : null}
          {detail.lineage.processingSessionId ? (
            <DataListItem
              label="Process session"
              value={detail.lineage.processingSessionId}
            />
          ) : null}
          {detail.lineage.processingOutputId ? (
            <DataListItem
              label="Process output"
              value={detail.lineage.processingOutputId}
              detail={
                detail.lineage.operationIds?.length
                  ? `${detail.lineage.operationIds.length} operation${detail.lineage.operationIds.length === 1 ? '' : 's'}`
                  : 'Build output'
              }
            />
          ) : null}
          <DataListItem
            label="Sources"
            value={
              detail.lineage.sourceAssetIds.length > 0
                ? detail.lineage.sourceAssetIds.join(', ')
                : 'Original source'
            }
          />
          {detail.capture ? (
            <DataListItem
              label="Capture"
              value={`${detail.capture.exposureSeconds}s · ${detail.capture.filter} · bin ${detail.capture.binning}`}
              detail={titleCase(detail.capture.frameType)}
            />
          ) : null}
        </DataList>
      </PanelBody>
    </Panel>
  )
}

function ReviewEvidence({
  detail,
  monitoringOnly = false,
}: {
  detail: LibraryAssetDetail
  monitoringOnly?: boolean
}) {
  const [fit, setFit] = useState<'aspect' | 'fill'>(() =>
    monitoringOnly ? 'aspect' : 'fill',
  )
  const [showMetrics, setShowMetrics] = useState(true)
  const [previewFailed, setPreviewFailed] = useState(false)
  useEffect(() => setPreviewFailed(false), [detail.assetId])
  const inspection = detail.inspection
  const available = inspection?._tag === 'Available' && !previewFailed
  const metrics = inspection?._tag === 'Available' ? inspection.metrics : null
  return (
    <EvidenceViewport
      className="beta-library-evidence"
      label={`Preview for ${detail.assetId}`}
      fit={fit}
      media={
        available ? (
          <img
            src={`/api/library/assets/${encodeURIComponent(detail.assetId)}/preview`}
            alt={`Inspection preview for ${detail.assetId}`}
            onError={() => setPreviewFailed(true)}
          />
        ) : undefined
      }
      fallback={previewFallback(detail, previewFailed)}
      overlays={
        !monitoringOnly && showMetrics && metrics ? (
          <MetricOverlay
            label="Inspection metrics"
            items={[
              { id: 'sharpness', label: 'Sharp', value: metrics.sharpness },
              { id: 'shape', label: 'Shape', value: metrics.shape },
              {
                id: 'drift',
                label: 'Drift',
                value: `${metrics.driftArcsec}″`,
              },
              {
                id: 'clipping',
                label: 'Clip',
                value: `${metrics.clippingPercent}%`,
              },
            ]}
          />
        ) : undefined
      }
      toolbar={
        monitoringOnly ? undefined : (
          <Toolbar label="Preview controls">
            <Button
              size="small"
              tone="quiet"
              aria-pressed={fit === 'aspect'}
              onClick={() => setFit('aspect')}
            >
              Full frame
            </Button>
            <Button
              size="small"
              tone="quiet"
              aria-pressed={fit === 'fill'}
              onClick={() => setFit('fill')}
            >
              Fill
            </Button>
            <Button
              size="small"
              tone="quiet"
              disabled={!metrics}
              aria-pressed={showMetrics}
              onClick={() => setShowMetrics((current) => !current)}
            >
              Metrics
            </Button>
          </Toolbar>
        )
      }
      caption={
        inspection?._tag === 'Available'
          ? inspection.rationale.summary
          : `${titleCase(detail.role)} · ${detail.format.toUpperCase()} · ${titleCase(detail.availability)}`
      }
    />
  )
}

function ReviewDecision({
  detail,
  page,
  readOnly,
  onSelectAsset,
  onReview,
}: {
  detail: LibraryAssetDetail
  page: BetaLibraryAppProps['page']
  readOnly: boolean
  onSelectAsset: BetaLibraryAppProps['onSelectAsset']
  onReview?: BetaLibraryAppProps['onReview']
}) {
  const [pending, setPending] = useState<'accepted' | 'rejected'>()
  const [result, setResult] = useState<string>()
  useEffect(() => {
    setPending(undefined)
    setResult(undefined)
  }, [detail.assetId, detail.review?.revision])

  const review = (decision: 'accepted' | 'rejected') => {
    if (!onReview || readOnly || pending) return
    setPending(decision)
    setResult(undefined)
    void onReview(decision)
      .then(
        () => setResult(`Review saved as ${decision}.`),
        () =>
          setResult('The review was not saved. The prior decision remains.'),
      )
      .finally(() => setPending(undefined))
  }

  const decision = detail.review?.decision ?? 'unreviewed'
  const primary: ActionDescriptor = {
    id: 'accept-frame',
    label: pending === 'accepted' ? 'Saving…' : 'Accept',
    tone: 'primary',
    disabled: readOnly || !onReview || pending !== undefined,
    description: readOnly
      ? 'Desktop control is required.'
      : 'Save this review decision; the original remains unchanged.',
    onSelect: () => review('accepted'),
  }
  const reject: ActionDescriptor = {
    id: 'reject-frame',
    label: pending === 'rejected' ? 'Saving…' : 'Reject',
    tone: 'danger',
    disabled: readOnly || !onReview || pending !== undefined,
    description: 'Reject this review only; preserve the original evidence.',
    onSelect: () => review('rejected'),
  }
  return (
    <aside className="beta-library-decision">
      <AssetNavigator
        page={page}
        selectedAssetId={detail.assetId}
        onSelectAsset={onSelectAsset}
      />
      <ActionPanel
        eyebrow={readOnly ? 'Review · viewer' : 'Review · controller'}
        title={titleCase(decision)}
        description={
          <StatusIndicator
            label={titleCase(decision)}
            tone={reviewTone(decision)}
            detail={`Review revision ${detail.review?.revision ?? 0}`}
          />
        }
        primary={primary}
        secondary={[reject]}
        footer={
          result ??
          'Review changes the durable decision only. Capture evidence and the original stay unchanged.'
        }
      />
    </aside>
  )
}

function ReviewTab({
  detail,
  page,
  projection,
  onSelectAsset,
  onReview,
}: Pick<
  BetaLibraryAppProps,
  'detail' | 'page' | 'projection' | 'onSelectAsset' | 'onReview'
>) {
  if (!detail) return null
  return (
    <section className="beta-library-review-grid" aria-label="Frame review">
      <LineagePanel detail={detail} />
      <ReviewEvidence detail={detail} />
      <ReviewDecision
        detail={detail}
        page={page}
        readOnly={projection.shell.readOnly}
        onSelectAsset={onSelectAsset}
        onReview={onReview}
      />
    </section>
  )
}

function AvailabilityTab({ detail }: { detail: LibraryAssetDetail }) {
  const download = detail.actions.find((action) => action.action === 'download')
  const eligible = download?._tag === 'Eligible'
  return (
    <section
      className="beta-library-availability"
      aria-label="Asset availability"
    >
      <Panel>
        <PanelHeader
          title="Representations"
          meta={titleCase(detail.availability)}
        />
        <PanelBody>
          <DataList aria-label="Representation availability">
            <DataListItem
              label="Durable asset"
              value={detail.assetId}
              detail="Stable identity"
            />
            {detail.representations.length > 0 ? (
              detail.representations.map((representation) => (
                <DataListItem
                  key={`${representation.label}-${representation.state}`}
                  label={representation.label}
                  value={titleCase(representation.state)}
                />
              ))
            ) : (
              <DataListItem label="Representations" value="None reported" />
            )}
          </DataList>
        </PanelBody>
      </Panel>
      <AttentionCard
        tone={eligible ? 'positive' : 'warning'}
        statusLabel={eligible ? 'Download available' : 'Download unavailable'}
        title="Get the original"
        description={
          eligible
            ? 'Use the service-owned download route for this stable asset.'
            : `The original cannot be downloaded now${download?._tag === 'Unavailable' ? `: ${titleCase(download.reason)}` : '.'}`
        }
        evidence="Preview availability does not change the original asset identity."
        actions={
          eligible ? (
            <a
              className="beta-library-download"
              href={`/api/library/assets/${encodeURIComponent(detail.assetId)}/download`}
            >
              Download original
            </a>
          ) : undefined
        }
      />
    </section>
  )
}

function BetaLibraryDesktop(props: BetaLibraryAppProps) {
  const [activeTab, setActiveTab] = useState('review')
  const title =
    props.detailState === 'loading' || props.loading
      ? 'Loading asset'
      : 'Frame review'
  const status = props.detail?.review?.decision ?? 'unreviewed'

  const tabs = useMemo(
    () =>
      props.detail
        ? [
            {
              id: 'review',
              label: 'Review',
              content: <ReviewTab {...props} />,
            },
            {
              id: 'availability',
              label: 'Availability',
              content: <AvailabilityTab detail={props.detail} />,
            },
          ]
        : [],
    [props],
  )

  return (
    <main id="beta-workspace" className="beta-library-workspace">
      <PageHeader
        eyebrow="Library / Frame review"
        title={title}
        meta={
          props.detail
            ? `${props.detail.capture?.frameId ?? props.detail.assetId} · ${titleCase(props.detail.role)} · ${props.detail.format.toUpperCase()} · captured ${props.detail.capturedAt}`
            : detailMessage(props.detailState, props.page.message)
        }
        actions={
          props.detail ? (
            <StatusIndicator
              label={titleCase(status)}
              tone={reviewTone(status)}
              detail={titleCase(props.detail.availability)}
            />
          ) : undefined
        }
      />
      {props.detail ? (
        <Tabs
          className="beta-library-tabs"
          items={tabs}
          activeId={activeTab}
          onActiveChange={setActiveTab}
          label="Frame review modes"
        />
      ) : (
        <AttentionCard
          tone={props.detailState === 'not-found' ? 'danger' : 'warning'}
          statusLabel={
            props.detailState === 'loading' || props.loading
              ? 'Loading'
              : 'Evidence unavailable'
          }
          title="Frame review"
          description={detailMessage(props.detailState, props.page.message)}
          evidence="No review action is available without current asset detail."
        />
      )}
    </main>
  )
}

export function BetaLibraryPhone({
  loading,
  detail,
  detailState,
  page,
}: Omit<BetaLibraryAppProps, 'onSelectAsset' | 'onReview'>) {
  return (
    <main
      id="beta-workspace"
      className="beta-library-phone"
      aria-label="Read-only Library phone projection"
    >
      <PageHeader
        eyebrow="Library / Frame review"
        title={
          detail ? (detail.capture?.frameId ?? detail.assetId) : 'Frame review'
        }
        actions={
          <StatusIndicator
            label={loading ? 'Loading' : detail ? 'Current' : 'Unavailable'}
            tone={loading ? 'info' : detail ? 'positive' : 'warning'}
          />
        }
      />
      <AttentionCard
        tone="warning"
        statusLabel="Read-only on phone"
        title={
          detail
            ? titleCase(detail.review?.decision ?? 'unreviewed')
            : 'No current asset'
        }
        description={
          detail
            ? 'Frame review and download controls are available on desktop only.'
            : detailMessage(detailState, page.message)
        }
      />
      {detail ? (
        <>
          <ReviewEvidence detail={detail} monitoringOnly />
          <Panel>
            <PanelBody>
              <DataList aria-label="Phone asset evidence and availability">
                <DataListItem label="Asset ID" value={detail.assetId} />
                <DataListItem label="Captured" value={detail.capturedAt} />
                {detail.equipment ? (
                  <>
                    <DataListItem label="Rig" value={detail.equipment.rigId} />
                    <DataListItem
                      label="Camera"
                      value={detail.equipment.cameraDeviceId}
                    />
                  </>
                ) : null}
                {detail.lineage.runId ? (
                  <DataListItem label="Run" value={detail.lineage.runId} />
                ) : null}
                {detail.lineage.processingSessionId ? (
                  <DataListItem
                    label="Process session"
                    value={detail.lineage.processingSessionId}
                  />
                ) : null}
                <DataListItem
                  label="Source"
                  value={
                    detail.lineage.sourceAssetIds.length > 0
                      ? detail.lineage.sourceAssetIds.join(', ')
                      : 'Original source'
                  }
                />
                <DataListItem
                  label="Original"
                  value={titleCase(detail.availability)}
                />
                <DataListItem
                  label="Inspection record"
                  value={
                    detail.inspection === undefined
                      ? 'Not generated'
                      : titleCase(detail.inspection._tag)
                  }
                />
              </DataList>
            </PanelBody>
          </Panel>
        </>
      ) : null}
    </main>
  )
}

function BetaLibraryStatusStrip({ projection }: { projection: Projection }) {
  const current = projection.shell.freshness.startsWith('Current ')
  return (
    <footer className="beta-operational-status" aria-label="Operational status">
      <span>
        <i data-tone={current ? 'positive' : 'warning'} aria-hidden="true" />
        <b>Library</b> ·{' '}
        {current ? 'snapshot current' : projection.shell.freshness}
      </span>
      <span>
        Library · service-owned durable evidence · revision{' '}
        {projection.shell.control.revision}
      </span>
      <span>{projection.shell.protection}</span>
    </footer>
  )
}

export function BetaLibraryApp(props: BetaLibraryAppProps) {
  const phone = usePhoneProjection()
  return (
    <div
      className="beta-app nb-theme"
      data-nb-theme="nightbook"
      data-nb-density="compact"
    >
      <a className="beta-skip-link" href="#beta-workspace">
        Skip to Library evidence
      </a>
      <BetaCommandBar
        projection={props.projection}
        loading={props.loading}
        workspace="library"
      />
      {phone ? (
        <BetaLibraryPhone
          projection={props.projection}
          loading={props.loading}
          page={props.page}
          {...(props.assetId === undefined ? {} : { assetId: props.assetId })}
          {...(props.detail === undefined ? {} : { detail: props.detail })}
          {...(props.detailState === undefined
            ? {}
            : { detailState: props.detailState })}
        />
      ) : (
        <BetaLibraryDesktop {...props} />
      )}
      <BetaLibraryStatusStrip projection={props.projection} />
    </div>
  )
}

export default BetaLibraryApp
