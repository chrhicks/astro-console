import catalogData from './catalog-data.json'
import { SOLAR_SYSTEM_TARGETS } from './catalog-constants'
import type { DeepSkyTarget } from './catalog-schema'

export const DEEP_SKY_TARGETS = catalogData as DeepSkyTarget[]

export { SOLAR_SYSTEM_TARGETS }
