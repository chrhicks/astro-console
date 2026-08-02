import { Data, Schema } from 'effect'
import { CommandTag } from './commands.js'
import {
  CommandResultRef,
  IdempotencyKey,
  NormalizedInputHash,
  OperationId,
  PersonId,
} from './primitives.js'

const ReceiptIdentity = {
  idempotencyKey: IdempotencyKey,
  personId: PersonId,
  commandTag: CommandTag,
  normalizedInputHash: NormalizedInputHash,
}

export const IdempotencyReceipt = Schema.TaggedUnion({
  Pending: {
    ...ReceiptIdentity,
    operationId: Schema.optionalKey(OperationId),
  },
  Recorded: {
    ...ReceiptIdentity,
    resultRef: CommandResultRef,
  },
})

export type IdempotencyReceipt = typeof IdempotencyReceipt.Type

export const IdempotencyRequest = Schema.Struct(ReceiptIdentity)

export interface IdempotencyRequest extends Schema.Schema.Type<
  typeof IdempotencyRequest
> {}

export type IdempotencyClassification = Data.TaggedEnum<{
  Fresh: {}
  PendingMatch: { readonly operationId?: typeof OperationId.Type }
  RecordedMatch: {}
  Conflict: {}
}>

export const IdempotencyClassification =
  Data.taggedEnum<IdempotencyClassification>()

export const classifyIdempotency = (
  request: IdempotencyRequest,
  receipt: IdempotencyReceipt | undefined,
): IdempotencyClassification => {
  if (receipt === undefined) return IdempotencyClassification.Fresh()

  const matches =
    receipt.idempotencyKey === request.idempotencyKey &&
    receipt.personId === request.personId &&
    receipt.commandTag === request.commandTag &&
    receipt.normalizedInputHash === request.normalizedInputHash

  if (!matches) return IdempotencyClassification.Conflict()
  return IdempotencyReceipt.match(receipt, {
    Pending: ({ operationId }): IdempotencyClassification =>
      operationId === undefined
        ? IdempotencyClassification.PendingMatch({})
        : IdempotencyClassification.PendingMatch({ operationId }),
    Recorded: (): IdempotencyClassification =>
      IdempotencyClassification.RecordedMatch(),
  })
}
