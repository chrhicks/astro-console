import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Schema } from 'effect'
import {
  ControlLeaseState,
  ControlRequestResolution,
  expireControlGrace,
  markControllerDisconnected,
  markControllerReconnected,
  releaseControl,
  requestControl,
  resolveControlRequest,
  takeControl,
} from './control.js'
import { ClientId } from './primitives.js'

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): S['Type'] => Schema.decodeUnknownSync(schema)(input)

const ownerClientId = ClientId.make('client-owner')
const friendClientId = ClientId.make('client-friend')

const heldLease = () =>
  decode(ControlLeaseState, {
    leaseId: 'lease-1',
    revision: 4,
    state: 'held',
    holderClientId: ownerClientId,
    requests: [],
  })

const request = (
  state = heldLease(),
  requestId = 'request-1',
  clientId = friendClientId,
) => {
  const decision = requestControl(state, requestId, clientId, 1_000, 61_000)
  assert.equal(decision._tag, 'Updated')
  if (decision._tag !== 'Updated')
    throw new Error('expected request to update control coordination')
  return decision.state
}

const grant = (requestId = 'request-1', targetClientId = friendClientId) =>
  ControlRequestResolution.cases.Grant.make({
    requestId,
    nowEpochMs: 2_000,
    target: {
      clientId: targetClientId,
      capability: 'controlCapable',
      connection: 'current',
    },
  })

describe('ControlLeaseState', () => {
  it('rejects impossible holder and reconnect combinations', () => {
    assert.throws(() =>
      decode(ControlLeaseState, {
        leaseId: 'lease-1',
        revision: 4,
        state: 'available',
        holderClientId: ownerClientId,
        requests: [],
      }),
    )
    assert.throws(() =>
      decode(ControlLeaseState, {
        leaseId: 'lease-1',
        revision: 4,
        state: 'held',
        requests: [],
      }),
    )
    assert.throws(() =>
      decode(ControlLeaseState, {
        leaseId: 'lease-1',
        revision: 4,
        state: 'reconnecting',
        holderClientId: ownerClientId,
        requests: [],
      }),
    )
  })

  it('rejects duplicate request identities, duplicate requesters, and invalid expiry', () => {
    const validRequest = {
      requestId: 'request-1',
      requesterClientId: friendClientId,
      basedOnLeaseRevision: 4,
      requestedAtEpochMs: 1_000,
      expiresAtEpochMs: 61_000,
    }
    assert.throws(() =>
      decode(ControlLeaseState, {
        ...heldLease(),
        requests: [validRequest, validRequest],
      }),
    )
    assert.throws(() =>
      decode(ControlLeaseState, {
        ...heldLease(),
        requests: [{ ...validRequest, expiresAtEpochMs: 1_000 }],
      }),
    )
    assert.throws(() =>
      decode(ControlLeaseState, {
        ...heldLease(),
        requests: [{ ...validRequest, requesterClientId: ownerClientId }],
      }),
    )
    assert.throws(() =>
      decode(ControlLeaseState, {
        ...heldLease(),
        requests: [{ ...validRequest, basedOnLeaseRevision: 5 }],
      }),
    )
  })
})

describe('control request coordination', () => {
  it('creates and declines requests without changing the ownership epoch', () => {
    const requested = request()
    assert.equal(requested.revision, 4)
    assert.deepEqual(requested.requests[0], {
      requestId: 'request-1',
      requesterClientId: friendClientId,
      basedOnLeaseRevision: 4,
      requestedAtEpochMs: 1_000,
      expiresAtEpochMs: 61_000,
    })

    const declined = resolveControlRequest(
      requested,
      ControlRequestResolution.cases.Decline.make({
        requestId: 'request-1',
        nowEpochMs: 2_000,
      }),
    )
    assert.equal(declined._tag, 'Updated')
    if (declined._tag !== 'Updated')
      throw new Error('expected decline to update request coordination')
    assert.equal(declined.state.revision, 4)
    assert.equal(declined.state.holderClientId, ownerClientId)
    assert.equal(declined.state.requests.length, 0)
  })

  it('rejects duplicate clients, conflicting request identities, and invalid expiry', () => {
    const requested = request()
    assert.equal(
      requestControl(requested, 'request-2', friendClientId, 2_000, 62_000)
        ._tag,
      'Unchanged',
    )
    assert.equal(
      requestControl(
        requested,
        'request-1',
        ClientId.make('client-other'),
        2_000,
        62_000,
      )._tag,
      'Unchanged',
    )

    const invalidExpiry = requestControl(
      heldLease(),
      'request-2',
      friendClientId,
      2_000,
      2_000,
    )
    assert.equal(invalidExpiry._tag, 'Unchanged')
    if (invalidExpiry._tag === 'Unchanged')
      assert.equal(invalidExpiry.reason, 'RequestExpiryInvalid')
  })

  it('allows a new request after an earlier request expires', () => {
    const requested = request()
    const renewed = requestControl(
      requested,
      'request-2',
      friendClientId,
      61_000,
      121_000,
    )
    assert.equal(renewed._tag, 'Updated')
    if (renewed._tag !== 'Updated')
      throw new Error('expected expired request replacement')
    assert.equal(renewed.state.revision, 4)
    assert.deepEqual(
      renewed.state.requests.map((candidate) => candidate.requestId),
      ['request-2'],
    )
  })

  it('requires a current request for the exact available control-capable target', () => {
    const requested = request()

    const mismatch = resolveControlRequest(
      requested,
      grant('request-1', ClientId.make('client-other')),
    )
    assert.equal(mismatch._tag, 'Unchanged')
    if (mismatch._tag === 'Unchanged')
      assert.equal(mismatch.reason, 'ControlTargetMismatch')

    const readOnly = resolveControlRequest(
      requested,
      ControlRequestResolution.cases.Grant.make({
        requestId: 'request-1',
        nowEpochMs: 2_000,
        target: {
          clientId: friendClientId,
          capability: 'readOnly',
          connection: 'current',
        },
      }),
    )
    assert.equal(readOnly._tag, 'Unchanged')
    if (readOnly._tag === 'Unchanged')
      assert.equal(readOnly.reason, 'ControlTargetUnavailable')

    const disconnected = resolveControlRequest(
      requested,
      ControlRequestResolution.cases.Grant.make({
        requestId: 'request-1',
        nowEpochMs: 2_000,
        target: {
          clientId: friendClientId,
          capability: 'controlCapable',
          connection: 'disconnected',
        },
      }),
    )
    assert.equal(disconnected._tag, 'Unchanged')
    if (disconnected._tag === 'Unchanged')
      assert.equal(disconnected.reason, 'ControlTargetUnavailable')

    const expired = resolveControlRequest(
      requested,
      ControlRequestResolution.cases.Grant.make({
        ...grant(),
        nowEpochMs: 61_000,
      }),
    )
    assert.equal(expired._tag, 'Unchanged')
    if (expired._tag === 'Unchanged')
      assert.equal(expired.reason, 'RequestExpired')

    const superseded = resolveControlRequest(
      decode(ControlLeaseState, {
        ...requested,
        revision: 5,
      }),
      grant(),
    )
    assert.equal(superseded._tag, 'Unchanged')
    if (superseded._tag === 'Unchanged')
      assert.equal(superseded.reason, 'RequestSuperseded')
  })

  it('grants exclusively, advances the ownership epoch once, and resolves incompatible requests', () => {
    const withTwoRequests = request(
      request(),
      'request-2',
      ClientId.make('client-other'),
    )
    const granted = resolveControlRequest(withTwoRequests, grant())
    assert.equal(granted._tag, 'Updated')
    if (granted._tag !== 'Updated') throw new Error('expected grant')
    assert.equal(granted.effect, 'granted')
    assert.equal(granted.state.revision, 5)
    assert.equal(granted.state.state, 'held')
    assert.equal(granted.state.holderClientId, friendClientId)
    assert.equal(granted.state.requests.length, 0)
  })
})

