import { useDeferredValue, useEffect, useState } from 'react'
import type { TargetSummary } from '../../../../shared/api-v2'
import { useProjectionStore } from '../../state/projection-store'
import { selectCurrentTargetId } from '../../state/projection-selectors'
import {
  setSelectedTarget,
  useSelectedTarget,
} from '../../state/selected-target-store'
import { useBrowseTargetsQuery } from './use-browse-targets-query'
import './targets-panel.css'

const VISIBILITY_LABELS: Record<
  NonNullable<TargetSummary['visibility']>,
  string
> = {
  up: 'Up now',
  later: 'Later',
  blocked: 'Blocked',
}

export default function TargetsPanel() {
  const [search, setSearch] = useState('')
  const [upNowOnly, setUpNowOnly] = useState(false)
  const deferredSearch = useDeferredValue(search)

  const { data, isPending, isError, error } = useBrowseTargetsQuery({
    search: deferredSearch,
    upNowOnly,
  })

  const targets = data?.targets ?? []
  const visibilityAvailable = data?.visibilityAvailable ?? false

  useEffect(() => {
    if (!visibilityAvailable && upNowOnly) {
      setUpNowOnly(false)
    }
  }, [upNowOnly, visibilityAvailable])

  const selectedTargetId = useSelectedTarget(
    (state) => state.target?.id ?? null,
  )
  const currentTargetId = useProjectionStore(selectCurrentTargetId)

  return (
    <div>
      <div className="panel-header targets-panel-header">
        <span>Targets</span>
        {data ? <span className="targets-count">{data.total}</span> : null}
        <span className="spacer"></span>
        <button
          type="button"
          className="btn btn-sm icon-btn"
          id="collapseLeft"
          title="Collapse panel"
          disabled
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
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        <button
          type="button"
          className="btn btn-sm icon-btn"
          id="btnFavorites"
          title="Favorites only"
          disabled
        >
          ★
        </button>
        <button
          type="button"
          className={`btn btn-sm${upNowOnly ? ' primary' : ''}`}
          id="btnUpNow"
          title="Up now only"
          disabled={!visibilityAvailable}
          aria-pressed={upNowOnly}
          onClick={() => setUpNowOnly((current) => !current)}
        >
          Up now
        </button>
      </div>
      <div className="panel-body targets-panel-body" id="targetList">
        {isPending ? (
          <div className="targets-status">Loading…</div>
        ) : isError ? (
          <div className="targets-status targets-status-error">
            {error?.message ?? 'Failed to load targets'}
          </div>
        ) : targets.length === 0 ? (
          <div className="empty-targets">No targets match.</div>
        ) : (
          targets.map((target) => (
            <TargetRow
              key={target.id}
              target={target}
              selected={target.id === selectedTargetId}
              current={target.id === currentTargetId}
            />
          ))
        )}
      </div>
    </div>
  )
}

function TargetRow({
  target,
  selected,
  current,
}: {
  target: TargetSummary
  selected: boolean
  current: boolean
}) {
  const className = [
    'target-row',
    selected ? 'selected' : '',
    current ? 'current' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={className}
      onClick={() => setSelectedTarget(target)}
      aria-pressed={selected}
    >
      <span>
        <span className="id">{target.short}</span>
        <span className="sub">{target.name}</span>
      </span>
      {current ? (
        <span className="target-current-mark" title="Hardware target">
          ●
        </span>
      ) : null}
      {target.visibility ? (
        <span className={`badge ${target.visibility}`}>
          {target.visibilityLabel ?? VISIBILITY_LABELS[target.visibility]}
        </span>
      ) : null}
    </button>
  )
}
