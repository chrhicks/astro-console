import {
  ActionPanel,
  AttentionCard,
  Button,
  DataList,
  DataListItem,
  EvidenceViewport,
  Field,
  MetricOverlay,
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
  Select,
  StatusIndicator,
  Stack,
  Tabs,
  TextField,
  Toolbar,
  type ActionDescriptor,
  type Tone,
} from '@nightbook/ui'
import { AssetId, CaptureSetId } from '@astro-console/protocol'
import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from 'react'
import type {
  LibraryAssetDetail,
  LibraryPage,
  LibraryQuery,
} from '../library-client'
import type { Projection } from '../presentation'
import type { ProcessingProjectList } from '../nightbook-workspace-runtime'
import { BetaCommandBar, type BetaControlSubmit } from './BetaObserveApp'
import { nightbookHref } from './route'
import '@nightbook/ui/styles.css'
import './beta-observe.css'
import './beta-library.css'

type DetailState = 'loading' | 'not-found' | 'unavailable'
type IntakeProject = ProcessingProjectList[number]
type LibraryIntake = {
  selectedAssetIds: ReadonlySet<string>
  selectedCaptureSetIds: ReadonlySet<string>
  projects: ReadonlyArray<IntakeProject>
  projectName: string
  destination: string
  pending: boolean
  disabled: boolean
  denial?: string
  message?: string
  setProjectName: (value: string) => void
  setDestination: (value: string) => void
  toggleAsset: (assetId: string) => void
  toggleCaptureSet: (captureSetId: string) => void
  submit: () => void
}