describe('control ownership lifecycle', () => {
  it('starts and clears reconnect grace without changing ownership', () => {
    const disconnected = markControllerDisconnected(
      heldLease(),
      ownerClientId,
      61_000,
    )
    assert.equal(disconnected._tag, 'Updated')
    if (disconnected._tag !== 'Updated')
      throw new Error('expected reconnect grace')
    assert.equal(disconnected.state.revision, 4)
    assert.equal(disconnected.state.state, 'reconnecting')

    const repeated = markControllerDisconnected(
      disconnected.state,
      ownerClientId,
      121_000,
    )
    assert.equal(repeated._tag, 'Unchanged')
    if (repeated._tag === 'Unchanged')
      assert.equal(repeated.reason, 'AlreadyReconnecting')

    const reconnected = markControllerReconnected(
      disconnected.state,
      ownerClientId,
    )
    assert.equal(reconnected._tag, 'Updated')
    if (reconnected._tag !== 'Updated') throw new Error('expected reconnect')
    assert.equal(reconnected.state.revision, 4)
    assert.equal(reconnected.state.state, 'held')
    assert.equal(reconnected.state.graceDeadlineEpochMs, undefined)
  })

  it('expires grace to no controller and advances the ownership epoch once', () => {
    const disconnected = markControllerDisconnected(
      request(),
      ownerClientId,
      61_000,
    )
    assert.equal(disconnected._tag, 'Updated')
    if (disconnected._tag !== 'Updated')
      throw new Error('expected reconnect grace')

    assert.equal(
      expireControlGrace(disconnected.state, 60_999)._tag,
      'Unchanged',
    )
    const expired = expireControlGrace(disconnected.state, 61_000)
    assert.equal(expired._tag, 'Updated')
    if (expired._tag !== 'Updated') throw new Error('expected grace expiry')
    assert.equal(expired.state.revision, 5)
    assert.equal(expired.state.state, 'available')
    assert.equal(expired.state.holderClientId, undefined)
    assert.equal(expired.state.requests.length, 0)
  })

  it('makes owner takeover idempotent and resolves incompatible requests', () => {
    const alreadyOwner = takeControl(request(), ownerClientId)
    assert.equal(alreadyOwner._tag, 'Unchanged')
    if (alreadyOwner._tag === 'Unchanged')
      assert.equal(alreadyOwner.reason, 'AlreadyController')

    const taken = takeControl(request(), ClientId.make('client-owner-2'))
    assert.equal(taken._tag, 'Updated')
    if (taken._tag !== 'Updated') throw new Error('expected owner takeover')
    assert.equal(taken.state.revision, 5)
    assert.equal(taken.state.requests.length, 0)

    const repeated = takeControl(taken.state, ClientId.make('client-owner-2'))
    assert.equal(repeated._tag, 'Unchanged')
    if (repeated._tag === 'Unchanged')
      assert.equal(repeated.reason, 'AlreadyController')
  })

  it('only lets the current holder release and advances ownership once', () => {
    assert.equal(releaseControl(heldLease(), friendClientId)._tag, 'Unchanged')
    const released = releaseControl(request(), ownerClientId)
    assert.equal(released._tag, 'Updated')
    if (released._tag !== 'Updated') throw new Error('expected release')
    assert.equal(released.state.revision, 5)
    assert.equal(released.state.state, 'available')
    assert.equal(released.state.requests.length, 0)
  })
})
