import { Schema } from 'effect'
import { LibraryAssetDetail } from '@astro-console/v2-contracts'
import type { StatusTone } from '../../presentation'
import { Status } from '../status'
import './style.css'

/** Sourced from the contract — a new availability state there is a type error here. */
export type AssetAvailability = Schema.Schema.Type<
  typeof LibraryAssetDetail
>['availability']

export function availabilityTone(availability: AssetAvailability): StatusTone {
  switch (availability) {
    case 'availableLocally':
    case 'published':
      return 'safe'
    case 'preparing':
    case 'expiring':
    case 'republishing':
    case 'temporarilyUnavailable':
      return 'attention'
    case 'failedPublication':
      return 'danger'
    case 'expired':
      return 'neutral'
  }
}

const labels: Record<AssetAvailability, string> = {
  availableLocally: 'available locally',
  preparing: 'preparing',
  published: 'published',
  expiring: 'expiring',
  expired: 'expired',
  republishing: 'republishing',
  temporarilyUnavailable: 'temporarily unavailable',
  failedPublication: 'publication failed',
}

export function availabilityLabel(availability: AssetAvailability): string {
  return labels[availability]
}

/** The lifecycle progression; an asset moves along it or off to a branch. */
const progression: readonly AssetAvailability[] = [
  'availableLocally',
  'preparing',
  'published',
  'expiring',
  'expired',
]
const branches: readonly AssetAvailability[] = [
  'republishing',
  'temporarilyUnavailable',
  'failedPublication',
]

/**
 * AvailabilityStrip — the full asset lifecycle, so "where is this asset"
 * never collapses to a binary. Top row is the progression; bottom row is
 * the failure branches. The current state is marked with text and tone.
 */
export function AvailabilityStrip({
  availability,
  className,
}: {
  availability: AssetAvailability
  className?: string
}) {
  const row = (states: readonly AssetAvailability[]) =>
    states.map((state, index) => {
      const status =
        state === availability ? (
          <Status tone={availabilityTone(state)}>{labels[state]}</Status>
        ) : (
          <span className="availability-strip__state">{labels[state]}</span>
        )
      return (
        <span key={state} className="availability-strip__step">
          {index > 0 ? <span aria-hidden="true">→&nbsp;</span> : null}
          {status}
        </span>
      )
    })
  return (
    <div
      className={`availability-strip${className ? ` ${className}` : ''}`}
      aria-label={`Availability: ${labels[availability]}`}
    >
      <div className="availability-strip__row">{row(progression)}</div>
      <div className="availability-strip__row">{row(branches)}</div>
    </div>
  )
}
