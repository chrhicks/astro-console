import { ManagedRuntime } from 'effect'
import { DesktopLiveLayer } from './desktop-live'

export const appRuntime = ManagedRuntime.make(DesktopLiveLayer)
