import { useEffect, useRef, useState } from 'react';
import { api, type Persona } from './api';
import { DOMANDE, prossimaDomanda } from './domandeRicordi';
import { nomiDestinatari } from './Lettere';
import { aggiornaVoce, aggiungiVoce, documentiDi, leggiFile, type Voce } from './vault';

const MAX_SECONDI = 180;
const CHIAVE_SALTATE = 'memoriae-domande-saltate';

const durata = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const giorno = (s: string) => new Date(s).toLocaleDateString('it-CH', { day: 'numeric', month: 'long', year: 'numeric' });

function leggiSaltate(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CHIAVE_SALTATE) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** Il formato audio che questo browser sa registrare (Safari: mp4, Chrome e Firefox: webm). */
function formatoAudio(): { mime: string; estensione: string } | null {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;
  for (const [mime, estensione] of [
    ['audio/mp4', 'm4a'],
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/webm', 'webm'],
    ['audio/ogg;codecs=opus', 'ogg'],
  ] as const) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, estensione };
  }
  return { mime: '', estensione: 'webm' };
}

/** Registra una risposta a voce, fino a 3 minuti, con l'ascolto prima di salvare. */
function Registratore(p: { onPronta: (f: File | null) => void }) {
  const [stato, setStato] = useState<'pronto' | 'registro' | 'fatto'>('pronto');
  const [secondi, setSecondi] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const formato = formatoAudio();

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      rec.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  if (!formato) return <p className="tenue">Questo browser non sa registrare la voce: scrivi la risposta qui sotto.</p>;

  async function inizia() {
    setErrore(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream, formato!.mime ? { mimeType: formato!.mime } : undefined);
      const pezzi: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && pezzi.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
        const tipo = r.mimeType || formato!.mime || 'audio/webm';
        const blob = new Blob(pezzi, { type: tipo });
        setUrl(URL.createObjectURL(blob));
        setStato('fatto');
        p.onPronta(new File([blob], `risposta.${formato!.estensione}`, { type: tipo.split(';')[0] }));
      };
      rec.current = r;
      r.start();
      setSecondi(0);
      setStato('registro');
      const t0 = Date.now();
      timer.current = setInterval(() => {
        const s = (Date.now() - t0) / 1000;
        setSecondi(s);
        if (s >= MAX_SECONDI && r.state === 'recording') r.stop();
      }, 250);
    } catch {
      setErrore('Non riesco a usare il microfono. Consenti a questo sito di usarlo (in Safari: Safari › Impostazioni › Siti web › Microfono) oppure scrivi la risposta.');
    }
  }

  return (
    <div className="registratore">
      {stato === 'pronto' && (
        <button type="button" className="primario registra" onClick={inizia}>
          ● Rispondi a voce
        </button>
      )}
      {stato === 'registro' && (
        <>
          <p className="in-registrazione" aria-live="polite">
            <span className="punto" aria-hidden="true" /> Sto registrando… {durata(secondi)} di {durata(MAX_SECONDI)}
          </p>
          <button type="button" className="primario" onClick={() => rec.current?.stop()}>
            ■ Ho finito
          </button>
        </>
      )}
      {stato === 'fatto' && url && (
        <>
          <p className="tenue">Ascolta la tua risposta prima di salvarla:</p>
          <audio controls src={url} />
          <button
            type="button"
            className="link"
            onClick={() => {
              setUrl(null);
              setStato('pronto');
              p.onPronta(null);
            }}
          >
            Rifai la registrazione
          </button>
        </>
      )}
      {errore && <p className="avviso">{errore}</p>}
    </div>
  );
}

