import { useEffect, useState } from 'react';
import type { Fornitore } from './api';

const data = (s: string) => new Date(s).toLocaleDateString('it-CH', { day: 'numeric', month: 'long', year: 'numeric' });

/** Indicazioni del catalogo per un fornitore, con fonte e stato della verifica. */
export function SchedaFornitore({
  f,
  perEredi = false,
  impostato,
  onImpostato,
}: {
  f: Fornitore;
  perEredi?: boolean;
  impostato?: boolean;
  onImpostato?: (fatto: boolean) => Promise<void>;
}) {
  // Risposta immediata alla spunta; il salvataggio cifrato avviene subito dopo.
  const [fatto, setFatto] = useState(!!impostato);
  useEffect(() => setFatto(!!impostato), [impostato]);
  return (
    <div className="riquadro">
      <h2>{f.nome}</h2>
      {!perEredi && f.daVivi.length > 0 && (
        <>
          <h3>Da fare adesso</h3>
          <ol>{f.daVivi.map((x) => <li key={x}>{x}</li>)}</ol>
          {onImpostato && (
            <label className="spunta">
              <input
                type="checkbox"
                checked={fatto}
                onChange={(e) => {
                  const v = e.target.checked;
                  setFatto(v);
                  onImpostato(v).catch(() => setFatto(!v));
                }}
              />
              Fatto: ho impostato questa funzione
            </label>
          )}
        </>
      )}
      {f.perGliEredi.length > 0 && (
        <>
          <h3>{perEredi ? 'Cosa fare' : 'Cosa dovranno fare gli eredi'}</h3>
          <ol>{f.perGliEredi.map((x) => <li key={x}>{x}</li>)}</ol>
        </>
      )}
      {f.nota && <p className="note">{f.nota}</p>}
      <p className="tenue">
        {f.verifica === 'da-verificare' ? (
          <>Indicazioni generali, non ancora confermate dal fornitore.</>
        ) : (
          <>
            {f.verifica === 'verificato' ? 'Verificato' : 'Verificato in parte'} sulla{' '}
            <a href={f.fonte!} target="_blank" rel="noreferrer noopener">
              pagina ufficiale
            </a>{' '}
            il {data(f.verificatoIl!)}. Le procedure cambiano: ricontrolla prima di agire.
          </>
        )}
      </p>
    </div>
  );
}
