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

export type Ruolo = 'fiduciario' | 'destinatario' | 'fiduciario-destinatario';
export type StatoInvito = 'da-invitare' | 'invitato' | 'accettato' | 'rifiutato' | 'revocato';

export interface Persona {
  id: string;
  ruolo: Ruolo;
  nome: string;
  email: string | null;
  statoInvito: StatoInvito;
  chiavePubblica: string | null;
  haMetaFiduciario: boolean;
}

export interface PacchettoRemoto {
  destinatarioId: string;
  ambito: 'decesso' | 'emergenza';
  tipo: 'sealed-to-recipient' | 'release-only';
  esterno: Envelope;
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
  modificaVoce: (id: string, dati: { contenuto?: Envelope; emergenza?: boolean }) => call<{ ok: true }>('PATCH', `/v1/cassaforte/voci/${id}`, dati),
  persone: () => call<{ persone: Persona[] }>('GET', '/v1/cassaforte/persone'),
  aggiungiPersona: (p: { id: string; ruolo: Ruolo; nome: string; email?: string }) => call<{ id: string }>('POST', '/v1/cassaforte/persone', p),
  rimuoviPersona: (id: string) => call<{ ok: true }>('DELETE', `/v1/cassaforte/persone/${id}`),
  invita: (id: string) => call<{ ok: true }>('POST', `/v1/cassaforte/persone/${id}/invito`),
  invito: (token: string) => call<{ proprietario: string; ruolo: Ruolo; nome: string }>('GET', `/v1/inviti/${token}`),
  accettaInvito: (token: string) => call<{ ok: true; proprietario: string }>('POST', '/v1/inviti/accetta', { token }),
  rifiutaInvito: (token: string) => call<{ ok: true }>('POST', '/v1/inviti/rifiuta', { token }),
  fiducia: () => call<{ cassaforti: { ruolo: Ruolo; proprietario: string }[] }>('GET', '/v1/fiducia'),
  rilascio: () => call<{ configurato: boolean; copiaProprietario: Envelope | null }>('GET', '/v1/cassaforte/rilascio'),
  impostaRilascio: (d: { copiaProprietario: Envelope; metaMemoriae: { decesso: string; emergenza: string }; metaFiduciari: { personaId: string; sigillata: string }[] }) =>
    call<{ ok: true }>('PUT', '/v1/cassaforte/rilascio', d),
  metaFiduciario: (personaId: string, sigillata: string) => call<{ ok: true }>('PUT', `/v1/cassaforte/persone/${personaId}/meta`, { sigillata }),
  pacchetti: (riferimentoRilascio: string, pacchetti: PacchettoRemoto[]) =>
    call<{ ok: true; numero: number }>('PUT', '/v1/cassaforte/pacchetti', { riferimentoRilascio, pacchetti }),
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
