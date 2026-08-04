import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LocalIdentity, RequestAdmission } from '../auth/identity.ts'

type RouteResult = void | ServerResponse | Promise<void | ServerResponse>

export type OriginRouterDependencies = {
  readonly identityResolver: RequestAdmission
  readonly expireReconnectGrace: () => void
  readonly live: (response: ServerResponse) => RouteResult
  readonly unauthenticated: (
    response: ServerResponse,
    method: string,
    pathname: string,
  ) => RouteResult
  readonly snapshot: (
    response: ServerResponse,
    identity: LocalIdentity,
  ) => RouteResult
  readonly ready: (response: ServerResponse) => RouteResult
  readonly operations: (
    response: ServerResponse,
    identity: LocalIdentity,
  ) => RouteResult
  readonly events: (
    request: IncomingMessage,
    response: ServerResponse,
    identity: LocalIdentity,
  ) => RouteResult
  readonly control: (
    response: ServerResponse,
    identity: LocalIdentity,
    request: IncomingMessage,
  ) => RouteResult
  readonly planWorkspace: (response: ServerResponse) => RouteResult
  readonly processWorkspace: (response: ServerResponse, url: URL) => RouteResult
  readonly libraryPage: (response: ServerResponse, url: URL) => RouteResult
  readonly libraryDownload: (response: ServerResponse, url: URL) => RouteResult
  readonly libraryDetail: (
    response: ServerResponse,
    encodedAssetId: string,
  ) => RouteResult
  readonly planCommand: (
    response: ServerResponse,
    identity: LocalIdentity,
    request: IncomingMessage,
  ) => RouteResult
  readonly observeCommand: (
    response: ServerResponse,
    identity: LocalIdentity,
    request: IncomingMessage,
  ) => RouteResult
  readonly refreshPreflight: (
    response: ServerResponse,
    identity: LocalIdentity,
    request: IncomingMessage,
  ) => RouteResult
  readonly polarCommand: (
    response: ServerResponse,
    identity: LocalIdentity,
    request: IncomingMessage,
  ) => RouteResult
  readonly webAsset: (response: ServerResponse, pathname: string) => boolean
  readonly webRoute: (response: ServerResponse, pathname: string) => boolean
  readonly apiNotFound: (response: ServerResponse) => RouteResult
  readonly notFound: (response: ServerResponse) => RouteResult
}

export const createOriginRouter =
  (dependencies: OriginRouterDependencies) =>
  async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://local')
    if (request.method === 'GET' && url.pathname === '/health/live')
      return dependencies.live(response)
    dependencies.expireReconnectGrace()
    const identity = await dependencies.identityResolver(request)
    if (identity === undefined)
      return dependencies.unauthenticated(
        response,
        request.method ?? 'GET',
        url.pathname,
      )
    if (request.method === 'GET' && url.pathname === '/api/snapshot')
      return dependencies.snapshot(response, identity)
    if (request.method === 'GET' && url.pathname === '/api/health/ready')
      return dependencies.ready(response)
    if (request.method === 'GET' && url.pathname === '/api/health/operations')
      return dependencies.operations(response, identity)
    if (request.method === 'GET' && url.pathname === '/api/events')
      return dependencies.events(request, response, identity)
    if (request.method === 'POST' && url.pathname === '/api/commands/control')
      return dependencies.control(response, identity, request)
    if (request.method === 'GET' && url.pathname === '/api/workspaces/plan')
      return dependencies.planWorkspace(response)
    if (request.method === 'GET' && url.pathname === '/api/workspaces/process')
      return dependencies.processWorkspace(response, url)
    if (request.method === 'GET' && url.pathname === '/api/library')
      return dependencies.libraryPage(response, url)
    if (
      request.method === 'GET' &&
      url.pathname.startsWith('/api/library/assets/') &&
      url.pathname.endsWith('/download')
    )
      return dependencies.libraryDownload(response, url)
    if (
      request.method === 'GET' &&
      url.pathname.startsWith('/api/library/assets/')
    )
      return dependencies.libraryDetail(
        response,
        url.pathname.slice('/api/library/assets/'.length),
      )
    if (request.method === 'POST' && url.pathname === '/api/plan/commands')
      return dependencies.planCommand(response, identity, request)
    if (request.method === 'POST' && url.pathname === '/api/observe/commands')
      return dependencies.observeCommand(response, identity, request)
    if (request.method === 'POST' && url.pathname === '/api/observe/preflight')
      return dependencies.refreshPreflight(response, identity, request)
    if (request.method === 'POST' && url.pathname === '/api/acquire/commands')
      return dependencies.polarCommand(response, identity, request)
    if (
      request.method === 'GET' &&
      dependencies.webAsset(response, url.pathname)
    )
      return
    if (
      request.method === 'GET' &&
      dependencies.webRoute(response, url.pathname)
    )
      return
    if (url.pathname.startsWith('/api/'))
      return dependencies.apiNotFound(response)
    return dependencies.notFound(response)
  }
