/**
 * Le domande dell'Intervista dei ricordi: una alla settimana, per un anno.
 * Domande leggere e concrete, che invitano a raccontare; ognuna si può saltare.
 * L'identificativo non cambia mai (le risposte lo ricordano), il testo sì.
 */
export interface Domanda {
  id: string;
  testo: string;
}

export const DOMANDE: Domanda[] = [
  { id: 'infanzia-casa', testo: 'Com\'era la casa in cui sei cresciuto? Raccontaci una stanza.' },
  { id: 'primo-ricordo', testo: 'Qual è il tuo primo ricordo?' },
  { id: 'genitori', testo: 'Che lavoro facevano i tuoi genitori? Cosa ricordi delle loro giornate?' },
  { id: 'nonni', testo: 'Cosa ricordi dei tuoi nonni?' },
  { id: 'gioco', testo: 'A cosa giocavi da bambino, e con chi?' },
  { id: 'scuola', testo: 'C\'è un insegnante che non hai dimenticato? Perché?' },
  { id: 'paese', testo: 'Com\'era il tuo paese o il tuo quartiere quando eri piccolo?' },
  { id: 'festa', testo: 'Come si festeggiava il Natale (o la festa più importante) nella tua famiglia?' },
  { id: 'ricetta', testo: 'Qual è la ricetta di famiglia che vorresti tramandare? Spiegaci come si fa.' },
  { id: 'profumo', testo: 'C\'è un profumo o un sapore che ti riporta subito indietro nel tempo?' },
  { id: 'amico', testo: 'Chi era il tuo migliore amico da ragazzo? Cosa facevate insieme?' },
  { id: 'primo-lavoro', testo: 'Qual è stato il tuo primo lavoro e quanto guadagnavi?' },
  { id: 'primo-stipendio', testo: 'Come hai speso il tuo primo stipendio?' },
  { id: 'mestiere', testo: 'Cosa ti piaceva di più del tuo lavoro? E cosa di meno?' },
  { id: 'incontro', testo: 'Come hai conosciuto la persona più importante della tua vita?' },
  { id: 'matrimonio', testo: 'Racconta un giorno speciale della tua vita di coppia.' },
  { id: 'figli', testo: 'Cosa hai provato quando sei diventato genitore (o zio, o padrino)?' },
  { id: 'casa-tua', testo: 'Com\'era la prima casa tutta tua?' },
  { id: 'viaggio', testo: 'Qual è il viaggio che ricordi con più piacere?' },
  { id: 'musica', testo: 'Quali canzoni ti accompagnano da sempre? Che ricordo ti portano?' },
  { id: 'libro', testo: 'Un libro, un film o una trasmissione che ti ha cambiato qualcosa?' },
  { id: 'coraggio', testo: 'Qual è la cosa più coraggiosa che hai fatto?' },
  { id: 'sbaglio', testo: 'Un errore da cui hai imparato molto?' },
  { id: 'fortuna', testo: 'Quando ti sei sentito davvero fortunato?' },
  { id: 'storia-famiglia', testo: 'C\'è una storia di famiglia che si racconta da generazioni?' },
  { id: 'oggetto', testo: 'Quale oggetto di casa ha una storia che vale la pena raccontare?' },
  { id: 'foto', testo: 'Scegli una vecchia fotografia e racconta cosa succedeva quel giorno.' },
  { id: 'animale', testo: 'Hai avuto un animale a cui eri affezionato? Raccontaci di lui.' },
  { id: 'sport', testo: 'Uno sport, un hobby o una passione che ti ha dato gioia?' },
  { id: 'mani', testo: 'Cosa sai fare con le mani che vorresti insegnare a qualcuno?' },
  { id: 'consiglio-giovane', testo: 'Che consiglio daresti a te stesso a vent\'anni?' },
  { id: 'cambiamento', testo: 'Qual è il cambiamento del mondo che ti ha colpito di più?' },
  { id: 'tecnologia', testo: 'Ricordi la prima televisione, il primo telefono, la prima auto?' },
  { id: 'evento', testo: 'Un fatto storico che hai vissuto: dov\'eri e cosa hai pensato?' },
  { id: 'lingua', testo: 'C\'è una parola o un modo di dire di famiglia? Cosa significa?' },
  { id: 'domenica', testo: 'Com\'era una domenica tipica, quando eri giovane?' },
  { id: 'stagione', testo: 'Qual è la tua stagione preferita e perché?' },
  { id: 'luogo', testo: 'Qual è il posto al mondo dove ti senti a casa?' },
  { id: 'persona-ammirata', testo: 'Una persona che hai ammirato, e cosa hai imparato da lei?' },
  { id: 'risata', testo: 'Racconta una volta in cui hai riso fino alle lacrime.' },
  { id: 'gentilezza', testo: 'Un gesto di gentilezza che hai ricevuto e non hai dimenticato?' },
  { id: 'orgoglio', testo: 'Di cosa sei più orgoglioso?' },
  { id: 'valori', testo: 'Quali valori vorresti che la tua famiglia portasse avanti?' },
  { id: 'felicita', testo: 'Cosa ti rende felice nelle piccole cose di ogni giorno?' },
  { id: 'nipoti', testo: 'Cosa vorresti che i tuoi nipoti sapessero di te?' },
  { id: 'lezione', testo: 'La lezione più importante che ti ha dato la vita?' },
  { id: 'sogno', testo: 'Un sogno che hai realizzato, o uno che hai ancora?' },
  { id: 'grazie', testo: 'A chi vorresti dire grazie, e per cosa?' },
  { id: 'carattere', testo: 'Come ti descriverebbero le persone che ti conoscono bene?' },
  { id: 'tradizione', testo: 'Una tradizione che vorresti che non si perdesse?' },
  { id: 'futuro', testo: 'Cosa auguri alle persone che ami per il loro futuro?' },
  { id: 'ricordati', testo: 'Come vorresti essere ricordato?' },
];

/** La domanda da proporre: la prima non ancora risposta né saltata. */
export function prossimaDomanda(risposte: Set<string>, saltate: string[]): Domanda | null {
  const libere = DOMANDE.filter((d) => !risposte.has(d.id));
  if (libere.length === 0) return null;
  return libere.find((d) => !saltate.includes(d.id)) ?? libere[0]!;
}
