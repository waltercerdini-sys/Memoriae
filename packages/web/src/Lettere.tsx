import { useState } from 'react';
import { api, type Persona } from './api';
import { aggiungiVoce } from './vault';

export const dataLunga = (s: string) => new Date(s).toLocaleDateString('it-CH', { day: 'numeric', month: 'long', year: 'numeric' });

/** Domani, come «AAAA-MM-GG» (le lettere con data si consegnano da domani in poi). */
function domani(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

/** «Anna», «Anna e Marco», «Anna, Marco e 2 altri». */
export function nomiDestinatari(ids: string[], persone: Persona[]): string {
  const nomi = persone.filter((p) => ids.includes(p.id)).map((p) => p.nome);
  if (nomi.length <= 2) return nomi.join(' e ');
  if (nomi.length === 3) return `${nomi[0]}, ${nomi[1]} e ${nomi[2]}`;
  return `${nomi[0]}, ${nomi[1]} e ${nomi.length - 2} altri`;
}

interface NuovoIndirizzo {
  nome: string;
  email: string;
}

/** Una lettera per il futuro: per una o più persone, da aprire subito dopo o in una data precisa. */
export function NuovaLettera(p: {
  vaultKey: Uint8Array;
  persone: Persona[];
  scegliDocumenti: (files: File[], onCambia: (f: File[]) => void) => React.ReactNode;
  onFatto: (id: string) => Promise<void>;
  onAnnulla: () => void;
}) {
  const [per, setPer] = useState<string[]>(p.persone.length === 1 ? [p.persone[0]!.id] : []);
  const [nuovi, setNuovi] = useState<NuovoIndirizzo[]>([]);
  const [nomeNuovo, setNomeNuovo] = useState('');
  const [emailNuova, setEmailNuova] = useState('');
  const [quando, setQuando] = useState<'subito' | 'data'>('data');
  const [data, setData] = useState('');
  const [titolo, setTitolo] = useState('');
  const [testo, setTesto] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [salvo, setSalvo] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const quanti = per.length + nuovi.length;
  const primoNome = p.persone.find((x) => x.id === per[0])?.nome ?? nuovi[0]?.nome ?? '';
  const emailValida = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNuova.trim());

  function aggiungiIndirizzo() {
    const nome = nomeNuovo.trim();
    const email = emailNuova.trim().toLowerCase();
    if (!nome || !emailValida) return setErrore('Scrivi il nome e un indirizzo e-mail valido.');
    if (nuovi.some((x) => x.email === email) || p.persone.some((x) => x.email === email)) return setErrore('Questo indirizzo c\'è già.');
    setErrore(null);
    setNuovi([...nuovi, { nome, email }]);
    setNomeNuovo('');
    setEmailNuova('');
  }

  return (
    <form
      className="passo"
      onSubmit={async (e) => {
        e.preventDefault();
        if (quanti === 0) return setErrore('Scegli almeno una persona a cui va la lettera.');
        if (quando === 'data' && !data) return setErrore('Scegli il giorno in cui la lettera si aprirà.');
        setErrore(null);
        setSalvo(true);
        try {
          // Chi non è tra le persone viene aggiunto come destinatario «solo lettere», senza invito.
          const aggiunti: string[] = [];
          for (const n of nuovi) {
            const id = crypto.randomUUID();
            await api.aggiungiPersona({ id, ruolo: 'destinatario', nome: n.nome, email: n.email, soloLettere: true });
            aggiunti.push(id);
          }
          const destinatari = [...per, ...aggiunti];
          // Mezzogiorno ora svizzera: la lettera si apre nel corso di quel giorno.
          const consegnaIl = quando === 'data' ? new Date(`${data}T12:00:00+01:00`).toISOString() : null;
          const id = await aggiungiVoce(p.vaultKey, {
            tipo: 'lettera',
            emergenza: false,
            titolo: titolo.trim() || (quanti === 1 ? `Per ${primoNome}` : 'Per voi'),
            note: testo,
            files,
            extra: { destinatari },
            lettera: { destinatari, consegnaIl },
          });
          await p.onFatto(id);
        } catch (err) {
          setErrore(err instanceof Error ? err.message : 'Salvataggio non riuscito');
          setSalvo(false);
        }
      }}
    >
      <p className="etichetta">Nuova lettera</p>
      <h1>Lettera per il futuro</h1>
      <p className="tenue">
        La lettera resta chiusa e cifrata. Si apre solo dopo la tua scomparsa, verificata come ogni apertura, e non prima del giorno che
        scegli. Se la scrivi a più persone, ognuna riceve la sua copia.
      </p>
      <fieldset className="scelte-ruolo">
        <legend>Per chi</legend>
        {p.persone.length === 0 && <p className="tenue">Nella scheda Persone non c'è ancora nessuno: aggiungi qui sotto nome ed e-mail.</p>}
        {p.persone.map((x) => (
          <label key={x.id} className="spunta">
            <input type="checkbox" checked={per.includes(x.id)} onChange={(e) => setPer(e.target.checked ? [...per, x.id] : per.filter((y) => y !== x.id))} />
            {x.nome}
          </label>
        ))}
        {nuovi.map((n) => (
          <p key={n.email} className="spunta">
            <span>
              ✓ {n.nome} <span className="tenue">({n.email})</span>
            </span>{' '}
            <button type="button" className="link" onClick={() => setNuovi(nuovi.filter((x) => x.email !== n.email))}>
              Togli
            </button>
          </p>
        ))}
        <div className="riga-campi">
          <label>
            Nome
            <input value={nomeNuovo} onChange={(e) => setNomeNuovo(e.target.value)} maxLength={120} placeholder="Per esempio Lucia" />
          </label>
          <label>
            E-mail
            <input type="email" value={emailNuova} onChange={(e) => setEmailNuova(e.target.value)} maxLength={254} placeholder="lucia@esempio.ch" />
          </label>
          <button type="button" className="secondario" disabled={!nomeNuovo.trim() || !emailValida} onClick={aggiungiIndirizzo}>
            Aggiungi un indirizzo e-mail
          </button>
        </div>
        <p className="tenue">Chi aggiungi così non riceve nessun invito adesso: la lettera resta una sorpresa.</p>
      </fieldset>
      <fieldset className="scelte-ruolo">
        <legend>Quando si apre</legend>
        <label className="spunta">
          <input type="radio" name="quando" checked={quando === 'data'} onChange={() => setQuando('data')} />
          <span>
            <b>In un giorno preciso</b>
            <br />
            <span className="tenue">Per esempio i 18 anni, un matrimonio, il primo Natale dopo.</span>
          </span>
        </label>
        {quando === 'data' && (
          <label>
            Giorno
            <input type="date" min={domani()} value={data} onChange={(e) => setData(e.target.value)} required />
          </label>
        )}
        <label className="spunta">
          <input type="radio" name="quando" checked={quando === 'subito'} onChange={() => setQuando('subito')} />
          <span>
            <b>Appena possibile</b>
            <br />
            <span className="tenue">Insieme a tutto il resto, quando la cassaforte viene aperta.</span>
          </span>
        </label>
      </fieldset>
      <label>
        Titolo
        <input value={titolo} onChange={(e) => setTitolo(e.target.value)} maxLength={200} placeholder={quanti > 1 ? 'Per voi' : `Per ${primoNome}`} />
      </label>
      <label>
        La lettera
        <textarea className="carta" value={testo} onChange={(e) => setTesto(e.target.value)} rows={12} maxLength={20000} required placeholder="Caro…" />
      </label>
      {p.scegliDocumenti(files, setFiles)}
      {errore && <p className="avviso">{errore}</p>}
      <button className="primario" type="submit" disabled={salvo || !testo.trim() || quanti === 0}>
        {salvo ? 'Cifro e salvo…' : quanti > 1 ? `Chiudi la lettera nella cassaforte (${quanti} persone)` : 'Chiudi la lettera nella cassaforte'}
      </button>
      <button className="link" type="button" onClick={p.onAnnulla}>
        Annulla
      </button>
    </form>
  );
}

/** Testo di una lettera, come su un foglio. */
export function FoglioLettera({ titolo, testo, da }: { titolo: string; testo: string; da?: string }) {
  return (
    <article className="foglio-lettera">
      <h2>{titolo}</h2>
      {testo.split(/\n{2,}/).map((par, i) => (
        <p key={i}>{par}</p>
      ))}
      {da && <p className="firma">{da}</p>}
    </article>
  );
}
