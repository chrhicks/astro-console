import type { SeestarDesktopApi } from '../../shared/legacy/api'
import type { SeestarDesktopApiV2, SeestarDevFakeApi } from '../../shared/api-v2'

declare global {
  interface Window {
    seestar: SeestarDesktopApi
    seestarV2: SeestarDesktopApiV2
    seestarDevFake?: SeestarDevFakeApi
  }
}

export {}
