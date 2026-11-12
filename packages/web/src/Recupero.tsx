import { useState } from 'react';
import { api, ApiError, type Utente } from './api';
import { aggiungiAccesso, apriConCodiceRecupero } from './vault';
import { createPasskey, prfOnly } from './webauthn';

/**
 * Recupero dell'accesso (passkey persa o nuovo dispositivo):
 * 1. e-mail → codice di 6 cifre;  2. codice di recupero stampato;  3. nuova passkey (o password).
 */
type Passo =
  | { n: 'email' }
  | { n: 'codice-email'; email: string }
  | { n: 'codice-stampato'; email: string; vaultId: string; chiaveCifrata: Parameters<typeof apriConCodiceRecupero>[1] }
  | { n: 'nuova-passkey'; vaultId: string; vaultKey: Uint8Array; verificatore: string }
  | { n: 'password'; vaultId: string; vaultKey: Uint8Array; utente: Utente };

export function Recupero(p: { onFatto: (vaultKey: Uint8Array, utente: Utente) => void; onAnnulla: () => void }) {
  const [passo, setPasso] = useState<Passo>({ n: 'email' });
  const [errore, setErrore] = useState<string | null>(null);
  const [occupato, setOccupato] = useState(false);
  const [campo, setCampo] = useState('');
  const [campo2, setCampo2] = useState('');

  async function esegui(fn: () => Promise<void>) {
    setErrore(null);
    setOccupato(true);
    try {
      await fn();
      setCampo('');
      setCampo2('');
    } catch (e) {
      const msg = e instanceof ApiError || e instanceof Error ? e.message : String(e);
      setErrore(msg.includes('NotAllowedError') ? 'Operazione annullata o non consentita dal dispositivo.' : msg);
    } finally {
      setOccupato(false);
    }
  }

  const avviso = errore && (
    <p className="avviso" role="alert">
      {errore}
    </p>
  );

  if (passo.n === 'email') {
    return (
      <form
        className="passo"
        onSubmit={(e) => {
          e.preventDefault();
          const email = campo.trim().toLowerCase();
          void esegui(async () => {
            await api.recuperoInizia(email);
            setPasso({ n: 'codice-email', email });
          });
        }}
      >
        <h1>Recupera l'accesso</h1>
        <p>
          Hai perso o cambiato il dispositivo? Ti servono due cose: l'accesso alla tua e-mail e il <b>codice di recupero</b> che hai
          stampato quando hai creato la cassaforte.
        </p>
        {avviso}
        <label>
          E-mail dell'account
          <input type="email" value={campo} onChange={(e) => setCampo(e.target.value)} required autoComplete="email" />
        </label>
        <button className="primario" type="submit" disabled={occupato}>
          {occupato ? 'Invio…' : 'Mandami il codice'}
        </button>
        <button className="link" type="button" onClick={p.onAnnulla}>
          Annulla
        </button>
      </form>
    );
  }

  if (passo.n === 'codice-email') {
    return (
      <form
        className="passo"
        onSubmit={(e) => {
          e.preventDefault();
          void esegui(async () => {
            const r = await api.recuperoVerificaEmail(passo.email, campo.trim());
            setPasso({ n: 'codice-stampato', email: passo.email, vaultId: r.cassaforteId, chiaveCifrata: r.chiaveCifrata });
          });
        }}
      >
        <h1>Controlla la tua e-mail</h1>
        <p>
          Se l'indirizzo <b>{passo.email}</b> corrisponde a una cassaforte, ti abbiamo mandato un codice di 6 cifre. Vale 15 minuti.
        </p>
        {avviso}
        <label>
          Codice ricevuto
          <input inputMode="numeric" pattern="\d{6}" maxLength={6} value={campo} onChange={(e) => setCampo(e.target.value)} required autoComplete="one-time-code" />
        </label>
        <button className="primario" type="submit" disabled={occupato}>
          {occupato ? 'Verifico…' : 'Continua'}
        </button>
        <button className="link" type="button" onClick={() => setPasso({ n: 'email' })}>
          Non è arrivato? Richiedilo
        </button>
      </form>
    );
  }

  if (passo.n === 'codice-stampato') {
    return (
      <form
        className="passo"
        onSubmit={(e) => {
          e.preventDefault();
          void esegui(async () => {
            const { vaultKey, verificatore } = await apriConCodiceRecupero(passo.vaultId, passo.chiaveCifrata, campo);
            setPasso({ n: 'nuova-passkey', vaultId: passo.vaultId, vaultKey, verificatore });
          });
        }}
      >
        <h1>Il tuo codice di recupero</h1>
        <p>Ricopia il codice che hai stampato. Non importa se usi maiuscole o minuscole, trattini o spazi.</p>
        {avviso}
        <label>
          Codice di recupero
          <textarea className="campo-codice" rows={3} value={campo} onChange={(e) => setCampo(e.target.value)} required spellCheck={false} autoCapitalize="characters" />
        </label>
        <button className="primario" type="submit" disabled={occupato}>
          {occupato ? 'Apro la cassaforte…' : 'Apri la cassaforte'}
        </button>
      </form>
    );
  }

  if (passo.n === 'nuova-passkey') {
    return (
      <section className="passo">
        <h1>Crea una nuova passkey</h1>
        <p>Il codice è giusto. Ora crea una passkey su questo dispositivo: sarà la tua nuova chiave per entrare.</p>
        <p className="tenue">Le passkey che usavi prima verranno disattivate e riceverai un avviso per e-mail.</p>
        {avviso}
        <button
          className="primario"
          disabled={occupato}
          onClick={() =>
            esegui(async () => {
              const { challengeId, opzioni } = await api.recuperoPasskeyOpzioni(passo.verificatore);
              const reg = await createPasskey(opzioni);
              const r = await api.recuperoCompleta(challengeId, reg.risposta, passo.verificatore);
              const prf = reg.prf ?? (await prfOnly(reg.credentialId).catch(() => null));
              if (prf) {
                await aggiungiAccesso(passo.vaultId, passo.vaultKey, { tipo: 'passkey', credentialId: reg.credentialId, prf });
                p.onFatto(passo.vaultKey, r.utente);
              } else {
                setPasso({ n: 'password', vaultId: passo.vaultId, vaultKey: passo.vaultKey, utente: r.utente });
              }
            })
          }
        >
          {occupato ? 'Attendi…' : 'Crea la passkey'}
        </button>
      </section>
    );
  }

  // Dispositivo senza PRF: la cassaforte si aprirà con una password.
  const ok = campo.length >= 12 && campo === campo2;
  return (
    <form
      className="passo"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        void esegui(async () => {
          await aggiungiAccesso(passo.vaultId, passo.vaultKey, { tipo: 'password', password: campo });
          p.onFatto(passo.vaultKey, passo.utente);
        });
      }}
    >
      <h1>Scegli una password per la cassaforte</h1>
      <p>Questo dispositivo non può aprire la cassaforte con la sola passkey: serve anche una password di almeno 12 caratteri.</p>
      {avviso}
      <label>
        Password
        <input type="password" value={campo} onChange={(e) => setCampo(e.target.value)} autoComplete="new-password" minLength={12} required />
      </label>
      <label>
        Ripeti la password
        <input type="password" value={campo2} onChange={(e) => setCampo2(e.target.value)} autoComplete="new-password" required />
      </label>
      <button className="primario" type="submit" disabled={!ok || occupato}>
        {occupato ? 'Salvo…' : 'Salva e apri la cassaforte'}
      </button>
    </form>
  );
}
