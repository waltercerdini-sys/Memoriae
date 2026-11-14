import { useCallback, useEffect, useState } from 'react';
import { api, type Caso, type Fornitore, type StatoPiano, type Persona, type Ruolo, type TipoVoce, type Utente } from './api';
import { Controllo } from './Controllo';
import { Fiducia, statoCaso } from './Fiducia';
import { Operatore } from './Operatore';
import { Piano, RigaPiano } from './Piano';
import { SchedaFornitore } from './SchedaFornitore';
import { Persone } from './Persone';
import { sincronizzaRilascio, type StatoRilascio } from './rilascio';
import { aggiornaVoce, aggiungiDocumenti, aggiungiVoce, documentiDi, leggiVoci, MAX_DOCUMENTI, rimuoviDocumento, scaricaFile, type AzioneAccount, type ContenutoVoce, type Voce } from './vault';

const TIPI: { tipo: TipoVoce; nome: string; descrizione: string }[] = [
  { tipo: 'account', nome: 'Account', descrizione: 'E-mail, social, banca online, abbonamenti' },
  { tipo: 'documento', nome: 'Documento', descrizione: 'Contratti, polizze, certificati' },
  { tipo: 'istruzione', nome: 'Istruzione', descrizione: 'Cosa fare, chi chiamare, dove trovare le cose' },
  { tipo: 'dispositivo', nome: 'Dispositivo', descrizione: 'Telefono, computer, chiavette' },
  { tipo: 'crypto', nome: 'Criptovalute', descrizione: 'Dove sono e chi deve accedervi (mai la frase di recupero)' },
  { tipo: 'cartella', nome: 'Cartella', descrizione: 'Foto e ricordi da lasciare' },
];

const nomeTipo = (t: TipoVoce) => TIPI.find((x) => x.tipo === t)?.nome ?? t;

export interface InvitoInSospeso {
  token: string;
  proprietario: string;
  ruolo: Ruolo;
}

