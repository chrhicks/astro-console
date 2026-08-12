import { Effect, Schema } from 'effect'
import { CommandHttpFailureEnvelope } from '@astro-console/protocol'
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http'
import { controlCommandFromEnvelope } from '../../persistence/control-sqlite-repository.ts'
import { OriginDatabase } from '../../persistence/database.ts'
import { StateSqliteRepository } from '../../persistence/state-sqlite-repository.ts'
import { ProjectionPublication } from '../../services/projection-publication.ts'
import { commandFailureStatuses } from '../command-handlers.ts'
import { BodyTooLarge } from '../request-body.ts'
import {
  json,
  OriginRequestIdentity,
  requestJson,
} from './origin-route-shared.ts'

export const makeControlRoutes = Effect.fn('OriginHttp.makeControlRoutes')(
  function* () {
    const { database } = yield* OriginDatabase
    const repository = yield* StateSqliteRepository
    const publication = yield* ProjectionPublication

    return HttpRouter.add(
      'POST',
      '/api/commands/control',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const identity = yield* OriginRequestIdentity
        const raw = yield* requestJson(request)
        const result = yield* controlCommandFromEnvelope(
          Promise.resolve(raw),
          BodyTooLarge,
          database,
          repository,
          identity,
          (_type, cursor) => publication.publish(cursor),
        ).pipe(
          Effect.catchTags({
            'Server.CommandInputInvalid': () =>
              Schema.decodeUnknownEffect(CommandHttpFailureEnvelope)({
                ok: false,
                failure: {
                  _tag: 'InvalidInput',
                  summary: 'The service could not read that action.',
                },
              }).pipe(Effect.map((body) => ({ status: 400, body }))),
            'Server.CommandRejected': ({ failure }) =>
              Schema.decodeUnknownEffect(CommandHttpFailureEnvelope)({
                ok: false,
                failure: { _tag: 'CommandRejected', failure },
              }).pipe(
                Effect.map((body) => ({
                  status: commandFailureStatuses[failure._tag],
                  body,
                })),
              ),
          }),
        )
        return json(result.status, result.body)
      }),
    )
  },
)
