import type { Envelope, PasswordKdfParams } from '@memoriae/crypto';

/** Chiamate al server. I cookie di sessione viaggiano da soli (stesso dominio). */

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.errore ?? `Errore ${res.status}`);
  return data as T;
}

export interface Utente {
  id: string;
  nome: string;
  email: string;
}

export interface Accesso {
  metodo: 'passkey' | 'password' | 'recovery-code';
  credentialId?: string | null;
  parametri?: PasswordKdfParams | null;
  chiaveCifrata: Envelope;
}

export interface CassaforteRemota {
  id: string;
  chiavePubblica: string;
  chiavePrivataCifrata: Envelope;
  accessi: Accesso[];
}

export type TipoVoce = 'account' | 'documento' | 'cartella' | 'istruzione' | 'crypto' | 'dispositivo';

export interface VoceRemota {
  id: string;
  tipo: TipoVoce;
  emergenza: boolean;
  chiaveVoceCifrata: Envelope;
  contenuto: Envelope;
  haFile: boolean;
  dimensioneFile: number | null;
  creataIl: string;
  modificataIl: string;
}

export interface Fornitore {
  slug: string;
  nome: string;
  categoria: string;
  daVivi: string[];
  perGliEredi: string[];
  fonte: string | null;
}

export const api = {
  io: () => call<{ utente: Utente; haCassaforte: boolean }>('GET', '/v1/io'),
  registrazioneOpzioni: (nome: string, email: string) =>
    call<{ challengeId: string; opzioni: PublicKeyCredentialCreationOptionsJSONLike }>('POST', '/v1/registrazione/opzioni', { nome, email }),
  registrazioneVerifica: (challengeId: string, risposta: unknown) =>
    call<{ utente: Utente; credentialId: string; haCassaforte: boolean }>('POST', '/v1/registrazione/verifica', { challengeId, risposta }),
  accessoOpzioni: () => call<{ challengeId: string; opzioni: PublicKeyCredentialRequestOptionsJSONLike }>('POST', '/v1/accesso/opzioni'),
  accessoVerifica: (challengeId: string, risposta: unknown) =>
    call<{ utente: Utente; credentialId: string; haCassaforte: boolean }>('POST', '/v1/accesso/verifica', { challengeId, risposta }),
  uscita: () => call<{ ok: true }>('POST', '/v1/uscita'),
  creaCassaforte: (dati: { id: string; chiavePubblica: string; chiavePrivataCifrata: Envelope; accessi: Accesso[]; verificaRecupero: string }) =>
    call<{ id: string }>('POST', '/v1/cassaforte', dati),
  cassaforte: () => call<CassaforteRemota>('GET', '/v1/cassaforte'),
  sostituisciAccesso: (a: Accesso) => call<{ ok: true }>('PUT', '/v1/cassaforte/accessi', a),
  recuperoInizia: (email: string) => call<{ ok: true }>('POST', '/v1/recupero/inizia', { email }),
  recuperoVerificaEmail: (email: string, codice: string) =>
    call<{ cassaforteId: string; chiaveCifrata: Envelope }>('POST', '/v1/recupero/verifica-email', { email, codice }),
  recuperoPasskeyOpzioni: (verificaRecupero: string) =>
    call<{ challengeId: string; opzioni: PublicKeyCredentialCreationOptionsJSONLike }>('POST', '/v1/recupero/passkey/opzioni', { verificaRecupero }),
  recuperoCompleta: (challengeId: string, risposta: unknown, verificaRecupero: string) =>
    call<{ utente: Utente; credentialId: string }>('POST', '/v1/recupero/completa', { challengeId, risposta, verificaRecupero }),
  voci: () => call<{ voci: VoceRemota[] }>('GET', '/v1/cassaforte/voci'),
  creaVoce: (v: { id: string; tipo: TipoVoce; emergenza: boolean; chiaveVoceCifrata: Envelope; contenuto: Envelope }) =>
    call<{ id: string }>('POST', '/v1/cassaforte/voci', v),
  eliminaVoce: (id: string) => call<{ ok: true }>('DELETE', `/v1/cassaforte/voci/${id}`),
  caricaFile: async (id: string, bytes: Uint8Array) => {
    const res = await fetch(`/v1/cassaforte/voci/${id}/file`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
    });
    if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.errore ?? 'Caricamento non riuscito');
  },
  scaricaFile: async (id: string) => {
    const res = await fetch(`/v1/cassaforte/voci/${id}/file`, { credentials: 'same-origin' });
    if (!res.ok) throw new ApiError(res.status, 'File non disponibile');
    return new Uint8Array(await res.arrayBuffer());
  },
  fornitori: () => call<{ fornitori: Fornitore[] }>('GET', '/v1/fornitori'),
};

/** Forme JSON delle opzioni WebAuthn (come le produce il server). */
export interface PublicKeyCredentialCreationOptionsJSONLike {
  challenge: string;
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout?: number;
  excludeCredentials?: { id: string; type: 'public-key'; transports?: string[] }[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
}

export interface PublicKeyCredentialRequestOptionsJSONLike {
  challenge: string;
  rpId?: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: { id: string; type: 'public-key'; transports?: string[] }[];
}
