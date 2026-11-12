import { useEffect, useState } from 'react';
import { api, type OffertaPiano, type StatoPiano } from './api';

const data = (s: string) => new Date(s).toLocaleDateString('it-CH', { day: 'numeric', month: 'long', year: 'numeric' });
const giorni = (s: string) => Math.max(0, Math.ceil((new Date(s).getTime() - Date.now()) / 86_400_000));

/** Riga breve sotto il titolo della cassaforte. */
export function RigaPiano({ st, onApri }: { st: StatoPiano | null; onApri: () => void }) {
  if (!st) return null;
  const testo =
    st.stato === 'prova'
      ? `Prova gratuita: ancora ${giorni(st.provaFinoAl)} giorni.`
      : st.stato === 'scaduto'
        ? 'La prova è finita: ciò che hai preparato resta valido, ma per aggiungere o modificare serve un piano.'
        : st.stato === 'in-ritardo'
          ? 'Il rinnovo non è andato a buon fine: aggiorna il metodo di pagamento.'
          : st.copertoDa
            ? `Incluso nel piano Famiglia di ${st.copertoDa}.`
            : st.rinnovoAutomatico
              ? `Piano ${st.piano === 'famiglia' ? 'Famiglia' : 'Essenziale'} attivo.`
              : `Piano valido fino al ${data(st.validoFinoAl!)}, senza rinnovo.`;
  return (
    <p className={st.stato === 'scaduto' || st.stato === 'in-ritardo' ? 'avviso' : 'tenue'}>
      {testo}{' '}
      <button className="link" onClick={onApri}>
        {st.stato === 'prova' || st.stato === 'scaduto' ? 'Scegli un piano' : 'Il tuo piano'}
      </button>
    </p>
  );
}

/** Il tuo piano: prezzi, pagamento con TWINT o carta, piano Famiglia. */
export function Piano({ onIndietro }: { onIndietro: () => void }) {
  const [st, setSt] = useState<StatoPiano | null>(null);
  const [offerte, setOfferte] = useState<OffertaPiano[]>([]);
  const [prova, setProva] = useState(false);
  const [email, setEmail] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [esito, setEsito] = useState<string | null>(null);
  const [occupato, setOccupato] = useState(false);

  const carica = async () => {
    const [s, p] = await Promise.all([api.abbonamento(), api.piani()]);
    setSt(s);
    setOfferte(p.piani);
    setProva(p.pagamentoDiProva);
  };
  useEffect(() => {
    carica().catch((e) => setErrore(e.message));
  }, []);

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

  const vaiA = (url: string) => {
    window.location.href = url;
  };

  if (!st) return <section className="passo">{errore ? <p className="avviso">{errore}</p> : <p className="tenue">Un momento…</p>}</section>;
  const attivo = (st.stato === 'attivo' || st.stato === 'in-ritardo') && !st.copertoDa;

  return (
    <section className="passo">
      <button className="link" onClick={onIndietro}>
        ← Torna alla cassaforte
      </button>
      <h1>Il tuo piano</h1>

      <div className="riquadro">
        {st.stato === 'prova' && (
          <p>
            Stai usando la <strong>prova gratuita</strong> fino al {data(st.provaFinoAl)}: tutte le funzioni, senza impegno.
          </p>
        )}
        {st.stato === 'scaduto' && (
          <p>
            La prova è finita. La tua cassaforte resta com'è, le tue persone di fiducia restano pronte e tutto ciò che hai preparato
            arriverà a chi deve. Per <strong>aggiungere o modificare</strong> voci e persone scegli un piano.
          </p>
        )}
        {st.copertoDa && <p>Sei incluso nel piano Famiglia di {st.copertoDa}{st.validoFinoAl && `, valido fino al ${data(st.validoFinoAl)}`}.</p>}
        {attivo && st.piano && (
          <p>
            Piano <strong>{offerte.find((o) => o.id === st.piano)?.nome}</strong>
            {st.validoFinoAl && <>, pagato fino al {data(st.validoFinoAl)}</>}.{' '}
            {st.rinnovoAutomatico ? 'Si rinnova da solo ogni anno; ti avvisiamo prima.' : 'Non si rinnova da solo.'}
          </p>
        )}
        {st.stato === 'in-ritardo' && <p className="avviso">Il rinnovo non è andato a buon fine. Aggiorna il metodo di pagamento qui sotto.</p>}
        {st.haPortale && (
          <button className="secondario" disabled={occupato} onClick={() => esegui(async () => vaiA((await api.gestisciPagamento()).url))}>
            Gestisci pagamento, ricevute e disdetta
          </button>
        )}
      </div>

      {!attivo &&
        offerte.map((o) => (
          <div key={o.id} className="riquadro">
            <h2>
              {o.nome} – CHF {o.chfAnno} all'anno
            </h2>
            <p>{o.descrizione}.</p>
            <button className="primario" disabled={occupato} onClick={() => esegui(async () => vaiA((await api.paga(o.id)).url))}>
              Paga con TWINT o carta
            </button>
          </div>
        ))}

      {attivo && st.piano === 'famiglia' && (
        <div className="riquadro">
          <h2>Il secondo adulto</h2>
          <p className="tenue">Avrà la sua cassaforte, separata dalla tua: nessuno dei due vede quella dell'altro.</p>
          {st.famiglia ? (
            <p>
              Incluso: <strong>{st.famiglia}</strong>{' '}
              <button className="link" onClick={() => esegui(async () => { await api.famiglia(null); await carica(); setEsito('Rimosso dal piano.'); })}>
                Rimuovi
              </button>
            </p>
          ) : (
            <form
              className="modulo"
              onSubmit={(e) => {
                e.preventDefault();
                void esegui(async () => {
                  await api.famiglia(email);
                  await carica();
                  setEsito('Fatto: gli abbiamo scritto per invitarlo.');
                });
              }}
            >
              <label>
                E-mail dell'altra persona
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <button className="primario" disabled={occupato}>
                Includi nel piano
              </button>
            </form>
          )}
        </div>
      )}

      <p className="tenue">
        Il pagamento avviene sulla pagina sicura del servizio di pagamento: MEMORIAE non vede né conserva i dati della tua carta o del tuo conto.
        {prova && ' In questa versione di prova il pagamento è simulato: non si muove denaro.'}
      </p>
      {esito && <p className="esito">{esito}</p>}
      {errore && <p className="avviso">{errore}</p>}
    </section>
  );
}

/** Solo prove: imita la pagina TWINT del servizio di pagamento. */
export function PagamentoProva({ id }: { id: string }) {
  const [info, setInfo] = useState<{ nome: string; chf: number; pagato: boolean } | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  useEffect(() => {
    api.pagamentoProva(id).then(setInfo).catch((e) => setErrore(e.message));
  }, [id]);
  if (errore) return <p className="avviso">{errore}</p>;
  if (!info) return <p className="tenue">Un momento…</p>;
  return (
    <section className="passo">
      <p className="avviso">Pagina di prova: qui ci sarebbe la pagina sicura di TWINT o della carta. Non si muove denaro.</p>
      <h1>
        MEMORIAE {info.nome}: CHF {info.chf}.–
      </h1>
      <p>Abbonamento annuale.</p>
      <button
        className="primario"
        disabled={info.pagato}
        onClick={() =>
          api
            .pagaProva(id)
            .then(() => {
              window.location.href = '/?pagato=1';
            })
            .catch((e) => setErrore(e.message))
        }
      >
        Paga con TWINT (prova)
      </button>
      <button
        className="link"
        onClick={() => {
          window.location.href = '/?pagato=0';
        }}
      >
        Annulla
      </button>
    </section>
  );
}
