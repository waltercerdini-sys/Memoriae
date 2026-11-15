import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Caso, type Fornitore, type StatoPiano, type Persona, type Ruolo, type TipoVoce, type Utente } from './api';
import { Controllo } from './Controllo';
import { Fiducia, statoCaso } from './Fiducia';
import { Operatore } from './Operatore';
import { Piano, RigaPiano } from './Piano';
import { calcolaProntezza, statoVoce, type Prontezza } from './prontezza';
import { SchedaFornitore } from './SchedaFornitore';
import { SchedaErede } from './SchedaErede';
import { funzioneErede } from './contattoErede';
import { TrovaTutto } from './TrovaTutto';
import { dataLunga, FoglioLettera, NuovaLettera, nomiDestinatari } from './Lettere';
import { Persone } from './Persone';
import { dimenticaPianoScelto, pianoScelto } from './pianoScelto';
import { Anteprima } from './Anteprima';
import { Fascicolo } from './Fascicolo';
import { LibroRicordi } from './LibroRicordi';
import { CartaMemoriae } from './CartaMemoriae';
import { useAiuto, type PaginaAiuto } from './aiuto';
import { sincronizzaRilascio, type StatoRilascio } from './rilascio';
import { aggiornaVoce, aggiungiDocumenti, aggiungiVoce, documentiDi, leggiVoci, MAX_DOCUMENTI, rimuoviDocumento, scaricaFile, sostituisciDocumento, type AzioneAccount, type ContenutoVoce, type Voce } from './vault';

