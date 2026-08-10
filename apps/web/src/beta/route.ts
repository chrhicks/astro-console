const currentSearch = () =>
  typeof location === 'undefined' ? '' : location.search

const routeHref = (path: string, search: string) => {
  const separator = path.indexOf('?')
  const pathname = separator < 0 ? path : path.slice(0, separator)
  const routeSearch = separator < 0 ? '' : path.slice(separator + 1)
  const parameters = new URLSearchParams(search)
  parameters.delete('ui')
  parameters.delete('sourceAssetId')
  new URLSearchParams(routeSearch).forEach((value, key) =>
    parameters.set(key, value),
  )
  const query = parameters.toString()
  return query.length === 0 ? pathname : `${pathname}?${query}`
}

export function nightbookHref(path: string, search = currentSearch()) {
  return routeHref(path, search)
}
