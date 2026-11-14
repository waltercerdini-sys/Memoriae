import { useCallback, useEffect, useState } from 'react';
import { api, type SchedaDaRicontrollare, type CasoOperatore } from './api';
import { salvaBytes } from './apertura';

const data = (s: string) => new Date(s).toLocaleString('it-CH', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const STATI: Record<CasoOperatore['stato'], string> = {
  richiesta: 'Da verificare',
  'in-verifica': 'In verifica',
  'in-attesa': 'Approvata, in attesa',
  rilasciata: 'Rilasciata',
  bloccata: 'Bloccata dal proprietario',
  respinta: 'Respinta',
};

/** Pannello dell'operatore MEMORIAE: verifica umana di ogni richiesta d'apertura. */
export function Operatore({ prova }: { prova: boolean }) {
  const [casi, setCasi] = useState<CasoOperatore[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const carica = useCallback(() => api.casiOperatore().then((r) => setCasi(r.casi)).catch((e) => setErrore(e.message)), []);
  useEffect(() => {
    void carica();
  }, [carica]);

  async function azione(fn: () => Promise<unknown>) {
    setErrore(null);
    try {
      await fn();
      await carica();
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  if (!casi) return errore ? <p className="avviso">{errore}</p> : <p className="tenue">Un momento…</p>;
  const aperti = casi.filter((c) => c.stato === 'richiesta' || c.stato === 'in-verifica');
  const altri = casi.filter((c) => !aperti.includes(c));
  return (
    <div>
      {prova && (
        <p className="avviso">
          Modalità prova: chiunque può fare da operatore, ma mai sulle cassaforti in cui è coinvolto. In produzione solo gli operatori indicati.
        </p>
      )}
      {errore && <p className="avviso">{errore}</p>}
      <h2>Da verificare ({aperti.length})</h2>
      {aperti.length === 0 && <p className="tenue">Nessuna richiesta in sospeso.</p>}
      {aperti.map((c) => (
        <div key={c.id} className="riquadro">
          <p>
            <span className="pillola">{c.ambito === 'emergenza' ? 'Emergenza' : 'Decesso'}</span> {STATI[c.stato]} · {data(c.creatoIl)}
          </p>
          <p>
            <strong>Cassaforte di</strong> {c.proprietario.nome} ({c.proprietario.email})
            <br />
            <strong>Chiede</strong> {c.richiedente.nome} {c.richiedente.email && `(${c.richiedente.email})`}
          </p>
          <p className="note">{c.motivo}</p>
          {c.documenti.map((d) => (
            <button key={d.id} className="secondario" onClick={() => azione(async () => salvaBytes(await api.documentoOperatore(c.id, d.id), d.nome, d.tipo))}>
              Documento «{d.nome}»
            </button>
          ))}
          {c.documenti.length === 0 && <p className="tenue">Nessun documento allegato.</p>}
          <div className="riquadro">
            <p className="tenue">
              Prima di approvare: contatta chi chiede, verifica il documento (per esempio con l'ufficio di stato civile o il reparto), prova a raggiungere il proprietario.
            </p>
            {c.stato === 'richiesta' ? (
              <button className="primario" onClick={() => azione(() => api.avviaVerifica(c.id))}>
                Prendo in carico la verifica
              </button>
            ) : c.verificatoDaMe ? (
              <>
                <label>
                  Nota (obbligatoria per respingere)
                  <textarea rows={2} value={note[c.id] ?? ''} onChange={(e) => setNote({ ...note, [c.id]: e.target.value })} />
                </label>
                <button className="primario" onClick={() => azione(() => api.approva(c.id, note[c.id] || undefined))}>
                  Approva: inizia l'attesa ({c.ambito === 'emergenza' ? '72 ore' : '14 giorni'})
                </button>
                <button className="secondario" onClick={() => azione(() => api.respingi(c.id, note[c.id] ?? ''))}>
                  Respingi
                </button>
              </>
            ) : (
              <p className="tenue">In verifica da un altro operatore.</p>
            )}
          </div>
        </div>
      ))}
      <Catalogo />
      {altri.length > 0 && (
        <>
          <h2>Storico</h2>
          <ul className="voci">
            {altri.map((c) => (
              <li key={c.id} className="voce aperta">
                <span className="titolo">
                  {c.proprietario.nome} – {c.ambito}
                </span>
                <span className="tenue">
                  {STATI[c.stato]}
                  {c.stato === 'in-attesa' && c.attesaFinoAl && ` fino al ${data(c.attesaFinoAl)}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const giorno = (s: string) => new Date(s).toLocaleDateString('it-CH', { day: 'numeric', month: 'long', year: 'numeric' });

/** Schede del catalogo la cui pagina ufficiale è cambiata o non risponde: le ricontrolla l'operatore. */
function Catalogo() {
  const [schede, setSchede] = useState<SchedaDaRicontrollare[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const carica = useCallback(() => {
    api.catalogoDaRicontrollare().then((r) => setSchede(r.daRicontrollare)).catch((e: Error) => setErrore(e.message));
  }, []);
  useEffect(carica, [carica]);
  if (!schede) return null;
  return (
    <>
      <h2>Catalogo da ricontrollare ({schede.length})</h2>
      {schede.length === 0 && <p className="tenue">Tutte le pagine ufficiali sono come all'ultima verifica.</p>}
      {schede.map((x) => (
        <div key={x.slug} className="riquadro">
          <p>
            <strong>{x.nome}</strong>{' '}
            <span className="pillola chiara">{x.stato === 'irraggiungibile' ? 'Pagina non raggiungibile' : 'Pagina cambiata'}</span>
          </p>
          <p className="tenue">
            {x.controllataIl && `Controllo del ${giorno(x.controllataIl)}. `}
            {x.verificatoIl && `Ultima verifica: ${giorno(x.verificatoIl)}.`}
          </p>
          {x.fonte && (
            <p>
              <a href={x.fonte} target="_blank" rel="noreferrer noopener">
                Apri la pagina ufficiale
              </a>
            </p>
          )}
          <p className="tenue">
            Confronta la pagina con le istruzioni della scheda. Se le istruzioni vanno cambiate, segnalalo a chi cura il catalogo prima di confermare.
          </p>
          <button
            className="secondario"
            onClick={() =>
              api
                .schedaRicontrollata(x.slug)
                .then(carica)
                .catch((e: Error) => setErrore(e.message))
            }
          >
            Ricontrollata: le istruzioni sono ancora giuste
          </button>
        </div>
      ))}
      {errore && <p className="avviso">{errore}</p>}
    </>
  );
}
