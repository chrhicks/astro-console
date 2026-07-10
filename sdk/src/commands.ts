import type {
  JsonRpcResponse,
  AlbumsResult,
  AlbumFile,
  EquCoord,
  HorizCoord,
  DeviceState,
  ViewStateResult,
} from './types.js'

/**
 * Typed command wrappers over raw JSON-RPC responses.
 */
export function parseAlbums(resp: JsonRpcResponse): AlbumsResult | null {
  if (typeof resp.result !== 'object' || resp.result === null) return null
  const r = resp.result as Record<string, unknown>
  return {
    path: typeof r.path === 'string' ? r.path : '',
    list: Array.isArray(r.list)
      ? r.list.map((entry: unknown) => {
          const e = asRecord(entry)
          return {
            groupName:
              typeof e?.group_name === 'string' ? e.group_name : undefined,
            type: typeof e?.type === 'string' ? e.type : undefined,
            name: typeof e?.name === 'string' ? e.name : undefined,
            files: Array.isArray(e?.files)
              ? e.files.map((f: unknown) => {
                  const file = asRecord(f)
                  return {
                    name: typeof file?.name === 'string' ? file.name : '',
                    thn: typeof file?.thn === 'string' ? file.thn : '',
                    count:
                      typeof file?.count === 'number' ? file.count : undefined,
                    type:
                      typeof file?.type === 'number' ? file.type : undefined,
                  }
                })
              : [],
          }
        })
      : [],
  }
}

export function parseEquCoord(resp: JsonRpcResponse): EquCoord | null {
  if (typeof resp.result !== 'object' || resp.result === null) return null
  const r = resp.result as Record<string, unknown>
  if (typeof r.ra === 'number' && typeof r.dec === 'number') {
    return { ra: r.ra, dec: r.dec }
  }
  return null
}

export function parseHorizCoord(resp: JsonRpcResponse): HorizCoord | null {
  if (!Array.isArray(resp.result)) return null
  const [altitudeDeg, azimuthDeg] = resp.result
  if (typeof altitudeDeg === 'number' && typeof azimuthDeg === 'number') {
    return { altitudeDeg, azimuthDeg }
  }
  return null
}

export function parseDeviceState(resp: JsonRpcResponse): DeviceState | null {
  if (typeof resp.result !== 'object' || resp.result === null) return null
  return resp.result as DeviceState
}

export function parseViewState(resp: JsonRpcResponse): ViewStateResult | null {
  if (typeof resp.result !== 'object' || resp.result === null) return null
  const result = resp.result as Record<string, unknown>
  return { ...result, View: asRecord(result.View) }
}

/**
 * Build a full HTTP URL for an album asset given the album path, thumbnail path,
 * and host. If isThumb is false, the _thn suffix is removed and replaced with
 * the given extension (default .jpg). Use extension=.fit for FIT assets or
 * extension=.mp4 for timelapse videos.
 */
export function buildImageUrl(
  host: string,
  albumPath: string,
  thumbPath: string,
  isThumb = false,
  extension = '.jpg',
): string {
  const fullPath = isThumb
    ? thumbPath
    : thumbPath.replace('_thn.jpg', extension)
  return `http://${host}/${albumPath}/${fullPath}`
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}