/** Ascolto di una risposta salvata (il file si decifra solo qui, nel browser). */
export function Ascolta(p: { carica: () => Promise<Blob> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  if (url) return <audio controls autoPlay src={url} />;
  return (
    <>
      <button
        type="button"
        className="secondario"
        onClick={() =>
          p
            .carica()
            .then((b) => setUrl(URL.createObjectURL(b)))
            .catch((e: Error) => setErrore(e.message))
        }
      >
        ▶ Ascolta
      </button>
      {errore && <span className="avviso">{errore}</span>}
    </>
  );
}

/** «Il libro dei ricordi»: una domanda alla settimana, risposte a voce o scritte, cifrate per chi le riceverà. */
export function LibroRicordi(p: {
  vaultKey: Uint8Array;
  voci: Voce[];
  persone: Persona[];
  onCambio: () => Promise<void>;
  onIndietro: () => void;
  onVaiPersone: () => void;
}) {
  const ricordi = p.voci.filter((v) => v.tipo === 'ricordo').sort((a, b) => b.remota.creataIl.localeCompare(a.remota.creataIl));
  const risposte = new Set(ricordi.map((v) => v.contenuto.domandaId).filter((x): x is string => !!x));
  const [saltate, setSaltate] = useState<string[]>(leggiSaltate);
  const domanda = prossimaDomanda(risposte, saltate);
  const destinatariLibro = ricordi[0]?.contenuto.destinatari ?? [];
  const [per, setPer] = useState<string[]>(destinatariLibro);
  const [audio, setAudio] = useState<File | null>(null);
  const [testo, setTesto] = useState('');
  const [scrivi, setScrivi] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [esito, setEsito] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [promemoria, setPromemoria] = useState<boolean | null>(null);
  const [chiave, setChiave] = useState(0); // per ripartire con un registratore nuovo

  useEffect(() => {
    api
      .promemoriaRicordi()
      .then((r) => setPromemoria(r.attivo))
      .catch(() => setPromemoria(null));
  }, []);

  function salta() {
    if (!domanda) return;
    const n = [...saltate.filter((x) => x !== domanda.id), domanda.id];
    setSaltate(n);
    try {
      localStorage.setItem(CHIAVE_SALTATE, JSON.stringify(n));
    } catch {
      // solo una comodità
    }
    setAudio(null);
    setTesto('');
    setChiave((k) => k + 1);
  }

  async function cambiaDestinatari(nuovi: string[]) {
    setPer(nuovi);
    setErrore(null);
    try {
      // Il libro va a tutti allo stesso modo: si aggiornano tutte le risposte.
      for (const v of ricordi) {
        const { destinatari: _d, ...resto } = v.contenuto;
        await aggiornaVoce(p.vaultKey, v, { ...resto, ...(nuovi.length ? { destinatari: nuovi } : {}) }, false);
      }
      if (ricordi.length) await p.onCambio();
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  async function salva() {
    if (!domanda || (!audio && !testo.trim())) return;
    setSalvo(true);
    setErrore(null);
    try {
      await aggiungiVoce(p.vaultKey, {
        tipo: 'ricordo',
        emergenza: false,
        titolo: domanda.testo,
        note: testo.trim(),
        files: audio ? [audio] : [],
        extra: { domandaId: domanda.id, ...(per.length ? { destinatari: per } : {}) },
      });
      setAudio(null);
      setTesto('');
      setScrivi(false);
      setChiave((k) => k + 1);
      setEsito('Salvato nel libro dei ricordi. Grazie! Se hai voglia, qui sopra c\'è già la prossima domanda; altrimenti, alla settimana prossima.');
      await p.onCambio();
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setSalvo(false);
    }
  }

  return (
    <section className="passo">
      <button className="link indietro" onClick={p.onIndietro}>
        ‹ Torna all'elenco
      </button>
      <p className="etichetta">Intervista dei ricordi</p>
      <h1>Il libro dei ricordi</h1>
      <p>
        Una domanda alla settimana. Rispondi a voce, anche solo due minuti, oppure scrivendo. Le risposte restano cifrate e arriveranno a chi
        scegli, dopo l'apertura della cassaforte. Hai risposto a <strong>{ricordi.length}</strong> domande su {DOMANDE.length}.
      </p>

      <div className="riquadro">
        <h2>Chi riceverà il libro</h2>
        {p.persone.length === 0 ? (
          <p>
            Aggiungi prima le persone che riceveranno il libro.{' '}
            <button className="link" onClick={p.onVaiPersone}>
              Vai alle persone
            </button>
          </p>
        ) : (
          <fieldset className={`scelte-ruolo ${per.length === 0 ? 'da-scegliere' : ''}`}>
            <legend>{per.length ? `Per ${nomiDestinatari(per, p.persone)}` : 'Scegli almeno una persona'}</legend>
            {p.persone.map((x) => (
              <label key={x.id} className="spunta">
                <input type="checkbox" checked={per.includes(x.id)} onChange={(e) => void cambiaDestinatari(e.target.checked ? [...per, x.id] : per.filter((y) => y !== x.id))} />
                {x.nome}
              </label>
            ))}
          </fieldset>
        )}
        {p.persone.length > 0 && per.length === 0 && <p className="avviso">Senza nessuno scelto, alla tua scomparsa il libro non arriva a nessuno.</p>}
      </div>

      {domanda ? (
        <div className="riquadro evidenza domanda-settimana">
          <p className="etichetta">La domanda di questa settimana</p>
          <h2 className="domanda">{domanda.testo}</h2>
          <Registratore key={`r${chiave}`} onPronta={setAudio} />
          {scrivi || !formatoAudio() ? (
            <label>
              {audio ? 'Vuoi aggiungere qualche riga?' : 'La tua risposta'}
              <textarea className="carta" rows={6} value={testo} onChange={(e) => setTesto(e.target.value)} maxLength={20000} />
            </label>
          ) : (
            <button type="button" className="link" onClick={() => setScrivi(true)}>
              Preferisco scrivere
            </button>
          )}
          {(audio || testo.trim()) && (
            <button type="button" className="primario" disabled={salvo} onClick={salva}>
              {salvo ? 'Cifro e salvo…' : 'Salva nel libro'}
            </button>
          )}
          <button type="button" className="link" onClick={salta}>
            Un'altra domanda
          </button>
        </div>
      ) : (
        <div className="riquadro evidenza">
          <p>Hai risposto a tutte le domande. Che bel regalo per chi resta.</p>
        </div>
      )}
      {esito && <p className="esito">{esito}</p>}
      {errore && <p className="avviso">{errore}</p>}

      <label className="spunta">
        <input
          type="checkbox"
          checked={!!promemoria}
          disabled={promemoria === null}
          onChange={(e) => {
            const prima = promemoria;
            setPromemoria(e.target.checked);
            api
              .impostaPromemoriaRicordi(e.target.checked)
              .then((r) => setPromemoria(r.attivo))
              .catch((err: Error) => {
                setPromemoria(prima);
                setErrore(err.message);
              });
          }}
        />
        <span>
          Mandami un promemoria ogni settimana per e-mail
          <br />
          <span className="tenue">Solo un invito a rispondere: l'e-mail non contiene domande né risposte.</span>
        </span>
      </label>

      {ricordi.length > 0 && (
        <>
          <h2>Le tue risposte</h2>
          <ul className="elenco-ricordi">
            {ricordi.map((v) => {
              const f = documentiDi(v.id, v.contenuto)[0];
              return (
                <li key={v.id} className="riquadro">
                  <p className="tenue">{giorno(v.remota.creataIl)}</p>
                  <h3>{v.contenuto.titolo}</h3>
                  {f && <Ascolta carica={() => leggiFile(p.vaultKey, v, f)} />}
                  {v.contenuto.note && <p className="testo-ricordo">{v.contenuto.note}</p>}
                  <button
                    className="link"
                    onClick={async () => {
                      if (!window.confirm('Eliminare questa risposta? Non si potrà recuperare.')) return;
                      await api.eliminaVoce(v.id);
                      await p.onCambio();
                    }}
                  >
                    Elimina
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