export function Inventario({
  vaultId,
  vaultKey,
  utente,
  invito,
  onInvitoGestito,
}: {
  vaultId: string;
  vaultKey: Uint8Array;
  utente: Utente;
  invito?: InvitoInSospeso | null;
  onInvitoGestito?: () => void;
}) {
  const [voci, setVoci] = useState<Voce[] | null>(null);
  const [persone, setPersone] = useState<Persona[]>([]);
  const [fornitori, setFornitori] = useState<Fornitore[]>([]);
  const [fiducia, setFiducia] = useState<{ ruolo: Ruolo; proprietario: string }[]>([]);
  const [operatore, setOperatore] = useState<{ prova: boolean } | null>(null);
  const [mieiCasi, setMieiCasi] = useState<Caso[]>([]);
  const [stato, setStato] = useState<StatoRilascio | null>(null);
  const [scheda, setScheda] = useState<'voci' | 'persone' | 'controllo' | 'altri' | 'operatore'>('voci');
  const [vista, setVista] = useState<{ tipo: 'elenco' } | { tipo: 'nuova' } | { tipo: 'dettaglio'; id: string } | { tipo: 'piano' }>({ tipo: 'elenco' });
  const [piano, setPiano] = useState<StatoPiano | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [esito, setEsito] = useState<string | null>(null);

  /** Ricarica voci e persone e prepara i pacchetti del rilascio. */
  const ricarica = useCallback(async () => {
    try {
      const [vs, ps] = await Promise.all([leggiVoci(vaultKey), api.persone().then((r) => r.persone)]);
      setVoci(vs);
      setPersone(ps);
      setStato(await sincronizzaRilascio(vaultId, vaultKey, vs));
    } catch (e) {
      setErrore(e instanceof Error ? e.message : 'Errore nel caricare la cassaforte');
    }
  }, [vaultId, vaultKey]);

  useEffect(() => {
    void ricarica();
    api.fornitori().then((r) => setFornitori(r.fornitori)).catch(() => setFornitori([]));
    api.fiducia().then((r) => setFiducia(r.cassaforti)).catch(() => setFiducia([]));
    api.operatore().then((r) => setOperatore({ prova: r.prova })).catch(() => setOperatore(null));
    api.mieiCasi().then((r) => setMieiCasi(r.casi)).catch(() => setMieiCasi([]));
    api.abbonamento().then(setPiano).catch(() => setPiano(null));
  }, [ricarica]);

  async function bloccaMio(id: string, chiudi: boolean) {
    setErrore(null);
    try {
      if (chiudi) await api.chiudiEmergenza(id);
      else await api.bloccaCaso(id);
      setMieiCasi((await api.mieiCasi()).casi);
      setEsito(chiudi ? 'Accesso d\'emergenza chiuso.' : 'Richiesta bloccata. Non succede nulla.');
    } catch (e) {
      setErrore(e instanceof Error ? e.message : 'Operazione non riuscita');
    }
  }

  async function rispondiInvito(accetta: boolean) {
    if (!invito) return;
    setErrore(null);
    try {
      if (accetta) {
        await api.accettaInvito(invito.token);
        setEsito(`Hai accettato: sei ${invito.ruolo === 'destinatario' ? 'destinatario' : 'persona di fiducia'} per ${invito.proprietario}.`);
        setFiducia((await api.fiducia()).cassaforti);
      } else {
        await api.rifiutaInvito(invito.token);
        setEsito('Invito rifiutato.');
      }
      onInvitoGestito?.();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : 'Operazione non riuscita');
    }
  }

  if (vista.tipo === 'piano') {
    return (
      <Piano
        onIndietro={() => {
          setVista({ tipo: 'elenco' });
          api.abbonamento().then(setPiano).catch(() => undefined);
        }}
      />
    );
  }

  if (vista.tipo === 'nuova') {
    return (
      <NuovaVoce
        fornitori={fornitori}
        onAnnulla={() => setVista({ tipo: 'elenco' })}
        onSalva={async (dati) => {
          await aggiungiVoce(vaultKey, dati);
          await ricarica();
          setVista({ tipo: 'elenco' });
        }}
      />
    );
  }

  if (vista.tipo === 'dettaglio') {
    const v = voci?.find((x) => x.id === vista.id);
    if (!v) return null;
    const f = fornitori.find((x) => x.slug === v.contenuto.fornitore);
    return (
      <section className="passo">
        <p className="etichetta">{nomeTipo(v.tipo)}</p>
        <h1>{v.contenuto.titolo}</h1>
        {v.emergenza && <p className="pillola">Serve in caso di emergenza</p>}
        {v.contenuto.note && <p className="note">{v.contenuto.note}</p>}
        <Documenti
          voce={v}
          onApri={(f) => scaricaFile(vaultKey, v, f)}
          onAggiungi={async (files) => {
            await aggiungiDocumenti(vaultKey, v, files);
            await ricarica();
          }}
          onTogli={async (f) => {
            await rimuoviDocumento(vaultKey, v, f.id);
            await ricarica();
          }}
        />
        <Volonta
          voce={v}
          persone={persone}
          onSalva={async (contenuto, emergenza) => {
            await aggiornaVoce(vaultKey, v, contenuto, emergenza);
            await ricarica();
          }}
          onVaiPersone={() => {
            setVista({ tipo: 'elenco' });
            setScheda('persone');
          }}
        />
        {f && <SchedaFornitore f={f} />}
        <button
          className="pericolo"
          onClick={async () => {
            if (!window.confirm('Eliminare questa voce?')) return;
            await api.eliminaVoce(v.id);
            await ricarica();
            setVista({ tipo: 'elenco' });
          }}
        >
          Elimina
        </button>
        <button className="link" onClick={() => setVista({ tipo: 'elenco' })}>
          Torna all'elenco
        </button>
      </section>
    );
  }

  return (
    <section className="passo larga">
      <h1>La cassaforte di {utente.nome.split(' ')[0]}</h1>
      <RigaPiano st={piano} onApri={() => setVista({ tipo: 'piano' })} />
      {invito && (
        <div className="riquadro evidenza">
          <h2>{invito.proprietario} ti ha scelto</h2>
          <p>
            {invito.proprietario} vorrebbe che tu fossi {invito.ruolo === 'destinatario' ? 'destinatario' : 'persona di fiducia'} nella sua
            cassaforte. Non vedrai nulla del contenuto finché non sarà necessario.
          </p>
          <button className="primario" onClick={() => rispondiInvito(true)}>
            Accetta
          </button>
          <button className="link" onClick={() => rispondiInvito(false)}>
            Rifiuta
          </button>
        </div>
      )}
      {mieiCasi
        .filter((c) => ['richiesta', 'in-verifica', 'in-attesa'].includes(c.stato) || (c.stato === 'rilasciata' && c.ambito === 'emergenza' && c.apribile))
        .map((c) => (
          <div key={c.id} className="riquadro evidenza" role="alert">
            {c.stato === 'rilasciata' ? (
              <>
                <h2>Le tue persone di fiducia vedono le voci d'emergenza</h2>
                <p>Se stai bene, puoi chiudere subito l'accesso.</p>
                <button className="primario" onClick={() => bloccaMio(c.id, true)}>
                  Chiudi l'accesso d'emergenza
                </button>
              </>
            ) : (
              <>
                <h2>{c.richiedente} ha chiesto di aprire la tua cassaforte</h2>
                <p>
                  Motivo indicato: {c.ambito === 'emergenza' ? 'emergenza' : 'decesso'}. {statoCaso(c)}
                </p>
                <button className="primario" onClick={() => bloccaMio(c.id, false)}>
                  Sto bene: blocca la richiesta
                </button>
              </>
            )}
          </div>
        ))}
      {esito && <p className="esito">{esito}</p>}
      {fiducia.length > 0 && (
        <p className="tenue">
          Sei persona di fiducia o destinatario per: {fiducia.map((c) => c.proprietario).join(', ')}.
        </p>
      )}
      {errore && <p className="avviso">{errore}</p>}
      <div className="schede" role="tablist">
        <button role="tab" aria-selected={scheda === 'voci'} className={scheda === 'voci' ? 'attiva' : ''} onClick={() => setScheda('voci')}>
          Voci
        </button>
        <button role="tab" aria-selected={scheda === 'persone'} className={scheda === 'persone' ? 'attiva' : ''} onClick={() => setScheda('persone')}>
          Persone
        </button>
        <button role="tab" aria-selected={scheda === 'controllo'} className={scheda === 'controllo' ? 'attiva' : ''} onClick={() => setScheda('controllo')}>
          Sono qui
        </button>
        {fiducia.length > 0 && (
          <button role="tab" aria-selected={scheda === 'altri'} className={scheda === 'altri' ? 'attiva' : ''} onClick={() => setScheda('altri')}>
            Per gli altri
          </button>
        )}
        {operatore && (
          <button role="tab" aria-selected={scheda === 'operatore'} className={scheda === 'operatore' ? 'attiva' : ''} onClick={() => setScheda('operatore')}>
            Operatore
          </button>
        )}
      </div>
      {scheda === 'operatore' && operatore ? (
        <Operatore prova={operatore.prova} />
      ) : scheda === 'altri' ? (
        <Fiducia vaultKey={vaultKey} />
      ) : scheda === 'controllo' ? (
        <Controllo />
      ) : scheda === 'persone' ? (
        <Persone persone={persone} stato={stato} onCambio={ricarica} />
      ) : (
        <>
          {voci === null && <p className="tenue">Apro la cassaforte…</p>}
          {voci && voci.length === 0 && (
            <div className="riquadro">
              <h2>Cominciamo dall'elenco</h2>
              <p>Aggiungi le cose che chi resta dovrà trovare: indirizzo e-mail principale, banca online, abbonamenti, telefono.</p>
            </div>
          )}
          {voci && voci.length > 0 && (
            <ul className="voci">
              {voci.map((v) => {
                const chi = persone.filter((p) => v.contenuto.destinatari?.includes(p.id)).map((p) => p.nome);
                return (
                  <li key={v.id}>
                    <button className="voce" onClick={() => setVista({ tipo: 'dettaglio', id: v.id })}>
                      <span className="etichetta">{nomeTipo(v.tipo)}</span>
                      <span className="titolo">{v.contenuto.titolo}</span>
                      {chi.length > 0 && <span className="tenue">Per: {chi.join(', ')}</span>}
                      <span className="dettagli">
                        {v.emergenza && <span className="pillola">Emergenza</span>}
                        {(() => {
                          const n = documentiDi(v.id, v.contenuto).length;
                          return n > 0 && <span className="pillola chiara">{n === 1 ? '1 documento' : `${n} documenti`}</span>;
                        })()}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button className="primario" onClick={() => setVista({ tipo: 'nuova' })}>
            Aggiungi una voce
          </button>
        </>
      )}
    </section>
  );
}

const AZIONI: { valore: AzioneAccount; testo: string }[] = [
  { valore: 'trasmettere', testo: 'Consegnarlo ai destinatari' },
  { valore: 'conservare', testo: 'Conservarlo come ricordo (commemorazione)' },
  { valore: 'cancellare', testo: 'Chiuderlo e cancellarlo' },
];

function Volonta(p: {
  voce: Voce;
  persone: Persona[];
  onSalva: (c: ContenutoVoce, emergenza: boolean) => Promise<void>;
  onVaiPersone: () => void;
}) {
  const [scelti, setScelti] = useState<string[]>(p.voce.contenuto.destinatari ?? []);
  const [azione, setAzione] = useState<AzioneAccount | ''>(p.voce.contenuto.azione ?? '');
  const [emergenza, setEmergenza] = useState(p.voce.emergenza);
  const [salvo, setSalvo] = useState(false);
  const [fatto, setFatto] = useState(false);
  const cambiato =
    JSON.stringify([...scelti].sort()) !== JSON.stringify([...(p.voce.contenuto.destinatari ?? [])].sort()) ||
    azione !== (p.voce.contenuto.azione ?? '') ||
    emergenza !== p.voce.emergenza;

  return (
    <div className="riquadro">
      <h2>Le tue volontà</h2>
      {p.persone.length === 0 ? (
        <p>
          Per decidere a chi va questa voce, aggiungi prima le persone.{' '}
          <button className="link" onClick={p.onVaiPersone}>
            Vai alle persone
          </button>
        </p>
      ) : (
        <fieldset className="scelte-ruolo">
          <legend>Chi la riceve</legend>
          {p.persone.map((x) => (
            <label key={x.id} className="spunta">
              <input
                type="checkbox"
                checked={scelti.includes(x.id)}
                onChange={(e) => {
                  setFatto(false);
                  setScelti(e.target.checked ? [...scelti, x.id] : scelti.filter((s) => s !== x.id));
                }}
              />
              {x.nome}
            </label>
          ))}
        </fieldset>
      )}
      {p.voce.tipo === 'account' && (
        <label>
          Cosa fare dell'account
          <select
            value={azione}
            onChange={(e) => {
              setFatto(false);
              setAzione(e.target.value as AzioneAccount | '');
            }}
          >
            <option value="">Non ho ancora deciso</option>
            {AZIONI.map((a) => (
              <option key={a.valore} value={a.valore}>
                {a.testo}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="spunta">
        <input
          type="checkbox"
          checked={emergenza}
          onChange={(e) => {
            setFatto(false);
            setEmergenza(e.target.checked);
          }}
        />
        Serve anche in caso di emergenza (le persone di fiducia la ricevono subito)
      </label>
      <button
        className="secondario"
        disabled={!cambiato || salvo}
        onClick={async () => {
          setSalvo(true);
          const { destinatari: _d, azione: _a, ...resto } = p.voce.contenuto;
          await p.onSalva({ ...resto, ...(scelti.length ? { destinatari: scelti } : {}), ...(azione ? { azione } : {}) }, emergenza);
          setSalvo(false);
          setFatto(true);
        }}
      >
        {salvo ? 'Salvo e preparo i pacchetti…' : 'Salva le volontà'}
      </button>
      {fatto && !cambiato && <p className="esito">Volontà salvate.</p>}
    </div>
  );
}

function NuovaVoce(p: {
  fornitori: Fornitore[];
  onAnnulla: () => void;
  onSalva: (d: { tipo: TipoVoce; emergenza: boolean; titolo: string; note: string; fornitore?: string; files?: File[] }) => Promise<void>;
}) {
  const [tipo, setTipo] = useState<TipoVoce | null>(null);
  const [titolo, setTitolo] = useState('');
  const [note, setNote] = useState('');
  const [fornitore, setFornitore] = useState('');
  const [emergenza, setEmergenza] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [salvo, setSalvo] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  if (!tipo) {
    return (
      <section className="passo">
        <h1>Che cosa vuoi aggiungere?</h1>
        <div className="scelte">
          {TIPI.map((t) => (
            <button key={t.tipo} className="scelta" onClick={() => setTipo(t.tipo)}>
              <span className="titolo">{t.nome}</span>
              <span className="tenue">{t.descrizione}</span>
            </button>
          ))}
        </div>
        <button className="link" onClick={p.onAnnulla}>
          Annulla
        </button>
      </section>
    );
  }

  return (
    <form
      className="passo"
      onSubmit={async (e) => {
        e.preventDefault();
        setSalvo(true);
        setErrore(null);
        try {
          await p.onSalva({ tipo, emergenza, titolo: titolo.trim(), note: note.trim(), fornitore: fornitore || undefined, files });
        } catch (err) {
          setErrore(err instanceof Error ? err.message : 'Salvataggio non riuscito');
          setSalvo(false);
        }
      }}
    >
      <p className="etichetta">{nomeTipo(tipo)}</p>
      <h1>Nuova voce</h1>
      {tipo === 'crypto' && (
        <p className="avviso">Non scrivere qui la frase di recupero o la chiave privata: indica solo dove si trovano e chi deve accedervi.</p>
      )}
      <label>
        Titolo
        <input value={titolo} onChange={(e) => setTitolo(e.target.value)} required maxLength={200} placeholder="Es. Conto PostFinance" />
      </label>
      {tipo === 'account' && (
        <label>
          Servizio
          <select value={fornitore} onChange={(e) => setFornitore(e.target.value)}>
            <option value="">Altro / non in elenco</option>
            {p.fornitori.map((f) => (
              <option key={f.slug} value={f.slug}>
                {f.nome}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Note per chi resta
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={5} maxLength={5000} placeholder="Cosa fare, a chi rivolgersi, dove trovare le cose" />
      </label>
      <ScegliDocumenti files={files} onCambia={setFiles} />
      <label className="spunta">
        <input type="checkbox" checked={emergenza} onChange={(e) => setEmergenza(e.target.checked)} />
        Serve anche in caso di emergenza (incidente, ricovero)
      </label>
      {errore && <p className="avviso">{errore}</p>}
      <button className="primario" type="submit" disabled={salvo || !titolo.trim()}>
        {salvo ? 'Cifro e salvo…' : 'Salva nella cassaforte'}
      </button>
      <button className="link" type="button" onClick={() => setTipo(null)}>
        Indietro
      </button>
    </form>
  );
}

const dimensione = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);
const MAX_BYTE = 25 * 1024 * 1024;

/** Scelta di uno o più documenti, con elenco di ciò che è stato scelto. */
function ScegliDocumenti(p: { files: File[]; onCambia: (f: File[]) => void; etichetta?: string; giaPresenti?: number }) {
  const [avviso, setAvviso] = useState<string | null>(null);
  const posti = MAX_DOCUMENTI - (p.giaPresenti ?? 0);
  return (
    <div className="scegli-documenti">
      <label>
        {p.etichetta ?? 'Documenti (facoltativi): puoi sceglierne più di uno, massimo 25 MB ciascuno'}
        <input
          type="file"
          multiple
          onChange={(e) => {
            const scelti = Array.from(e.target.files ?? []);
            const troppoGrandi = scelti.filter((f) => f.size > MAX_BYTE);
            const validi = [...p.files, ...scelti.filter((f) => f.size <= MAX_BYTE)].slice(0, posti);
            setAvviso(
              troppoGrandi.length
                ? `${troppoGrandi.map((f) => f.name).join(', ')}: più di 25 MB, non aggiunto.`
                : p.files.length + scelti.length > posti
                  ? `Al massimo ${MAX_DOCUMENTI} documenti per voce.`
                  : null,
            );
            p.onCambia(validi);
            e.target.value = '';
          }}
        />
      </label>
      {p.files.length > 0 && (
        <ul className="elenco-documenti">
          {p.files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span>
                {f.name} <span className="tenue">({dimensione(f.size)})</span>
              </span>
              <button type="button" className="link" onClick={() => p.onCambia(p.files.filter((_, j) => j !== i))}>
                Togli
              </button>
            </li>
          ))}
        </ul>
      )}
      {avviso && <p className="avviso">{avviso}</p>}
    </div>
  );
}

/** Documenti di una voce: aprire, aggiungerne altri, toglierli. */
function Documenti(p: {
  voce: Voce;
  onApri: (f: ReturnType<typeof documentiDi>[number]) => Promise<void>;
  onAggiungi: (files: File[]) => Promise<void>;
  onTogli: (f: ReturnType<typeof documentiDi>[number]) => Promise<void>;
}) {
  const documenti = documentiDi(p.voce.id, p.voce.contenuto);
  const [nuovi, setNuovi] = useState<File[]>([]);
  const [daTogliere, setDaTogliere] = useState<string | null>(null);
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function esegui(fn: () => Promise<void>) {
    setErrore(null);
    setOccupato(true);
    try {
      await fn();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : 'Operazione non riuscita');
    } finally {
      setOccupato(false);
    }
  }

  return (
    <div className="riquadro">
      <h2>Documenti</h2>
      {documenti.length === 0 && <p className="tenue">Nessun documento allegato.</p>}
      {documenti.length > 0 && (
        <ul className="elenco-documenti">
          {documenti.map((f) => (
            <li key={f.id}>
              <button className="link" onClick={() => esegui(() => p.onApri(f))}>
                {f.nome}
              </button>
              <span className="tenue">{dimensione(f.dimensione)}</span>
              {daTogliere === f.id ? (
                <span className="conferma">
                  Togliere?{' '}
                  <button className="link" disabled={occupato} onClick={() => esegui(async () => { await p.onTogli(f); setDaTogliere(null); })}>
                    Sì, togli
                  </button>{' '}
                  <button className="link" onClick={() => setDaTogliere(null)}>
                    No
                  </button>
                </span>
              ) : (
                <button className="link" onClick={() => setDaTogliere(f.id)}>
                  Togli
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {documenti.length < MAX_DOCUMENTI && (
        <>
          <ScegliDocumenti files={nuovi} onCambia={setNuovi} etichetta="Aggiungi documenti (anche più di uno)" giaPresenti={documenti.length} />
          {nuovi.length > 0 && (
            <button
              className="primario"
              disabled={occupato}
              onClick={() =>
                esegui(async () => {
                  await p.onAggiungi(nuovi);
                  setNuovi([]);
                })
              }
            >
              {occupato ? 'Cifro e carico…' : nuovi.length === 1 ? 'Carica il documento' : `Carica ${nuovi.length} documenti`}
            </button>
          )}
        </>
      )}
      {errore && <p className="avviso">{errore}</p>}
    </div>
  );
}
