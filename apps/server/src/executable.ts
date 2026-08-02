export function runExecutable(name: string, run: () => Promise<unknown>) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'failed'
    console.error(`${name}: ${message.slice(0, 500)}`)
    process.exitCode = 1
  })
}
