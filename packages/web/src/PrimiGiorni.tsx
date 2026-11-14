import { useState } from 'react';
import type { Fatto } from './api';
import { FONTE_PRIMI_GIORNI, PASSI_PRIMI_GIORNI, scadenza } from './passiDopoDecesso';
import { ALLEGATI_DI_BASE, apriPerStampa, htmlLettera } from './stampa';

const giorno = (d: Date) => d.toLocaleDateString('it-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const breve = (s: string) => new Date(s).toLocaleDateString('it-CH', { day: 'numeric', month: 'long' });

/** «I primi 30 giorni»: le pratiche in Svizzera dopo un decesso, con scadenze, spunte condivise e lettere pronte. */
export function PrimiGiorni(p: {
  defunto: string;
  mittente: string;
  /** Giorno proposto per il decesso (AAAA-MM-GG), modificabile. */
  dataProposta: string;
  /** Dove ricordare il giorno scelto su questo dispositivo. */
  chiaveMemoria: string;
  fatti: Map<string, Fatto>;
  onFatto: (chiave: string, fatto: boolean) => Promise<void>;
  onVaiVoci?: () => void;
}) {
  const [data, setData] = useState(() => {
    try {
      return localStorage.getItem(p.chiaveMemoria) ?? p.dataProposta;
    } catch {
      return p.dataProposta;
    }
  });
  const [aperto, setAperto] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const oggi = new Date();
  const fatti = PASSI_PRIMI_GIORNI.filter((x) => p.fatti.has(`passo:${x.id}`)).length;

  return (
    <section className="riquadro primi-giorni" aria-label="I primi 30 giorni">
      <div className="prontezza-riga">
        <h2>I primi 30 giorni</h2>
        <button className="link" aria-expanded={aperto} onClick={() => setAperto(!aperto)}>
          {aperto ? 'Riduci' : 'Mostra'}
        </button>
      </div>
      <p>
        Cosa fare in Svizzera, passo per passo. Fatti <strong>{fatti}</strong> di {PASSI_PRIMI_GIORNI.length}: le spunte le vedono tutte le persone che
        si occupano delle pratiche per {p.defunto.split(' ')[0]}.
      </p>
      {aperto && (
        <>
          <label className="data-decesso">
            Giorno del decesso
            <input
              type="date"
              value={data}
              max={oggi.toISOString().slice(0, 10)}
              onChange={(e) => {
                setData(e.target.value);
                try {
                  localStorage.setItem(p.chiaveMemoria, e.target.value);
                } catch {
                  // solo una comodità: senza memoria resta il giorno proposto
                }
              }}
            />
          </label>
          <ol className="passi-primi-giorni">
            {PASSI_PRIMI_GIORNI.map((x) => {
              const f = p.fatti.get(`passo:${x.id}`);
              const entro = x.entroGiorni && data ? scadenza(data, x.entroGiorni) : null;
              const scaduto = !f && entro && entro < oggi;
              return (
                <li key={x.id} className={f ? 'fatto' : ''}>
                  <p className={`quando ${scaduto ? 'scaduto' : ''}`}>
                    {x.quando}
                    {entro && ` · entro ${giorno(entro)}`}
                    {scaduto && ' · termine superato: chiedete consiglio'}
                  </p>
                  <h3>{x.titolo}</h3>
                  <p>{x.testo}</p>
                  <div className="azioni-voci">
                    <label className="spunta">
                      <input
                        type="checkbox"
                        checked={!!f}
                        onChange={(e) => {
                          setErrore(null);
                          p.onFatto(`passo:${x.id}`, e.target.checked).catch((err: Error) => setErrore(err.message));
                        }}
                      />
                      {f ? `Fatto (${f.da}, ${breve(f.il)})` : 'Fatto'}
                    </label>
                    {x.lettera && (
                      <button
                        className="secondario"
                        onClick={() =>
                          apriPerStampa(
                            `Lettera – ${x.titolo}`,
                            htmlLettera({
                              destinatario: x.lettera!.destinatario,
                              oggetto: x.lettera!.oggetto,
                              defunto: p.defunto,
                              mittente: p.mittente,
                              richiesta: x.lettera!.richiesta,
                              allegati: x.lettera!.allegati ?? ALLEGATI_DI_BASE,
                            }),
                          )
                        }
                      >
                        Prepara la lettera
                      </button>
                    )}
                    {x.voci && p.onVaiVoci && (
                      <button className="link" onClick={p.onVaiVoci}>
                        Vai all'elenco
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {errore && <p className="avviso">{errore}</p>}
          <p className="tenue">
            Fonte: Confederazione,{' '}
            {FONTE_PRIMI_GIORNI.pagine.map((f, i) => (
              <span key={f.url}>
                {i > 0 && ' e '}
                <a href={f.url} target="_blank" rel="noreferrer noopener">
                  {f.titolo.replace('ch.ch – ', '')}
                </a>
              </span>
            ))}
            . Le procedure possono variare da Cantone a Cantone. Per l'eredità, in caso di dubbio, chiedete a un notaio.
          </p>
        </>
      )}
    </section>
  );
}
