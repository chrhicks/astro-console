import { Schema } from 'effect'
import { ObserveLiveFrameReview } from '@astro-console/v2-contracts'

export type LiveFrameReview = Schema.Schema.Type<typeof ObserveLiveFrameReview>

/** Reads one current Library-backed frame. It never loads the Library catalog. */
export async function loadLiveFrameReview(
  request: typeof fetch = fetch,
): Promise<LiveFrameReview> {
  const response = await request('/api/observe/live-frame')
  if (!response.ok)
    throw new Error('The current frame review could not be read.')
  return Schema.decodeUnknownSync(ObserveLiveFrameReview)(await response.json())
}
