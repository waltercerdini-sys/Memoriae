import { useCallback, useEffect, useState } from 'react';
import { api, type Fornitore, type TipoVoce, type Utente } from './api';
import { aggiungiVoce, leggiVoci, scaricaFile, type Voce } from './vault';

const TIPI: { tipo: TipoVoce; nome: string; descrizione: string }[] = [
  { tipo: 'account', nome: 'Account', descrizione: 'E-mail, social, banca online, abbonamenti' },
  { tipo: 'documento', nome: 'Documento', descrizione: 'Contratti, polizze, certificati' },
  { tipo: 'istruzione', nome: 'Istruzione', descrizione: 'Cosa fare, chi chiamare, dove trovare le cose' },
  { tipo: 'dispositivo', nome: 'Dispositivo', descrizione: 'Telefono, computer, chiavette' },
  { tipo: 'crypto', nome: 'Criptovalute', descrizione: 'Dove sono e chi deve accedervi (mai la frase di recupero)' },
  { tipo: 'cartella', nome: 'Cartella', descrizione: 'Foto e ricordi da lasciare' },
];

const nomeTipo = (t: TipoVoce) => TIPI.find((x) => x.tipo === t)?.nome ?? t;

export function Inventario({ vaultKey, utente }: { vaultKey: Uint8Array; utente: Utente }) {
  const [voci, setVoci] = useState<Voce[] | null>(null);
  const [fornitori, setFornitori] = useState<Fornitore[]>([]);
  const [vista, setVista] = useState<{ tipo: 'elenco' } | { tipo: 'nuova' } | { tipo: 'dettaglio'; voce: Voce }>({ tipo: 'elenco' });
  const [errore, setErrore] = useState<string | null>(null);

  const ricarica = useCallback(async () => {
    try {
      setVoci(await leggiVoci(vaultKey));
    } catch (e) {
      setErrore(e instanceof Error ? e.message : 'Errore nel caricare le voci');
    }
  }, [vaultKey]);

  useEffect(() => {
    void ricarica();
    api.fornitori().then((r) => setFornitori(r.fornitori)).catch(() => setFornitori([]));
  }, [ricarica]);

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
    const v = vista.voce;
    const f = fornitori.find((x) => x.slug === v.contenuto.fornitore);
    return (
      <section className="passo">
        <p className="etichetta">{nomeTipo(v.tipo)}</p>
        <h1>{v.contenuto.titolo}</h1>
        {v.emergenza && <p className="pillola">Serve in caso di emergenza</p>}
        {v.contenuto.note && <p className="note">{v.contenuto.note}</p>}
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
        {v.haFile && v.contenuto.file && (
          <button className="secondario" onClick={() => scaricaFile(vaultKey, v).catch((e) => setErrore(String(e)))}>
            Apri «{v.contenuto.file.nome}»
          </button>
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
      {errore && <p className="avviso">{errore}</p>}
      {voci === null && <p className="tenue">Apro la cassaforte…</p>}
      {voci && voci.length === 0 && (
        <div className="riquadro">
          <h2>Cominciamo dall'elenco</h2>
          <p>Aggiungi le cose che chi resta dovrà trovare: indirizzo e-mail principale, banca online, abbonamenti, telefono.</p>
        </div>
      )}
      {voci && voci.length > 0 && (
        <ul className="voci">
          {voci.map((v) => (
            <li key={v.id}>
              <button className="voce" onClick={() => setVista({ tipo: 'dettaglio', voce: v })}>
                <span className="etichetta">{nomeTipo(v.tipo)}</span>
                <span className="titolo">{v.contenuto.titolo}</span>
                <span className="dettagli">
                  {v.emergenza && <span className="pillola">Emergenza</span>}
                  {v.haFile && <span className="pillola chiara">Documento</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="primario" onClick={() => setVista({ tipo: 'nuova' })}>
        Aggiungi una voce
      </button>
    </section>
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
