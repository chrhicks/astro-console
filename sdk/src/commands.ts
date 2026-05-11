import type { JsonRpcResponse, AlbumsResult, AlbumFile, EquCoord, DeviceState, ViewStateResult } from "./types.js";

/**
 * Typed command wrappers over raw JSON-RPC responses.
 */
export function parseAlbums(resp: JsonRpcResponse): AlbumsResult | null {
  if (typeof resp.result !== "object" || resp.result === null) return null;
  const r = resp.result as Record<string, unknown>;
  return {
    path: String(r.path ?? ""),
    list: Array.isArray(r.list) ? r.list.map((entry: unknown) => {
      const e = entry as Record<string, unknown>;
      return {
        groupName: e.group_name ? String(e.group_name) : undefined,
        type: e.type ? String(e.type) : undefined,
        name: e.name ? String(e.name) : undefined,
        files: Array.isArray(e.files)
          ? e.files.map((f: unknown) => {
              const file = f as Record<string, unknown>;
              return {
                name: String(file.name ?? ""),
                thn: String(file.thn ?? ""),
                count: typeof file.count === "number" ? file.count : undefined,
                type: typeof file.type === "number" ? file.type : undefined,
              };
            })
          : [],
      };
    }) : [],
  };
}

export function parseEquCoord(resp: JsonRpcResponse): EquCoord | null {
  if (typeof resp.result !== "object" || resp.result === null) return null;
  const r = resp.result as Record<string, unknown>;
  if (typeof r.ra === "number" && typeof r.dec === "number") {
    return { ra: r.ra, dec: r.dec };
  }
  return null;
}

export function parseDeviceState(resp: JsonRpcResponse): DeviceState | null {
  if (typeof resp.result !== "object" || resp.result === null) return null;
  return resp.result as DeviceState;
}

export function parseViewState(resp: JsonRpcResponse): ViewStateResult | null {
  if (typeof resp.result !== "object" || resp.result === null) return null;
  return resp.result as ViewStateResult;
}

/**
 * Build a full HTTP URL for an album asset given the album path, thumbnail path,
 * and host. If isThumb is false, the _thn suffix is removed and replaced with
 * the given extension (default .jpg). Use extension=.mp4 for timelapse videos.
 */
export function buildImageUrl(
  host: string,
  albumPath: string,
  thumbPath: string,
  isThumb = false,
  extension = ".jpg"
): string {
  const fullPath = isThumb
    ? thumbPath
    : thumbPath.replace("_thn.jpg", extension);
  return `http://${host}/${albumPath}/${fullPath}`;
}
