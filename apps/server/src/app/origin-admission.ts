import type { OriginServerConfig } from '../config/environment-config.ts'
import type { RequestAdmission } from '../auth/identity.ts'
import {
  createJwksKeyResolver,
  createLocalFixtureAdmission,
  createMembershipBootstrapResolver,
  createProductionAccessAdmission,
} from '../auth/access-admission.ts'

export function createOriginAdmission(
  config: OriginServerConfig,
): RequestAdmission {
  if (config.admission.mode === 'development') {
    const client = config.admission.client
    return createLocalFixtureAdmission({
      personId: client === 'friend' ? 'friend-ada' : 'owner-chicks',
      clientId:
        client === 'phone'
          ? 'phone-monitor'
          : client === 'friend'
            ? 'desktop-ada'
            : 'desktop-owner',
      capability: client === 'phone' ? 'readOnly' : 'controlCapable',
    })
  }
  return createRemoteAccessAdmission(config, config.admission.clientContext)
}

export const createRemoteReadOnlyAdmission = (config: OriginServerConfig) =>
  createRemoteAccessAdmission(config, 'phone')

export const createRemoteDesktopAdmission = (config: OriginServerConfig) =>
  createRemoteAccessAdmission(config, 'desktop')

function createRemoteAccessAdmission(
  config: OriginServerConfig,
  clientContext: 'desktop' | 'phone',
): RequestAdmission {
  if (config.admission.mode === 'development')
    return createOriginAdmission(config)
  return createProductionAccessAdmission({
    issuer: config.admission.issuer,
    audience: config.admission.audience,
    keyResolver: createJwksKeyResolver({
      url: config.admission.jwksUrl,
      cacheTtlMs: config.admission.cacheTtlMs,
    }),
    databasePath: config.runtime.databasePath,
    clientContext,
    bootstrapResolver: createMembershipBootstrapResolver({
      path: config.admission.bootstrapPath,
    }),
  })
}

export const createLocalOwnerAdmission = (): RequestAdmission =>
  createLocalFixtureAdmission({
    personId: 'owner-chicks',
    clientId: 'local-owner',
    role: 'owner',
    capability: 'controlCapable',
  })
