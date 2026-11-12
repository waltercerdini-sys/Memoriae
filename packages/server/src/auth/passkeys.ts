import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';

/**
 * Le passkey servono ad ACCEDERE (dimostrare chi sei).
 * Il segreto che apre la cassaforte (estensione PRF) resta nel browser e il server non lo vede mai.
 */

export interface StoredCredential {
  id: string;
  publicKey: string; // base64url
  counter: number;
  transports: string[];
}

export interface VerifiedRegistration {
  id: string;
  publicKey: string;
  counter: number;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
}

export interface PasskeyService {
  registrationOptions(user: { id: string; email: string; name: string }, exclude: StoredCredential[]): Promise<PublicKeyCredentialCreationOptionsJSON>;
  verifyRegistration(response: RegistrationResponseJSON, expectedChallenge: string): Promise<VerifiedRegistration | null>;
  authenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON>;
  verifyAuthentication(response: AuthenticationResponseJSON, expectedChallenge: string, credential: StoredCredential): Promise<{ newCounter: number } | null>;
}

export interface WebAuthnSettings {
  rpId: string;
  rpName: string;
  origins: string[];
}

const toB64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

export function createPasskeyService(settings: WebAuthnSettings): PasskeyService {
  return {
    async registrationOptions(user, exclude) {
      return generateRegistrationOptions({
        rpName: settings.rpName,
        rpID: settings.rpId,
        userName: user.email,
        userDisplayName: user.name,
        userID: new TextEncoder().encode(user.id),
        attestationType: 'none',
        excludeCredentials: exclude.map((c) => ({ id: c.id, transports: c.transports as AuthenticatorTransport[] })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      });
    },

    async verifyRegistration(response, expectedChallenge) {
      try {
        const v = await verifyRegistrationResponse({
          response,
          expectedChallenge,
          expectedOrigin: settings.origins,
          expectedRPID: settings.rpId,
          requireUserVerification: true,
        });
        if (!v.verified || !v.registrationInfo) return null;
        const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
        return {
          id: credential.id,
          publicKey: toB64url(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports ?? [],
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
        };
      } catch {
        return null;
      }
    },

    async authenticationOptions() {
      return generateAuthenticationOptions({ rpID: settings.rpId, userVerification: 'required' });
    },

    async verifyAuthentication(response, expectedChallenge, credential) {
      try {
        const v = await verifyAuthenticationResponse({
          response,
          expectedChallenge,
          expectedOrigin: settings.origins,
          expectedRPID: settings.rpId,
          requireUserVerification: true,
          credential: {
            id: credential.id,
            publicKey: fromB64url(credential.publicKey),
            counter: credential.counter,
            transports: credential.transports as AuthenticatorTransport[],
          },
        });
        return v.verified ? { newCounter: v.authenticationInfo.newCounter } : null;
      } catch {
        return null;
      }
    },
  };
}
