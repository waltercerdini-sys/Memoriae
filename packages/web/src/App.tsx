import { useEffect, useState } from 'react';
import { api, ApiError, type Utente } from './api';
import { Inventario } from './Inventario';
import { Recupero } from './Recupero';
import { apriConPasskey, apriConPassword, creaCassaforte, metodoPer, type SegretoAccesso } from './vault';
import { createPasskey, passkeysSupported, prfOnly, usePasskey } from './webauthn';

type Schermata =
  | { nome: 'caricamento' }
  | { nome: 'benvenuto' }
  | { nome: 'registrazione' }
  | { nome: 'password-nuova'; credentialId: string }
  | { nome: 'codice'; codice: string; vaultKey: Uint8Array }
  | { nome: 'accesso'; messaggio?: string }
  | { nome: 'password-apri' }
  | { nome: 'recupero' }
  | { nome: 'inventario'; vaultKey: Uint8Array };

export function App() {
  const [s, setS] = useState<Schermata>({ nome: 'caricamento' });
  const [utente, setUtente] = useState<Utente | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [occupato, setOccupato] = useState(false);

  useEffect(() => {
    api
      .io()
      .then((r) => {
        setUtente(r.utente);
        setS({ nome: 'accesso', messaggio: 'Per sicurezza la cassaforte va riaperta con la passkey.' });
      })
      .catch(() => setS({ nome: 'benvenuto' }));
  }, []);

  async function esegui(fn: () => Promise<void>) {
    setErrore(null);
    setOccupato(true);
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof ApiError || e instanceof Error ? e.message : String(e);
      setErrore(msg.includes('NotAllowedError') || msg.includes('annullat') ? 'Operazione annullata o non consentita dal dispositivo.' : msg);
    } finally {
      setOccupato(false);
    }
  }

  async function completaCreazione(segreto: SegretoAccesso) {
    const { vaultKey, codiceRecupero } = await creaCassaforte(segreto);
    setS({ nome: 'codice', codice: codiceRecupero, vaultKey });
  }

  const registra = (nome: string, email: string) =>
    esegui(async () => {
      const { challengeId, opzioni } = await api.registrazioneOpzioni(nome, email);
      const reg = await createPasskey(opzioni);
      const r = await api.registrazioneVerifica(challengeId, reg.risposta);
      setUtente(r.utente);
      // Il segreto della passkey: subito, oppure con un secondo tocco.
      const prf = reg.prf ?? (await prfOnly(reg.credentialId).catch(() => null));
      if (prf) await completaCreazione({ tipo: 'passkey', credentialId: reg.credentialId, prf });
      else setS({ nome: 'password-nuova', credentialId: reg.credentialId });
    });

  const accedi = () =>
    esegui(async () => {
      const { challengeId, opzioni } = await api.accessoOpzioni();
      const a = await usePasskey(opzioni);
      const r = await api.accessoVerifica(challengeId, a.risposta);
      setUtente(r.utente);
      if (!r.haCassaforte) {
        // Registrazione interrotta prima di creare la cassaforte: la completiamo adesso.
        const prf = a.prf ?? (await prfOnly(a.credentialId).catch(() => null));
        if (prf) await completaCreazione({ tipo: 'passkey', credentialId: a.credentialId, prf });
        else setS({ nome: 'password-nuova', credentialId: a.credentialId });
        return;
      }
      const remota = await api.cassaforte();
      const metodo = metodoPer(remota, a.credentialId);
      if (metodo === 'passkey' && a.prf) setS({ nome: 'inventario', vaultKey: await apriConPasskey(remota, a.credentialId, a.prf) });
      else if (metodo === 'password' || metodo === 'passkey') setS({ nome: 'password-apri' });
      else throw new Error('Nessun metodo per aprire la cassaforte da questo dispositivo');
    });

  const esci = () =>
    esegui(async () => {
      await api.uscita();
      setUtente(null);
      setS({ nome: 'benvenuto' });
    });

  return (
    <div className="pagina">
      <header className="testata">
        <span className="marchio">MEMORIAE</span>
        {utente && s.nome !== 'benvenuto' && (
          <button className="link" onClick={esci} disabled={occupato}>
            Esci
          </button>
        )}
      </header>
      <main className="contenuto">
        {errore && (
          <p className="avviso" role="alert">
            {errore}
          </p>
        )}
        {s.nome === 'caricamento' && <p className="tenue">Un momento…</p>}
        {s.nome === 'benvenuto' && (
          <Benvenuto supportato={passkeysSupported()} onCrea={() => setS({ nome: 'registrazione' })} onAccedi={() => setS({ nome: 'accesso' })} />
        )}
        {s.nome === 'registrazione' && <Registrazione occupato={occupato} onInvia={registra} onIndietro={() => setS({ nome: 'benvenuto' })} />}
        {s.nome === 'password-nuova' && (
          <PasswordNuova
            occupato={occupato}
            onInvia={(password) => esegui(() => completaCreazione({ tipo: 'password', password }))}
          />
        )}
        {s.nome === 'codice' && <CodiceRecupero codice={s.codice} onFatto={() => setS({ nome: 'inventario', vaultKey: s.vaultKey })} />}
        {s.nome === 'accesso' && (
          <section className="passo">
            <h1>Apri la tua cassaforte</h1>
            {s.messaggio && <p className="tenue">{s.messaggio}</p>}
            <p>Usa Face ID, l'impronta, oppure il PIN o la password con cui sblocchi il dispositivo.</p>
            <button className="primario" onClick={accedi} disabled={occupato}>
              {occupato ? 'Attendi…' : 'Accedi con la passkey'}
            </button>
            <button className="link" onClick={() => setS({ nome: 'recupero' })}>
              Ho perso la passkey o ho cambiato dispositivo
            </button>
            {!utente && (
              <button className="link" onClick={() => setS({ nome: 'benvenuto' })}>
                Indietro
              </button>
            )}
          </section>
        )}
        {s.nome === 'recupero' && (
          <Recupero
            onAnnulla={() => setS({ nome: 'accesso' })}
            onFatto={(vaultKey, u) => {
              setUtente(u);
              setS({ nome: 'inventario', vaultKey });
            }}
          />
        )}
        {s.nome === 'password-apri' && (
          <PasswordApri
            occupato={occupato}
            onInvia={(password) =>
              esegui(async () => {
                const remota = await api.cassaforte();
                setS({ nome: 'inventario', vaultKey: await apriConPassword(remota, password) });
              })
            }
          />
        )}
        {s.nome === 'inventario' && utente && <Inventario vaultKey={s.vaultKey} utente={utente} />}
      </main>
    </div>
  );
}

