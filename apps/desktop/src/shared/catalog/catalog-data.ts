import { Schema } from 'effect'
import catalogData from './catalog-data.json'
import { SOLAR_SYSTEM_TARGETS } from './catalog-constants'
import type { DeepSkyTarget } from './catalog-schema'

const DeepSkyTargetSchema = Schema.Struct({
  id: Schema.String,
  designation: Schema.String,
  commonName: Schema.optional(Schema.String),
  alternativeDesignations: Schema.mutable(Schema.Array(Schema.String)),
  messierNumber: Schema.optional(Schema.String),
  objectType: Schema.Literal(
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
  ),
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
  source: Schema.Literal('openngc', 'manual'),
})

export const DEEP_SKY_TARGETS: DeepSkyTarget[] = Schema.decodeUnknownSync(
  Schema.mutable(Schema.Array(DeepSkyTargetSchema)),
)(catalogData)

export { SOLAR_SYSTEM_TARGETS }
