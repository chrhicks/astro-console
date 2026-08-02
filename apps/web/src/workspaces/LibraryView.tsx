import { useState } from 'react'
import type { LibraryView as View } from '../presentation'
import type { Route } from '../routes'
import { Evidence, Status } from './shared'

export function LibraryView({
  view,
  assetId,
  link,
}: {
  view: View
  assetId: string | undefined
  link: (route: Exclude<Route, { kind: 'not-found' }>) => {
    href: string
    onClick: React.MouseEventHandler<HTMLAnchorElement>
  }
}) {
  const requestedIndex = view.assets.findIndex((asset) => asset.id === assetId)
  const [selected, setSelected] = useState(Math.max(0, requestedIndex))
  const selectedIndex = requestedIndex === -1 ? selected : requestedIndex
  const asset = view.assets[selectedIndex]
  return (
    <div className="workspace library-workspace">
      <header className="workspace-heading">
        <div>
          <span>Library / 25 July / M31</span>
          <h1 tabIndex={-1}>Durable evidence</h1>
        </div>
      </header>
      <aside className="library-lineage">
        <span>Relationship</span>
        <b>{asset?.lineage.split(' → ')[0]}</b>
        <small>{asset?.lineage.split(' → ')[1]}</small>
        <small>{asset?.lineage.split(' → ')[2]}</small>
        <p>Originals are immutable. Related saved outputs are peers.</p>
      </aside>
      <section className="frame-grid" aria-label="Evidence frames">
        <div className="frame-grid__heading">
          <span>Capture chronology</span>
          <small>Peer originals / select to compare</small>
        </div>
        {view.assets.map((item, index) => (
          <a
            key={item.id}
            data-selected={selectedIndex === index}
            {...link({ kind: 'asset', assetId: item.id })}
            onClick={(event) => {
              setSelected(index)
              link({ kind: 'asset', assetId: item.id }).onClick(event)
            }}
          >
            <Evidence label={item.name} />
            <b>{item.name}</b>
            <small>{item.review}</small>
          </a>
        ))}
      </section>
      <aside className="library-inspector">
        {asset && (
          <Evidence
            label={`Selected ${asset.name}`}
            variant={asset.review === 'Accepted' ? 'andromeda' : 'nebula'}
          />
        )}
        <Status tone={asset?.review === 'Accepted' ? 'safe' : 'danger'}>
          {asset?.review ?? 'Unavailable'}
        </Status>
        <h2>{asset?.name}</h2>
        <p>{asset?.representation}</p>
        <dl>
          <div>
            <dt>Stable asset</dt>
            <dd>{asset?.id}</dd>
          </div>
          <div>
            <dt>Download authorization</dt>
            <dd>{asset?.download}</dd>
          </div>
        </dl>
        <p className="action-result">
          Read-only monitoring. Durable local evidence is protected.
        </p>
      </aside>
    </div>
  )
}
