export type RigWorkerConfig =
  | { readonly mode: "disabled"; readonly databasePath: string }
  | { readonly mode: "seestar"; readonly databasePath: string; readonly rigId: "seestar-s30"; readonly host: string; readonly pemPath: string }

export function rigWorkerConfig(env: Record<string, string | undefined>): RigWorkerConfig {
  const databasePath = env.ASTRO_LOCAL_WEB_DB
  if (!databasePath || /[\r\n]/.test(databasePath)) throw new Error("Rig worker requires ASTRO_LOCAL_WEB_DB")
  const mode = env.ASTRO_RIG_WORKER_MODE ?? "disabled"
  if (mode === "disabled") return { mode, databasePath }
  if (mode !== "seestar") throw new Error("ASTRO_RIG_WORKER_MODE must be disabled or seestar")
  const host = env.ASTRO_SEESTAR_HOST
  const pemPath = env.ASTRO_SEESTAR_PEM_PATH
  if (host !== "192.168.4.63") throw new Error("Seestar worker requires ASTRO_SEESTAR_HOST=192.168.4.63")
  if (!pemPath || /[\r\n]/.test(pemPath)) throw new Error("Seestar worker requires ASTRO_SEESTAR_PEM_PATH")
  return { mode, databasePath, rigId: "seestar-s30", host, pemPath }
}
