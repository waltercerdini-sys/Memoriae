import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * Aiuto contestuale: in ogni pagina un pulsante «? Aiuto» in alto, con tre parti brevi:
 * a cosa serve la pagina, cosa fare adesso (in base alla situazione) e il capitolo della guida.
 * Alla prima visita di una pagina si apre da solo, una volta.
 */

export type PaginaAiuto =
  | 'benvenuto'
  | 'registrazione'
  | 'password-nuova'
  | 'codice'
  | 'accesso'
  | 'password-apri'
  | 'recupero'
  | 'voci'
  | 'voce-nuova'
  | 'voce'
  | 'trova'
  | 'ricordi'
  | 'lettera'
  | 'libro'
  | 'persone'
  | 'anteprima'
  | 'protezione'
  | 'carta'
  | 'fascicolo'
  | 'altri'
  | 'cassaforte-ricevuta'
  | 'operatore'
  | 'piano'
  | 'pagamento-carta'
  | 'carta-toccata';

/** Quello che serve per dare il passo giusto: tutto facoltativo. */
export interface ContestoAiuto {
  voci?: number;
  daCompletare?: number;
  persone?: number;
  /** Persone di fiducia che hanno accettato l'invito. */
  fiduciari?: number;
  /** Persone con un'e-mail che non hanno ancora accettato. */
  daInvitare?: number;
  lettere?: number;
  ricordi?: number;
  controlloAttivo?: boolean;
  decesso?: boolean;
}

interface TestoAiuto {
  titolo: string;
  quiPuoi: string;
  passi: (c: ContestoAiuto) => string[];
  capitolo?: string;
}

const n = (x: number | undefined) => x ?? 0;

