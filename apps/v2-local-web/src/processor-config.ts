export type ProcessorConfig =
  | { readonly mode: "disabled" }
  | { readonly mode: "manifest"; readonly databasePath: string; readonly sourcesRoot: string; readonly outputsRoot: string; readonly manifestPath: string; readonly ownerPersonId: string }

export function processorConfig(env: Record<string, string | undefined>): ProcessorConfig {
  const mode = env.ASTRO_PROCESSOR_MODE ?? "disabled"
  if (mode === "disabled") return { mode }
  if (mode !== "manifest") throw new Error("ASTRO_PROCESSOR_MODE must be disabled or manifest")
  const databasePath = env.ASTRO_LOCAL_WEB_DB; const sourcesRoot = env.ASTRO_PROCESSOR_SOURCES_ROOT; const outputsRoot = env.ASTRO_PROCESSOR_OUTPUTS_ROOT; const manifestPath = env.ASTRO_PROCESSOR_MANIFEST_PATH; const ownerPersonId = env.ASTRO_PROCESSOR_OWNER_PERSON_ID
  if (!databasePath || !sourcesRoot || !outputsRoot || !manifestPath || !ownerPersonId) throw new Error("Manifest processor requires database, source root, output root, manifest path, and owner person ID")
  if (![databasePath, sourcesRoot, outputsRoot, manifestPath, ownerPersonId].every((value) => !/[\r\n]/.test(value))) throw new Error("Manifest processor configuration contains an invalid value")
  if (!databasePath.startsWith("/var/lib/astro-console/") || !sourcesRoot.startsWith("/var/lib/astro-console/") || !outputsRoot.startsWith("/var/lib/astro-console/") || !manifestPath.startsWith("/run/config/") || /(?:^|\/)\.\.(?:\/|$)/.test(`${databasePath}/${sourcesRoot}/${outputsRoot}/${manifestPath}`) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(ownerPersonId)) throw new Error("Manifest processor paths must be app-owned and manifest host-managed")
  return { mode, databasePath, sourcesRoot, outputsRoot, manifestPath, ownerPersonId }
}
