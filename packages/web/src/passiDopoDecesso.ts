/**
 * «I primi 30 giorni»: cosa fare in Svizzera dopo un decesso, con le scadenze.
 * Fonte: ch.ch (Confederazione), «Decesso: lista di controllo» e «Rinunciare a un'eredità»,
 * controllate il 14.11.2026. Le procedure possono cambiare da Cantone a Cantone.
 */
export const FONTE_PRIMI_GIORNI = {
  controllatoIl: '2026-11-14',
  pagine: [
    { titolo: 'ch.ch – Decesso: lista di controllo', url: 'https://ch.ch/it/famiglia-e-unione-domestica/decesso/decesso:-lista-di-controllo' },
    { titolo: 'ch.ch – Rinunciare a un\'eredità', url: 'https://ch.ch/it/famiglia-e-unione-domestica/eredita/rinunciare-a-un-eredita' },
  ],
};

export interface PassoPrimiGiorni {
  id: string;
  /** Entro quanti giorni dal decesso (se c'è una scadenza). */
  entroGiorni?: number;
  quando: string;
  titolo: string;
  testo: string;
  /** Lettera già pronta: a chi e cosa chiedere. */
  lettera?: { destinatario: string; oggetto: string; richiesta: string[]; allegati?: string[] };
  /** Il passo rimanda all'elenco delle voci di MEMORIAE (abbonamenti, account). */
  voci?: boolean;
}

