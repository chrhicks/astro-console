import type { SeestarDesktopApiV2, SeestarDevFakeApi } from '../../shared/api-v2'

declare global {
  interface Window {
    seestarV2: SeestarDesktopApiV2
    seestarDevFake?: SeestarDevFakeApi
  }
}

export {}
