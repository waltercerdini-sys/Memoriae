import { useState } from 'react';
import { api, type Persona, type Ruolo } from './api';
import type { StatoRilascio } from './rilascio';

export const NOME_RUOLO: Record<Ruolo, string> = {
  fiduciario: 'Persona di fiducia',
  destinatario: 'Destinatario',
  'fiduciario-destinatario': 'Fiducia e destinatario',
};

const STATO: Record<Persona['statoInvito'], string> = {
  'da-invitare': 'Da invitare',
  invitato: 'Invito inviato',
  accettato: 'Ha accettato',
  rifiutato: 'Ha rifiutato',
  revocato: 'Revocato',
};

export function Persone(p: { persone: Persona[]; stato: StatoRilascio | null; onCambio: () => Promise<void> }) {
  const [aggiungi, setAggiungi] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [occupato, setOccupato] = useState<string | null>(null);

  async function azione(id: string, fn: () => Promise<unknown>) {
    setErrore(null);
    setOccupato(id);
    try {
      await fn();
      await p.onCambio();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : 'Operazione non riuscita');
    } finally {
      setOccupato(null);
    }
  }

  if (aggiungi) {
    return <NuovaPersona onAnnulla={() => setAggiungi(false)} onSalvata={async () => { setAggiungi(false); await p.onCambio(); }} />;
  }

  return (
    <div className="passo">
      <div className="riquadro">
        <p>
          <b>Persone di fiducia</b>: in caso di emergenza o di decesso potranno chiedere l'apertura. Nessuna apertura avviene senza
          una verifica e un periodo d'attesa in cui puoi bloccarla.
        </p>
        <p>
          <b>Destinatari</b>: ricevono solo le voci che assegni loro, e solo dopo l'apertura.
        </p>
      </div>
      {p.stato?.stato === 'senza-fiduciari' && (
        <p className="avviso">Finché nessuna persona di fiducia accetta l'invito, nessuno potrà ricevere le tue voci.</p>
      )}
      {p.stato?.stato === 'pronto' && (
        <p className="esito">
          Tutto pronto: {p.stato.fiduciari === 1 ? '1 persona di fiducia' : `${p.stato.fiduciari} persone di fiducia`},{' '}
          {p.stato.pacchetti === 1 ? '1 pacchetto preparato' : `${p.stato.pacchetti} pacchetti preparati`}.
          {p.stato.senzaAccount > 0 && ' Chi non ha ancora accettato riceverà le sue voci tramite una persona di fiducia.'}
        </p>
      )}
      {errore && <p className="avviso">{errore}</p>}
      {p.persone.length === 0 && <p className="tenue">Non hai ancora indicato nessuno.</p>}
      <ul className="voci">
        {p.persone.map((x) => (
          <li key={x.id} className="persona">
            <span className="etichetta">{NOME_RUOLO[x.ruolo]}</span>
            <span className="titolo">{x.nome}</span>
            {x.email && <span className="tenue">{x.email}</span>}
            <span className="dettagli">
              <span className={`pillola ${x.statoInvito === 'accettato' ? '' : 'chiara'}`}>{STATO[x.statoInvito]}</span>
            </span>
            <span className="azioni">
              {x.email && x.statoInvito !== 'accettato' && (
                <button className="secondario piccolo" disabled={occupato === x.id} onClick={() => azione(x.id, () => api.invita(x.id))}>
                  {x.statoInvito === 'invitato' ? 'Invia di nuovo' : 'Invia invito'}
                </button>
              )}
              <button
                className="link"
                disabled={occupato === x.id}
                onClick={() => {
                  if (window.confirm(`Rimuovere ${x.nome}?`)) void azione(x.id, () => api.rimuoviPersona(x.id));
                }}
              >
                Rimuovi
              </button>
            </span>
          </li>
        ))}
      </ul>
      <button className="primario" onClick={() => setAggiungi(true)}>
        Aggiungi una persona
      </button>
    </div>
  );
}

function NuovaPersona(p: { onAnnulla: () => void; onSalvata: () => Promise<void> }) {
  const [ruolo, setRuolo] = useState<Ruolo>('fiduciario');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [invia, setInvia] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const serveEmail = ruolo !== 'destinatario';

  return (
    <form
      className="passo"
      onSubmit={async (e) => {
        e.preventDefault();
        setSalvo(true);
        setErrore(null);
        try {
          const id = crypto.randomUUID();
          await api.aggiungiPersona({ id, ruolo, nome: nome.trim(), email: email.trim() || undefined });
          if (invia && email.trim()) await api.invita(id);
          await p.onSalvata();
        } catch (err) {
          setErrore(err instanceof Error ? err.message : 'Salvataggio non riuscito');
          setSalvo(false);
        }
      }}
    >
      <h1>Aggiungi una persona</h1>
      <fieldset className="scelte-ruolo">
        <legend>Che ruolo ha?</legend>
        {(['fiduciario', 'destinatario', 'fiduciario-destinatario'] as Ruolo[]).map((r) => (
          <label key={r} className="spunta">
            <input type="radio" name="ruolo" checked={ruolo === r} onChange={() => setRuolo(r)} />
            <span>
              <b>{NOME_RUOLO[r]}</b>
              <br />
              <span className="tenue">
                {r === 'fiduciario' && 'Potrà chiedere l\'apertura in caso di emergenza o decesso.'}
                {r === 'destinatario' && 'Riceverà le voci che gli assegni. Può anche non avere un\'e-mail (per esempio un nipote).'}
                {r === 'fiduciario-destinatario' && 'Entrambe le cose, per esempio un figlio o il coniuge.'}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <label>
        Nome
        <input value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={120} />
      </label>
      <label>
        E-mail{serveEmail ? '' : ' (facoltativa)'}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required={serveEmail} />
      </label>
      {email.trim() && (
        <label className="spunta">
          <input type="checkbox" checked={invia} onChange={(e) => setInvia(e.target.checked)} />
          Invia subito l'invito per e-mail
        </label>
      )}
      {errore && <p className="avviso">{errore}</p>}
      <button className="primario" type="submit" disabled={salvo || !nome.trim()}>
        {salvo ? 'Salvo…' : 'Salva'}
      </button>
      <button className="link" type="button" onClick={p.onAnnulla}>
        Annulla
      </button>
    </form>
  );
}