export const PASSI_PRIMI_GIORNI: PassoPrimiGiorni[] = [
  {
    id: 'stato-civile',
    entroGiorni: 2,
    quando: 'Entro 2 giorni',
    titolo: 'Annunciare il decesso all\'ufficio dello stato civile',
    testo:
      'Se il decesso è avvenuto in ospedale o in una casa di cura, di solito lo annuncia l\'istituto. Altrimenti lo fanno i familiari o l\'impresa di pompe funebri. Servono il certificato medico di morte, il libretto o certificato di famiglia e un documento d\'identità della persona. Su richiesta l\'ufficio rilascia l\'atto di morte: chiedetene alcune copie, servono per molte pratiche.',
  },
  {
    id: 'beneficio-inventario',
    entroGiorni: 30,
    quando: 'Entro 1 mese',
    titolo: 'Decidere se chiedere il beneficio d\'inventario',
    testo:
      'Se temete che ci siano debiti, chiedete il beneficio d\'inventario entro un mese da quando avete saputo del decesso, all\'autorità competente per le successioni dell\'ultimo domicilio: si ottiene un elenco ufficiale di beni e debiti prima di decidere.',
  },
  {
    id: 'eredita',
    entroGiorni: 90,
    quando: 'Entro 3 mesi',
    titolo: 'Accettare o rinunciare all\'eredità',
    testo:
      'Chi non vuole l\'eredità deve rinunciarvi per iscritto, con lettera raccomandata, entro tre mesi, all\'autorità competente dell\'ultimo domicilio. Chi non fa nulla accetta l\'eredità, debiti compresi. In caso di dubbio chiedete a un notaio o a un avvocato.',
  },
  {
    id: 'certificato-ereditario',
    quando: 'Appena possibile',
    titolo: 'Chiedere il certificato ereditario',
    testo:
      'Banche, assicurazioni e altri enti chiedono di sapere chi sono gli eredi prima di dare informazioni o sbloccare i conti. Il certificato si chiede all\'autorità competente per le successioni (a seconda del Cantone, un notaio o un ufficio del tribunale).',
  },
  {
    id: 'avs',
    quando: 'Dopo il funerale',
    titolo: 'Avvisare l\'AVS e chiedere le rendite per superstiti',
    testo: 'Avvisate la cassa di compensazione AVS e chiedete le rendite per superstiti che spettano (coniuge, figli).',
    lettera: {
      destinatario: 'Cassa di compensazione AVS',
      oggetto: 'Comunicazione di decesso e richiesta di rendite per superstiti',
      richiesta: [
        'Vi chiedo di registrare il decesso e di inviarmi i moduli per la richiesta delle rendite per superstiti che spettano ai familiari.',
        'Numero AVS della persona deceduta: ______________________',
      ],
    },
  },
  {
    id: 'previdenza',
    quando: 'Dopo il funerale',
    titolo: 'Cassa pensione, 3° pilastro e assicurazione sulla vita',
    testo:
      'Contattate il datore di lavoro o la cassa pensione (2° pilastro) per le prestazioni ai superstiti e lo stipendio residuo. Avvisate la banca o l\'assicurazione del 3° pilastro e, se c\'è, l\'assicurazione sulla vita.',
    lettera: {
      destinatario: 'Cassa pensione / istituto di previdenza',
      oggetto: 'Comunicazione di decesso e prestazioni ai superstiti',
      richiesta: ['Vi chiedo di registrare il decesso e di indicarmi le prestazioni previste per i superstiti e i documenti necessari per richiederle.'],
    },
  },
  {
    id: 'assicurazioni',
    quando: 'Dopo il funerale',
    titolo: 'Disdire cassa malati e altre assicurazioni',
    testo: 'Cassa malati, assicurazione mobilia, responsabilità civile, infortuni, veicoli: avvisatele e chiedete il rimborso dei premi pagati in anticipo.',
    lettera: {
      destinatario: 'Cassa malati / assicurazione',
      oggetto: 'Comunicazione di decesso e disdetta delle polizze',
      richiesta: [
        'Vi chiedo di chiudere le polizze intestate alla persona deceduta e di rimborsare agli eredi i premi pagati per il periodo successivo al decesso.',
        'Numero di assicurato o di polizza: ______________________',
      ],
    },
  },
  {
    id: 'banca-posta',
    quando: 'Dopo il funerale',
    titolo: 'Informare banche e PostFinance',
    testo: 'Le banche bloccano di solito i conti finché non ricevono il certificato ereditario. Chiedete un estratto alla data del decesso: serve per l\'inventario e le imposte.',
    lettera: {
      destinatario: 'Banca / PostFinance',
      oggetto: 'Comunicazione di decesso',
      richiesta: [
        'Vi chiedo di registrare il decesso, di inviarmi un estratto di tutti i conti e i depositi alla data del decesso e di indicarmi i documenti necessari per la successione.',
      ],
    },
  },
  {
    id: 'fisco',
    quando: 'Dopo il funerale',
    titolo: 'Informare l\'autorità fiscale',
    testo: 'L\'ufficio delle imposte del Comune o del Cantone vi indicherà come chiudere la dichiarazione dei redditi della persona deceduta.',
  },
  {
    id: 'locazione',
    quando: 'Dopo il funerale',
    titolo: 'Informare il locatore',
    testo: 'Se la persona viveva sola, va disdetto il contratto d\'affitto e va svuotata l\'abitazione nei termini del contratto.',
    lettera: {
      destinatario: 'Locatore / amministrazione dello stabile',
      oggetto: 'Comunicazione di decesso del conduttore',
      richiesta: ['Vi chiedo di indicarmi i termini per la disdetta del contratto di locazione e per la riconsegna dell\'abitazione.'],
    },
  },
  {
    id: 'circolazione',
    quando: 'Dopo il funerale',
    titolo: 'Patente e veicoli',
    testo: 'Se la persona aveva la patente o un veicolo immatricolato a suo nome, informate la sezione della circolazione del Cantone.',
  },
  {
    id: 'abbonamenti',
    quando: 'Dopo il funerale',
    titolo: 'Disdire abbonamenti e account',
    testo: 'Giornali, associazioni, trasporti, telefono, servizi online: l\'elenco preparato è qui sotto, con la volontà per ciascuno e la lettera già pronta.',
    voci: true,
  },
  {
    id: 'inventario-casa',
    quando: 'Dopo il funerale',
    titolo: 'Fare l\'elenco dei beni in casa',
    testo: 'Un elenco degli oggetti trovati nell\'abitazione aiuta nella divisione dell\'eredità.',
  },
];

/** La data entro cui fare un passo, a partire dal giorno del decesso. */
export function scadenza(dataDecesso: string, giorni: number): Date {
  const d = new Date(`${dataDecesso}T12:00:00`);
  d.setDate(d.getDate() + giorni);
  return d;
}
