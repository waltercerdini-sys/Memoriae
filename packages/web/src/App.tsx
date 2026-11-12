import { useEffect, useState } from 'react';
import { api, ApiError, type Utente } from './api';
import { Inventario, type InvitoInSospeso } from './Inventario';
import { Recupero } from './Recupero';
import { apriConPasskey, apriConPassword, creaCassaforte, metodoPer, type SegretoAccesso } from './vault';
import { createPasskey, passkeysSupported, prfOnly, usePasskey } from './webauthn';

type Schermata =
  | { nome: 'caricamento' }
  | { nome: 'benvenuto' }
  | { nome: 'registrazione' }
  | { nome: 'password-nuova'; credentialId: string }
  | { nome: 'codice'; codice: string; vaultId: string; vaultKey: Uint8Array }
  | { nome: 'accesso'; messaggio?: string }
  | { nome: 'password-apri' }
  | { nome: 'recupero' }
  | { nome: 'inventario'; vaultId: string; vaultKey: Uint8Array };

export function App() {
  const [s, setS] = useState<Schermata>({ nome: 'caricamento' });
  const [utente, setUtente] = useState<Utente | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [occupato, setOccupato] = useState(false);
  const [invito, setInvito] = useState<InvitoInSospeso | null>(null);

  // Collegamento d'invito ricevuto per e-mail: ?invito=<token>
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('invito');
    if (!token) return;
    api
      .invito(token)
      .then((r) => setInvito({ token, proprietario: r.proprietario, ruolo: r.ruolo }))
      .catch(() => setErrore('Questo invito non è più valido: chiedi a chi te l\'ha mandato di inviarlo di nuovo.'));
  }, []);

  // Collegamento del promemoria «sono qui»: un clic, senza accedere.
  const [grazie, setGrazie] = useState<string | null>(null);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('sonoqui');
    if (!token) return;
    window.history.replaceState(null, '', window.location.pathname);
    api
      .sonoQuiDaEmail(token)
      .then(() => setGrazie('Grazie! Abbiamo registrato che stai bene. Non serve fare altro.'))
      .catch(() => setGrazie('Questo collegamento è già stato usato o è scaduto. Se vuoi confermare che stai bene, entra nell\'app.'));
  }, []);

  // Collegamento «blocca» nell'e-mail al proprietario: funziona senza accedere.
  const [blocco, setBlocco] = useState<{ token: string; richiedente: string; ambito: string; fatto: boolean } | null>(null);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('blocca');
    if (!token) return;
    window.history.replaceState(null, '', window.location.pathname);
    api
      .infoBlocco(token)
      .then((r) => setBlocco({ token, richiedente: r.richiedente, ambito: r.ambito, fatto: false }))
      .catch(() => setErrore('Questo collegamento è già stato usato oppure la richiesta è già chiusa.'));
  }, []);
  const bloccaOra = () =>
    esegui(async () => {
      if (!blocco) return;
      await api.bloccaDaEmail(blocco.token);
      setBlocco({ ...blocco, fatto: true });
    });

  const chiudiInvito = () => {
    setInvito(null);
    window.history.replaceState(null, '', window.location.pathname);
  };

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
    const { vaultId, vaultKey, codiceRecupero } = await creaCassaforte(segreto);
    setS({ nome: 'codice', codice: codiceRecupero, vaultId, vaultKey });
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
      if (metodo === 'passkey' && a.prf) setS({ nome: 'inventario', vaultId: remota.id, vaultKey: await apriConPasskey(remota, a.credentialId, a.prf) });
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
        {grazie && (
          <p className="esito" role="status">
            {grazie}
          </p>
        )}
        {blocco && (
          <div className="riquadro evidenza">
            {blocco.fatto ? (
              <>
                <h2>Richiesta bloccata</h2>
                <p>Non succede nulla: la tua cassaforte resta chiusa. Abbiamo avvisato le tue persone di fiducia.</p>
              </>
            ) : (
              <>
                <h2>{blocco.richiedente} ha chiesto di aprire la tua cassaforte</h2>
                <p>Motivo indicato: {blocco.ambito === 'emergenza' ? 'emergenza' : 'decesso'}. Se stai bene, bloccala: basta un clic.</p>
                <button className="primario" onClick={bloccaOra} disabled={occupato}>
                  Sto bene: blocca la richiesta
                </button>
              </>
            )}
          </div>
        )}
        {s.nome === 'caricamento' && <p className="tenue">Un momento…</p>}
        {invito && s.nome !== 'inventario' && (
          <div className="riquadro evidenza">
            <h2>{invito.proprietario} ti ha scelto</h2>
            <p>
              Per accettare serve una tua cassaforte MEMORIAE: è lì che riceverai, in modo sicuro, ciò che {invito.proprietario} ti
              affiderà. Creala o accedi: subito dopo potrai accettare.
            </p>
          </div>
        )}
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
        {s.nome === 'codice' && <CodiceRecupero codice={s.codice} onFatto={() => setS({ nome: 'inventario', vaultId: s.vaultId, vaultKey: s.vaultKey })} />}
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
            onFatto={(vaultId, vaultKey, u) => {
              setUtente(u);
              setS({ nome: 'inventario', vaultId, vaultKey });
            }}
          />
        )}
        {s.nome === 'password-apri' && (
          <PasswordApri
            occupato={occupato}
            onInvia={(password) =>
              esegui(async () => {
                const remota = await api.cassaforte();
                setS({ nome: 'inventario', vaultId: remota.id, vaultKey: await apriConPassword(remota, password) });
              })
            }
          />
        )}
        {s.nome === 'inventario' && utente && (
          <Inventario vaultId={s.vaultId} vaultKey={s.vaultKey} utente={utente} invito={invito} onInvitoGestito={chiudiInvito} />
        )}
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
