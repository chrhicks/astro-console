import { Schema } from 'effect'
import type {
  DeepSkyTarget,
  FilterPosition,
  OpenNgcObjectType,
} from '../src/shared/catalog/catalog-schema.js'
import type { OpenNgcRow } from './import-openngc-parse.js'

export const OPENNGC_PROVENANCE = {
  upstreamRepo: 'mattiaverga/OpenNGC',
  attributionName: 'Mattia Verga',
  projectUrl: 'https://github.com/mattiaverga/OpenNGC',
  doi: '10.21938/y.1ejWUD_MQ6b_eDFoVbbw',
  license: 'CC-BY-SA-4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  snapshot: 'checked-in CSV snapshot',
  files: [
    {
      path: 'apps/desktop/scripts/ngc/raw/NGC.csv',
      sha256:
        '840fe0c9ee1332e551b2e722a0e92726cd7b157914a3d2177602832aadd3aa9e',
    },
    {
      path: 'apps/desktop/scripts/ngc/raw/addendum.csv',
      sha256:
        '1d8f0914e643ada325a5a94d88d8fefad6a4937a2f77cc34f21483af22b11983',
    },
  ],
} as const

const EXCLUDED_TYPES = new Set(['NonEx', 'Dup', '*', '**'])

const OBJECT_TYPE_MAPPING: Record<
  OpenNgcObjectType,
  { targetType: 'dso'; recommendedFilter: FilterPosition }
> = {
  G: { targetType: 'dso', recommendedFilter: 'clear' },
  GPair: { targetType: 'dso', recommendedFilter: 'clear' },
  GTrpl: { targetType: 'dso', recommendedFilter: 'clear' },
  GGroup: { targetType: 'dso', recommendedFilter: 'clear' },
  OCl: { targetType: 'dso', recommendedFilter: 'clear' },
  GCl: { targetType: 'dso', recommendedFilter: 'clear' },
  'Cl+N': { targetType: 'dso', recommendedFilter: 'lp' },
  PN: { targetType: 'dso', recommendedFilter: 'lp' },
  HII: { targetType: 'dso', recommendedFilter: 'lp' },
  Neb: { targetType: 'dso', recommendedFilter: 'lp' },
  EmN: { targetType: 'dso', recommendedFilter: 'lp' },
  RfN: { targetType: 'dso', recommendedFilter: 'lp' },
  DrkN: { targetType: 'dso', recommendedFilter: 'clear' },
  SNR: { targetType: 'dso', recommendedFilter: 'lp' },
  '*Ass': { targetType: 'dso', recommendedFilter: 'clear' },
  Nova: { targetType: 'dso', recommendedFilter: 'clear' },
  Other: { targetType: 'dso', recommendedFilter: 'clear' },
}

const OpenNgcObjectTypeSchema = Schema.Literal(
  'G',
  'GPair',
  'GTrpl',
  'GGroup',
  'OCl',
  'GCl',
  'Cl+N',
  'PN',
  'HII',
  'Neb',
  'EmN',
  'RfN',
  'DrkN',
  'SNR',
  '*Ass',
  'Nova',
  'Other',
)

export const DeepSkyTargetSchema = Schema.Struct({
  id: Schema.String,
  designation: Schema.String,
  commonName: Schema.optional(Schema.String),
  alternativeDesignations: Schema.Array(Schema.String),
  messierNumber: Schema.optional(Schema.String),
  objectType: OpenNgcObjectTypeSchema,
  targetType: Schema.Literal('dso'),
  raHours: Schema.Number,
  decDeg: Schema.Number,
  visualMagnitude: Schema.optional(Schema.Number),
  blueMagnitude: Schema.optional(Schema.Number),
  surfaceBrightness: Schema.optional(Schema.Number),
  majorAxisArcmin: Schema.optional(Schema.Number),
  minorAxisArcmin: Schema.optional(Schema.Number),
  constellation: Schema.String,
  recommendedFilter: Schema.Literal('clear', 'ir', 'lp'),
  source: Schema.Literal('openngc'),
})

type DeepSkyTargetInput = Schema.Schema.Type<typeof DeepSkyTargetSchema>

export class ImportTransformError extends Error {
  readonly _tag = 'ImportTransformError'

