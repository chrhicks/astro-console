// Test-only no-op loader for colocated component styles. The component
// grammar tests assert markup, not computed style; Vite serves the real
// CSS in dev and build. Registered via scripts/test-register.mjs so it
// composes ahead of tsx in the loader chain.
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css'))
    return {
      format: 'module',
      source: 'export default undefined',
      shortCircuit: true,
    }
  return nextLoad(url, context)
}