export const AIUTO: Record<PaginaAiuto, TestoAiuto> = {
  benvenuto: {
    titolo: 'Benvenuto in MEMORIAE',
    quiPuoi: "Creare la tua cassaforte digitale o entrare in quella che hai già. Tutto quello che scrivi viene cifrato sul tuo dispositivo: nemmeno noi possiamo leggerlo.",
    passi: () => ['È la prima volta? Tocca «Crea la tua cassaforte».', 'Hai già una cassaforte? Tocca «Ho già una cassaforte».'],
    capitolo: 'Prima di cominciare',
  },
  registrazione: {
    titolo: 'Creare la cassaforte',
    quiPuoi: 'Dare il tuo nome e il tuo indirizzo e-mail. Le e-mail di MEMORIAE (avvisi, inviti, controlli) arriveranno lì.',
    passi: () => [
      'Scrivi nome e cognome e il tuo indirizzo e-mail.',
      'Tocca «Continua»: il telefono o il computer ti chiederà Face ID, l\'impronta o il PIN.',
      'Non serve inventare una password nuova.',
    ],
    capitolo: 'Creare la cassaforte',
  },
  'password-nuova': {
    titolo: 'La password della cassaforte',
    quiPuoi: 'Questo dispositivo non può usare la passkey da solo: serve una password per proteggere la cassaforte.',
    passi: () => ['Scegli una frase lunga che ricordi bene, per esempio quattro parole.', 'Scrivila due volte e tocca il pulsante per continuare.'],
    capitolo: 'Creare la cassaforte',
  },
  codice: {
    titolo: 'Il codice di recupero',
    quiPuoi: 'Ricevere il codice che ti fa rientrare se perdi il telefono o cambi computer. Senza questo codice nessuno può aprire la tua cassaforte al posto tuo, nemmeno noi.',
    passi: () => [
      'Stampa il codice o scrivilo a mano su un foglio.',
      'Conservalo con i documenti importanti, per esempio con il testamento.',
      'Spunta «Ho stampato o scritto il codice» e tocca «Vai alla cassaforte».',
    ],
    capitolo: 'Creare la cassaforte',
  },
  accesso: {
    titolo: 'Entrare nella cassaforte',
    quiPuoi: 'Aprire la tua cassaforte con lo stesso gesto con cui sblocchi il telefono o il computer.',
    passi: () => [
      'Tocca «Accedi con la passkey».',
      'Conferma con Face ID, l\'impronta o il PIN.',
      'Hai cambiato telefono o computer? Tocca «Ho perso la passkey o ho cambiato dispositivo».',
    ],
    capitolo: 'Entrare di nuovo',
  },
  'password-apri': {
    titolo: 'Entrare con la password',
    quiPuoi: 'Aprire la cassaforte con la password che hai scelto quando l\'hai creata.',
    passi: () => ['Scrivi la password e tocca il pulsante.', 'Non la ricordi? Torna indietro e usa il codice di recupero.'],
    capitolo: 'Entrare di nuovo',
  },
  recupero: {
    titolo: 'Rientrare con il codice di recupero',
    quiPuoi: 'Rientrare nella tua cassaforte da un telefono o un computer nuovo, con il codice di recupero che hai stampato.',
    passi: () => [
      'Scrivi il tuo indirizzo e-mail e tocca «Mandami il codice».',
      'Scrivi il codice che ricevi per e-mail, poi il codice di recupero.',
      'Alla fine crea la nuova passkey su questo dispositivo.',
    ],
    capitolo: 'Se perdi il telefono o cambi computer',
  },
  voci: {
    titolo: 'Le tue voci',
    quiPuoi: 'Vedere l\'elenco delle tue cose digitali (account, documenti, istruzioni) e decidere per ognuna cosa farne e a chi va.',
    passi: (c) => {
      if (n(c.voci) === 0)
        return [
          'Tocca «Trova tutto»: in pochi minuti prepara l\'elenco di banche, posta e abbonamenti dal tuo computer.',
          'Oppure aggiungi le voci una alla volta con «Aggiungi una voce», in fondo alla pagina.',
        ];
      const p: string[] = [];
      if (n(c.daCompletare) > 0)
        p.push(`Hai ${c.daCompletare === 1 ? '1 voce' : `${c.daCompletare} voci`} da completare: tocca «Da completare» e aprile una alla volta.`);
      if (n(c.fiduciari) === 0) p.push('Indica almeno una persona di fiducia nella scheda «Persone».');
      if (p.length === 0) p.push('È tutto in ordine. Quando apri un nuovo account, aggiungilo con «Aggiungi una voce».');
      p.push('Le voci con il segno ✓ sono complete.');
      return p;
    },
    capitolo: 'Fare l\'elenco',
  },
  'voce-nuova': {
    titolo: 'Aggiungere una voce',
    quiPuoi: 'Registrare un account, un documento, un\'istruzione o un dispositivo. Non servono le password: basta dire che cosa è e dove si trova.',
    passi: () => [
      'Scegli il tipo di voce.',
      'Scrivi il nome (per esempio «Posta Gmail») e, se vuoi, una nota.',
      'Tocca «Salva nella cassaforte». Le volontà le aggiungi subito dopo.',
    ],
    capitolo: 'Fare l\'elenco',
  },
  voce: {
    titolo: 'Una voce',
    quiPuoi: 'Decidere cosa fare di questa voce dopo la tua scomparsa e chi la riceve. Le modifiche si salvano da sole.',
    passi: () => [
      'Scegli che cosa fare: chiudere e cancellare, conservare come ricordo o consegnare.',
      'In «Chi la riceve» spunta una o più persone.',
      'Se il servizio ha una funzione per gli eredi (Apple, Google, Facebook…), seguine le istruzioni qui sotto.',
    ],
    capitolo: 'Le volontà: a chi va che cosa',
  },
  trova: {
    titolo: 'Trova tutto',
    quiPuoi: 'Preparare in pochi minuti l\'elenco dei tuoi account, partendo dal file delle password salvate nel browser. Le password non vengono mai lette né salvate.',
    passi: () => [
      'Segui le istruzioni per il tuo browser (Safari, Chrome o Firefox) e salva il file.',
      'Carica il file qui: MEMORIAE tiene solo il nome dei siti.',
      'Scegli quali account aggiungere, poi cancella il file dal computer.',
    ],
    capitolo: 'Fare l\'elenco',
  },
  ricordi: {
    titolo: 'Ricordi',
    quiPuoi: 'Lasciare parole e ricordi alle persone che ami: lettere che si aprono in un giorno scelto e il libro dei ricordi, con la tua voce.',
    passi: (c) => [
      n(c.lettere) === 0 ? 'Tocca «✉ Scrivi una lettera» per la prima lettera.' : 'Tocca una lettera per rileggerla o cambiarla.',
      n(c.ricordi) === 0 ? 'Apri «📖 Il libro dei ricordi» e rispondi alla prima domanda a voce.' : 'Nel libro dei ricordi c\'è una nuova domanda per te.',
    ],
    capitolo: 'Le lettere nel tempo',
  },
  lettera: {
    titolo: 'Scrivere una lettera',
    quiPuoi: 'Scrivere una lettera che resta chiusa e cifrata fino al giorno che scegli, o fino all\'apertura della cassaforte.',
    passi: () => [
      'Scrivi un titolo e il testo. Puoi allegare una foto o un documento.',
      'In «Per chi» spunta una o più persone, oppure aggiungi un indirizzo e-mail.',
      'Scegli quando si apre e tocca «Chiudi la lettera nella cassaforte».',
    ],
    capitolo: 'Le lettere nel tempo',
  },
  libro: {
    titolo: 'Il libro dei ricordi',
    quiPuoi: 'Rispondere a voce a una domanda sulla tua vita. Le risposte formano un libro per i tuoi cari.',
    passi: (c) => [
      'Leggi la domanda e tocca «● Rispondi a voce». Bastano due minuti.',
      'Quando hai finito tocca «■ Ho finito», poi «Salva nel libro».',
      n(c.persone) === 0 ? 'Indica nella scheda «Persone» chi riceverà il libro.' : 'Non ti piace la domanda? Tocca «Un\'altra domanda».',
    ],
    capitolo: 'Il libro dei ricordi',
  },
  persone: {
    titolo: 'Le persone',
    quiPuoi: 'Scegliere chi si occuperà delle tue cose digitali (persone di fiducia) e chi riceverà le tue voci (destinatari).',
    passi: (c) => {
      if (n(c.persone) === 0) return ['Tocca «Aggiungi una persona».', 'Scegli se è una persona di fiducia o riceve soltanto.', 'Mandale l\'invito.'];
      const p: string[] = [];
      if (n(c.fiduciari) === 0) p.push('Serve almeno una persona di fiducia che abbia accettato l\'invito.');
      if (n(c.daInvitare) > 0) p.push(`${c.daInvitare === 1 ? '1 persona non ha' : `${c.daInvitare} persone non hanno`} ancora accettato: manda di nuovo l\'invito.`);
      p.push('Tocca «👁 Guarda con gli occhi di…» per vedere cosa riceverà ciascuno.');
      return p;
    },
    capitolo: 'Le persone di fiducia e i destinatari',
  },
  anteprima: {
    titolo: 'Guarda con gli occhi di…',
    quiPuoi: 'Vedere esattamente cosa riceverà una persona dopo l\'apertura della cassaforte. Adesso nessuno riceve nulla.',
    passi: () => ['Scegli una persona.', 'Controlla le voci che riceverà.', 'Qualcosa non va? Apri la voce e cambia «Chi la riceve».'],
    capitolo: 'Fare l\'elenco',
  },
  protezione: {
    titolo: 'Protezione',
    quiPuoi: 'Scegliere ogni quanto MEMORIAE ti chiede «Ci sei?», ordinare la Carta MEMORIAE e preparare il fascicolo per il notaio.',
    passi: (c) => [
      c.controlloAttivo === false ? 'Il controllo è in pausa: tocca «Riattiva il controllo».' : 'Quando ricevi l\'e-mail del controllo, tocca «Sono qui, va tutto bene».',
      'Tieni la Carta MEMORIAE nel portafoglio: chi la trova può avvisare le tue persone di fiducia.',
      'Stampa il fascicolo e consegnalo al notaio con il testamento.',
    ],
    capitolo: 'Il controllo «sono qui»',
  },
  carta: {
    titolo: 'La Carta MEMORIAE',
    quiPuoi: 'Ordinare la tessera da tenere nel portafoglio. Chi la trova la avvicina al telefono e può avvisare le tue persone di fiducia. La carta non apre la cassaforte.',
    passi: () => [
      'Scegli quante carte e tocca «Ordina e paga». Puoi spedirla anche presso una casa per anziani o un parente.',
      'Quando arriva, avvicinala al tuo telefono per attivarla.',
      'Se la perdi, tocca «L\'ho persa: disattiva»: smette subito di funzionare.',
    ],
    capitolo: 'La Carta MEMORIAE',
  },
  fascicolo: {
    titolo: 'Fascicolo per il notaio',
    quiPuoi: 'Stampare un documento ordinato con i tuoi account, le persone e le volontà, senza password, da conservare con il testamento.',
    passi: () => ['Tocca «Prepara il fascicolo (PDF)».', 'Nella pagina che si apre scegli «Salva come PDF» o stampa.', 'Portalo al notaio insieme al testamento.'],
    capitolo: 'Fare l\'elenco',
  },
  altri: {
    titolo: 'Per gli altri',
    quiPuoi: 'Vedere le cassaforti delle persone che ti hanno scelto e, quando serve, chiedere che vengano aperte.',
    passi: () => [
      'Se una persona è in ospedale o è mancata, tocca la sua cassaforte e chiedi l\'apertura.',
      'Allega il documento richiesto: un operatore MEMORIAE lo verifica.',
      'Dopo l\'attesa ricevi un\'e-mail e trovi qui le voci per te.',
    ],
    capitolo: 'Per chi è persona di fiducia o destinatario',
  },
  'cassaforte-ricevuta': {
    titolo: 'Le voci che hai ricevuto',
    quiPuoi: 'Vedere le voci che ti sono state affidate e cosa fare per ognuna.',
    passi: (c) =>
      c.decesso
        ? [
            'Segui «I primi 30 giorni»: le pratiche in Svizzera, con le scadenze e le lettere già pronte.',
            'Per ogni voce leggi le volontà e tocca «Fatto» quando hai finito.',
            'Se ci sono voci da consegnare ad altri, consegnale tu.',
          ]
        : ['Leggi le voci d\'emergenza: valgono per 30 giorni.', 'Tocca «Fatto» quando hai finito una voce.'],
    capitolo: 'Per chi è persona di fiducia o destinatario',
  },
  operatore: {
    titolo: 'Operatore',
    quiPuoi: 'Verificare le richieste di apertura con i documenti, controllare il catalogo dei servizi e spedire le carte.',
    passi: () => [
      'Controlla i documenti di ogni richiesta e approvala o rifiutala.',
      'Rivedi le istruzioni dei servizi segnalate come cambiate.',
      'Carte: scrivi il codice stampato sotto il QR, «Abbina all\'ordine», poi «Spedito».',
      'Nuove carte dal fornitore: crea un lotto, manda i dati e alla consegna importa il suo file.',
    ],
    capitolo: 'Chi controlla le aperture',
  },
  piano: {
    titolo: 'Il tuo piano',
    quiPuoi: 'Vedere a che punto è la prova gratuita o il tuo piano, e sceglierne uno.',
    passi: () => [
      'Il riquadro colorato in alto dice se è tutto a posto.',
      'Per continuare a provare tocca «Continua la prova gratuita».',
      'Quando vuoi, scegli un piano e paga con TWINT o con la carta.',
    ],
    capitolo: 'Il piano e il pagamento',
  },
  'pagamento-carta': {
    titolo: 'Pagare la Carta MEMORIAE',
    quiPuoi: 'Scrivere dove spedire la carta e pagarla.',
    passi: () => [
      'Scrivi nome, via e numero, NPA e località.',
      'Se la carta va in una casa per anziani o da un parente, scrivilo in «Presso (c/o)».',
      'Tocca il pulsante per pagare.',
    ],
    capitolo: 'La Carta MEMORIAE',
  },
  'carta-toccata': {
    titolo: 'Hai trovato una Carta MEMORIAE',
    quiPuoi: 'Avvisare le persone di fiducia del proprietario della carta. Non vedrai nulla dei suoi dati.',
    passi: () => [
      'Se vuoi, scrivi un breve messaggio (dove l\'hai trovata, cosa è successo).',
      'Lascia un numero di telefono o un\'e-mail, se vuoi essere richiamato.',
      'Tocca «Avvisa le persone di fiducia».',
    ],
  },
};

