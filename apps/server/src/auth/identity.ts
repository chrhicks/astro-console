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

export type AdmissionRequest = {
  readonly method: string
  readonly path: string
  readonly headers: Readonly<Record<string, string | Array<string> | undefined>>
}

export type RequestAdmission = (
  request: AdmissionRequest,
  observation?: AdmissionObservation,
) => LocalIdentity | undefined | Promise<LocalIdentity | undefined>
