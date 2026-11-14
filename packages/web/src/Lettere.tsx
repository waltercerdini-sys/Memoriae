import { useState } from 'react';
import type { Persona } from './api';
import { aggiungiVoce } from './vault';

export const dataLunga = (s: string) => new Date(s).toLocaleDateString('it-CH', { day: 'numeric', month: 'long', year: 'numeric' });

/** Domani, come «AAAA-MM-GG» (le lettere con data si consegnano da domani in poi). */
function domani(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Una lettera per il futuro: per una persona, da aprire subito dopo o in una data precisa. */
export function NuovaLettera(p: {
  vaultKey: Uint8Array;
  persone: Persona[];
  scegliDocumenti: (files: File[], onCambia: (f: File[]) => void) => React.ReactNode;
  onFatto: () => Promise<void>;
  onAnnulla: () => void;
  onVaiPersone: () => void;
}) {
  const [per, setPer] = useState(p.persone[0]?.id ?? '');
  const [quando, setQuando] = useState<'subito' | 'data'>('data');
  const [data, setData] = useState('');
  const [titolo, setTitolo] = useState('');
  const [testo, setTesto] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [salvo, setSalvo] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  if (p.persone.length === 0) {
    return (
      <section className="passo">
        <h1>Lettera per il futuro</h1>
        <p>Una lettera va sempre a qualcuno: aggiungi prima la persona (anche senza e-mail, per esempio un nipote piccolo).</p>
        <button className="primario" onClick={p.onVaiPersone}>
          Aggiungi una persona
        </button>
        <button className="link" onClick={p.onAnnulla}>
          Annulla
        </button>
      </section>
    );
  }

  const persona = p.persone.find((x) => x.id === per);
  return (
    <form
      className="passo"
      onSubmit={async (e) => {
        e.preventDefault();
        if (quando === 'data' && !data) return setErrore('Scegli il giorno in cui la lettera si aprirà.');
        setErrore(null);
        setSalvo(true);
        try {
          // Mezzogiorno ora svizzera: la lettera si apre nel corso di quel giorno.
          const consegnaIl = quando === 'data' ? new Date(`${data}T12:00:00+01:00`).toISOString() : null;
          await aggiungiVoce(p.vaultKey, {
            tipo: 'lettera',
            emergenza: false,
            titolo: titolo.trim() || `Per ${persona?.nome ?? ''}`,
            note: testo,
            files,
            extra: { destinatari: [per] },
            lettera: { destinatarioId: per, consegnaIl },
          });
          await p.onFatto();
        } catch (err) {
          setErrore(err instanceof Error ? err.message : 'Salvataggio non riuscito');
          setSalvo(false);
        }
      }}
    >
      <p className="etichetta">Lettera per il futuro</p>
      <h1>Nuova lettera</h1>
      <p className="tenue">
        La lettera resta chiusa e cifrata. Si apre solo dopo la tua scomparsa, verificata come ogni apertura, e non prima del giorno che
        scegli.
      </p>
      <label>
        Per chi
        <select value={per} onChange={(e) => setPer(e.target.value)}>
          {p.persone.map((x) => (
            <option key={x.id} value={x.id}>
              {x.nome}
            </option>
          ))}
        </select>
      </label>
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
        <input value={titolo} onChange={(e) => setTitolo(e.target.value)} maxLength={200} placeholder={`Per ${persona?.nome ?? ''}`} />
      </label>
      <label>
        La lettera
        <textarea className="carta" value={testo} onChange={(e) => setTesto(e.target.value)} rows={12} maxLength={20000} required placeholder="Caro…" />
      </label>
      {p.scegliDocumenti(files, setFiles)}
      {errore && <p className="avviso">{errore}</p>}
      <button className="primario" type="submit" disabled={salvo || !testo.trim()}>
        {salvo ? 'Cifro e salvo…' : 'Chiudi la lettera nella cassaforte'}
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