// ——— Quale pagina è aperta adesso ———
// Ogni parte dell'app dice la sua pagina; vince quella più interna (livello più alto).

type Voce = { pagina: PaginaAiuto; ctx: ContestoAiuto; livello: number; ordine: number };
const registrate = new Map<number, Voce>();
const ascoltatori = new Set<() => void>();
let prossimo = 1;
let corrente: Voce | null = null;

function aggiorna() {
  let best: Voce | null = null;
  for (const v of registrate.values()) if (!best || v.livello > best.livello || (v.livello === best.livello && v.ordine > best.ordine)) best = v;
  corrente = best;
  ascoltatori.forEach((f) => f());
}

/** Dichiara la pagina aperta (e la situazione, per i passi). `null` = nessuna. */
export function useAiuto(pagina: PaginaAiuto | null, ctx: ContestoAiuto = {}, livello = 0) {
  const id = useRef(0);
  if (id.current === 0) id.current = prossimo++;
  const chiave = JSON.stringify(ctx);
  useEffect(() => {
    if (!pagina) return;
    const mio = id.current;
    registrate.set(mio, { pagina, ctx: JSON.parse(chiave) as ContestoAiuto, livello, ordine: prossimo++ });
    aggiorna();
    return () => {
      registrate.delete(mio);
      aggiorna();
    };
  }, [pagina, chiave, livello]);
}

