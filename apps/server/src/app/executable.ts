export function runExecutable(name: string, run: () => Promise<unknown>) {
  void run().catch((error: unknown) => {
    console.error(`${name}: ${executableErrorMessage(error)}`)
    process.exitCode = 1
  })
}

export function executableErrorMessage(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : isConfigError(error)
          ? error.message
          : 'failed'
  return message.slice(0, 500)
}

function isConfigError(
  error: unknown,
): error is { readonly name: 'ConfigError'; readonly message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ConfigError' &&
    'message' in error &&
    typeof error.message === 'string'
  )
}
