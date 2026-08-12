export function nightbookHref(path: string) {
  const separator = path.indexOf('?')
  const pathname = separator < 0 ? path : path.slice(0, separator)
  const routeSearch = separator < 0 ? '' : path.slice(separator + 1)
  const parameters = new URLSearchParams(routeSearch)
  const query = parameters.toString()
  return query.length === 0 ? pathname : `${pathname}?${query}`
}