  constructor(message: string) {
    super(message)
    this.name = 'ImportTransformError'
  }
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function parseSexagesimal(value: string): number {
  const parts = value.split(':').map(Number)
  if (parts.some((part) => Number.isNaN(part))) {
    throw new ImportTransformError(`Invalid sexagesimal value: ${value}`)
  }

  const [first, second = 0, third = 0] = parts
  return first + second / 60 + third / 3600
}

export function parseRaHours(ra: string): number {
  return round(parseSexagesimal(ra), 8)
}

export function parseDecDegrees(dec: string): number {
  const sign = dec.startsWith('-') ? -1 : 1
  const unsigned = dec.replace(/^[+-]/, '')
  return round(sign * parseSexagesimal(unsigned), 8)
}

function normalizeMessierNumber(value: string): string {
  return String(parseInt(value, 10))
}

function formatMessierDesignation(value: string): string {
  return `M${normalizeMessierNumber(value)}`
}

function formatCatalogNumber(prefix: 'NGC' | 'IC', value: string): string {
  return `${prefix} ${parseInt(value, 10)}`
}

function formatNgcIcDesignation(name: string): string | null {
  const ngc = name.match(/^NGC(\d+)$/i)
  if (ngc) {
    return formatCatalogNumber('NGC', ngc[1])
  }

  const ic = name.match(/^IC(\d+)$/i)
  if (ic) {
    return formatCatalogNumber('IC', ic[1])
  }

  return null
}

function parseCatalogId(name: string): string | null {
  const ngc = name.match(/^NGC(\d+)$/i)
  if (ngc) {
    return `ngc:${parseInt(ngc[1], 10)}`
  }

  const ic = name.match(/^IC(\d+)$/i)
  if (ic) {
    return `ic:${parseInt(ic[1], 10)}`
  }

  return null
}

function splitCommaList(value: string | undefined): string[] {
  if (!value) {
    return []
  }

  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function uniqueDesignations(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const key = value.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(value)
  }

  return result
}

function isOpenNgcObjectType(type: string): type is OpenNgcObjectType {
  return Object.hasOwn(OBJECT_TYPE_MAPPING, type)
}

function mapObjectType(type: string, rowName: string): OpenNgcObjectType {
  if (isOpenNgcObjectType(type)) {
    return type
  }

  throw new ImportTransformError(
    `Unsupported OpenNGC Type \"${type}\" for ${rowName}`,
  )
}

function buildTargetId(row: OpenNgcRow): string {
  if (row.M) {
    return `messier:m${normalizeMessierNumber(row.M)}`
  }

  const fromName = parseCatalogId(row.Name)
  if (fromName) {
    return fromName
  }

  return `openngc:${row.Name.toLowerCase()}`
}

function buildDesignation(row: OpenNgcRow): string {
  if (row.M) {
    return formatMessierDesignation(row.M)
  }

  const fromName = formatNgcIcDesignation(row.Name)
  if (fromName) {
    return fromName
  }

  const commonNames = splitCommaList(row['Common names'])
  if (commonNames.length > 0) {
    return commonNames[0]
  }

  return row.Name
}

function buildAlternativeDesignations(
  row: OpenNgcRow,
  designation: string,
): string[] {
  const values: string[] = []

  const catalogDesignation = formatNgcIcDesignation(row.Name)
  if (catalogDesignation) {
    values.push(catalogDesignation)
  } else if (row.Name !== designation) {
    values.push(row.Name)
  }

  if (row.M) {
    values.push(formatMessierDesignation(row.M))
  }

  if (row.NGC) {
    values.push(formatCatalogNumber('NGC', row.NGC))
  }

  if (row.IC) {
    values.push(formatCatalogNumber('IC', row.IC))
  }

  values.push(...splitCommaList(row['Common names']))

  return uniqueDesignations(values).filter((value) => value !== designation)
}

function buildCommonName(
  row: OpenNgcRow,
  designation: string,
): string | undefined {
  const commonNames = splitCommaList(row['Common names'])
  const preferred = commonNames.find((name) => name !== designation)
  return preferred
}

export function shouldIncludeRow(row: OpenNgcRow): boolean {
  return !EXCLUDED_TYPES.has(row.Type)
}

export function transformRow(row: OpenNgcRow): DeepSkyTarget {
  if (!shouldIncludeRow(row)) {
    throw new ImportTransformError(
      `Attempted to transform excluded row: ${row.Name}`,
    )
  }

  const objectType = mapObjectType(row.Type, row.Name)
  const mapping = OBJECT_TYPE_MAPPING[objectType]
  const designation = buildDesignation(row)
  const commonName = buildCommonName(row, designation)
  const alternativeDesignations = buildAlternativeDesignations(
    row,
    designation,
  ).filter((value) => value !== commonName)

  const target: DeepSkyTargetInput = {
    id: buildTargetId(row),
    designation,
    alternativeDesignations,
    objectType,
    targetType: mapping.targetType,
    raHours: parseRaHours(row.RA),
    decDeg: parseDecDegrees(row.Dec),
    constellation: row.Const,
    recommendedFilter: mapping.recommendedFilter,
    source: 'openngc',
    ...(commonName ? { commonName } : {}),
    ...(row.M ? { messierNumber: normalizeMessierNumber(row.M) } : {}),
    ...(row['V-Mag'] !== undefined ? { visualMagnitude: row['V-Mag'] } : {}),
    ...(row['B-Mag'] !== undefined ? { blueMagnitude: row['B-Mag'] } : {}),
    ...(row.SurfBr !== undefined ? { surfaceBrightness: row.SurfBr } : {}),
    ...(row.MajAx !== undefined ? { majorAxisArcmin: row.MajAx } : {}),
    ...(row.MinAx !== undefined ? { minorAxisArcmin: row.MinAx } : {}),
  }

  const decoded = Schema.decodeSync(DeepSkyTargetSchema)(target)

  return {
    ...decoded,
    alternativeDesignations: [...decoded.alternativeDesignations],
  }
}

export function transformRows(rows: OpenNgcRow[]): DeepSkyTarget[] {
  const targets: DeepSkyTarget[] = []

  for (const row of rows) {
    if (!shouldIncludeRow(row)) {
      continue
    }

    targets.push(transformRow(row))
  }

  return targets
}

export function mergeCatalog(
  ngcTargets: DeepSkyTarget[],
  addendumTargets: DeepSkyTarget[],
): DeepSkyTarget[] {
  const byId = new Map<string, DeepSkyTarget>()

  for (const target of ngcTargets) {
    byId.set(target.id, target)
  }

  for (const target of addendumTargets) {
    if (!byId.has(target.id)) {
      byId.set(target.id, target)
    }
  }

  return [...byId.values()].sort((left, right) => {
    const byDesignation = left.designation.localeCompare(
      right.designation,
      'en',
      {
        numeric: true,
        sensitivity: 'base',
      },
    )

    if (byDesignation !== 0) {
      return byDesignation
    }

    return left.id.localeCompare(right.id, 'en', {
      numeric: true,
      sensitivity: 'base',
    })
  })
}
