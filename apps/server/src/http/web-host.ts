import { readFileSync, realpathSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import type { ServerResponse } from 'node:http'
import { Context, Effect, Layer } from 'effect'

export interface WebHostShape {
  readonly asset: (
    response: ServerResponse,
    pathname: string,
    headers: (
      contentType: string,
      cacheControl?: string,
    ) => Record<string, string>,
  ) => Effect.Effect<boolean>
  readonly route: (
    response: ServerResponse,
    pathname: string,
    headers: (
      contentType: string,
      cacheControl?: string,
    ) => Record<string, string>,
  ) => Effect.Effect<boolean>
}

export class WebHost extends Context.Service<WebHost, WebHostShape>()(
  '@astro-console/server/WebHost',
) {}

export const webHostLayer = (rootPath: string) =>
  Layer.sync(WebHost, () => {
    const file = (pathname: string) => {
      try {
        const decoded = decodeURIComponent(pathname)
        if (decoded.split('/').some((part) => part === '.' || part === '..'))
          return undefined
        const root = realpathSync(rootPath)
        const candidate = resolve(root, `.${decoded}`)
        if (relative(root, candidate).startsWith('..')) return undefined
        const resolved = realpathSync(candidate)
        return relative(root, resolved).startsWith('..') ? undefined : resolved
      } catch {
        return undefined
      }
    }
    const asset = Effect.fn('WebHost.asset')(function* (
      response: ServerResponse,
      pathname: string,
      headers: (
        contentType: string,
        cacheControl?: string,
      ) => Record<string, string>,
    ) {
      const resolved = file(pathname)
      if (resolved === undefined) return false
      const contentType = webContentType(resolved)
      if (contentType === undefined) return false
      try {
        response
          .writeHead(
            200,
            headers(
              contentType,
              /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(pathname)
                ? 'public, max-age=31536000, immutable'
                : 'no-store',
            ),
          )
          .end(readFileSync(resolved))
        return true
      } catch {
        return false
      }
    })
    const route = Effect.fn('WebHost.route')(function* (
      response: ServerResponse,
      pathname: string,
      headers: (
        contentType: string,
        cacheControl?: string,
      ) => Record<string, string>,
    ) {
      if (!webRoute(pathname)) return false
      const index = file('/index.html')
      if (index === undefined) return false
      try {
        response
          .writeHead(200, headers('text/html; charset=utf-8', 'no-store'))
          .end(readFileSync(index))
        return true
      } catch {
        return false
      }
    })
    return WebHost.of({ asset, route })
  })

function webRoute(pathname: string) {
  return (
    pathname === '/' ||
    /^\/(?:plan|observe|library|process)$/.test(pathname) ||
    /^\/library\/assets\/[^/]+$/.test(pathname) ||
    /^\/process\/projects\/[^/]+$/.test(pathname)
  )
}

function webContentType(path: string) {
  switch (extname(path)) {
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
  }
}
