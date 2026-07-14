import { Context, Effect } from 'effect'
import type {
  CatalogPage,
  CatalogQuery,
  DeepSkyTarget,
  SolarSystemTarget,
  TargetSummary,
} from '../../../shared/catalog/catalog-schema'
import type { TargetDetails } from '../../../shared/api-v2'

export interface CatalogStore {
  readonly browse: (query: CatalogQuery) => Effect.Effect<CatalogPage>
  readonly getById: (
    targetId: string,
  ) => Effect.Effect<DeepSkyTarget | SolarSystemTarget | null>
  readonly getDetailsById: (
    targetId: string,
  ) => Effect.Effect<TargetDetails | null>
  readonly getSummaryById: (
    targetId: string,
  ) => Effect.Effect<TargetSummary | null>
}

export const CatalogStore = Context.Service<CatalogStore>('CatalogStore')
