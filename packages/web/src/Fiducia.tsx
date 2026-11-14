import { useCallback, useEffect, useState } from 'react';
import { api, type Ambito, type CassaforteAffidata, type Caso, type Fornitore, type Ricevuto } from './api';
import { SchedaFornitore } from './SchedaFornitore';
import { apriCaso, apriRicevuto, salvaFileAperto, type EsitoApertura, type VoceAperta } from './apertura';

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
export function Fiducia({ vaultKey }: { vaultKey: Uint8Array }) {
  const [cassaforti, setCassaforti] = useState<CassaforteAffidata[] | null>(null);
  const [ricevuti, setRicevuti] = useState<Ricevuto[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  const [aperto, setAperto] = useState<{ casoId: string; esito: EsitoApertura } | null>(null);
  const [ricevutoAperto, setRicevutoAperto] = useState<{ r: Ricevuto; voci: VoceAperta[] } | null>(null);
  const [occupato, setOccupato] = useState(false);

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
    return (
      <div>
        <button className="link" onClick={() => setAperto(null)}>
          ← Indietro
        </button>
        <h2>
          Cassaforte di {esito.proprietario} – {esito.ambito === 'emergenza' ? 'emergenza' : 'eredità'}
        </h2>
        {esito.accessoFinoAl && <p className="tenue">Accesso d'emergenza fino al {data(esito.accessoFinoAl)}.</p>}
        <ElencoVoci titolo="Per te" voci={esito.perMe} scarica={(v, fid) => api.fileCaso(casoId, v.id, fid)} vuoto="Non ci sono voci assegnate a te." />
        {esito.daConsegnare.map((d) => (
          <div key={d.nome} className="riquadro evidenza">
            <h3>Da consegnare a {d.nome}</h3>
            <p className="tenue">{d.nome} non ha un account MEMORIAE: {esito.proprietario} ha chiesto a te di consegnare queste voci.</p>
            <ElencoVoci voci={d.voci} scarica={(v, fid) => api.fileCaso(casoId, v.id, fid)} />
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
        <button className="link" onClick={() => setRicevutoAperto(null)}>
          ← Indietro
        </button>
        <h2>Da {ricevutoAperto.r.proprietario}</h2>
        <ElencoVoci voci={ricevutoAperto.voci} scarica={(v, fid) => api.fileRicevuto(ricevutoAperto.r.id, v.id, fid)} vuoto="Il pacchetto è vuoto." />
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
          onApri={(casoId) => esegui(async () => setAperto({ casoId, esito: await apriCaso(casoId, vaultKey) }))}
          onRichiesta={carica}
        />
      ))}
    </div>
  );
}

function Affidata(p: { c: CassaforteAffidata; occupato: boolean; onApri: (casoId: string) => void; onRichiesta: () => Promise<void> }) {
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
            <button className="primario" disabled={p.occupato} onClick={() => p.onApri(k.id)}>
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

function ElencoVoci(p: { titolo?: string; voci: VoceAperta[]; scarica: (v: VoceAperta, fileId: string) => Promise<Uint8Array>; vuoto?: string }) {
  const [errore, setErrore] = useState<string | null>(null);
  const [fornitori, setFornitori] = useState<Fornitore[]>([]);
  const [guida, setGuida] = useState<string | null>(null);
  useEffect(() => {
    api.fornitori().then((r) => setFornitori(r.fornitori)).catch(() => setFornitori([]));
  }, []);
  return (
    <div>
      {p.titolo && <h3>{p.titolo}</h3>}
      {p.voci.length === 0 && p.vuoto && <p className="tenue">{p.vuoto}</p>}
      <ul className="voci">
        {p.voci.map((v) => (
          <li key={v.id} className="voce aperta">
            <span className="titolo">{v.contenuto.titolo}</span>
            {v.contenuto.note && <p className="note">{v.contenuto.note}</p>}
            {v.contenuto.azione && (
              <p className="tenue">
                Volontà: {v.contenuto.azione === 'cancellare' ? 'chiudere e cancellare l\'account' : v.contenuto.azione === 'conservare' ? 'conservarlo come ricordo' : 'consegnarlo ai destinatari'}
              </p>
            )}
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
            {v.documenti.length > 0 && (
              <div className="documenti">
                {v.documenti.map((f) => (
                  <button key={f.id} className="secondario" onClick={() => salvaFileAperto(v, f, () => p.scarica(v, f.id)).catch((e) => setErrore(String(e)))}>
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
