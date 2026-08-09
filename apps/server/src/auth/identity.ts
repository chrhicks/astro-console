import type { IncomingMessage } from 'node:http'

export type ClientCapability = 'controlCapable' | 'readOnly'

export type LocalIdentity = {
  readonly personId: string
  readonly clientId: string
  readonly capability: ClientCapability
  readonly role?: 'owner' | 'viewer'
}

export type AdmissionReason =
  | 'missingOrInvalidToken'
  | 'keyUnavailable'
  | 'membershipUnavailable'
  | 'notMember'
  | 'admitted'

export type AdmissionObservation = {
  readonly admission: (reason: AdmissionReason) => void
  readonly jwks: (outcome: 'success' | 'failed') => void
}

export type RequestAdmission = (
  request?: Pick<IncomingMessage, 'headers' | 'method' | 'url'>,
  observation?: AdmissionObservation,
) => LocalIdentity | undefined | Promise<LocalIdentity | undefined>
