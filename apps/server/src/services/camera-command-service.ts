import { Cause, Context, Effect, Exit, Option, Schema } from 'effect'
import {
  CameraCommandRequest,
  CameraExposureObservation,
} from '@astro-console/v2-contracts'

export interface CameraProviderShape {
  readonly startExposure: (
    durationSeconds: number,
  ) => Effect.Effect<unknown, unknown>
  readonly abortExposure: () => Effect.Effect<unknown, unknown>
  readonly readState: () => Effect.Effect<unknown, unknown>
}
export class CameraProvider extends Context.Service<
  CameraProvider,
  CameraProviderShape
>()('@astro-console/server/CameraProvider') {}

export const executeCameraCommand = Effect.fn('CameraCommandService.execute')(
  function* (raw: unknown) {
    const input = yield* Schema.decodeUnknownEffect(CameraCommandRequest)(
      raw,
    ).pipe(Effect.option)
    if (Option.isNone(input))
      return {
        _tag: 'Rejected' as const,
        summary: 'The camera command is invalid.',
      }
    const provider = yield* Effect.serviceOption(CameraProvider)
    if (Option.isNone(provider))
      return {
        _tag: 'Unavailable' as const,
        summary: 'No configured camera provider is available.',
      }
    const command = input.value.intent
    const acknowledged =
      CameraCommandRequest.fields.intent.guards.StartCameraExposure(command)
        ? provider.value.startExposure(command.durationSeconds)
        : provider.value.abortExposure()
    const acknowledgement = yield* acknowledged.pipe(Effect.exit)
    if (Exit.isFailure(acknowledgement))
      return {
        _tag: 'Unavailable' as const,
        summary: `The camera provider did not acknowledge the command. ${boundedDiagnostic(acknowledgement.cause)}`,
      }
    const observed = yield* provider.value
      .readState()
      .pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(CameraExposureObservation)),
        Effect.exit,
      )
    if (Exit.isFailure(observed))
      return {
        _tag: 'Unavailable' as const,
        summary: `The camera provider did not return a post-command state. ${boundedDiagnostic(observed.cause)}`,
      }
    return { _tag: 'Observed' as const, observation: observed.value }
  },
)

function boundedDiagnostic(cause: Cause.Cause<unknown>) {
  return Cause.pretty(cause)
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240)
}