function usaCorrente() {
  return useSyncExternalStore(
    (f) => {
      ascoltatori.add(f);
      return () => ascoltatori.delete(f);
    },
    () => corrente,
  );
}

// ——— Prima visita ———
const CHIAVE_VISTE = 'memoriae-aiuto-visto';
function viste(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CHIAVE_VISTE) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function segnaVista(p: PaginaAiuto) {
  try {
    const v = viste();
    if (!v.includes(p)) localStorage.setItem(CHIAVE_VISTE, JSON.stringify([...v, p]));
  } catch {
    /* senza memoria del browser l'aiuto resta solo sul pulsante */
  }
}
/** Nei test automatici (Chrome guidato) l'aiuto non si apre da solo, salvo richiesta esplicita. */
function aperturaAutomatica(): boolean {
  try {
    if (localStorage.getItem('memoriae-aiuto-auto') === 'si') return true;
  } catch {
    /* niente */
  }
  return !navigator.webdriver;
}

const GUIDA_URL = (import.meta.env.VITE_GUIDA_URL as string | undefined) || null;

/** Il pulsante «? Aiuto» della testata e il riquadro che apre. */
export function PulsanteAiuto() {
  const c = usaCorrente();
  const [aperto, setAperto] = useState<PaginaAiuto | null>(null);
  const pulsante = useRef<HTMLButtonElement>(null);
  const chiudi = useRef<HTMLButtonElement>(null);

  // Prima visita di una pagina: l'aiuto si apre da solo, una volta.
  useEffect(() => {
    if (!c || !aperturaAutomatica()) return;
    if (!viste().includes(c.pagina)) {
      segnaVista(c.pagina);
      setAperto(c.pagina);
    }
  }, [c?.pagina]); // eslint-disable-line react-hooks/exhaustive-deps

  // Se si cambia pagina, il riquadro si chiude.
  useEffect(() => {
    if (aperto && c && c.pagina !== aperto) setAperto(null);
  }, [c?.pagina]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!aperto) return;
    chiudi.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAperto(null);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aperto]);

  if (!c) return null;
  const t = AIUTO[c.pagina];
  const passi = t.passi(c.ctx);
  return (
    <>
      <button
        ref={pulsante}
        className="pulsante-aiuto"
        aria-haspopup="dialog"
        aria-expanded={aperto !== null}
        onClick={() => {
          segnaVista(c.pagina);
          setAperto(c.pagina);
        }}
      >
        <span aria-hidden="true">?</span> Aiuto
      </button>
      {aperto && (
        <div
          className="aiuto-sfondo"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAperto(null);
          }}
        >
          <div className="aiuto" role="dialog" aria-modal="true" aria-labelledby="aiuto-titolo">
            <h2 id="aiuto-titolo">{t.titolo}</h2>
            <h3>Qui puoi</h3>
            <p>{t.quiPuoi}</p>
            <h3>Cosa fare adesso</h3>
            <ol>
              {passi.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
            {t.capitolo && (
              <p className="tenue">
                Leggi di più nella guida, al capitolo{' '}
                {GUIDA_URL ? (
                  <a href={GUIDA_URL} target="_blank" rel="noreferrer">
                    «{t.capitolo}»
                  </a>
                ) : (
                  <>«{t.capitolo}»</>
                )}
                .
              </p>
            )}
            <button
              ref={chiudi}
              className="primario"
              onClick={() => {
                setAperto(null);
                pulsante.current?.focus();
              }}
            >
              Ho capito
            </button>
          </div>
        </div>
      )}
    </>
  );
}
