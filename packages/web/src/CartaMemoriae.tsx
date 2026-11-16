import { useCallback, useEffect, useState } from 'react';
import { api, type DatiFornitore, type EsitoCarta, type IndirizzoCarta, type LottoCarte, type OrdineOperatore, type StatoCarte } from './api';

const giorno = (s: string) => new Date(s).toLocaleDateString('it-CH', { day: 'numeric', month: 'long', year: 'numeric' });

// Una lettura vale una volta sola: la chiediamo al server una volta anche se React ripete l'effetto.
let lettura: Promise<EsitoCarta> | null = null;

/** La pagina che si apre avvicinando una Carta MEMORIAE a un telefono. Pubblica: la vede anche chi la trova. */
export function CartaToccata() {
  const q = new URLSearchParams(window.location.search);
  const [esito, setEsito] = useState<EsitoCarta | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState('');
  const [contatto, setContatto] = useState('');
  const [invio, setInvio] = useState(false);
  const [avvisati, setAvvisati] = useState<number | null>(null);

  useEffect(() => {
    // Dal chip (collegamento sempre nuovo) o dal QR di riserva stampato sulla carta.
    lettura ??= q.get('q') ? api.cartaDaQr(q.get('q')!) : api.cartaToccata(q.get('picc') ?? '', q.get('cmac') ?? '');
    lettura
      .then(setEsito)
      .catch((e: Error) => setErrore(e.message));
    // Il collegamento vale una volta sola: lo togliamo dalla barra degli indirizzi.
    window.history.replaceState(null, '', '/c');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const corpo = (() => {
    if (errore) return <p className="avviso">{errore}</p>;
    if (!esito) return <p className="tenue">Leggo la carta…</p>;
    switch (esito.esito) {
      case 'non-valida':
        return (
          <>
            <h1>Carta non riconosciuta</h1>
            <p>Questa non sembra una Carta MEMORIAE valida.</p>
          </>
        );
      case 'ripetuta':
        return (
          <>
            <h1>Avvicina di nuovo la carta</h1>
            <p>Questo collegamento è già stato usato. Per sicurezza ogni lettura vale una volta sola: avvicina di nuovo la carta al telefono.</p>
          </>
        );
      case 'magazzino':
        return (
          <>
            <h1>Carta non ancora consegnata</h1>
            <p>Questa Carta MEMORIAE è nuova e non appartiene ancora a nessuno. Non serve fare nulla.</p>
          </>
        );
      case 'disattivata':
        return (
          <>
            <h1>Carta disattivata</h1>
            <p>La persona a cui appartiene l'ha disattivata. Non serve fare nulla.</p>
          </>
        );
      case 'da-attivare':
        return (
          <>
            <h1>Carta non ancora attiva</h1>
            <p>
              Se è la tua carta: apri MEMORIAE su questo telefono, entra con la tua passkey e avvicina di nuovo la carta. Si attiva da sola.
            </p>
            <a className="bottone primario" href="/">
              Apri MEMORIAE
            </a>
          </>
        );
      case 'attivata':
        return (
          <>
            <h1>Carta attivata ✓</h1>
            <p>Da adesso, se qualcuno la trova e la avvicina al telefono, potrà avvisare le tue persone di fiducia. La carta non apre mai la tua cassaforte.</p>
            <a className="bottone primario" href="/">
              Torna a MEMORIAE
            </a>
          </>
        );
      case 'valida':
        if (esito.tua)
          return (
            <>
              <h1>È la tua carta ✓</h1>
              <p>Funziona. Se la perdi, disattivala da MEMORIAE › Protezione › Carta MEMORIAE.</p>
              <a className="bottone primario" href="/">
                Apri MEMORIAE
              </a>
            </>
          );
        return (
          <>
            <h1>Questa carta appartiene a {esito.nome}</h1>
            <p>
              {esito.nome} usa MEMORIAE per mettere in ordine la sua eredità digitale. Se hai trovato la carta, o se {esito.nome} ha bisogno di aiuto,
              puoi avvisare le sue persone di fiducia. I loro recapiti restano riservati.
            </p>
            {avvisati !== null ? (
              <p className="esito">
                {avvisati > 0 ? 'Grazie! Le persone di fiducia sono state avvisate.' : `Grazie! ${esito.nome} è stato avvisato.`}
              </p>
            ) : (
              <form
                className="riquadro"
                onSubmit={(e) => {
                  e.preventDefault();
                  setInvio(true);
                  setErrore(null);
                  api
                    .avvisaDaCarta(esito.token, messaggio, contatto)
                    .then((r) => setAvvisati(r.avvisati))
                    .catch((err: Error) => setErrore(err.message))
                    .finally(() => setInvio(false));
                }}
              >
                <label>
                  Messaggio (facoltativo)
                  <textarea rows={3} maxLength={1000} value={messaggio} onChange={(e) => setMessaggio(e.target.value)} placeholder="Per esempio: ho trovato la carta sul treno per Lugano" />
                </label>
                <label>
                  Il tuo recapito (facoltativo)
                  <input maxLength={200} value={contatto} onChange={(e) => setContatto(e.target.value)} placeholder="Telefono o e-mail, se vuoi essere ricontattato" />
                </label>
                <button className="primario" type="submit" disabled={invio}>
                  {invio ? 'Invio…' : 'Avvisa le persone di fiducia'}
                </button>
              </form>
            )}
            {esito.fiducia && (
              <div className="riquadro evidenza">
                <p>Sei una persona di fiducia di {esito.nome}. Se le è successo qualcosa, puoi chiedere l'apertura della cassaforte: la richiesta viene sempre verificata.</p>
                <a className="bottone" href="/">
                  Apri MEMORIAE
                </a>
              </div>
            )}
            <p className="tenue">La carta non apre la cassaforte e non mostra nessun contenuto: serve solo ad avvisare.</p>
          </>
        );
    }
  })();

  return (
    <section className="passo">
      <p className="etichetta">Carta MEMORIAE</p>
      {corpo}
    </section>
  );
}

/** Pagina di prova del pagamento delle carte: chiede l'indirizzo come farebbe Stripe. Non si muove denaro. */
export function PagamentoCarteProva({ id }: { id: string }) {
  const [info, setInfo] = useState<{ quantita: number; chf: number; regalo: boolean; pagato: boolean } | null>(null);
  const [a, setA] = useState<IndirizzoCarta>({ nome: '', presso: '', riga1: '', riga2: '', cap: '', citta: '', paese: 'CH' });
  const [errore, setErrore] = useState<string | null>(null);
  useEffect(() => {
    api.ordineCarteProva(id).then(setInfo).catch((e: Error) => setErrore(e.message));
  }, [id]);
  if (!info) return errore ? <p className="avviso">{errore}</p> : <p className="tenue">Un momento…</p>;
  const campo = (k: keyof IndirizzoCarta, etichetta: string, extra: Record<string, unknown> = {}) => (
    <label>
      {etichetta}
      <input value={a[k] ?? ''} onChange={(e) => setA({ ...a, [k]: e.target.value })} {...extra} />
    </label>
  );
  return (
    <form
      className="passo"
      onSubmit={(e) => {
        e.preventDefault();
        setErrore(null);
        api
          .pagaCarteProva(id, a)
          .then(() => {
            window.location.href = '/?carte=pagate';
          })
          .catch((err: Error) => setErrore(err.message));
      }}
    >
      <p className="avviso">Pagina di prova: qui ci sarebbe la pagina sicura di TWINT o della carta di credito. Non si muove denaro.</p>
      <h1>
        {info.quantita === 1 ? 'Carta MEMORIAE' : `${info.quantita} Carte MEMORIAE`}: CHF {info.chf}.–
      </h1>
      <h2>Indirizzo di spedizione</h2>
      {info.regalo && <p className="tenue">È un regalo: puoi scrivere l'indirizzo della persona che la riceverà.</p>}
      {campo('nome', 'Nome e cognome', { required: true, autoComplete: 'name' })}
      {campo('presso', 'Presso (c/o), facoltativo', { maxLength: 120, placeholder: 'Es. Casa anziani Al Lago, oppure famiglia Bernasconi' })}
      <p className="tenue">
        Se la carta va recapitata in una casa per anziani, da un parente o a un altro indirizzo, scrivi qui presso chi. Il postino la consegnerà lì.
      </p>
      {campo('riga1', 'Via e numero', { required: true, autoComplete: 'address-line1' })}
      {campo('riga2', 'Complemento (facoltativo)', { autoComplete: 'address-line2' })}
      <div className="riga-campi">
        {campo('cap', 'NPA', { required: true, inputMode: 'numeric', pattern: '[0-9]{4}', maxLength: 4, autoComplete: 'postal-code' })}
        {campo('citta', 'Località', { required: true, autoComplete: 'address-level2' })}
      </div>
      <label>
        Paese
        <select value={a.paese} onChange={(e) => setA({ ...a, paese: e.target.value as 'CH' | 'LI' })}>
          <option value="CH">Svizzera</option>
          <option value="LI">Liechtenstein</option>
        </select>
      </label>
      {errore && <p className="avviso">{errore}</p>}
      <button className="primario" type="submit" disabled={info.pagato}>
        Paga con TWINT (prova)
      </button>
      <button
        className="link"
        type="button"
        onClick={() => {
          window.location.href = '/?carte=annullato';
        }}
      >
        Annulla
      </button>
    </form>
  );
}

const STATO_CARTA = { spedita: 'Da attivare', attiva: 'Attiva', disattivata: 'Disattivata' } as const;
const STATO_ORDINE = { 'in-attesa': 'In attesa di pagamento', pagato: 'Pagato, in preparazione', spedito: 'Spedito' } as const;

/** Per il proprietario: cos'è la carta, ordinarla, attivarla e disattivarla. */
export function CartaMemoriae(p: { onIndietro: () => void; esito?: string | null }) {
  const [stato, setStato] = useState<StatoCarte | null>(null);
  const [quante, setQuante] = useState(1);
  const [regalo, setRegalo] = useState(false);
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [conferma, setConferma] = useState<string | null>(null);
  const carica = useCallback(() => {
    api.carte().then(setStato).catch((e: Error) => setErrore(e.message));
  }, []);
  useEffect(carica, [carica]);

  return (
    <section className="passo">
      <button className="link indietro" onClick={p.onIndietro}>
        ‹ Indietro
      </button>
      <p className="etichetta">Da tenere nel portafoglio</p>
      <h1>Carta MEMORIAE</h1>
      {p.esito && <p className="esito">{p.esito}</p>}
      <p>
        Una tessera con un chip. Se ti succede qualcosa, chi la trova la avvicina al telefono e può avvisare le tue persone di fiducia, senza
        vedere i loro recapiti. Una tua persona di fiducia, dal suo telefono, può chiedere subito l'apertura.
      </p>
      <div className="riquadro">
        <p>
          <strong>La carta non apre la tua cassaforte.</strong> Non contiene dati personali: solo un collegamento, firmato in modo diverso a ogni
          lettura, che non si può copiare. Ogni richiesta d'apertura resta verificata da una persona, con l'attesa e la possibilità di bloccarla.
        </p>
      </div>

      <h2>Ordina</h2>
      <div className="riga-campi">
        <label>
          Quante carte
          <select value={quante} onChange={(e) => setQuante(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <p className="prezzo-carta">CHF {(stato?.prezzo ?? 25) * quante}.–</p>
      </div>
      <label className="spunta">
        <input type="checkbox" checked={regalo} onChange={(e) => setRegalo(e.target.checked)} />
        <span>
          È un regalo
          <br />
          <span className="tenue">Nella pagina di pagamento potrai indicare l'indirizzo di chi la riceve.</span>
        </span>
      </label>
      <button
        className="primario"
        disabled={occupato}
        onClick={() => {
          setOccupato(true);
          setErrore(null);
          api
            .ordinaCarte(quante, regalo)
            .then((r) => {
              window.location.href = r.url;
            })
            .catch((e: Error) => {
              setErrore(e.message);
              setOccupato(false);
            });
        }}
      >
        {occupato ? 'Un momento…' : 'Ordina e paga'}
      </button>
      <p className="tenue">Spedizione in Svizzera e Liechtenstein. CHF {stato?.prezzo ?? 25}.– a carta, spedizione compresa.</p>

      {stato && stato.ordini.length > 0 && (
        <>
          <h2>I tuoi ordini</h2>
          <ul className="voci">
            {stato.ordini.map((o) => (
              <li key={o.id} className="riquadro">
                <p>
                  <strong>{o.quantita === 1 ? '1 carta' : `${o.quantita} carte`}</strong> · CHF {o.chf}.– · {giorno(o.creatoIl)}
                  {o.regalo && ' · regalo'}
                </p>
                <p className="tenue">
                  {STATO_ORDINE[o.stato]}
                  {o.spedizione && ` · a ${o.spedizione}`}
                  {o.tracking && ` · spedizione n. ${o.tracking}`}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      {stato && stato.carte.length > 0 && (
        <>
          <h2>Le tue carte</h2>
          <p className="tenue">Una carta «da attivare» si attiva da sola: apri MEMORIAE su questo telefono e avvicinala.</p>
          <ul className="voci">
            {stato.carte.map((c) => (
              <li key={c.id} className="riquadro">
                <p>
                  <strong>Carta …{c.finale}</strong> <span className="pillola chiara">{STATO_CARTA[c.stato]}</span>
                </p>
                {c.attivataIl && <p className="tenue">Attivata il {giorno(c.attivataIl)}</p>}
                {c.stato !== 'disattivata' &&
                  (conferma === c.id ? (
                    <p>
                      Disattivarla per sempre?{' '}
                      <button
                        className="link"
                        onClick={() =>
                          api
                            .disattivaCarta(c.id)
                            .then(() => {
                              setConferma(null);
                              carica();
                            })
                            .catch((e: Error) => setErrore(e.message))
                        }
                      >
                        Sì, disattiva
                      </button>{' '}
                      <button className="link" onClick={() => setConferma(null)}>
                        No
                      </button>
                    </p>
                  ) : (
                    <button className="link" onClick={() => setConferma(c.id)}>
                      L'ho persa: disattiva
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        </>
      )}
      {errore && <p className="avviso">{errore}</p>}
    </section>
  );
}

/** Operatore: carte da programmare, abbinare e spedire. */
export function OperatoreCarte() {
  const [ordini, setOrdini] = useState<OrdineOperatore[] | null>(null);
  const [uid, setUid] = useState<Record<string, string>>({});
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [chiavi, setChiavi] = useState<{ uid: string; chiaveMeta: string; chiaveFile: string; collegamento: string } | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [simulato, setSimulato] = useState<string | null>(null);
  const [giro, setGiro] = useState(0);
  const carica = useCallback(() => {
    api.ordiniCarteOperatore().then((r) => setOrdini(r.ordini)).catch((e: Error) => setErrore(e.message));
    setGiro((g) => g + 1);
  }, []);
  useEffect(carica, [carica]);
  if (!ordini) return null;
  const daSpedire = ordini.filter((o) => o.stato === 'pagato');
  const spediti = ordini.filter((o) => o.stato === 'spedito').slice(0, 10);
  const fai = (f: Promise<unknown>) => f.then(carica).catch((e: Error) => setErrore(e.message));

  return (
    <>
      <h2>Carte da spedire ({daSpedire.length})</h2>
      {daSpedire.length === 0 && <p className="tenue">Nessun ordine da preparare.</p>}
      {daSpedire.map((o) => (
        <div key={o.id} className="riquadro ordine-carte">
          <p>
            <strong>{o.quantita === 1 ? '1 carta' : `${o.quantita} carte`}</strong>
            {o.regalo && <span className="pillola chiara">regalo</span>} · pagato il {giorno(o.pagatoIl)}
          </p>
          <address>
            {o.indirizzo.nome}
            <br />
            {o.indirizzo.presso && (
              <>
                c/o {o.indirizzo.presso}
                <br />
              </>
            )}
            {o.indirizzo.riga1}
            {o.indirizzo.riga2 && (
              <>
                <br />
                {o.indirizzo.riga2}
              </>
            )}
            <br />
            {o.indirizzo.paese === 'LI' ? 'FL-' : ''}
            {o.indirizzo.cap} {o.indirizzo.citta}
          </address>
          <ol className="passi-carta">
            <li>Prendi una carta dal magazzino e scrivi il codice stampato sotto il QR (per esempio 7K3Q-PX2D-M9TA).</li>
            <li>Premi «Abbina all'ordine». Carte abbinate: {o.carte.length} di {o.quantita}.</li>
          </ol>
          {o.carte.length > 0 && <p className="tenue">UID abbinati: {o.carte.join(', ')}</p>}
          {o.carte.length < o.quantita && (
            <div className="riga-campi">
              <label>
                Codice della carta (o UID)
                <input
                  value={uid[o.id] ?? ''}
                  onChange={(e) => setUid({ ...uid, [o.id]: e.target.value.replace(/[^0-9a-zA-Z-]/g, '').toUpperCase() })}
                  maxLength={16}
                  placeholder="7K3Q-PX2D-M9TA"
                  autoComplete="off"
                />
              </label>
              {/^[0-9A-F]{14}$/.test(uid[o.id] ?? '') && (
                <button className="secondario" onClick={() => fai(api.programmaCarta(uid[o.id]!).then(setChiavi))}>
                  Chiavi (carta vergine)
                </button>
              )}
              <button
                className="secondario"
                disabled={(uid[o.id] ?? '').replace(/-/g, '').length < 12}
                onClick={() =>
                  fai(
                    api.abbinaCarta(o.id, uid[o.id]!).then(() => {
                      setUid({ ...uid, [o.id]: '' });
                      setChiavi(null);
                    }),
                  )
                }
              >
                Abbina all'ordine
              </button>
            </div>
          )}
          {o.carte.length === o.quantita && (
            <div className="riga-campi">
              <label>
                Numero di spedizione (facoltativo)
                <input value={tracking[o.id] ?? ''} onChange={(e) => setTracking({ ...tracking, [o.id]: e.target.value })} maxLength={60} />
              </label>
              <button className="primario" onClick={() => fai(api.cartaSpedita(o.id, tracking[o.id] ?? ''))}>
                Spedito
              </button>
            </div>
          )}
        </div>
      ))}
      {chiavi && (
        <div className="riquadro evidenza chiavi-carta">
          <p>
            <strong>Da scrivere nella carta {chiavi.uid}</strong> (per esempio con l'app NXP TagXplorer o TagWriter, NTAG 424 DNA con «SUN»):
          </p>
          <dl>
            <dt>Collegamento (NDEF URL, con PICC cifrato e CMAC)</dt>
            <dd>
              <code>{chiavi.collegamento}</code>
            </dd>
            <dt>Chiave SDM Meta Read (chiave 1)</dt>
            <dd>
              <code>{chiavi.chiaveMeta}</code>
            </dd>
            <dt>Chiave SDM File Read (chiave 2)</dt>
            <dd>
              <code>{chiavi.chiaveFile}</code>
            </dd>
          </dl>
          <p className="tenue">Le chiavi sono riservate: non conservarle altrove. Si possono rigenerare qui dall'UID.</p>
        </div>
      )}
      <MagazzinoCarte giro={giro} />
      {spediti.length > 0 && (
        <>
          <h3>Spedite di recente</h3>
          {spediti.map((o) => (
            <div key={o.id} className="riquadro">
              <p>
                {o.indirizzo.nome}, {o.indirizzo.citta} · {o.quantita === 1 ? '1 carta' : `${o.quantita} carte`} · spedito il {o.speditoIl ? giorno(o.speditoIl) : ''}
                {o.tracking && ` · n. ${o.tracking}`}
              </p>
              <div className="azioni-voci">
                {o.carte.map((u) => (
                  <button key={u} className="link" onClick={() => api.simulaCarta(u).then((r) => setSimulato(r.collegamento)).catch((e: Error) => setErrore(e.message))}>
                    Prova la carta {u.slice(-4)}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {simulato && (
            <p className="riquadro evidenza">
              Solo in prova: questo è il collegamento che scriverebbe la carta avvicinata a un telefono.{' '}
              <a href={simulato} target="_blank" rel="noreferrer">
                Apri come se avessi avvicinato la carta
              </a>
            </p>
          )}
        </>
      )}
      {errore && <p className="avviso">{errore}</p>}
    </>
  );
}

/** Scarica un testo come file (il CSV per il fornitore). */
function scaricaTesto(nome: string, testo: string) {
  const url = URL.createObjectURL(new Blob(['\ufeff' + testo], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Magazzino delle carte prodotte dal fornitore: si crea un lotto (codici dei QR e chiavi da mandare al fornitore),
 * alla consegna si importa il suo file con gli UID e le carte sono pronte da abbinare agli ordini.
 */
function MagazzinoCarte({ giro }: { giro: number }) {
  const [lotti, setLotti] = useState<LottoCarte[] | null>(null);
  const [nuovo, setNuovo] = useState({ nome: '', fornitore: 'Cardnology', quantita: '200' });
  const [dati, setDati] = useState<(DatiFornitore & { id: string }) | null>(null);
  const [esitoImport, setEsitoImport] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const carica = useCallback(() => {
    api.lottiCarte().then((r) => setLotti(r.lotti)).catch((e: Error) => setErrore(e.message));
  }, []);
  // Si aggiorna anche quando un ordine prende una carta dal magazzino.
  useEffect(carica, [carica, giro]);
  if (!lotti) return null;
  const pronte = lotti.reduce((s, l) => s + l.inMagazzino, 0);

  const importa = (l: LottoCarte, file: File) => {
    setErrore(null);
    setEsitoImport(null);
    file
      .text()
      .then((csv) => api.importaLottoCarte(l.id, csv))
      .then((r) => {
        setEsitoImport(
          `Lotto «${l.nome}»: ${r.registrate === 1 ? '1 carta registrata' : `${r.registrate} carte registrate`}` +
            (r.gia ? `, ${r.gia} già presenti` : '') +
            (r.nErrori ? `. Righe da controllare (${r.nErrori}): ${r.errori.map((e) => `riga ${e.riga} – ${e.motivo}`).join('; ')}` : '.'),
        );
        carica();
      })
      .catch((e: Error) => setErrore(e.message));
  };

  return (
    <>
      <h2>Magazzino carte</h2>
      <p>
        Carte pronte da spedire: <strong>{pronte}</strong>
      </p>
      {lotti.map((l) => (
        <div key={l.id} className="riquadro lotto-carte">
          <p>
            <strong>{l.nome}</strong>
            {l.fornitore && ` · ${l.fornitore}`} · creato il {giorno(l.creatoIl)}
          </p>
          <p className="tenue">
            {l.quantita} carte ordinate · {l.registrate} consegnate · {l.inMagazzino} in magazzino · {l.assegnate} assegnate
          </p>
          <div className="azioni-voci">
            <button className="secondario" onClick={() => api.datiFornitore(l.id).then((d) => setDati({ ...d, id: l.id })).catch((e: Error) => setErrore(e.message))}>
              Dati per il fornitore
            </button>
            <label className="bottone secondario carica-file">
              Importa il file del fornitore
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) importa(l, f);
                }}
              />
            </label>
          </div>
          {dati?.id === l.id && (
            <div className="riquadro evidenza chiavi-carta">
              <p>
                <strong>Da mandare al fornitore</strong> per programmare le {dati.codici.length} carte (NTAG 424 DNA, SUN/SDM con PICC cifrato e CMAC,
                secondo NXP AN12196), e da cui ricevere alla consegna un file con UID e codice di ogni carta.
              </p>
              <dl>
                <dt>Collegamento da scrivere nel chip (NDEF URL)</dt>
                <dd>
                  <code>{dati.collegamento}</code>
                </dd>
                <dt>Chiave SDM Meta Read (chiave 1)</dt>
                <dd>
                  <code>{dati.chiaveMeta}</code>
                </dd>
                <dt>Chiave SDM File Read (chiave 2), solo per questo lotto</dt>
                <dd>
                  <code>{dati.chiaveFile}</code>
                </dd>
              </dl>
              <button
                className="secondario"
                onClick={() =>
                  scaricaTesto(
                    `codici-qr-${dati.nome.replace(/[^a-zA-Z0-9]+/g, '-')}.csv`,
                    ['numero;codice;qr', ...dati.codici.map((c) => `${c.numero};${c.codice};${c.qr}`)].join('\r\n'),
                  )
                }
              >
                Scarica i codici dei QR (CSV)
              </button>
              <p className="tenue">
                Le chiavi mandale in un messaggio separato dal file, mai per e-mail insieme. Ogni carta riceve un QR diverso, con il codice stampato
                sotto: è quello che scriverai per abbinarla a un ordine.
              </p>
            </div>
          )}
        </div>
      ))}
      <form
        className="riquadro"
        onSubmit={(e) => {
          e.preventDefault();
          setErrore(null);
          api
            .nuovoLottoCarte(nuovo.nome, nuovo.fornitore, Number(nuovo.quantita))
            .then((r) => {
              setNuovo({ ...nuovo, nome: '' });
              carica();
              return api.datiFornitore(r.id).then((d) => setDati({ ...d, id: r.id }));
            })
            .catch((err: Error) => setErrore(err.message));
        }}
      >
        <h3>Nuovo lotto</h3>
        <label>
          Nome del lotto
          <input required maxLength={80} value={nuovo.nome} onChange={(e) => setNuovo({ ...nuovo, nome: e.target.value })} placeholder="Per esempio: Cardnology gennaio 2027" />
        </label>
        <div className="riga-campi">
          <label>
            Fornitore
            <input maxLength={80} value={nuovo.fornitore} onChange={(e) => setNuovo({ ...nuovo, fornitore: e.target.value })} />
          </label>
          <label>
            Numero di carte
            <input required type="number" min={1} max={5000} value={nuovo.quantita} onChange={(e) => setNuovo({ ...nuovo, quantita: e.target.value })} />
          </label>
        </div>
        <button className="primario" type="submit">
          Crea il lotto
        </button>
      </form>
      {esitoImport && <p className="esito">{esitoImport}</p>}
      {errore && <p className="avviso">{errore}</p>}
    </>
  );
}

