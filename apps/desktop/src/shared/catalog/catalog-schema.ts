export type OpenNgcObjectType =
  | 'G' // Galaxy
  | 'GPair' // Galaxy pair
  | 'GTrpl' // Galaxy triplet
  | 'GGroup' // Group of galaxies
  | 'OCl' // Open cluster
  | 'GCl' // Globular cluster
  | 'Cl+N' // Cluster + nebula
  | 'PN' // Planetary nebula
  | 'HII' // HII region
  | 'Neb' // Nebula
  | 'EmN' // Emission nebula
  | 'RfN' // Reflection nebula
  | 'DrkN' // Dark nebula
  | 'SNR' // Supernova remnant
  | '*Ass' // Association of stars
  | 'Nova' // Nova / nova remnant
  | 'Other' // Other classification

export type SeestarViewMode = 'star' | 'moon' | 'sun' | 'planet' | 'scenery'
export type FilterPosition = 'clear' | 'ir' | 'lp'

export interface DeepSkyTarget {
  id: string // e.g. "ngc:1976" or "messier:m42"
  designation: string // primary display designation: "M42" (Messier priority) or "NGC 7000"
  commonName?: string // "Orion Nebula"
  alternativeDesignations: string[] // ["NGC 1976", "Orion Nebula", ...] for search
  messierNumber?: string // "42" — separate for search priority and display
  objectType: OpenNgcObjectType // raw OpenNGC type
  viewMode: SeestarViewMode // always 'star' for DSOs; determined at import
  raHours: number // J2000 RA in hours
  decDeg: number // J2000 Dec in degrees
  visualMagnitude?: number // V-Mag (visual band)
  blueMagnitude?: number // B-Mag when available
  surfaceBrightness?: number // mag/arcsec² for galaxies
  majorAxisArcmin?: number // angular extent
  minorAxisArcmin?: number // angular extent
  constellation: string // "Ori" — always present from OpenNGC
  recommendedFilter: FilterPosition // derived from objectType at import
  source: 'openngc' | 'manual'
}

export type SolarSystemBody =
  | 'sun'
  | 'moon'
  | 'mercury'
  | 'venus'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'

export interface SolarSystemTarget {
  id: string // "sun", "moon", "planet:jupiter"
  designation: string // "Sun", "Moon", "Jupiter"
  body: SolarSystemBody // maps to astronomy-engine Body enum
  viewMode: SeestarViewMode // 'sun' | 'moon' | 'planet'
  recommendedFilter: FilterPosition | null // Sun → 'ir', others → 'clear'
  source: 'solar-system'
}

export type TargetAction = 'slew' | 'stack' | 'preview' | 'filter'

export interface TargetSummary {
  id: string
  short: string // "M42" or "Jupiter"
  name: string // "Orion Nebula" or "Jupiter"
  visibility?: 'up' | 'later' | 'blocked'
  visibilityLabel?: string // "Up now", "Later tonight", "Below horizon"
  recommendedFilter: FilterPosition | null // null if device has no filter wheel
  type: 'dso' | 'planet' | 'moon' | 'sun'
  availableActions: TargetAction[] // device-capability-dependent
}

export interface CatalogQuery {
  search?: string
  upNowOnly?: boolean
  typeFilter?: SeestarViewMode | 'dso' // 'dso' = all deep sky, 'star' = DSOs, etc.
  offset?: number
  limit?: number
}

export interface CatalogPage {
  targets: TargetSummary[]
  total: number
  offset: number
  limit: number
  visibilityAvailable: boolean
}
