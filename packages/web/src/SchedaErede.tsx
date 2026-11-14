import { useState } from 'react';
import { documentoChiave, type FunzioneErede } from './contattoErede';
import type { FileVoce, Voce } from './vault';

/** Chi è il contatto erede presso il fornitore e dove sta la chiave: così regge anche se quella persona non c'è più. */
export function SchedaErede(p: {
  voce: Voce;
  fz: FunzioneErede;
  servizio: string;
  onSalvaContatti: (contatti: string[]) => Promise<void>;
  onAllegaChiave: (file: File) => Promise<void>;
  onSostituisciChiave: (vecchia: FileVoce, file: File) => Promise<void>;
  onTogliChiave: (vecchia: FileVoce) => Promise<void>;
  onApri: (f: FileVoce) => Promise<void>;
}) {
  const [conferma, setConferma] = useState(false);
  const contatti = p.voce.contenuto.erede?.contatti ?? [];
  const chiave = documentoChiave(p.voce);
  const [nuovo, setNuovo] = useState('');
  const [lavoro, setLavoro] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [appenaAllegata, setAppenaAllegata] = useState(false);
  const pieno = p.fz.consigliate === 1 && contatti.length >= 1;

  async function esegui(f: () => Promise<void>) {
    setErrore(null);
    setLavoro(true);
    try {
      await f();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : 'Salvataggio non riuscito');
    } finally {
      setLavoro(false);
    }
  }

  return (
    <div className="riquadro" aria-label={`${p.fz.nome} di ${p.servizio}`}>
      <h3>
        {p.fz.nome} di {p.servizio}
      </h3>
      <p className="tenue">{p.fz.perche}</p>

      <p>
        <b>{p.fz.persone}</b>
      </p>
      {contatti.length === 0 ? (
        <p className="tenue">Non hai ancora scritto chi è.</p>
      ) : (
        <ul>
          {contatti.map((c) => (
            <li key={c}>
              {c}{' '}
              <button className="link" disabled={lavoro} onClick={() => esegui(() => p.onSalvaContatti(contatti.filter((x) => x !== c)))}>
                Togli
              </button>
            </li>
          ))}
        </ul>
      )}
      {!pieno && (
        <form
          className="riga-campi"
          onSubmit={(e) => {
            e.preventDefault();
            const n = nuovo.trim();
            if (!n || contatti.includes(n)) return;
            void esegui(async () => {
              await p.onSalvaContatti([...contatti, n]);
              setNuovo('');
            });
          }}
        >
          <label>
            Nome e cognome
            <input value={nuovo} onChange={(e) => setNuovo(e.target.value)} maxLength={120} placeholder="Per esempio Anna Rossi" />
          </label>
          <button className="secondario" type="submit" disabled={lavoro || !nuovo.trim()}>
            {contatti.length === 0 ? 'Aggiungi' : 'Aggiungi un altro'}
          </button>
        </form>
      )}

      {p.fz.chiave && (
        <>
          <p>
            <b>La {p.fz.chiave.nome}</b>
          </p>
          {chiave ? (
            <>
              <p>
                Allegata: «{chiave.nome}».{' '}
                <button className="link" onClick={() => esegui(() => p.onApri(chiave))}>
                  Apri
                </button>
              </p>
              <div className="azioni-voci">
                <label className="secondario pulsante-file">
                  {lavoro ? 'Cifro e salvo…' : 'Sostituisci con un altro file'}
                  <input
                    type="file"
                    accept=".pdf,application/pdf,image/*"
                    disabled={lavoro}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file)
                        void esegui(async () => {
                          await p.onSostituisciChiave(chiave, file);
                          setAppenaAllegata(true);
                        });
                    }}
                  />
                </label>
                {conferma ? (
                  <span className="conferma">
                    Togliere la chiave?{' '}
                    <button className="link" disabled={lavoro} onClick={() => esegui(async () => { await p.onTogliChiave(chiave); setConferma(false); setAppenaAllegata(false); })}>
                      Sì, togli
                    </button>{' '}
                    <button className="link" onClick={() => setConferma(false)}>
                      No
                    </button>
                  </span>
                ) : (
                  <button className="link" onClick={() => setConferma(true)}>
                    Togli
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="tenue">{p.fz.chiave.comeSalvarla}</p>
              <label className="zona-file">
                <span>{lavoro ? 'Cifro e salvo…' : `Allega la ${p.fz.chiave.nome} (PDF o foto)`}</span>
                <input
                  type="file"
                  accept=".pdf,application/pdf,image/*"
                  disabled={lavoro}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file)
                      void esegui(async () => {
                        await p.onAllegaChiave(file);
                        setAppenaAllegata(true);
                      });
                  }}
                />
              </label>
            </>
          )}
          {appenaAllegata && <p className="avviso">Fatto. Ora cancella il file dal computer e svuota il Cestino: la copia sicura è qui.</p>}
        </>
      )}

      {contatti.length > 0 && (
        <p className="tenue">
          Consiglio: in «Le tue volontà» assegna questa voce anche a una persona diversa da {contatti.join(' e ')}. Se {contatti.length === 1 ? 'lui o lei non c\'è più' : 'non ci sono più'}, le
          indicazioni {p.fz.chiave ? 'e la chiave ' : ''}arrivano comunque a qualcuno.
        </p>
      )}
      {errore && <p className="avviso">{errore}</p>}
    </div>
  );
}
