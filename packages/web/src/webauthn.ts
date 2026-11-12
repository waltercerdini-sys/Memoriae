import type { PublicKeyCredentialCreationOptionsJSONLike, PublicKeyCredentialRequestOptionsJSONLike } from './api';

/**
 * Passkey nel browser, con l'estensione PRF.
 *
 * La passkey fa due cose diverse:
 * 1. dimostra al server chi sei (firma della sfida) → la risposta va al server;
 * 2. produce un segreto (PRF) da cui ricaviamo la chiave della cassaforte → resta NEL BROWSER.
 * Il segreto PRF non viene mai incluso nelle risposte inviate al server.
 */

const b64url = {
  encode(buf: ArrayBuffer | Uint8Array): string {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(s: string): Uint8Array {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

/** Sale fisso dell'estensione PRF per MEMORIAE: stessa passkey → stesso segreto. */
async function prfSalt(): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('memoriae-prf-v1'));
  return new Uint8Array(digest);
}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
}

function prfFrom(cred: PublicKeyCredential): Uint8Array | null {
  const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: BufferSource } } };
  const first = ext.prf?.results?.first;
  if (!first) return null;
  return first instanceof ArrayBuffer ? new Uint8Array(first) : new Uint8Array((first as ArrayBufferView).buffer);
}

export interface RegistrationResult {
  /** Da inviare al server (senza segreto PRF). */
  risposta: unknown;
  credentialId: string;
  /** Segreto PRF, se il dispositivo l'ha già fornito alla creazione. */
  prf: Uint8Array | null;
  prfSupported: boolean;
}

export async function createPasskey(o: PublicKeyCredentialCreationOptionsJSONLike): Promise<RegistrationResult> {
  const salt = await prfSalt();
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: b64url.decode(o.challenge),
      rp: o.rp,
      user: { id: b64url.decode(o.user.id), name: o.user.name, displayName: o.user.displayName },
      pubKeyCredParams: o.pubKeyCredParams,
      timeout: o.timeout,
      excludeCredentials: (o.excludeCredentials ?? []).map((c) => ({ type: 'public-key' as const, id: b64url.decode(c.id) })),
      authenticatorSelection: o.authenticatorSelection,
      attestation: o.attestation ?? 'none',
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Creazione della passkey annullata');
  const res = cred.response as AuthenticatorAttestationResponse;
  const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean } };
  return {
    risposta: {
      id: cred.id,
      rawId: b64url.encode(cred.rawId),
      type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
      response: {
        clientDataJSON: b64url.encode(res.clientDataJSON),
        attestationObject: b64url.encode(res.attestationObject),
        transports: res.getTransports?.() ?? [],
      },
      clientExtensionResults: {},
    },
    credentialId: cred.id,
    prf: prfFrom(cred),
    prfSupported: ext.prf?.enabled === true || prfFrom(cred) !== null,
  };
}

export interface AssertionResult {
  risposta: unknown;
  credentialId: string;
  prf: Uint8Array | null;
}

/** Firma una sfida e, se possibile, ottiene il segreto PRF nello stesso gesto. */
export async function usePasskey(o: PublicKeyCredentialRequestOptionsJSONLike, onlyCredentialId?: string): Promise<AssertionResult> {
  const salt = await prfSalt();
  const allow = onlyCredentialId ? [{ type: 'public-key' as const, id: b64url.decode(onlyCredentialId) }] : (o.allowCredentials ?? []).map((c) => ({ type: 'public-key' as const, id: b64url.decode(c.id) }));
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: b64url.decode(o.challenge),
      rpId: o.rpId,
      timeout: o.timeout,
      userVerification: o.userVerification ?? 'required',
      allowCredentials: allow,
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Accesso annullato');
  const res = cred.response as AuthenticatorAssertionResponse;
  return {
    risposta: {
      id: cred.id,
      rawId: b64url.encode(cred.rawId),
      type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
      response: {
        clientDataJSON: b64url.encode(res.clientDataJSON),
        authenticatorData: b64url.encode(res.authenticatorData),
        signature: b64url.encode(res.signature),
        userHandle: res.userHandle ? b64url.encode(res.userHandle) : undefined,
      },
      clientExtensionResults: {},
    },
    credentialId: cred.id,
    prf: prfFrom(cred),
  };
}

/** Solo per ottenere il segreto PRF subito dopo la registrazione (sfida locale, nulla va al server). */
export async function prfOnly(credentialId: string): Promise<Uint8Array | null> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const r = await usePasskey({ challenge: b64url.encode(challenge), userVerification: 'required' }, credentialId);
  return r.prf;
}
