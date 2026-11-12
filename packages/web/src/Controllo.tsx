import { useEffect, useState } from 'react';
import { api, type StatoControllo } from './api';

const FREQUENZE = [
  { giorni: 7, testo: 'Ogni settimana' },
  { giorni: 30, testo: 'Ogni mese' },
  { giorni: 90, testo: 'Ogni tre mesi' },
];

const data = (s: string) => new Date(s).toLocaleDateString('it-CH', { day: 'numeric', month: 'long', year: 'numeric' });

/** Controllo periodico «sono qui»: frequenza, pausa, conferma immediata. */
export function Controllo() {
  const [c, setC] = useState<StatoControllo | null>(null);
  const [esito, setEsito] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const carica = () => api.controllo().then(setC).catch((e) => setErrore(e.message));
  useEffect(() => {
    void carica();
  }, []);

  async function salva(intervalloGiorni: number, inPausa: boolean) {
    setErrore(null);
    try {
      await api.impostaControllo(intervalloGiorni, inPausa);
      await carica();
      setEsito(inPausa ? 'Controllo in pausa: non ti scriveremo finché non lo riattivi.' : 'Impostazione salvata.');
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  async function sonoQui() {
    setErrore(null);
    try {
      await api.sonoQui();
      await carica();
      setEsito('Grazie! Abbiamo registrato che stai bene.');
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  if (!c) return errore ? <p className="avviso">{errore}</p> : <p className="tenue">Un momento…</p>;
  const frequenze = FREQUENZE.some((f) => f.giorni === c.intervalloGiorni)
    ? FREQUENZE
    : [...FREQUENZE, { giorni: c.intervalloGiorni, testo: `Ogni ${c.intervalloGiorni} giorni` }];

  return (
    <div>
      <div className="riquadro">
        <h2>Controllo periodico</h2>
        <p>
          Ogni tanto ti scriviamo per sapere se va tutto bene: basta un clic sul collegamento nell'e-mail, oppure entrare nell'app.
          Se non rispondi a 3 promemoria, avvisiamo le tue persone di fiducia. <strong>Nessuno apre la tua cassaforte</strong> senza
          una verifica fatta da una persona.
        </p>
        {c.inPausa ? (
          <p className="pillola">In pausa</p>
        ) : (
          <p>
            Ultima conferma: <strong>{data(c.ultimoSonoQui)}</strong>. Prossimo controllo: <strong>{data(c.prossimaScadenza)}</strong>.
            {c.promemoriaInviati > 0 && <> Ti abbiamo già scritto {c.promemoriaInviati} {c.promemoriaInviati === 1 ? 'volta' : 'volte'}.</>}
          </p>
        )}
        <button className="primario" onClick={sonoQui}>
          Sono qui, va tutto bene
        </button>
      </div>

      <div className="riquadro">
        <h2>Ogni quanto?</h2>
        <fieldset className="scelte-ruolo">
          <legend>Frequenza del controllo</legend>
          {frequenze.map((f) => (
            <label key={f.giorni} className="spunta">
              <input type="radio" name="frequenza" checked={c.intervalloGiorni === f.giorni} onChange={() => salva(f.giorni, c.inPausa)} />
              <span>{f.testo}</span>
            </label>
          ))}
        </fieldset>
        <button className="link" onClick={() => salva(c.intervalloGiorni, !c.inPausa)}>
          {c.inPausa ? 'Riattiva il controllo' : 'Metti in pausa (per esempio durante un lungo viaggio)'}
        </button>
      </div>
      {esito && <p className="esito">{esito}</p>}
      {errore && <p className="avviso">{errore}</p>}
    </div>
  );
}