export type BetaLibraryAppProps = {
  projection: Projection
  loading: boolean
  submitControl?: BetaControlSubmit
  assetId?: string
  page: {
    readonly query: LibraryQuery
    readonly value?: LibraryPage
    readonly message?: string
  }
  detail?: LibraryAssetDetail
  detailState?: DetailState
  onQuery?: (query: LibraryQuery) => void
  onSelectAsset: (assetId: string) => void
  comparison?: {
    assetId: string | undefined
    value: LibraryAssetDetail | undefined
    state: 'loading' | 'unavailable' | undefined
  }
  onSelectComparisonAsset?: (assetId: string | undefined) => void
  onReview?: (review: {
    decision: 'accepted' | 'rejected' | 'unreviewed'
    rating?: number
    annotation?: string
  }) => Promise<void>
  onOpenProcess?: (assetId: string) => void
  processProjects?: ProcessingProjectList
  onCreateProject?: (
    name: string,
    selection: {
      readonly assetIds: ReadonlyArray<string>
      readonly captureSetIds: ReadonlyArray<string>
    },
  ) => Promise<void>
  onAddProjectSources?: (
    projectId: string,
    expectedProjectRevision: number,
    selection: {
      readonly assetIds: ReadonlyArray<string>
      readonly captureSetIds: ReadonlyArray<string>
    },
  ) => Promise<void>
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

const actionReason = (
  action:
    | Extract<LibraryAssetDetail['actions'][number], { _tag: 'Unavailable' }>
    | undefined,
) => (action ? titleCase(action.reason) : 'Not projected by the service')

const compactAssetId = (assetId: string) =>
  assetId.length > 20 ? `${assetId.slice(0, 10)}…${assetId.slice(-7)}` : assetId

const roleOptions: ReadonlyArray<{
  value: LibraryQuery['role'] | undefined
  label: string
}> = [
  { value: undefined, label: 'All roles' },
  { value: 'original', label: 'Original' },
  { value: 'linearMaster', label: 'Linear master' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'final', label: 'Final' },
  { value: 'preview', label: 'Preview' },
  { value: 'diagnostic', label: 'Diagnostic' },
]

const sortOptions: ReadonlyArray<{
  value: LibraryQuery['sort']
  label: string
}> = [
  { value: 'capturedAtDescending', label: 'Newest first' },
  { value: 'sharpestFirst', label: 'Sharpest first' },
  { value: 'recentlyUpdated', label: 'Recently updated' },
]

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
      <a href={nightbookHref('/library')}>Catalog</a>
      {previous ? (
        <a
          href={nightbookHref(
            `/library/assets/${encodeURIComponent(previous.assetId)}`,
          )}
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
          href={nightbookHref(
            `/library/assets/${encodeURIComponent(next.assetId)}`,
          )}
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

const availabilityTone = (
  availability: LibraryAssetDetail['availability'],
): Tone =>
  availability === 'availableLocally' || availability === 'published'
    ? 'positive'
    : availability === 'failedPublication'
      ? 'danger'
      : availability === 'preparing' ||
          availability === 'republishing' ||
          availability === 'expiring'
        ? 'info'
        : 'warning'

function CatalogReview({
  review,
}: {
  review: LibraryPage['results'][number]['review']
}) {
  const rating =
    review.rating === undefined ? '☆ Not rated' : `★ ${review.rating}/5`
  return (
    <div
      className="beta-library-catalog-review"
      data-decision={review.decision}
      aria-label={`Review: ${titleCase(review.decision)}; ${rating}`}
    >
      <span>{rating}</span>
      <b>{titleCase(review.decision)}</b>
    </div>
  )
}

function LibraryCatalog({
  page,
  onQuery,
  onSelectAsset,
  intake,
}: Pick<BetaLibraryAppProps, 'page' | 'onQuery' | 'onSelectAsset'> & {
  intake: LibraryIntake
}) {
  const groups = useMemo(() => {
    const grouped = new Map<
      string,
      NonNullable<BetaLibraryAppProps['page']['value']>['results']
    >()
    for (const asset of page.value?.results ?? [])
      grouped.set(asset.comparisonGroupId, [
        ...(grouped.get(asset.comparisonGroupId) ?? []),
        asset,
      ])
    return [...grouped.entries()]
  }, [page.value])
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
  const changeQuery = (
    role: LibraryQuery['role'] | undefined,
    sort: LibraryQuery['sort'],
    cursor?: LibraryQuery['cursor'],
  ) =>
    onQuery?.({
      queryId: page.query.queryId,
      pageSize: page.query.pageSize,
      sort,
      ...(role === undefined ? {} : { role }),
      ...(cursor === undefined ? {} : { cursor }),
    })

  return (
    <main id="beta-workspace" className="beta-library-catalog">
      <PageHeader
        eyebrow="Library / Durable evidence"
        title="Catalog"
        meta={
          page.value
            ? `${page.value.results.length} loaded records · snapshot ${page.value.querySnapshotVersion}${page.message ? ` · ${page.message}` : ''}`
            : (page.message ?? 'Loading Library records.')
        }
        actions={
          <StatusIndicator
            label={
              page.value
                ? page.message
                  ? 'Last-confirmed page'
                  : 'Service page loaded'
                : 'Loading'
            }
            tone={
              page.value ? (page.message ? 'warning' : 'positive') : 'neutral'
            }
            detail={
              page.message ??
              (page.value?.catalogChanged
                ? 'Catalog changed during this query.'
                : 'Current loaded page')
            }
          />
        }
      />
      <Panel className="beta-library-catalog-controls">
        <PanelHeader title="Organize" meta="Service query" />
        <PanelBody>
          <div className="beta-library-catalog-fields">
            <Field label="Role">
              <Select
                value={page.query.role ?? ''}
                disabled={!onQuery}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  changeQuery(
                    event.target.value
                      ? (event.target.value as LibraryQuery['role'])
                      : undefined,
                    page.query.sort,
                  )
                }
              >
                {roleOptions.map((option) => (
                  <option key={option.label} value={option.value ?? ''}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sort">
              <Select
                value={page.query.sort}
                disabled={!onQuery}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  changeQuery(
                    page.query.role,
                    event.target.value as LibraryQuery['sort'],
                  )
                }
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="beta-library-message">
            Assets are grouped by the service comparison-group identity. Night,
            target, and review-status facets are not projected by the current
            query contract.
          </p>
        </PanelBody>
      </Panel>
      <Panel className="beta-library-intake">
        <PanelHeader
          title="Processing Project intake"
          meta={`${intake.selectedAssetIds.size} frames · ${intake.selectedCaptureSetIds.size} Capture Sets`}
        />
        <PanelBody>
          <div className="beta-library-intake-fields">
            <Field label="Destination">
              <Select
                value={intake.destination}
                disabled={intake.pending || intake.disabled}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  intake.setDestination(event.target.value)
                }
              >
                <option value="new">New Processing Project</option>
                {intake.projects.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    Add to {project.name}
                  </option>
                ))}
              </Select>
            </Field>
            {intake.destination === 'new' ? (
              <Field label="Project name">
                <TextField
                  value={intake.projectName}
                  disabled={intake.pending || intake.disabled}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    intake.setProjectName(event.target.value)
                  }
                />
              </Field>
            ) : null}
            <Button
              tone="primary"
              disabled={
                intake.pending ||
                intake.disabled ||
                intake.selectedAssetIds.size +
                  intake.selectedCaptureSetIds.size ===
                  0 ||
                (intake.destination === 'new' && !intake.projectName.trim())
              }
              onClick={intake.submit}
            >
              {intake.pending
                ? 'Freezing sources…'
                : intake.destination === 'new'
                  ? 'Create project'
                  : 'Add to project'}
            </Button>
          </div>
          <p className="beta-library-message" role="status">
            {intake.message ??
              intake.denial ??
              'Project intake is ready for an exact source selection.'}
          </p>
          <p className="beta-library-message">
            Capture Sets resolve to the exact asset revisions currently
            retained. Intake does not start Calibration.
          </p>
        </PanelBody>
      </Panel>
      {page.value?.catalogChanged ? (
        <AttentionCard
          tone="warning"
          statusLabel="Catalog changed"
          title="Reload this query before acting on page position"
          description="The loaded records remain exact, but their page position may have changed."
        />
      ) : null}
      {groups.length ? (
        <section
          className="beta-library-catalog-groups"
          aria-label="Loaded Library groups"
        >
          {groups.map(([groupId, assets]) => {
            const captureSetId = assets.find(
              (asset) => asset.captureSetId !== undefined,
            )?.captureSetId
            return (
              <Panel key={groupId} className="beta-library-catalog-group">
                <PanelHeader
                  title={groupId}
                  meta={`${assets.length} loaded representation${assets.length === 1 ? '' : 's'}`}
                />
                <PanelBody>
                  {captureSetId ? (
                    <label className="beta-library-set-selector">
                      <input
                        type="checkbox"
                        disabled={intake.disabled}
                        checked={intake.selectedCaptureSetIds.has(captureSetId)}
                        onChange={() => intake.toggleCaptureSet(captureSetId)}
                      />
                      Select whole Capture Set
                    </label>
                  ) : null}
                  <div className="beta-library-catalog-assets">
                    {assets.map((asset) => (
                      <div
                        className="beta-library-selectable-asset"
                        key={asset.assetId}
                      >
                        <label>
                          <input
                            type="checkbox"
                            disabled={intake.disabled}
                            checked={intake.selectedAssetIds.has(asset.assetId)}
                            onChange={() => intake.toggleAsset(asset.assetId)}
                          />
                          Select frame
                        </label>
                        <a
                          href={nightbookHref(
                            `/library/assets/${encodeURIComponent(asset.assetId)}`,
                          )}
                          onClick={(event) => follow(event, asset.assetId)}
                        >
                          <b>{compactAssetId(asset.assetId)}</b>
                          <span>
                            {asset.targetName ? `${asset.targetName} · ` : ''}
                            {titleCase(asset.role)} ·{' '}
                            {asset.format.toUpperCase()}
                          </span>
                          <CatalogReview review={asset.review} />
                          <StatusIndicator
                            className="beta-library-catalog-availability"
                            label={titleCase(asset.availability)}
                            tone={availabilityTone(asset.availability)}
                            detail={`Revision ${asset.revision}`}
                          />
                        </a>
                      </div>
                    ))}
                  </div>
                </PanelBody>
              </Panel>
            )
          })}
        </section>
      ) : (
        <AttentionCard
          tone={page.message ? 'warning' : 'neutral'}
          statusLabel={page.message ? 'Catalog unavailable' : 'No records'}
          title="Library catalog"
          description={page.message ?? 'No assets match this service query.'}
        />
      )}
      {page.value ? (
        <nav className="beta-library-catalog-paging" aria-label="Catalog pages">
          <Button
            size="small"
            disabled={!page.query.cursor || !onQuery}
            onClick={() =>
              changeQuery(page.query.role, page.query.sort, undefined)
            }
          >
            First page
          </Button>
          <span>
            {page.query.cursor
              ? `Cursor ${page.query.cursor}`
              : 'First loaded page'}
          </span>
          <Button
            size="small"
            disabled={!page.value.nextCursor || !onQuery}
            onClick={() =>
              changeQuery(
                page.query.role,
                page.query.sort,
                page.value?.nextCursor,
              )
            }
          >
            Next page
          </Button>
        </nav>
      ) : null}
    </main>
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
          <DataListItem
            label="Representation"
            value={`${titleCase(detail.role)} · ${detail.format.toUpperCase()}`}
            detail={titleCase(detail.availability)}
          />
          <DataListItem
            label="Comparison group"
            value={detail.comparisonGroupId}
          />
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
          {detail.lineage.processingProjectId ? (
            <DataListItem
              label="Processing Project"
              value={detail.lineage.processingProjectId}
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
          {detail.lineage.operationIds?.length ? (
            <DataListItem
              label="Operations"
              value={detail.lineage.operationIds.join(', ')}
              detail="Exact applied operation lineage"
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
  onOpenProcess,
}: {
  detail: LibraryAssetDetail
  page: BetaLibraryAppProps['page']
  readOnly: boolean
  onSelectAsset: BetaLibraryAppProps['onSelectAsset']
  onReview?: BetaLibraryAppProps['onReview']
  onOpenProcess?: BetaLibraryAppProps['onOpenProcess']
}) {
  const [pending, setPending] = useState<
    'accepted' | 'rejected' | 'unreviewed'
  >()
  const [result, setResult] = useState<string>()
  const [rating, setRating] = useState(detail.review?.rating ?? 0)
  const [annotation, setAnnotation] = useState(detail.review?.annotation ?? '')
  useEffect(() => {
    setPending(undefined)
    setResult(undefined)
    setRating(detail.review?.rating ?? 0)
    setAnnotation(detail.review?.annotation ?? '')
  }, [detail.assetId, detail.review?.revision])

  const review = (decision: 'accepted' | 'rejected' | 'unreviewed') => {
    if (!onReview || readOnly || pending) return
    setPending(decision)
    setResult(undefined)
    const note = annotation.trim()
    void onReview({
      decision,
      ...(rating > 0 ? { rating } : {}),
      ...(note ? { annotation: note } : {}),
    })
      .then(
        () => setResult(`Review saved as ${decision}.`),
        () =>
          setResult('The review was not saved. The prior decision remains.'),
      )
      .finally(() => setPending(undefined))
  }

  const decision = detail.review?.decision ?? 'unreviewed'
  const process = detail.actions.find(
    (action) => action.action === 'openInProcess',
  )
  const processEligible = process?._tag === 'Eligible'
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
      <Panel className="beta-library-review-fields">
        <PanelHeader title="Review" meta="Durable rating and note" />
        <PanelBody>
          <Stack gap={8}>
            <div
              className="beta-library-rating"
              role="radiogroup"
              aria-label="Frame rating"
            >
              <span>Rate</span>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={rating === value}
                  aria-label={`Rate ${value}`}
                  disabled={readOnly || !onReview || pending !== undefined}
                  onClick={() => setRating(value)}
                >
                  {value <= rating ? '★' : '☆'}
                </button>
              ))}
            </div>
            <Field label="Durable review note">
              <TextField
                value={annotation}
                placeholder="Add a note"
                disabled={readOnly || !onReview || pending !== undefined}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setAnnotation(event.target.value)
                }
              />
            </Field>
            <Button
              size="small"
              disabled={readOnly || !onReview || pending !== undefined}
              onClick={() => review(decision)}
            >
              {pending === decision ? 'Saving…' : 'Save review details'}
            </Button>
            <Button
              size="small"
              disabled={!processEligible || !onOpenProcess}
              title={
                processEligible
                  ? 'Open this service-eligible source in Process.'
                  : `Unavailable: ${actionReason(process?._tag === 'Unavailable' ? process : undefined)}`
              }
              onClick={() => onOpenProcess?.(detail.assetId)}
            >
              Open in Process →
            </Button>
          </Stack>
        </PanelBody>
      </Panel>
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
  onOpenProcess,
}: Pick<
  BetaLibraryAppProps,
  | 'detail'
  | 'page'
  | 'projection'
  | 'onSelectAsset'
  | 'onReview'
  | 'onOpenProcess'
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
        onOpenProcess={onOpenProcess}
      />
    </section>
  )
}