function Benvenuto(p: { supportato: boolean; onCrea: () => void; onAccedi: () => void }) {
  return (
    <section className="passo">
      <h1>La tua vita digitale, in ordine</h1>
      <p>
        Un posto sicuro per l'elenco dei tuoi account, i documenti importanti e le tue volontà. Tutto viene cifrato su questo
        dispositivo: nemmeno noi possiamo leggerlo.
      </p>
      {!p.supportato && <p className="avviso">Questo browser non supporta le passkey. Usa un browser aggiornato (Safari, Chrome, Edge, Firefox).</p>}
      <button className="primario" onClick={p.onCrea} disabled={!p.supportato}>
        Crea la tua cassaforte
      </button>
      <button className="secondario" onClick={p.onAccedi} disabled={!p.supportato}>
        Ho già una cassaforte
      </button>
    </section>
  );
}

function Registrazione(p: { occupato: boolean; onInvia: (nome: string, email: string) => void; onIndietro: () => void }) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  return (
    <form
      className="passo"
      onSubmit={(e) => {
        e.preventDefault();
        p.onInvia(nome.trim(), email.trim());
      }}
    >
      <h1>Crea la tua cassaforte</h1>
      <label>
        Nome e cognome
        <input value={nome} onChange={(e) => setNome(e.target.value)} required autoComplete="name" />
      </label>
      <label>
        E-mail
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </label>
      <p className="tenue">
        Al passo successivo il dispositivo ti chiederà Face ID, l'impronta, oppure il PIN o la password con cui lo sblocchi: è la tua passkey, la chiave per entrare. Non serve
        ricordare una password.
      </p>
      <button className="primario" type="submit" disabled={p.occupato}>
        {p.occupato ? 'Attendi…' : 'Continua'}
      </button>
      <button className="link" type="button" onClick={p.onIndietro}>
        Indietro
      </button>
    </form>
  );
}

function PasswordNuova(p: { occupato: boolean; onInvia: (password: string) => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const ok = a.length >= 12 && a === b;
  return (
    <form
      className="passo"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) p.onInvia(a);
      }}
    >
      <h1>Scegli una password per la cassaforte</h1>
      <p>
        Il tuo dispositivo ti fa entrare con la passkey, ma non può proteggere il contenuto della cassaforte. Serve quindi anche una
        password, di almeno 12 caratteri. Una frase che ricordi bene va benissimo.
      </p>
      <label>
        Password
        <input type="password" value={a} onChange={(e) => setA(e.target.value)} autoComplete="new-password" minLength={12} required />
      </label>
      <label>
        Ripeti la password
        <input type="password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" required />
      </label>
      {b.length > 0 && a !== b && <p className="avviso">Le due password non coincidono.</p>}
      <button className="primario" type="submit" disabled={!ok || p.occupato}>
        {p.occupato ? 'Creo la cassaforte…' : 'Crea la cassaforte'}
      </button>
    </form>
  );
}

function PasswordApri(p: { occupato: boolean; onInvia: (password: string) => void }) {
  const [a, setA] = useState('');
  return (
    <form
      className="passo"
      onSubmit={(e) => {
        e.preventDefault();
        p.onInvia(a);
      }}
    >
      <h1>Password della cassaforte</h1>
      <label>
        Password
        <input type="password" value={a} onChange={(e) => setA(e.target.value)} autoComplete="current-password" required />
      </label>
      <button className="primario" type="submit" disabled={p.occupato}>
        {p.occupato ? 'Apro…' : 'Apri'}
      </button>
    </form>
  );
}

function CodiceRecupero(p: { codice: string; onFatto: () => void }) {
  const [conservato, setConservato] = useState(false);
  return (
    <section className="passo">
      <h1>Il tuo codice di recupero</h1>
      <p>
        Se un giorno perdi il telefono o la passkey, questo codice è l'unico modo per riaprire la cassaforte. Noi non lo conosciamo e non
        possiamo recuperarlo.
      </p>
      <p className="codice" aria-label="Codice di recupero">
        {p.codice}
      </p>
      <p className="tenue">Stampalo o scrivilo a mano, e conservalo insieme al testamento o in cassaforte.</p>
      <button className="secondario" onClick={() => window.print()}>
        Stampa il codice
      </button>
      <label className="spunta">
        <input type="checkbox" checked={conservato} onChange={(e) => setConservato(e.target.checked)} />
        Ho stampato o scritto il codice e l'ho messo al sicuro
      </label>
      <button className="primario" onClick={p.onFatto} disabled={!conservato}>
        Vai alla cassaforte
      </button>
    </section>
  );
}
