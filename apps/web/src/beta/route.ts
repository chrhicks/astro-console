const betaPath =
  /^(?:\/plan\/?|\/observe\/?|\/library\/?|\/library\/assets\/[^/]+\/?|\/process\/?)$/

export function isBetaWorkspaceLocation(pathname: string, search = '') {
  return (
    betaPath.test(pathname) && new URLSearchParams(search).get('ui') === 'beta'
  )
}

export function isBetaObserveLocation(pathname: string, search = '') {
  return pathname === '/observe' && isBetaWorkspaceLocation(pathname, search)
}

export function isBetaPlanLocation(pathname: string, search = '') {
  return pathname === '/plan' && isBetaWorkspaceLocation(pathname, search)
}

export function isBetaProcessLocation(pathname: string, search = '') {
  return pathname === '/process' && isBetaWorkspaceLocation(pathname, search)
}