function CompareTab({
  detail,
  page,
  comparison,
  onSelectComparisonAsset,
}: Pick<
  BetaLibraryAppProps,
  'detail' | 'page' | 'comparison' | 'onSelectComparisonAsset'
>) {
  const peers = useMemo(
    () =>
      (page.value?.results ?? []).filter(
        (asset) =>
          asset.assetId !== detail?.assetId &&
          asset.comparisonGroupId === detail?.comparisonGroupId,
      ),
    [detail?.assetId, detail?.comparisonGroupId, page.value],
  )
  const [peerAssetId, setPeerAssetId] = useState<string>()

  useEffect(() => {
    setPeerAssetId(peers[0]?.assetId)
    onSelectComparisonAsset?.(peers[0]?.assetId)
  }, [
    detail?.assetId,
    detail?.comparisonGroupId,
    onSelectComparisonAsset,
    peers,
  ])

  if (!detail) return null
  const inspection = (asset: LibraryAssetDetail) =>
    asset.inspection?._tag === 'Available'
      ? asset.inspection.metrics
      : undefined
  const leftMetrics = inspection(detail)
  const peer =
    comparison?.assetId === peerAssetId ? comparison?.value : undefined
  const rightMetrics = peer ? inspection(peer) : undefined
  const pair = (left: string | number, right: string | number | undefined) =>
    `${left} · ${right ?? 'Not loaded'}`

  return (
    <section className="beta-library-compare" aria-label="Frame compare">
      <div className="beta-library-compare-picker">
        <b>Comparison peer</b>
        {peers.length ? (
          peers.map((candidate) => (
            <Button
              key={candidate.assetId}
              size="small"
              tone="quiet"
              aria-pressed={peerAssetId === candidate.assetId}
              title={candidate.assetId}
              onClick={() => {
                setPeerAssetId(candidate.assetId)
                onSelectComparisonAsset?.(candidate.assetId)
              }}
            >
              {compactAssetId(candidate.assetId)}
            </Button>
          ))
        ) : (
          <span>
            No peer is present in this loaded page and comparison group.
          </span>
        )}
      </div>
      <ReviewEvidence detail={detail} monitoringOnly />
      {peer ? (
        <ReviewEvidence detail={peer} monitoringOnly />
      ) : (
        <AttentionCard
          tone={comparison?.state === 'unavailable' ? 'warning' : 'neutral'}
          statusLabel={
            comparison?.state === 'loading'
              ? 'Loading peer'
              : 'Peer unavailable'
          }
          title="Select loaded service detail"
          description={
            comparison?.state === 'unavailable'
              ? 'The selected peer detail could not be loaded.'
              : 'Comparison waits for the selected Library detail.'
          }
        />
      )}
      <Panel className="beta-library-compare-facts">
        <PanelHeader title="Loaded service facts" meta="Browser-only view" />
        <PanelBody>
          <DataList aria-label="Compared service facts">
            <DataListItem
              label="Assets"
              value={pair(detail.assetId, peer?.assetId)}
            />
            <DataListItem
              label="Representation"
              value={pair(
                `${titleCase(detail.role)} · ${detail.format.toUpperCase()}`,
                peer
                  ? `${titleCase(peer.role)} · ${peer.format.toUpperCase()}`
                  : undefined,
              )}
            />
            <DataListItem
              label="Availability"
              value={pair(
                titleCase(detail.availability),
                peer ? titleCase(peer.availability) : undefined,
              )}
            />
            <DataListItem
              label="Review"
              value={pair(
                titleCase(detail.review?.decision ?? 'unreviewed'),
                peer
                  ? titleCase(peer.review?.decision ?? 'unreviewed')
                  : undefined,
              )}
            />
            {leftMetrics && rightMetrics ? (
              <>
                <DataListItem
                  label="Sharpness"
                  value={pair(leftMetrics.sharpness, rightMetrics.sharpness)}
                />
                <DataListItem
                  label="Shape"
                  value={pair(leftMetrics.shape, rightMetrics.shape)}
                />
                <DataListItem
                  label="Drift"
                  value={pair(
                    `${leftMetrics.driftArcsec}″`,
                    `${rightMetrics.driftArcsec}″`,
                  )}
                />
                <DataListItem
                  label="Clipping"
                  value={pair(
                    `${leftMetrics.clippingPercent}%`,
                    `${rightMetrics.clippingPercent}%`,
                  )}
                />
              </>
            ) : (
              <DataListItem
                label="Inspection metrics"
                value={pair(
                  leftMetrics ? 'Available' : 'Unavailable',
                  peer
                    ? rightMetrics
                      ? 'Available'
                      : 'Unavailable'
                    : undefined,
                )}
                detail="Metrics appear only when both loaded details provide them."
              />
            )}
          </DataList>
          <p className="beta-library-message">
            Left · right. Compare selection is browser-only and changes no asset
            or review.
          </p>
        </PanelBody>
      </Panel>
    </section>
  )
}

