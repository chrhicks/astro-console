import type { IncomingMessage } from 'node:http'

export type ClientCapability = 'controlCapable' | 'readOnly'

export type LocalIdentity = {
  readonly personId: string
  readonly clientId: string
  readonly capability: ClientCapability
  readonly role?: 'owner' | 'viewer'
}

export type RequestAdmission = (
  request?: Pick<IncomingMessage, 'headers'>,
) => LocalIdentity | undefined | Promise<LocalIdentity | undefined>
