export type StartM27CaptureAdapter = {
  readonly startM27Capture: (work: { readonly runId: string }) => Promise<boolean>
}

export function createRigWorker(
  service: {
    readonly dispatchStartOutbox: (
      adapter: StartM27CaptureAdapter | undefined,
      workerId?: string,
    ) => Promise<string>
  },
  adapter: StartM27CaptureAdapter | undefined,
  workerId = "rig-worker",
) {
  return { runOnce: () => service.dispatchStartOutbox(adapter, workerId) }
}