function AvailabilityTab({ detail }: { detail: LibraryAssetDetail }) {
  const download = detail.actions.find((action) => action.action === 'download')
  const process = detail.actions.find(
    (action) => action.action === 'openInProcess',
  )
  const eligible = download?._tag === 'Eligible'
  const publishedRepresentation = detail.representations.find(
    (representation) => representation.state === 'published',
  )
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
            <DataListItem
              label="Download action"
              value={
                download?._tag === 'Eligible'
                  ? 'Eligible'
                  : `Unavailable · ${actionReason(download?._tag === 'Unavailable' ? download : undefined)}`
              }
            />
            <DataListItem
              label="Process handoff"
              value={
                process?._tag === 'Eligible'
                  ? 'Eligible'
                  : `Unavailable · ${actionReason(process?._tag === 'Unavailable' ? process : undefined)}`
              }
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
        statusLabel={
          publishedRepresentation
            ? 'Published delivery'
            : eligible
              ? 'Download available'
              : 'Download unavailable'
        }
        title={publishedRepresentation?.label ?? 'Get the original'}
        description={
          publishedRepresentation
            ? 'The service reports this representation as published and the download action as eligible.'
            : eligible
              ? 'Use the service-owned download route for this stable asset.'
              : `The original cannot be downloaded now${download?._tag === 'Unavailable' ? `: ${titleCase(download.reason)}` : '.'}`
        }
        evidence={
          publishedRepresentation
            ? 'No grant expiry or transfer progress is projected by this detail contract.'
            : 'Preview availability does not change the original asset identity.'
        }
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

function BetaLibraryDesktop(
  props: BetaLibraryAppProps & { intake: LibraryIntake },
) {
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
              id: 'compare',
              label: 'Compare',
              content: <CompareTab {...props} />,
            },
            {
              id: 'availability',
              label: 'Availability & delivery',
              content: <AvailabilityTab detail={props.detail} />,
            },
          ]
        : [],
    [props],
  )

  if (!props.assetId && !props.detail && props.detailState === undefined)
    return (
      <LibraryCatalog
        page={props.page}
        onSelectAsset={props.onSelectAsset}
        {...(props.onQuery === undefined ? {} : { onQuery: props.onQuery })}
        intake={props.intake}
      />
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
  assetId,
  detail,
  detailState,
  page,
}: Omit<
  BetaLibraryAppProps,
  'onSelectAsset' | 'onReview' | 'onOpenProcess' | 'onSelectComparisonAsset'
