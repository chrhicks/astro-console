import { Effect, Exit, Schema } from 'effect'
import { CommandEnvelope, ProcessingAction } from '@astro-console/v2-contracts'

type ProcessOperation = 'workspace.open' | 'command.execute'
type ProcessCommandIntent = typeof ProcessingAction.Type

const operationSpanNames: Record<ProcessOperation, string> = {
  'workspace.open': 'Process.workspace.open',
  'command.execute': 'Process.command.execute',
}

export function tracedProcessOperation<A, E, R>(
  response: { readonly statusCode: number; readonly headersSent?: boolean },
  operation: ProcessOperation,
  effect: Effect.Effect<A, E, R>,
) {
  const traced = Effect.gen(function* () {
    const result = yield* effect.pipe(Effect.exit)
    yield* Effect.annotateCurrentSpan({
      'astro.process.outcome': Exit.match(result, {
        onFailure: () => 'unavailable',
        onSuccess: () => outcomeFor(response),
      }),
    })
    return result
  }).pipe(
    Effect.withSpan(operationSpanNames[operation], {
      attributes: {
        'astro.workspace': 'process',
        'astro.process.operation': operation,
      },
    }),
  )
  return traced.pipe(
    Effect.flatMap(
      Exit.match({
        onFailure: Effect.failCause,
        onSuccess: Effect.succeed,
      }),
    ),
  )
}

export function annotateProcessCommandIntent(intent: ProcessCommandIntent) {
  return Effect.annotateCurrentSpan({ 'astro.command.intent': intent })
}

export function processCommandIntent(raw: unknown) {
  try {
    const envelope = Schema.decodeUnknownSync(CommandEnvelope)(raw)
    return Schema.decodeUnknownSync(ProcessingAction)(envelope.command._tag)
  } catch {
    return undefined
  }
}

function outcomeFor(response: {
  readonly statusCode: number
  readonly headersSent?: boolean
}) {
  if (response.headersSent !== true || response.statusCode >= 500)
    return 'unavailable'
  if (response.statusCode >= 200 && response.statusCode < 300) return 'accepted'
  return 'rejected'
}
