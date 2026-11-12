import { useCallback, useEffect, useState } from 'react';
import { api, type Fornitore, type Persona, type Ruolo, type TipoVoce, type Utente } from './api';
import { Persone } from './Persone';
import { sincronizzaRilascio, type StatoRilascio } from './rilascio';
import { aggiornaVoce, aggiungiVoce, leggiVoci, scaricaFile, type AzioneAccount, type ContenutoVoce, type Voce } from './vault';

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
  const [stato, setStato] = useState<StatoRilascio | null>(null);
  const [scheda, setScheda] = useState<'voci' | 'persone'>('voci');
  const [vista, setVista] = useState<{ tipo: 'elenco' } | { tipo: 'nuova' } | { tipo: 'dettaglio'; id: string }>({ tipo: 'elenco' });
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
  }, [ricarica]);

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
        {v.haFile && v.contenuto.file && (
          <button className="secondario" onClick={() => scaricaFile(vaultKey, v).catch((e) => setErrore(String(e)))}>
            Apri «{v.contenuto.file.nome}»
          </button>
        )}
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
        {f && (
          <div className="riquadro">
            <h2>{f.nome}</h2>
            {f.daVivi.length > 0 && (
              <>
                <h3>Da fare adesso</h3>
                <ol>{f.daVivi.map((x) => <li key={x}>{x}</li>)}</ol>
              </>
            )}
            {f.perGliEredi.length > 0 && (
              <>
                <h3>Cosa dovranno fare gli eredi</h3>
                <ol>{f.perGliEredi.map((x) => <li key={x}>{x}</li>)}</ol>
              </>
            )}
            <p className="tenue">
              {f.fonte ? (
                <>
                  Fonte:{' '}
                  <a href={f.fonte} target="_blank" rel="noreferrer noopener">
                    pagina ufficiale
                  </a>
                  . Indicazioni da ricontrollare prima di agire.
                </>
              ) : (
                'Indicazioni generali, in corso di verifica con il fornitore.'
              )}
            </p>
          </div>
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
      </div>
      {scheda === 'persone' ? (
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
                        {v.haFile && <span className="pillola chiara">Documento</span>}
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
  onSalva: (d: { tipo: TipoVoce; emergenza: boolean; titolo: string; note: string; fornitore?: string; file?: File | null }) => Promise<void>;
}) {
  const [tipo, setTipo] = useState<TipoVoce | null>(null);
  const [titolo, setTitolo] = useState('');
  const [note, setNote] = useState('');
  const [fornitore, setFornitore] = useState('');
  const [emergenza, setEmergenza] = useState(false);
  const [file, setFile] = useState<File | null>(null);
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
          await p.onSalva({ tipo, emergenza, titolo: titolo.trim(), note: note.trim(), fornitore: fornitore || undefined, file });
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
      <label>
        Documento (facoltativo, massimo 25 MB)
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
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