>) {
  const catalogGroups = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof page.value>['results']>()
    for (const asset of page.value?.results ?? [])
      groups.set(asset.comparisonGroupId, [
        ...(groups.get(asset.comparisonGroupId) ?? []),
        asset,
      ])
    return [...groups.entries()]
  }, [page.value])
  return (
    <main
      id="beta-workspace"
      className="beta-library-phone"
      aria-label="Read-only Library phone projection"
    >
      <PageHeader
        eyebrow={
          detail || assetId
            ? 'Library / Frame review'
            : 'Library / Durable evidence'
        }
        title={
          detail
            ? (detail.capture?.frameId ?? detail.assetId)
            : assetId
              ? 'Frame review'
              : 'Catalog'
        }
        actions={
          <StatusIndicator
            label={
              loading
                ? 'Loading'
                : detail
                  ? 'Current'
                  : !assetId && page.value
                    ? 'Catalog loaded'
                    : 'Unavailable'
            }
            tone={
              loading
                ? 'info'
                : detail || (!assetId && page.value)
                  ? 'positive'
                  : 'warning'
            }
          />
        }
      />
      <AttentionCard
        tone="warning"
        statusLabel="Read-only on phone"
        title={
          detail
            ? titleCase(detail.review?.decision ?? 'unreviewed')
            : assetId
              ? 'Asset detail unavailable'
              : page.value
                ? `${page.value.results.length} loaded records`
                : 'Library catalog'
        }
        description={
          detail
            ? 'Frame review and download controls are available on desktop only.'
            : assetId
              ? detailMessage(detailState, page.message)
              : (page.message ??
                'Browse exact service records. Review and delivery controls remain on desktop.')
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
                {detail.lineage.processingProjectId ? (
                  <DataListItem
                    label="Processing Project"
                    value={detail.lineage.processingProjectId}
                  />
                ) : null}
                {detail.lineage.processingOutputId ? (
                  <DataListItem
                    label="Process output"
                    value={detail.lineage.processingOutputId}
                  />
                ) : null}
                {detail.lineage.operationIds?.length ? (
                  <DataListItem
                    label="Operations"
                    value={detail.lineage.operationIds.join(', ')}
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
                  label="Review rating"
                  value={
                    detail.review?.rating === undefined
                      ? 'Not rated'
                      : `${detail.review.rating} / 5`
                  }
                />
                <DataListItem
                  label="Review note"
                  value={detail.review?.annotation ?? 'No durable note'}
                />
                <DataListItem
                  label="Comparison group"
                  value={detail.comparisonGroupId}
                />
                {detail.representations.length ? (
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
      ) : !assetId && catalogGroups.length ? (
        <section
          className="beta-library-phone-groups"
          aria-label="Phone Library catalog"
        >
          {catalogGroups.map(([groupId, assets]) => (
            <Panel key={groupId}>
              <PanelHeader
                title={groupId}
                meta={`${assets.length} loaded representation${assets.length === 1 ? '' : 's'}`}
              />
              <PanelBody>
                <nav aria-label={`Assets in ${groupId}`}>
                  {assets.map((asset) => (
                    <a
                      key={asset.assetId}
                      href={nightbookHref(
                        `/library/assets/${encodeURIComponent(asset.assetId)}`,
                      )}
                    >
                      <b>{compactAssetId(asset.assetId)}</b>
                      <span>
                        {titleCase(asset.role)} · {asset.format.toUpperCase()} ·{' '}
                        {titleCase(asset.availability)} · Revision{' '}
                        {asset.revision}
                      </span>
                      <CatalogReview review={asset.review} />
                    </a>
                  ))}
                </nav>
              </PanelBody>
            </Panel>
          ))}
        </section>
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
  const [selectedAssetIds, setSelectedAssetIds] = useState<ReadonlySet<string>>(
    new Set(),
  )
  const [selectedCaptureSetIds, setSelectedCaptureSetIds] = useState<
    ReadonlySet<string>
  >(new Set())
  const [projectName, setProjectName] = useState('New Processing Project')
  const [destination, setDestination] = useState('new')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string>()
  const projects = props.processProjects ?? []
  const toggle = (
    update: (value: ReadonlySet<string>) => void,
    values: ReadonlySet<string>,
    value: string,
  ) => {
    const next = new Set(values)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    update(next)
  }
  const disabled =
    phone ||
    props.projection.shell.membership !== 'Owner member' ||
    props.projection.shell.control.readOnly ||
    pending
  const submitDisabled =
    disabled ||
    selectedAssetIds.size + selectedCaptureSetIds.size === 0 ||
    (destination === 'new' && projectName.trim() === '')
  const denial =
    props.projection.shell.membership !== 'Owner member'
      ? 'Owner membership is required for Project intake.'
      : props.projection.shell.control.readOnly
        ? 'Project intake requires a mutation-capable desktop.'
        : selectedAssetIds.size + selectedCaptureSetIds.size === 0
          ? 'Select at least one Asset or Capture Set.'
          : undefined
  const intake: LibraryIntake = {
    selectedAssetIds,
    selectedCaptureSetIds,
    projects,
    projectName,
    destination,
    pending,
    disabled,
    ...(denial === undefined ? {} : { denial }),
    ...(message === undefined ? {} : { message }),
    setProjectName,
    setDestination,
    toggleAsset: (assetId) =>
      !disabled && toggle(setSelectedAssetIds, selectedAssetIds, assetId),
    toggleCaptureSet: (captureSetId) =>
      !disabled &&
      toggle(setSelectedCaptureSetIds, selectedCaptureSetIds, captureSetId),
    submit: () => {
      if (submitDisabled) return
      const project = projects.find(
        (candidate) => candidate.projectId === destination,
      )
      setPending(true)
      setMessage(undefined)
      const selection = {
        assetIds: [...selectedAssetIds].map((assetId) => AssetId.make(assetId)),
        captureSetIds: [...selectedCaptureSetIds].map((captureSetId) =>
          CaptureSetId.make(captureSetId),
        ),
      }
      const accepted =
        destination === 'new'
          ? (props.onCreateProject?.(projectName.trim(), selection) ??
            Promise.reject(new Error('Project intake unavailable')))
          : project === undefined
            ? Promise.reject(new Error('Project unavailable'))
            : (props.onAddProjectSources?.(
                project.projectId,
                project.revision,
                selection,
              ) ?? Promise.reject(new Error('Project intake unavailable')))
      void accepted
        .then(() => undefined)
        .catch(() => setMessage('The project intake was not accepted.'))
        .finally(() => setPending(false))
    },
  }
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
        submitControl={props.submitControl}
        allowControlAction={!phone}
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
        <BetaLibraryDesktop {...props} intake={intake} />
      )}
      <BetaLibraryStatusStrip projection={props.projection} />
    </div>
  )
}

export default BetaLibraryApp
