import { Cause, Context, Effect, Exit, Option, Schema } from 'effect'
import {
  CameraCommandRequest,
  CameraExposureObservation,
} from '@astro-console/protocol'

export interface CameraProviderShape {
  readonly startExposure: (
    durationSeconds: number,
  ) => Effect.Effect<CameraProviderCommandOutcome | void, unknown>
  readonly abortExposure: () => Effect.Effect<
    CameraProviderCommandOutcome | void,
    unknown
  >
  readonly readState: () => Effect.Effect<unknown, unknown>
  readonly readImageArray?: () => Effect.Effect<
    {
      readonly bytes: Uint8Array
      readonly format: 'cameraRaw' | 'fits' | 'tiff'
    },
    unknown
  >
}
export type CameraProviderCommandOutcome =
  | { readonly _tag: 'Acknowledged' }
  | { readonly _tag: 'Rejected'; readonly summary: string }
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
    yield* Effect.annotateCurrentSpan({
      'astro.workspace': 'acquire',
      'astro.command.intent': input.value.intent._tag,
      'astro.device.kind': 'camera',
    })
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
    if (acknowledgement.value?._tag === 'Rejected')
      return {
        _tag: 'Rejected' as const,
        summary: acknowledgement.value.summary,
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