const TIPI: { tipo: TipoVoce; nome: string; descrizione: string }[] = [
  { tipo: 'account', nome: 'Account', descrizione: 'E-mail, social, banca online, abbonamenti' },
  { tipo: 'documento', nome: 'Documento', descrizione: 'Contratti, polizze, certificati' },
  { tipo: 'istruzione', nome: 'Istruzione', descrizione: 'Cosa fare, chi chiamare, dove trovare le cose' },
  { tipo: 'dispositivo', nome: 'Dispositivo', descrizione: 'Telefono, computer, chiavette' },
  { tipo: 'crypto', nome: 'Criptovalute', descrizione: 'Dove sono e chi deve accedervi (mai la frase di recupero)' },
  { tipo: 'cartella', nome: 'Cartella', descrizione: 'Foto e ricordi da lasciare' },
  { tipo: 'lettera', nome: 'Lettera per il futuro', descrizione: 'Parole, foto o un audio per qualcuno, da aprire in un giorno che scegli tu' },
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
  const [scheda, setScheda] = useState<'voci' | 'ricordi' | 'persone' | 'controllo' | 'altri' | 'operatore'>('voci');
  const [vista, setVista] = useState<{ tipo: 'elenco' } | { tipo: 'nuova' } | { tipo: 'dettaglio'; id: string } | { tipo: 'piano' } | { tipo: 'trova' } | { tipo: 'lettera' } | { tipo: 'anteprima'; id: string | null } | { tipo: 'fascicolo' } | { tipo: 'ricordi' } | { tipo: 'carta' }>({ tipo: 'elenco' });

  // Il tasto «indietro» del browser torna alla schermata precedente dentro MEMORIAE invece di uscire.
  useEffect(() => {
    // Lo scorrimento lo gestiamo noi (ritorno sulla voce): il browser non deve ripristinarlo da solo.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const nav = { scheda, vista };
    const attuale = (history.state as { memoriae?: unknown } | null)?.memoriae;
    if (!attuale) history.replaceState({ ...(history.state ?? {}), memoriae: nav }, '');
    else if (JSON.stringify(attuale) !== JSON.stringify(nav)) {
      history.pushState({ memoriae: nav }, '');
      window.scrollTo(0, 0);
    }
  }, [scheda, vista]);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const n = (e.state as { memoriae?: { scheda: typeof scheda; vista: typeof vista } } | null)?.memoriae;
      if (!n) return;
      setScheda(n.scheda);
      setVista(n.vista);
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  /** Ultima voce aperta o aggiunta: tornando all'elenco la ritroviamo lì, evidenziata. */
  const [ultima, setUltima] = useState<string | null>(null);
  const daRiposizionare = useRef(false);
  const [filtro, setFiltro] = useState<'tutte' | 'da-completare'>('tutte');
  const apri = (id: string) => {
    setUltima(id);
    daRiposizionare.current = true;
    setVista({ tipo: 'dettaglio', id });
  };
  const [piano, setPiano] = useState<StatoPiano | null>(null);
  const [controlloAttivo, setControlloAttivo] = useState(true);
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

  // Piano scelto sul sito: dopo l'accesso si apre la pagina del piano con quella scelta in evidenza.
  useEffect(() => {
    const sc = pianoScelto();
    if (sc === 'essenziale' || sc === 'famiglia') setVista({ tipo: 'piano' });
    else if (sc === 'prova') dimenticaPianoScelto();
  }, []);

  useEffect(() => {
    void ricarica();
    api.fornitori().then((r) => setFornitori(r.fornitori)).catch(() => setFornitori([]));
    api.fiducia().then((r) => setFiducia(r.cassaforti)).catch(() => setFiducia([]));
    api.operatore().then((r) => setOperatore({ prova: r.prova })).catch(() => setOperatore(null));
    api.mieiCasi().then((r) => setMieiCasi(r.casi)).catch(() => setMieiCasi([]));
    api.abbonamento().then(setPiano).catch(() => setPiano(null));
    api.controllo().then((c) => setControlloAttivo(!c.inPausa)).catch(() => undefined);
  }, [ricarica]);

  // Le risposte dell'Intervista dei ricordi stanno nel loro libro, non nell'elenco né nella percentuale.
  // Le lettere stanno nella scheda «Ricordi», insieme al libro dei ricordi.
  const vociElenco = voci ? voci.filter((v) => v.tipo !== 'ricordo' && v.tipo !== 'lettera') : null;
  const ricordi = voci ? voci.filter((v) => v.tipo === 'ricordo') : [];
  const lettere = voci ? voci.filter((v) => v.tipo === 'lettera') : [];
  const prontezza = vociElenco ? calcolaProntezza(vociElenco, persone, fornitori, controlloAttivo) : null;

  // Tornando all'elenco: la voce appena gestita in vista, evidenziata per un attimo.
  // Una volta sola per ritorno (non a ogni ricaricamento dei dati), dopo che l'elenco è disegnato.
  useEffect(() => {
    if (vista.tipo !== 'elenco' || (scheda !== 'voci' && scheda !== 'ricordi') || !ultima || !voci || !daRiposizionare.current) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const f = requestAnimationFrame(() => {
      // Se la voce non è in elenco (per esempio eliminata), si va alla voce che la seguiva.
      const ordine = voci.map((v) => v.id);
      const da = Math.max(0, ordine.indexOf(ultima));
      const id = [ultima, ...ordine.slice(da + 1), ...ordine.slice(0, da).reverse()].find((x) => document.getElementById(`voce-${x}`));
      const el = id ? document.getElementById(`voce-${id}`) : null;
      daRiposizionare.current = false;
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('appena');
      t = setTimeout(() => el.classList.remove('appena'), 2000);
    });
    return () => {
      cancelAnimationFrame(f);
      if (t) clearTimeout(t);
    };
  }, [vista, scheda, ultima, voci]);

  // Aiuto contestuale: la pagina aperta e la situazione, per suggerire il passo giusto.
  const SCHEDA_AIUTO: Record<typeof scheda, PaginaAiuto> = { voci: 'voci', ricordi: 'ricordi', persone: 'persone', controllo: 'protezione', altri: 'altri', operatore: 'operatore' };
  const VISTA_AIUTO: Record<Exclude<typeof vista.tipo, 'elenco' | 'dettaglio'>, PaginaAiuto> = {
    nuova: 'voce-nuova', piano: 'piano', trova: 'trova', lettera: 'lettera', anteprima: 'anteprima', fascicolo: 'fascicolo', ricordi: 'libro', carta: 'carta',
  };
  const paginaAiuto: PaginaAiuto =
    vista.tipo === 'elenco'
      ? SCHEDA_AIUTO[scheda]
      : vista.tipo === 'dettaglio'
        ? voci?.find((v) => v.id === vista.id)?.tipo === 'lettera'
          ? 'lettera'
          : 'voce'
        : VISTA_AIUTO[vista.tipo];
  useAiuto(paginaAiuto, {
    voci: vociElenco?.length ?? 0,
    daCompletare: prontezza?.daCompletare ?? 0,
    persone: persone.length,
    fiduciari: persone.filter((x) => x.ruolo !== 'destinatario' && x.statoInvito === 'accettato').length,
    daInvitare: persone.filter((x) => !x.soloLettere && x.email && x.statoInvito !== 'accettato').length,
    lettere: lettere.length,
    ricordi: ricordi.length,
    controlloAttivo,
  });

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

  if (vista.tipo === 'trova') {
    return (
      <TrovaTutto
        vaultKey={vaultKey}
        fornitori={fornitori}
        voci={voci ?? []}
        onAnnulla={() => setVista({ tipo: 'elenco' })}
        onFatto={async (n) => {
          await ricarica();
          setScheda('voci');
          setVista({ tipo: 'elenco' });
          setEsito(`Aggiunte ${n === 1 ? '1 voce' : `${n} voci`} alla cassaforte. Ora decidi a chi va ciascuna e cosa fare degli account.`);
        }}
      />
    );
  }

  if (vista.tipo === 'anteprima') {
    return (
      <Anteprima
        persone={persone}
        voci={voci ?? []}
        fornitori={fornitori}
        proprietario={utente.nome}
        personaId={vista.id}
        onScegli={(id) => setVista({ tipo: 'anteprima', id: id || null })}
        onIndietro={() => setVista({ tipo: 'elenco' })}
        onApriVoce={apri}
      />
    );
  }

  if (vista.tipo === 'carta') {
    return <CartaMemoriae onIndietro={() => setVista({ tipo: 'elenco' })} />;
  }

  if (vista.tipo === 'ricordi') {
    return (
      <LibroRicordi
        vaultKey={vaultKey}
        voci={voci ?? []}
        persone={persone}
        onCambio={ricarica}
        onIndietro={() => setVista({ tipo: 'elenco' })}
        onVaiPersone={() => {
          setVista({ tipo: 'elenco' });
          setScheda('persone');
        }}
      />
    );
  }

  if (vista.tipo === 'fascicolo') {
    return <Fascicolo proprietario={utente.nome} voci={voci ?? []} persone={persone} fornitori={fornitori} onIndietro={() => setVista({ tipo: 'elenco' })} />;
  }

  if (vista.tipo === 'lettera') {
    return (
      <NuovaLettera
        vaultKey={vaultKey}
        persone={persone}
        scegliDocumenti={(files, onCambia) => (
          <ScegliDocumenti files={files} onCambia={onCambia} etichetta="Foto, audio o video da allegare (facoltativi, massimo 25 MB ciascuno)" />
        )}
        onAnnulla={() => setVista({ tipo: 'elenco' })}
        onFatto={async (id) => {
          await ricarica();
          setUltima(id);
          daRiposizionare.current = true;
          setScheda('ricordi');
          setVista({ tipo: 'elenco' });
          setEsito('Lettera chiusa nella cassaforte. Resterà cifrata fino al giorno che hai scelto.');
        }}
      />
    );
  }

  if (vista.tipo === 'nuova') {
    return (
      <NuovaVoce
        fornitori={fornitori}
        onLettera={() => setVista({ tipo: 'lettera' })}
        onAnnulla={() => setVista({ tipo: 'elenco' })}
        onSalva={async (dati) => {
          const id = await aggiungiVoce(vaultKey, dati);
          await ricarica();
          setUltima(id);
          daRiposizionare.current = true;
          setVista({ tipo: 'elenco' });
        }}
      />
    );
  }

  if (vista.tipo === 'dettaglio') {
    const v = voci?.find((x) => x.id === vista.id);
    if (!v) {
      // Voce eliminata o non ancora caricata (per esempio tornando indietro con il browser).
      if (voci) queueMicrotask(() => setVista({ tipo: 'elenco' }));
      return null;
    }
    const f = fornitori.find((x) => x.slug === v.contenuto.fornitore);
    if (v.tipo === 'lettera') {
      const per = nomiDestinatari(v.remota.lettera?.destinatari ?? [], persone);
      const quando = v.remota.lettera?.consegnaIl;
      return (
        <section className="passo">
          <button className="link indietro" onClick={() => setVista({ tipo: 'elenco' })}>
            ‹ Torna all'elenco
          </button>
          {prontezza && <BarraProntezza p={prontezza} compatta />}
          <p className="etichetta">Lettera per il futuro</p>
          <p className="pillola chiara">
            {per ? `Per ${per}` : 'Nessun destinatario: la persona è stata rimossa'} · {quando ? `si apre il ${dataLunga(quando)}` : 'si apre insieme alla cassaforte'}
          </p>
          <FoglioLettera titolo={v.contenuto.titolo} testo={v.contenuto.note} />
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
          <button
            className="pericolo"
            onClick={async () => {
              if (!window.confirm('Eliminare questa lettera?')) return;
              await api.eliminaVoce(v.id);
              await ricarica();
              setVista({ tipo: 'elenco' });
            }}
          >
            Elimina la lettera
          </button>
          <button className="link" onClick={() => setVista({ tipo: 'elenco' })}>
            Torna all'elenco
          </button>
        </section>
      );
    }
    return (
      <section className="passo">
        <button className="link indietro" onClick={() => setVista({ tipo: 'elenco' })}>
          ‹ Torna all'elenco
        </button>
        {prontezza && <BarraProntezza p={prontezza} compatta />}
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
          key={v.id}
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
        {f && (
          <SchedaFornitore
            f={f}
            impostato={!!v.contenuto.impostatoDaVivo}
            onImpostato={async (fatto) => {
              await aggiornaVoce(vaultKey, v, { ...v.contenuto, impostatoDaVivo: fatto }, v.emergenza);
              await ricarica();
            }}
          />
        )}
        {f && funzioneErede(v) && (
          <SchedaErede
            voce={v}
            fz={funzioneErede(v)!}
            servizio={f.nome.split(' (')[0] ?? f.nome}
            onSalvaContatti={async (contatti) => {
              const erede = { ...v.contenuto.erede, contatti };
              await aggiornaVoce(vaultKey, v, { ...v.contenuto, erede, ...(contatti.length ? { impostatoDaVivo: true } : {}) }, v.emergenza);
              await ricarica();
            }}
            onAllegaChiave={async (file) => {
              await aggiungiDocumenti(vaultKey, v, [file], (nuovi) => ({ erede: { contatti: v.contenuto.erede?.contatti ?? [], chiaveFileId: nuovi[0]?.id } }));
              await ricarica();
            }}
            onSostituisciChiave={async (vecchia, file) => {
              await sostituisciDocumento(vaultKey, v, vecchia.id, file, (nuovo) => ({ erede: { contatti: v.contenuto.erede?.contatti ?? [], chiaveFileId: nuovo.id } }));
              await ricarica();
            }}
            onTogliChiave={async (vecchia) => {
              await rimuoviDocumento(vaultKey, v, vecchia.id);
              await ricarica();
            }}
            onApri={(x) => scaricaFile(vaultKey, v, x)}
          />
        )}
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
      {prontezza && <BarraProntezza p={prontezza} />}
      {prontezza?.avvisi.map((a) => (
        <div key={a.azione} className="riquadro avviso-azione">
          <p>{a.testo}</p>
          <button
            className="secondario"
            onClick={() => setScheda(a.azione)}
          >
            {a.pulsante}
          </button>
        </div>
      ))}
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
        <button role="tab" aria-selected={scheda === 'ricordi'} className={scheda === 'ricordi' ? 'attiva' : ''} onClick={() => setScheda('ricordi')}>
          Ricordi
        </button>
        <button role="tab" aria-selected={scheda === 'persone'} className={scheda === 'persone' ? 'attiva' : ''} onClick={() => setScheda('persone')}>
          Persone
        </button>
        <button role="tab" aria-selected={scheda === 'controllo'} className={scheda === 'controllo' ? 'attiva' : ''} onClick={() => setScheda('controllo')}>
          Protezione
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
      {scheda !== 'voci' && (
        <button className="link indietro" onClick={() => setScheda('voci')}>
          ‹ Torna alle voci
        </button>
      )}
      {scheda === 'operatore' && operatore ? (
        <Operatore prova={operatore.prova} />
      ) : scheda === 'altri' ? (
        <Fiducia vaultKey={vaultKey} mioNome={utente.nome} />
      ) : scheda === 'controllo' ? (
        <>
          <Controllo />
          <h2>Se ti succede qualcosa</h2>
          <button className="voce strumento" onClick={() => setVista({ tipo: 'carta' })}>
            <span className="etichetta">Da tenere nel portafoglio</span>
            <span className="titolo">💳 Carta MEMORIAE</span>
            <span className="tenue">Chi la trova la avvicina al telefono e può avvisare le tue persone di fiducia.</span>
          </button>
          <button className="voce strumento" onClick={() => setVista({ tipo: 'fascicolo' })}>
            <span className="etichetta">Da allegare al testamento</span>
            <span className="titolo">📄 Fascicolo per il notaio</span>
            <span className="tenue">I tuoi account, le persone e le volontà, senza password, pronti da stampare.</span>
          </button>
        </>
      ) : scheda === 'persone' ? (
        <>
          {persone.length > 0 && (
            <button className="voce strumento" onClick={() => setVista({ tipo: 'anteprima', id: null })}>
              <span className="etichetta">Prova generale</span>
              <span className="titolo">👁 Guarda con gli occhi di…</span>
              <span className="tenue">Scegli una persona e vedi esattamente cosa riceverà.</span>
            </button>
          )}
          <Persone persone={persone} stato={stato} onCambio={ricarica} onAnteprima={(id) => setVista({ tipo: 'anteprima', id })} />
        </>
      ) : scheda === 'ricordi' ? (
        <>
          <p>Le cose del cuore: parole e ricordi per le persone che ami, chiusi e cifrati fino al momento giusto.</p>
          <h2>Lettere per il futuro</h2>
          {lettere.length === 0 && <p className="tenue">Una lettera per i 18 anni di un nipote, per un matrimonio, o semplicemente per dire grazie.</p>}
          {lettere.length > 0 && (
            <ul className="voci">
              {lettere.map((v) => (
                <li key={v.id} id={`voce-${v.id}`}>
                  <button className="voce" onClick={() => apri(v.id)}>
                    <span className="etichetta">Lettera</span>
                    <span className="titolo">{v.contenuto.titolo}</span>
                    {nomiDestinatari(v.remota.lettera?.destinatari ?? [], persone) && (
                      <span className="tenue">Per {nomiDestinatari(v.remota.lettera?.destinatari ?? [], persone)}</span>
                    )}
                    <span className="dettagli">
                      <span className="pillola chiara">
                        {v.remota.lettera?.consegnaIl ? `Si apre il ${dataLunga(v.remota.lettera.consegnaIl)}` : 'Si apre con la cassaforte'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="primario" onClick={() => setVista({ tipo: 'lettera' })}>
            ✉ Scrivi una lettera
          </button>
          <h2>Il libro dei ricordi</h2>
          <button className="voce strumento" onClick={() => setVista({ tipo: 'ricordi' })}>
            <span className="etichetta">Intervista dei ricordi</span>
            <span className="titolo">📖 Il libro dei ricordi</span>
            <span className="tenue">
              {ricordi.length === 0
                ? 'Una domanda alla settimana: rispondi a voce, anche solo due minuti.'
                : `${ricordi.length === 1 ? '1 risposta' : `${ricordi.length} risposte`}. C'è una nuova domanda per te.`}
            </span>
          </button>
        </>
      ) : (
        <>
          {voci === null && <p className="tenue">Apro la cassaforte…</p>}
          {vociElenco && vociElenco.length === 0 && (
            <div className="riquadro evidenza">
              <h2>Cominciamo dall'elenco</h2>
              <p>
                Il modo più veloce: <strong>Trova tutto</strong> legge l'elenco delle password del tuo computer (senza tenere le password) e
                prepara in pochi minuti l'elenco di banche, posta, assicurazioni e abbonamenti.
              </p>
              <button className="primario" onClick={() => setVista({ tipo: 'trova' })}>
                Trova tutto
              </button>
            </div>
          )}
          {vociElenco && vociElenco.length > 0 && (
            <div className="filtro" role="group" aria-label="Quali voci mostrare">
              <button aria-pressed={filtro === 'tutte'} className={filtro === 'tutte' ? 'attiva' : ''} onClick={() => setFiltro('tutte')}>
                Tutte ({vociElenco.length})
              </button>
              <button aria-pressed={filtro === 'da-completare'} className={filtro === 'da-completare' ? 'attiva' : ''} onClick={() => setFiltro('da-completare')}>
                Da completare ({prontezza?.daCompletare ?? 0})
              </button>
            </div>
          )}
          {vociElenco && vociElenco.length > 0 && filtro === 'da-completare' && prontezza?.daCompletare === 0 && (
            <p className="esito">Tutte le voci sono complete. ✓</p>
          )}
          {vociElenco && vociElenco.length > 0 && (
            <ul className="voci">
              {vociElenco
                .map((v) => ({ v, st: statoVoce(v, fornitori) }))
                .filter(({ v, st }) => filtro === 'tutte' || !st.completa || v.id === ultima)
                .map(({ v, st }) => {
                const ids = v.tipo === 'lettera' ? (v.remota.lettera?.destinatari ?? []) : (v.contenuto.destinatari ?? []);
                const chi = nomiDestinatari(ids, persone);
                return (
                  <li key={v.id} id={`voce-${v.id}`}>
                    <button className="voce" onClick={() => apri(v.id)}>
                      <span className="riga-voce">
                        <span className="etichetta">{nomeTipo(v.tipo)}</span>
                        {st.completa ? (
                          <span className="spunta-voce" aria-label="Completa" title="Completa">
                            ✓
                          </span>
                        ) : null}
                      </span>
                      <span className="titolo">{v.contenuto.titolo}</span>
                      {chi && <span className="tenue">Per {chi}</span>}
                      {!st.completa && <span className="manca">Manca: {st.manca.join(', ')}</span>}
                      <span className="dettagli">
                        {v.emergenza && <span className="pillola">Emergenza</span>}
                        {v.tipo === 'lettera' && (
                          <span className="pillola chiara">
                            {v.remota.lettera?.consegnaIl ? `Si apre il ${dataLunga(v.remota.lettera.consegnaIl)}` : 'Si apre con la cassaforte'}
                          </span>
                        )}
                        {v.contenuto.abbonamento && (
                          <span className="pillola chiara">CHF {v.contenuto.abbonamento.chfMese.toFixed(2)} al mese</span>
                        )}
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
          <div className="azioni-voci">
            <button className="primario" onClick={() => setVista({ tipo: 'nuova' })}>
              Aggiungi una voce
            </button>
            {vociElenco && vociElenco.length > 0 && (
              <button className="secondario" onClick={() => setVista({ tipo: 'trova' })}>
                Trova tutto
              </button>
            )}
          </div>
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
  const [stato, setStato] = useState<'fermo' | 'salvo' | 'salvato' | 'errore'>('fermo');
  // Ogni scelta si salva subito; i salvataggi vanno in fila, così due tocchi veloci non si sovrappongono.
  const coda = useRef<Promise<void>>(Promise.resolve());
  const ultimo = useRef(0);

  function salva(n: { scelti: string[]; azione: AzioneAccount | ''; emergenza: boolean }, annulla: () => void) {
    setScelti(n.scelti);
    setAzione(n.azione);
    setEmergenza(n.emergenza);
    setStato('salvo');
    const numero = ++ultimo.current;
    coda.current = coda.current.then(async () => {
      try {
        const { destinatari: _d, azione: _a, ...resto } = p.voce.contenuto;
        await p.onSalva({ ...resto, ...(n.scelti.length ? { destinatari: n.scelti } : {}), ...(n.azione ? { azione: n.azione } : {}) }, n.emergenza);
        if (numero === ultimo.current) setStato('salvato');
      } catch {
        annulla();
        setStato('errore');
      }
    });
  }

  // Persone di fiducia per prime: di solito sono loro a occuparsi delle pratiche.
  const ordinate = [...p.persone].sort((a, b) => Number(b.ruolo !== 'destinatario') - Number(a.ruolo !== 'destinatario'));
  const cosa = azione === 'cancellare' ? 'chiuderlo' : azione === 'conservare' ? 'occuparsene' : 'riceverlo';
  const senzaPersona = !!azione && scelti.length === 0;
  const prima = { scelti, azione, emergenza };

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
        <fieldset className={`scelte-ruolo ${senzaPersona ? 'da-scegliere' : ''}`}>
          <legend>{senzaPersona ? `Chi si occuperà di ${cosa}?` : 'Chi la riceve'}</legend>
          {senzaPersona && <p className="avviso">Scegli almeno una persona: senza, alla tua scomparsa questa voce non arriva a nessuno.</p>}
          {ordinate.map((x) => (
            <label key={x.id} className="spunta">
              <input
                type="checkbox"
                checked={scelti.includes(x.id)}
                disabled={stato === 'salvo'}
                onChange={(e) => salva({ ...prima, scelti: e.target.checked ? [...scelti, x.id] : scelti.filter((s) => s !== x.id) }, () => setScelti(prima.scelti))}
              />
              {x.nome}
              {x.ruolo !== 'destinatario' && <span className="tenue"> · persona di fiducia</span>}
            </label>
          ))}
        </fieldset>
      )}
      {p.voce.tipo === 'account' && (
        <label>
          Cosa fare dell'account
          <select
            value={azione}
            disabled={stato === 'salvo'}
            onChange={(e) => salva({ ...prima, azione: e.target.value as AzioneAccount | '' }, () => setAzione(prima.azione))}
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
          disabled={stato === 'salvo'}
          onChange={(e) => salva({ ...prima, emergenza: e.target.checked }, () => setEmergenza(prima.emergenza))}
        />
        Serve anche in caso di emergenza (le persone di fiducia la ricevono dopo la verifica e 72 ore d'attesa)
      </label>
      <p className={stato === 'errore' ? 'avviso' : 'stato-salvataggio'} aria-live="polite">
        {stato === 'salvo' && 'Salvo…'}
        {stato === 'salvato' && 'Salvato ✓'}
        {stato === 'errore' && 'Non sono riuscito a salvare: la scelta è tornata com\'era. Riprova.'}
      </p>
    </div>
  );
}

function NuovaVoce(p: {
  fornitori: Fornitore[];
  onAnnulla: () => void;
  onLettera: () => void;
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
          {TIPI.filter((t) => t.tipo !== 'lettera' && t.tipo !== 'ricordo').map((t) => (
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
      <p className="etichetta">Nuova voce</p>
      <h1>{nomeTipo(tipo)}</h1>
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

/** «La tua eredità digitale è pronta al …%»: un numero solo, come la batteria del telefono. */
function BarraProntezza({ p, compatta = false }: { p: Prontezza; compatta?: boolean }) {
  return (
    <div className={`prontezza ${compatta ? 'compatta' : ''}`}>
      <div className="prontezza-riga">
        <span>
          {compatta ? 'Eredità digitale pronta al ' : 'La tua eredità digitale è pronta al '}
          <strong>{p.percento}%</strong>
        </span>
      </div>
      <div className="prontezza-barra" role="progressbar" aria-valuenow={p.percento} aria-valuemin={0} aria-valuemax={100} aria-label="Eredità digitale pronta">
        <span style={{ width: `${p.percento}%` }} />
      </div>
      {!compatta && p.abbonamentiAnno > 0 && <p className="tenue">Abbonamenti in elenco: circa CHF {p.abbonamentiAnno.toLocaleString('de-CH')} all'anno.</p>}
    </div>
  );
}
