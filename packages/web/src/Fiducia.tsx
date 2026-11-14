import { useCallback, useEffect, useState } from 'react';
import { api, type Ambito, type CassaforteAffidata, type Caso, type DoveFatti, type Fatto, type Fornitore, type Ricevuto } from './api';
import { dataLunga, FoglioLettera } from './Lettere';
import { SchedaFornitore } from './SchedaFornitore';
import { FUNZIONI_EREDE } from './contattoErede';
import { apriCaso, apriRicevuto, salvaFileAperto, type EsitoApertura, type VoceAperta } from './apertura';
import { etichettaFatto, letteraPerVoce } from './letteraRichiesta';
import { PrimiGiorni } from './PrimiGiorni';

const data = (s: string) => new Date(s).toLocaleString('it-CH', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function statoCaso(c: Caso): string {
  switch (c.stato) {
    case 'richiesta':
      return 'In attesa della verifica di un operatore MEMORIAE.';
    case 'in-verifica':
      return 'Un operatore sta verificando la richiesta.';
    case 'in-attesa':
      return `Verificata. Periodo d'attesa fino al ${data(c.attesaFinoAl!)}: fino ad allora la richiesta si può ancora bloccare.`;
    case 'bloccata':
      return 'Bloccata dal proprietario.';
    case 'respinta':
      return `Non accolta${c.nota ? `: ${c.nota}` : '.'}`;
    case 'rilasciata':
      return c.apribile
        ? `Apribile${c.accessoFinoAl ? ` fino al ${data(c.accessoFinoAl)}` : ''}.`
        : 'Accesso concluso.';
  }
}

/** Scheda «Per gli altri»: le cassaforti che mi sono state affidate e ciò che ho ricevuto. */
/** Spunte «fatto» condivise fra chi si occupa delle pratiche di una cassaforte aperta. */
function useFatti(dove: DoveFatti | null) {
  const [fatti, setFatti] = useState<Map<string, Fatto>>(new Map());
  const chiave = dove ? JSON.stringify(dove) : '';
  useEffect(() => {
    if (!dove) return;
    api.fatti(dove).then((r) => setFatti(new Map(r.fatti.map((f) => [f.chiave, f])))).catch(() => setFatti(new Map()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiave]);
  const segna = async (k: string, fatto: boolean) => {
    if (!dove) return;
    // Risposta immediata alla spunta; se il salvataggio non riesce, torna com'era.
    const prima = fatti;
    const subito = new Map(fatti);
    if (fatto) subito.set(k, { chiave: k, da: 'te', il: new Date().toISOString() });
    else subito.delete(k);
    setFatti(subito);
    try {
      const r = await api.segnaFatto(dove, k, fatto);
      setFatti(new Map(r.fatti.map((f) => [f.chiave, f])));
    } catch (e) {
      setFatti(prima);
      throw e;
    }
  };
  return { fatti, segna };
}

const giornoIso = (s: string) => new Date(s).toISOString().slice(0, 10);

export function Fiducia({ vaultKey, mioNome }: { vaultKey: Uint8Array; mioNome: string }) {
  const [cassaforti, setCassaforti] = useState<CassaforteAffidata[] | null>(null);
  const [ricevuti, setRicevuti] = useState<Ricevuto[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  const [aperto, setAperto] = useState<{ casoId: string; creatoIl: string; esito: EsitoApertura } | null>(null);
  const [ricevutoAperto, setRicevutoAperto] = useState<{ r: Ricevuto; voci: VoceAperta[] } | null>(null);
  const [occupato, setOccupato] = useState(false);
  const { fatti, segna } = useFatti(aperto ? { caso: aperto.casoId } : ricevutoAperto ? { ricevuto: ricevutoAperto.r.id } : null);

  const carica = useCallback(async () => {
    try {
      const [f, r] = await Promise.all([api.fiducia(), api.ricevuti()]);
      setCassaforti(f.cassaforti);
      setRicevuti(r.ricevuti);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void carica();
  }, [carica]);

  async function esegui(fn: () => Promise<void>) {
    setErrore(null);
    setOccupato(true);
    try {
      await fn();
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setOccupato(false);
    }
  }

  if (aperto) {
    const { esito, casoId } = aperto;
    const pratiche = { fatti, onFatto: segna, proprietario: esito.proprietario, mittente: mioNome };
    return (
      <div>
        <button className="link indietro" onClick={() => setAperto(null)}>
          ‹ Indietro
        </button>
        <h2>
          Cassaforte di {esito.proprietario} – {esito.ambito === 'emergenza' ? 'emergenza' : 'eredità'}
        </h2>
        {esito.accessoFinoAl && <p className="tenue">Accesso d'emergenza fino al {data(esito.accessoFinoAl)}.</p>}
        {esito.ambito === 'decesso' && (
          <PrimiGiorni
            defunto={esito.proprietario}
            mittente={mioNome}
            dataProposta={giornoIso(aperto.creatoIl)}
            chiaveMemoria={`memoriae-decesso-${casoId}`}
            fatti={fatti}
            onFatto={segna}
            onVaiVoci={() => document.getElementById('elenco-ricevuto')?.scrollIntoView({ block: 'start' })}
          />
        )}
        <div id="elenco-ricevuto">
          <ElencoVoci titolo="Per te" voci={esito.perMe} scarica={(v, fid) => api.fileCaso(casoId, v.id, fid)} vuoto="Non ci sono voci assegnate a te." {...pratiche} />
        </div>
        {esito.daConsegnare.map((d) => (
          <div key={d.nome} className="riquadro evidenza">
            <h3>Da consegnare a {d.nome}</h3>
            <p className="tenue">{d.nome} non ha un account MEMORIAE: {esito.proprietario} ha chiesto a te di consegnare queste voci.</p>
            <ElencoVoci voci={d.voci} scarica={(v, fid) => api.fileCaso(casoId, v.id, fid)} {...pratiche} />
          </div>
        ))}
        {esito.consegnati.length > 0 && (
          <p className="esito">Pacchetti consegnati a: {esito.consegnati.join(', ')}. Li può aprire solo chi li riceve.</p>
        )}
        {errore && <p className="avviso">{errore}</p>}
      </div>
    );
  }

  if (ricevutoAperto) {
    return (
      <div>
        <button className="link indietro" onClick={() => setRicevutoAperto(null)}>
          ‹ Indietro
        </button>
        <h2>Da {ricevutoAperto.r.proprietario}</h2>
        {ricevutoAperto.r.ambito === 'decesso' && (
          <PrimiGiorni
            defunto={ricevutoAperto.r.proprietario}
            mittente={mioNome}
            dataProposta={giornoIso(ricevutoAperto.r.consegnatoIl)}
            chiaveMemoria={`memoriae-decesso-${ricevutoAperto.r.id}`}
            fatti={fatti}
            onFatto={segna}
            onVaiVoci={() => document.getElementById('elenco-ricevuto')?.scrollIntoView({ block: 'start' })}
          />
        )}
        <div id="elenco-ricevuto">
          <ElencoVoci
            voci={ricevutoAperto.voci}
            scarica={(v, fid) => api.fileRicevuto(ricevutoAperto.r.id, v.id, fid)}
            vuoto="Il pacchetto è vuoto."
            fatti={fatti}
            onFatto={segna}
            proprietario={ricevutoAperto.r.proprietario}
            mittente={mioNome}
          />
        </div>
      </div>
    );
  }

  if (!cassaforti) return errore ? <p className="avviso">{errore}</p> : <p className="tenue">Un momento…</p>;

  return (
    <div>
      {errore && <p className="avviso">{errore}</p>}
      {ricevuti.length > 0 && (
        <div className="riquadro evidenza">
          <h2>Hai ricevuto</h2>
          {ricevuti.map((r) => (
            <p key={r.id}>
              Da <strong>{r.proprietario}</strong>, il {data(r.consegnatoIl)}.{' '}
              <button className="primario" disabled={occupato} onClick={() => esegui(async () => setRicevutoAperto({ r, voci: await apriRicevuto(r.id, r.interno, vaultKey) }))}>
                Apri
              </button>
            </p>
          ))}
        </div>
      )}
      {cassaforti.length === 0 && ricevuti.length === 0 && (
        <div className="riquadro">
          <p>Nessuno ti ha ancora scelto come persona di fiducia o destinatario.</p>
        </div>
      )}
      {cassaforti.map((c) => (
        <Affidata
          key={c.vaultId}
          c={c}
          occupato={occupato}
          onApri={(casoId, creatoIl) => esegui(async () => setAperto({ casoId, creatoIl, esito: await apriCaso(casoId, vaultKey) }))}
          onRichiesta={carica}
        />
      ))}
    </div>
  );
}

function Affidata(p: { c: CassaforteAffidata; occupato: boolean; onApri: (casoId: string, creatoIl: string) => void; onRichiesta: () => Promise<void> }) {
  const { c } = p;
  const [chiedi, setChiedi] = useState(false);
  const fiduciario = c.ruolo !== 'destinatario';
  const inCorso = (a: Ambito) => c.casi.some((k) => k.ambito === a && ['richiesta', 'in-verifica', 'in-attesa'].includes(k.stato));
  return (
    <div className="riquadro">
      <h2>{c.proprietario}</h2>
      <p className="tenue">
        {fiduciario
          ? 'Sei persona di fiducia: in caso di bisogno puoi chiedere l\'apertura.'
          : `Sei destinatario: se servirà, riceverai ciò che ${c.proprietario.split(' ')[0]} ha preparato per te.`}
      </p>
      {c.casi.map((k) => (
        <div key={k.id} className="caso">
          <p>
            <span className="pillola chiara">{k.ambito === 'emergenza' ? 'Emergenza' : 'Decesso'}</span> Richiesta di {k.richiestoDaMe ? 'te' : k.richiedente}, il {data(k.creatoIl)}.
          </p>
          <p>{statoCaso(k)}</p>
          {k.apribile && (
            <button className="primario" disabled={p.occupato} onClick={() => p.onApri(k.id, k.creatoIl)}>
              Apri
            </button>
          )}
        </div>
      ))}
      {fiduciario && !chiedi && (!inCorso('decesso') || !inCorso('emergenza')) && (
        <button className="secondario" onClick={() => setChiedi(true)}>
          Chiedi l'apertura
        </button>
      )}
      {chiedi && <Richiesta c={c} inCorso={inCorso} onFatto={async () => { setChiedi(false); await p.onRichiesta(); }} onAnnulla={() => setChiedi(false)} />}
    </div>
  );
}

function Richiesta(p: { c: CassaforteAffidata; inCorso: (a: Ambito) => boolean; onFatto: () => Promise<void>; onAnnulla: () => void }) {
  const nome = p.c.proprietario.split(' ')[0];
  const [ambito, setAmbito] = useState<Ambito>(p.inCorso('emergenza') ? 'decesso' : 'emergenza');
  const [motivo, setMotivo] = useState('');
  const [documenti, setDocumenti] = useState<File[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  const [occupato, setOccupato] = useState(false);

  async function invia(e: React.FormEvent) {
    e.preventDefault();
    setErrore(null);
    setOccupato(true);
    try {
      const { id } = await api.chiediApertura(p.c.vaultId, ambito, motivo);
      for (const d of documenti) await api.caricaDocumento(id, d);
      await p.onFatto();
    } catch (err) {
      setErrore((err as Error).message);
    } finally {
      setOccupato(false);
    }
  }

  return (
    <form onSubmit={invia} className="modulo">
      <fieldset className="scelte-ruolo">
        <legend>Che cosa è successo?</legend>
        <label className="spunta">
          <input type="radio" name="ambito" checked={ambito === 'emergenza'} disabled={p.inCorso('emergenza')} onChange={() => setAmbito('emergenza')} />
          <span>
            <b>Un'emergenza</b>
            <br />
            <span className="tenue">{nome} è in ospedale o non può occuparsi delle sue cose. Riceverai solo le voci d'emergenza, per 30 giorni.</span>
          </span>
        </label>
        <label className="spunta">
          <input type="radio" name="ambito" checked={ambito === 'decesso'} disabled={p.inCorso('decesso')} onChange={() => setAmbito('decesso')} />
          <span>
            <b>{nome} è mancata/o</b>
            <br />
            <span className="tenue">Dopo la verifica e 14 giorni d'attesa, ognuno riceverà ciò che {nome} ha preparato.</span>
          </span>
        </label>
      </fieldset>
      <label>
        Spiega in poche righe (lo leggerà un operatore MEMORIAE)
        <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={4} required minLength={10} />
      </label>
      <label>
        Documenti (certificato di morte, attestazione medica), se li hai: fino a 5
        <input type="file" multiple accept=".pdf,image/*" onChange={(e) => setDocumenti(Array.from(e.target.files ?? []).slice(0, 5))} />
      </label>
      <p className="tenue">{nome} riceverà subito un'e-mail e potrà bloccare la richiesta in qualsiasi momento.</p>
      {errore && <p className="avviso">{errore}</p>}
      <button className="primario" disabled={occupato}>
        Invia la richiesta
      </button>
      <button type="button" className="link" onClick={p.onAnnulla}>
        Annulla
      </button>
    </form>
  );
}

export function ElencoVoci(p: {
  titolo?: string;
  voci: VoceAperta[];
  scarica: (v: VoceAperta, fileId: string) => Promise<Uint8Array>;
  vuoto?: string;
  /** Pratiche: spunte condivise e lettere di richiesta (dopo l'apertura). */
  fatti?: Map<string, Fatto>;
  onFatto?: (chiave: string, fatto: boolean) => Promise<void>;
  proprietario?: string;
  mittente?: string;
  /** Anteprima per il proprietario: si vede tutto, ma non si può segnare nulla. */
  anteprima?: boolean;
}) {
  const [errore, setErrore] = useState<string | null>(null);
  const [fornitori, setFornitori] = useState<Fornitore[]>([]);
  const [guida, setGuida] = useState<string | null>(null);
  useEffect(() => {
    api.fornitori().then((r) => setFornitori(r.fornitori)).catch(() => setFornitori([]));
  }, []);
  const pratiche = p.voci.filter((v) => v.tipo !== 'lettera');
  const fatte = pratiche.filter((v) => p.fatti?.has(`voce:${v.id}`)).length;
  return (
    <div>
      {p.titolo && <h3>{p.titolo}</h3>}
      {p.voci.length === 0 && p.vuoto && <p className="tenue">{p.vuoto}</p>}
      {p.onFatto && !p.anteprima && pratiche.length > 0 && (
        <p className="esito">
          {fatte === pratiche.length
            ? 'Tutto sistemato. ✓'
            : `Sistemate ${fatte} di ${pratiche.length}: ${pratiche.length - fatte === 1 ? 'ne resta 1' : `ne restano ${pratiche.length - fatte}`}.`}
        </p>
      )}
      <ul className="voci">
        {p.voci.map((v) => (
          <li key={v.id} className="voce aperta">
            {v.tipo === 'lettera' && v.inArrivo ? (
              <div className="lettera-chiusa">
                <span className="titolo">Una lettera ti aspetta</span>
                <p>Si aprirà il {dataLunga(v.inArrivo)}. Quel giorno riceverai un'e-mail.</p>
              </div>
            ) : v.tipo === 'lettera' ? (
              <FoglioLettera titolo={v.contenuto.titolo} testo={v.contenuto.note} />
            ) : (
              <>
                <span className="titolo">{v.contenuto.titolo}</span>
                {v.contenuto.note && <p className="note">{v.contenuto.note}</p>}
              </>
            )}
            {v.contenuto.azione && (
              <p className="tenue">
                Volontà: {v.contenuto.azione === 'cancellare' ? 'chiudere e cancellare l\'account' : v.contenuto.azione === 'conservare' ? 'conservarlo come ricordo' : 'consegnarlo ai destinatari'}
              </p>
            )}
            {(() => {
              const fz = v.contenuto.fornitore ? FUNZIONI_EREDE[v.contenuto.fornitore] : undefined;
              const contatti = v.contenuto.erede?.contatti ?? [];
              if (!fz || contatti.length === 0) return null;
              const chiave = v.documenti.find((d) => d.id === v.contenuto.erede?.chiaveFileId);
              return (
                <p className="riquadro evidenza">
                  {fz.persone}: <b>{contatti.join(', ')}</b>.{' '}
                  {fz.chiave &&
                    (chiave
                      ? `La ${fz.chiave.nome} è il documento «${chiave.nome}» qui sotto: serve a ${contatti.length === 1 ? 'questa persona' : 'queste persone'} per la richiesta. Se non ${contatti.length === 1 ? 'c\'è più o l\'ha persa' : 'ci sono più o l\'hanno persa'}, consegnala a chi ne ha diritto.`
                      : `Chiedi a ${contatti.length === 1 ? 'questa persona' : 'queste persone'} la ${fz.chiave.nome}: serve per la richiesta.`)}
                </p>
              );
            })()}
            {(() => {
              const f = fornitori.find((x) => x.slug === v.contenuto.fornitore);
              if (!f) return null;
              return guida === v.id ? (
                <SchedaFornitore f={f} perEredi />
              ) : (
                <button className="link" onClick={() => setGuida(v.id)}>
                  Come si fa con {f.nome}?
                </button>
              );
            })()}
            {v.tipo !== 'lettera' && (p.onFatto || p.anteprima) && (
              <div className="azioni-voci">
                <label className="spunta">
                  <input
                    type="checkbox"
                    disabled={p.anteprima}
                    checked={p.fatti?.has(`voce:${v.id}`) ?? false}
                    onChange={(e) => p.onFatto?.(`voce:${v.id}`, e.target.checked).catch((err: Error) => setErrore(err.message))}
                  />
                  {(() => {
                    const f = p.fatti?.get(`voce:${v.id}`);
                    return f ? `${etichettaFatto(v.contenuto.azione)} (${f.da})` : etichettaFatto(v.contenuto.azione);
                  })()}
                </label>
                {v.tipo === 'account' && p.proprietario && p.mittente && (
                  <button
                    className="secondario"
                    disabled={p.anteprima}
                    onClick={() => letteraPerVoce(v.contenuto, fornitori.find((x) => x.slug === v.contenuto.fornitore), p.proprietario!, p.mittente!)}
                  >
                    Prepara la lettera
                  </button>
                )}
              </div>
            )}
            {v.documenti.length > 0 && (
              <div className="documenti">
                {v.documenti.map((f) => (
                  <button key={f.id} className="secondario" disabled={p.anteprima} onClick={() => salvaFileAperto(v, f, () => p.scarica(v, f.id)).catch((e) => setErrore(String(e)))}>
                    Scarica «{f.nome}»
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {errore && <p className="avviso">{errore}</p>}
    </div>
  );
}
