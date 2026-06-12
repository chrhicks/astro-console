import type { SeestarDesktopApi } from '../../shared/api'
import type { SeestarDesktopApiV2 } from '../../shared/api-v2'

declare global {
  interface Window {
    seestar: SeestarDesktopApi
    seestarV2: SeestarDesktopApiV2
  }
}

export {}
