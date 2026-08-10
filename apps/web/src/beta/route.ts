const workspacePath =
  /^(?:\/?|\/plan\/?|\/observe\/?|\/library\/?|\/library\/assets\/[^/]+\/?|\/process\/?)$/

const currentSearch = () =>
  typeof location === 'undefined' ? '' : location.search

export function isNightbookWorkspaceLocation(pathname: string, search = '') {
  return (
    workspacePath.test(pathname) &&
    new URLSearchParams(search).get('ui') !== 'legacy'
  )
}

export function isLegacyWorkspaceLocation(pathname: string, search = '') {
  return (
    workspacePath.test(pathname) &&
    new URLSearchParams(search).get('ui') === 'legacy'
  )
}

export function isNightbookObserveLocation(pathname: string, search = '') {
  return (
    pathname === '/observe' && isNightbookWorkspaceLocation(pathname, search)
  )
}

export function isNightbookPlanLocation(pathname: string, search = '') {
  return (
    (pathname === '/' || pathname === '/plan') &&
    isNightbookWorkspaceLocation(pathname, search)
  )
}

export function isNightbookProcessLocation(pathname: string, search = '') {
  return (
    pathname === '/process' && isNightbookWorkspaceLocation(pathname, search)
  )
}

const routeHref = (
  path: string,
  search: string,
  presentation: 'nightbook' | 'legacy',
) => {
  const separator = path.indexOf('?')
  const pathname = separator < 0 ? path : path.slice(0, separator)
  const routeSearch = separator < 0 ? '' : path.slice(separator + 1)
  const parameters = new URLSearchParams(search)
  parameters.delete('ui')
  parameters.delete('sourceAssetId')
  new URLSearchParams(routeSearch).forEach((value, key) =>
    parameters.set(key, value),
  )
  if (presentation === 'legacy') parameters.set('ui', 'legacy')
  const query = parameters.toString()
  return query.length === 0 ? pathname : `${pathname}?${query}`
}

export function nightbookHref(path: string, search = currentSearch()) {
  return routeHref(path, search, 'nightbook')
}

export function legacyHref(path: string, search = currentSearch()) {
  return routeHref(path, search, 'legacy')
}
