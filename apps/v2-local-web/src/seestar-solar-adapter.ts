import { SeestarDevice, type SeestarPushEvent } from "../../../sdk/dist/index.js"
import type { RigWorkerConfig } from "./rig-worker-config.ts"

export type SolarTestAdapter = {
  readonly startSolarTestObservation: (work: { readonly intentId: string; readonly name: string; readonly target: "Sun"; readonly requiredEvidence: "Stack" }) => Promise<"providerAcknowledged" | "uncertain">
  readonly stopSolarTestObservation: (intentId: string) => Promise<boolean>
  readonly close: () => void
}

type SolarDevice = Pick<SeestarDevice, "connectAndAuth" | "disconnect" | "preflightCheck" | "startStack" | "startView" | "stopStack" | "stopView" | "rawClient">

export function createSeestarSolarAdapter(config: Extract<RigWorkerConfig, { readonly mode: "seestar" }>, options: { readonly onStack: (intentId: string, event: SeestarPushEvent, observedAt: string) => void; readonly deviceFactory?: (input: { host: string; pemPath: string; timeoutMs: number }) => SolarDevice }): SolarTestAdapter {
  const device = options.deviceFactory?.({ host: config.host, pemPath: config.pemPath, timeoutMs: 15_000 }) ?? new SeestarDevice({ host: config.host, pemPath: config.pemPath, timeoutMs: 15_000 })
  let unsubscribe: (() => void) | undefined
  return {
    startSolarTestObservation: async (work) => {
      try {
        const authenticated = await device.connectAndAuth()
        if (!authenticated) return "uncertain"
        const preflight = await device.preflightCheck()
        if (preflight.mountClosed || preflight.viewMode && preflight.viewMode !== "none") return "uncertain"
        unsubscribe?.()
        unsubscribe = device.rawClient.subscribeToPushEvents((event) => {
          if (event.Event === "Stack") options.onStack(work.intentId, event, new Date().toISOString())
        })
        const startedView = await device.startView("sun", undefined, { waitForCompletion: true, timeoutMs: 30_000, pollIntervalMs: 500 })
        if (!startedView) return "uncertain"
        const startedStack = await device.startStack(true, { waitForCompletion: false, timeoutMs: 15_000 })
        return startedStack ? "providerAcknowledged" : "uncertain"
      } catch {
        return "uncertain"
      }
    },
    stopSolarTestObservation: async () => {
      try {
        const stoppedStack = await device.stopStack({ waitForCompletion: true, timeoutMs: 30_000, pollIntervalMs: 500 })
        const stoppedView = await device.stopView(undefined, { waitForCompletion: true, timeoutMs: 30_000, pollIntervalMs: 500 })
        return stoppedStack && stoppedView
      } catch { return false }
    },
    close: () => { unsubscribe?.(); unsubscribe = undefined; device.disconnect() },
  }
}
