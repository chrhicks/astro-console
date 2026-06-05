import type { SeestarDesktopApi } from '../../shared/api'

declare global {
  interface Window {
    seestar: SeestarDesktopApi
  }
}

export {}
