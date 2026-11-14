import type { Fornitore, Persona } from './api';
import type { VoceAperta } from './apertura';
import { ElencoVoci } from './Fiducia';
import { NOME_RUOLO } from './Persone';
import { documentiDi, type Voce } from './vault';

const fiduciario = (p: Persona) => p.ruolo !== 'destinatario';

/** Quello che una persona riceverà: voci assegnate (e lettere), più quelle d'emergenza se è di fiducia. */
export function cosaRiceve(p: Persona, voci: Voce[]) {
  const perLei = voci.filter((v) =>
    v.tipo === 'lettera' ? (v.remota.lettera?.destinatari ?? []).includes(p.id) : (v.contenuto.destinatari ?? []).includes(p.id),
  );
  const emergenza = fiduciario(p) ? voci.filter((v) => v.emergenza && v.tipo !== 'lettera') : [];
  return { perLei, emergenza };
}

/** La voce come la vedrà chi la riceve (le lettere con una data futura restano chiuse). */
function comeAperta(v: Voce): VoceAperta {
  const consegna = v.remota.lettera?.consegnaIl;
  return {
    id: v.id,
    tipo: v.tipo,
    contenuto: v.contenuto,
    documenti: documentiDi(v.id, v.contenuto),
    itemKey: new Uint8Array(0),
    ...(v.tipo === 'lettera' && consegna && new Date(consegna) > new Date() ? { inArrivo: consegna } : {}),
  };
}

/** «Guarda con gli occhi di…»: la prova generale di ciò che ciascuno riceverà. */
export function Anteprima(p: {
  persone: Persona[];
  voci: Voce[];
  fornitori: Fornitore[];
  proprietario: string;
  personaId: string | null;
  onScegli: (id: string) => void;
  onIndietro: () => void;
  onApriVoce: (id: string) => void;
}) {
  const persona = p.persone.find((x) => x.id === p.personaId);

  if (!persona) {
    return (
      <section className="passo">
        <button className="link indietro" onClick={p.onIndietro}>
          ‹ Torna all'elenco
        </button>
        <p className="etichetta">Prova generale</p>
        <h1>Guarda con gli occhi di…</h1>
        <p>Scegli una persona: vedrai esattamente cosa riceverà, nell'ordine in cui lo vedrà. Nessuno riceve nulla adesso.</p>
        {p.persone.length === 0 && <p className="tenue">Non hai ancora indicato nessuno nella scheda Persone.</p>}
        <div className="scelte">
          {p.persone.map((x) => {
            const { perLei, emergenza } = cosaRiceve(x, p.voci);
            return (
              <button key={x.id} className="scelta" onClick={() => p.onScegli(x.id)}>
                <span className="titolo">{x.nome}</span>
                <span className="tenue">
                  {x.soloLettere ? 'Riceve solo lettere' : NOME_RUOLO[x.ruolo]} · {perLei.length === 1 ? '1 voce' : `${perLei.length} voci`}
                  {emergenza.length > 0 && ` · ${emergenza.length} in emergenza`}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  const { perLei, emergenza } = cosaRiceve(persona, p.voci);
  const nome = persona.nome.split(' ')[0];
  const altre = p.voci.length - new Set([...perLei, ...emergenza].map((v) => v.id)).size;
  const accettato = persona.statoInvito === 'accettato';

  return (
    <section className="passo larga">
      <button className="link indietro" onClick={() => p.onScegli('')}>
        ‹ Scegli un'altra persona
      </button>
      <div className="riquadro evidenza anteprima-banner">
        <p className="etichetta">Prova generale</p>
        <h1>Con gli occhi di {nome}</h1>
        <p>
          Così {nome} vedrà la tua cassaforte dopo l'apertura. Adesso non riceve nulla: è solo un'anteprima.
        </p>
      </div>

      <h2>Come ci arriverà</h2>
      <ol>
        {fiduciario(persona) && <li>Se ti succede qualcosa, {nome} può chiedere l'apertura. Un operatore MEMORIAE verifica la richiesta e tu puoi sempre bloccarla.</li>}
        <li>Dopo la verifica e il periodo d'attesa, {nome} riceve un'e-mail.</li>
        <li>
          {accettato
            ? `Entra in MEMORIAE con il suo accesso e trova le tue voci nella scheda «Per gli altri».`
            : `${nome} non ha ancora un account MEMORIAE: le sue voci gliele consegnerà una persona di fiducia.`}
        </li>
      </ol>
      {!accettato && !persona.soloLettere && persona.email && (
        <p className="avviso">
          Consiglio: manda l'invito a {nome} dalla scheda Persone. Con un account riceverà tutto direttamente.
        </p>
      )}

      <h2>Cosa vedrà dopo la tua scomparsa</h2>
      {fiduciario(persona) && (
        <p className="tenue">
          In più, come persona di fiducia, troverà la guida «I primi 30 giorni»: le pratiche in Svizzera con le scadenze e le lettere già pronte.
        </p>
      )}
      <div className="anteprima">
        <ElencoVoci voci={perLei.map(comeAperta)} scarica={async () => new Uint8Array(0)} vuoto={`Non hai ancora assegnato nessuna voce a ${nome}.`} proprietario={p.proprietario} mittente={persona.nome} anteprima />
      </div>

      {emergenza.length > 0 && (
        <>
          <h2>In caso di emergenza</h2>
          <p className="tenue">
            Se sei in ospedale o non puoi occuparti delle tue cose, {nome} vedrà per 30 giorni solo queste voci, dopo la verifica e 72 ore d'attesa.
          </p>
          <div className="anteprima">
            <ElencoVoci voci={emergenza.map(comeAperta)} scarica={async () => new Uint8Array(0)} anteprima />
          </div>
        </>
      )}

      <div className="riquadro">
        <p>
          <b>Cosa non vedrà:</b>{' '}
          {altre === 0 ? `${nome} vedrà tutte le tue voci.` : `le altre ${altre === 1 ? 'voce' : `${altre} voci`} della cassaforte restano chiuse per ${nome}.`}
        </p>
        <p className="tenue">
          Qualcosa non va? Apri la voce e cambia «Chi la riceve»: quello che vedi qui è quello che succederà.
        </p>
        {perLei.length > 0 && (
          <div className="azioni-voci">
            {perLei.slice(0, 6).map((v) => (
              <button key={v.id} className="link" onClick={() => p.onApriVoce(v.id)}>
                Apri «{v.contenuto.titolo}»
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
