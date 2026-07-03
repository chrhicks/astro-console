import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { CatalogQuery } from '../../../../shared/api-v2'
import { electronApi } from '../../lib/electron-api'
import { useProjectionStore } from '../../state/projection-store'
import { selectBrowseContextKey } from '../../state/projection-selectors'

export function useBrowseTargetsQuery(query: CatalogQuery) {
  const contextKey = useProjectionStore(selectBrowseContextKey)
  return useQuery({
    queryKey: ['catalog', 'browse', query, contextKey],
    queryFn: () => electronApi.browseTargets(query),
    placeholderData: keepPreviousData,
    refetchInterval: 300_000,
  })
}
