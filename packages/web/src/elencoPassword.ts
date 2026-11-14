/**
 * «Trova tutto»: dall'elenco delle password esportato (Mac/iPhone, Chrome, Firefox, Bitwarden, …)
 * ricava l'elenco degli account, SENZA tenere le password.
 *
 * Tutto avviene nel browser: il file non viene mai inviato. Dalle righe si prendono solo
 * il sito e, se è un indirizzo e-mail, il nome utente (utile agli eredi per sapere con quale
 * indirizzo è stato aperto l'account). Le password vengono scartate durante la lettura.
 */

export type Categoria =
  | 'banca'
  | 'pagamenti'
  | 'e-mail'
  | 'cloud'
  | 'social'
  | 'telefonia'
  | 'assicurazione'
  | 'crypto'
  | 'abbonamento'
  | 'acquisti'
  | 'trasporti'
  | 'pubblica amministrazione'
  | 'altro';

/** Categorie che contano davvero per gli eredi: proposte già selezionate. */
export const IMPORTANTI: Categoria[] = ['banca', 'pagamenti', 'e-mail', 'cloud', 'crypto', 'assicurazione', 'telefonia', 'pubblica amministrazione', 'social'];

export const NOME_CATEGORIA: Record<Categoria, string> = {
  banca: 'Banche',
  pagamenti: 'Pagamenti',
  'e-mail': 'Posta elettronica',
  cloud: 'Foto, file e dispositivi',
  social: 'Social network',
  telefonia: 'Telefono e Internet',
  assicurazione: 'Assicurazioni e casse malati',
  crypto: 'Criptovalute',
  abbonamento: 'Abbonamenti (streaming, giornali, servizi)',
  acquisti: 'Acquisti online',
  trasporti: 'Trasporti',
  'pubblica amministrazione': 'Enti e servizi pubblici',
  altro: 'Altri account',
};

interface Noto {
  nome: string;
  categoria: Categoria;
  domini: string[];
}

/** Servizi noti (soprattutto in Svizzera). Quelli del catalogo MEMORIAE si aggiungono a parte. */
const NOTI: Noto[] = [
  // Banche
  { nome: 'Zürcher Kantonalbank', categoria: 'banca', domini: ['zkb.ch'] },
  { nome: 'Banca Cantonale Vodese', categoria: 'banca', domini: ['bcv.ch'] },
  { nome: 'Banca Migros', categoria: 'banca', domini: ['migrosbank.ch'] },
  { nome: 'Banca Cler', categoria: 'banca', domini: ['cler.ch'] },
  { nome: 'Valiant', categoria: 'banca', domini: ['valiant.ch'] },
  { nome: 'Banca Cantonale di Berna', categoria: 'banca', domini: ['bekb.ch'] },
  { nome: 'Banca Cantonale dei Grigioni', categoria: 'banca', domini: ['gkb.ch'] },
  { nome: 'Banca Cantonale di Lucerna', categoria: 'banca', domini: ['lukb.ch'] },
  { nome: 'Banca Cantonale di San Gallo', categoria: 'banca', domini: ['sgkb.ch'] },
  { nome: 'Banca Cantonale di Ginevra', categoria: 'banca', domini: ['bcge.ch'] },
  { nome: 'Banca Cantonale di Basilea', categoria: 'banca', domini: ['bkb.ch'] },
  { nome: 'Banca Cantonale di Argovia', categoria: 'banca', domini: ['akb.ch'] },
  { nome: 'Cornèr Banca', categoria: 'banca', domini: ['corner.ch', 'cornercard.ch'] },
  { nome: 'Banca del Sempione', categoria: 'banca', domini: ['bancasempione.ch'] },
  { nome: 'Revolut', categoria: 'banca', domini: ['revolut.com'] },
  { nome: 'Neon', categoria: 'banca', domini: ['neon-free.ch'] },
  { nome: 'Yuh', categoria: 'banca', domini: ['yuh.com'] },
  { nome: 'Wise', categoria: 'banca', domini: ['wise.com', 'transferwise.com'] },
  { nome: 'N26', categoria: 'banca', domini: ['n26.com'] },
  { nome: 'Swissquote', categoria: 'banca', domini: ['swissquote.ch', 'swissquote.com'] },
  { nome: 'Interactive Brokers', categoria: 'banca', domini: ['interactivebrokers.com', 'ibkr.com'] },
  { nome: 'Viac (pilastro 3a)', categoria: 'banca', domini: ['viac.ch'] },
  { nome: 'Frankly (pilastro 3a)', categoria: 'banca', domini: ['frankly.ch'] },
  { nome: 'Intesa Sanpaolo', categoria: 'banca', domini: ['intesasanpaolo.com'] },
  { nome: 'UniCredit', categoria: 'banca', domini: ['unicredit.it'] },
  // Pagamenti e carte
  { nome: 'Viseca (one)', categoria: 'pagamenti', domini: ['viseca.ch', 'one-digitalservice.ch'] },
  { nome: 'Swisscard', categoria: 'pagamenti', domini: ['swisscard.ch'] },
  { nome: 'Cembra', categoria: 'pagamenti', domini: ['cembra.ch', 'certo-cembra.ch'] },
  { nome: 'Klarna', categoria: 'pagamenti', domini: ['klarna.com'] },
  // Posta elettronica
  { nome: 'GMX', categoria: 'e-mail', domini: ['gmx.ch', 'gmx.net', 'gmx.com'] },
  { nome: 'Proton Mail', categoria: 'e-mail', domini: ['proton.me', 'protonmail.com'] },
  { nome: 'Yahoo', categoria: 'e-mail', domini: ['yahoo.com'] },
  { nome: 'Libero', categoria: 'e-mail', domini: ['libero.it'] },
  // Cloud
  { nome: 'Dropbox', categoria: 'cloud', domini: ['dropbox.com'] },
  { nome: 'pCloud', categoria: 'cloud', domini: ['pcloud.com'] },
  { nome: 'Samsung', categoria: 'cloud', domini: ['samsung.com'] },
  // Social
  { nome: 'X (Twitter)', categoria: 'social', domini: ['x.com', 'twitter.com'] },
  { nome: 'TikTok', categoria: 'social', domini: ['tiktok.com'] },
  { nome: 'WhatsApp', categoria: 'social', domini: ['whatsapp.com'] },
  { nome: 'Pinterest', categoria: 'social', domini: ['pinterest.com'] },
  { nome: 'Snapchat', categoria: 'social', domini: ['snapchat.com'] },
  { nome: 'Telegram', categoria: 'social', domini: ['telegram.org'] },
  { nome: 'Reddit', categoria: 'social', domini: ['reddit.com'] },
  // Telefonia
  { nome: 'Sunrise', categoria: 'telefonia', domini: ['sunrise.ch', 'upc.ch'] },
  { nome: 'Salt', categoria: 'telefonia', domini: ['salt.ch'] },
  { nome: 'Wingo', categoria: 'telefonia', domini: ['wingo.ch'] },
  { nome: 'Yallo', categoria: 'telefonia', domini: ['yallo.ch'] },
  { nome: 'Galaxus Mobile / Digital Republic', categoria: 'telefonia', domini: ['digitalrepublic.ch'] },
  // Assicurazioni e casse malati
  { nome: 'CSS', categoria: 'assicurazione', domini: ['css.ch'] },
  { nome: 'Helsana', categoria: 'assicurazione', domini: ['helsana.ch'] },
  { nome: 'Swica', categoria: 'assicurazione', domini: ['swica.ch'] },
  { nome: 'Sanitas', categoria: 'assicurazione', domini: ['sanitas.com'] },
  { nome: 'Groupe Mutuel', categoria: 'assicurazione', domini: ['groupemutuel.ch'] },
  { nome: 'Assura', categoria: 'assicurazione', domini: ['assura.ch'] },
  { nome: 'Visana', categoria: 'assicurazione', domini: ['visana.ch'] },
  { nome: 'Concordia', categoria: 'assicurazione', domini: ['concordia.ch'] },
  { nome: 'KPT', categoria: 'assicurazione', domini: ['kpt.ch'] },
  { nome: 'AXA', categoria: 'assicurazione', domini: ['axa.ch'] },
  { nome: 'La Mobiliare', categoria: 'assicurazione', domini: ['mobiliar.ch'] },
  { nome: 'Zurich', categoria: 'assicurazione', domini: ['zurich.ch'] },
  { nome: 'Helvetia', categoria: 'assicurazione', domini: ['helvetia.ch', 'helvetia.com'] },
  { nome: 'Generali', categoria: 'assicurazione', domini: ['generali.ch'] },
  { nome: 'Swiss Life', categoria: 'assicurazione', domini: ['swisslife.ch'] },
  { nome: 'Allianz', categoria: 'assicurazione', domini: ['allianz.ch'] },
  { nome: 'Baloise', categoria: 'assicurazione', domini: ['baloise.ch'] },
  // Criptovalute
  { nome: 'Coinbase', categoria: 'crypto', domini: ['coinbase.com'] },
  { nome: 'Binance', categoria: 'crypto', domini: ['binance.com'] },
  { nome: 'Kraken', categoria: 'crypto', domini: ['kraken.com'] },
  { nome: 'Bitpanda', categoria: 'crypto', domini: ['bitpanda.com'] },
  { nome: 'SwissBorg', categoria: 'crypto', domini: ['swissborg.com'] },
  { nome: 'Relai', categoria: 'crypto', domini: ['relai.app', 'relai.ch'] },
  { nome: 'Pocket Bitcoin', categoria: 'crypto', domini: ['pocketbitcoin.com'] },
  { nome: 'Ledger', categoria: 'crypto', domini: ['ledger.com'] },
  // Abbonamenti
  { nome: 'Netflix', categoria: 'abbonamento', domini: ['netflix.com'] },
  { nome: 'Spotify', categoria: 'abbonamento', domini: ['spotify.com'] },
  { nome: 'Disney+', categoria: 'abbonamento', domini: ['disneyplus.com'] },
  { nome: 'Prime Video', categoria: 'abbonamento', domini: ['primevideo.com'] },
  { nome: 'DAZN', categoria: 'abbonamento', domini: ['dazn.com'] },
  { nome: 'Zattoo', categoria: 'abbonamento', domini: ['zattoo.com'] },
  { nome: 'Teleboy', categoria: 'abbonamento', domini: ['teleboy.ch'] },
  { nome: 'oneplus (Swisscom)', categoria: 'abbonamento', domini: ['oneplus.ch'] },
  { nome: 'Sky', categoria: 'abbonamento', domini: ['sky.ch', 'sky.it'] },
  { nome: 'Audible', categoria: 'abbonamento', domini: ['audible.com', 'audible.de'] },
  { nome: 'Deezer', categoria: 'abbonamento', domini: ['deezer.com'] },
  { nome: 'Corriere del Ticino', categoria: 'abbonamento', domini: ['cdt.ch'] },
  { nome: 'laRegione', categoria: 'abbonamento', domini: ['laregione.ch'] },
  { nome: 'NZZ', categoria: 'abbonamento', domini: ['nzz.ch'] },
  { nome: 'Tages-Anzeiger', categoria: 'abbonamento', domini: ['tagesanzeiger.ch'] },
  { nome: 'Le Temps', categoria: 'abbonamento', domini: ['letemps.ch'] },
  { nome: 'Corriere della Sera', categoria: 'abbonamento', domini: ['corriere.it'] },
  { nome: 'Adobe', categoria: 'abbonamento', domini: ['adobe.com'] },
  { nome: 'Canva', categoria: 'abbonamento', domini: ['canva.com'] },
  { nome: 'ChatGPT', categoria: 'abbonamento', domini: ['openai.com', 'chatgpt.com'] },
  { nome: 'Claude', categoria: 'abbonamento', domini: ['claude.ai', 'anthropic.com'] },
  { nome: 'Zoom', categoria: 'abbonamento', domini: ['zoom.us'] },
  { nome: '1Password', categoria: 'abbonamento', domini: ['1password.com'] },
  { nome: 'Strava', categoria: 'abbonamento', domini: ['strava.com'] },
  { nome: 'Duolingo', categoria: 'abbonamento', domini: ['duolingo.com'] },
  // Acquisti
  { nome: 'Amazon', categoria: 'acquisti', domini: ['amazon.com', 'amazon.de', 'amazon.it', 'amazon.fr', 'amazon.co.uk'] },
  { nome: 'Galaxus / Digitec', categoria: 'acquisti', domini: ['galaxus.ch', 'digitec.ch'] },
  { nome: 'Ricardo', categoria: 'acquisti', domini: ['ricardo.ch'] },
  { nome: 'Tutti.ch', categoria: 'acquisti', domini: ['tutti.ch'] },
  { nome: 'Zalando', categoria: 'acquisti', domini: ['zalando.ch'] },
  { nome: 'eBay', categoria: 'acquisti', domini: ['ebay.com', 'ebay.ch', 'ebay.it', 'ebay.de'] },
  { nome: 'AliExpress', categoria: 'acquisti', domini: ['aliexpress.com'] },
  { nome: 'Temu', categoria: 'acquisti', domini: ['temu.com'] },
  { nome: 'Migros', categoria: 'acquisti', domini: ['migros.ch'] },
  { nome: 'Coop', categoria: 'acquisti', domini: ['coop.ch'] },
  { nome: 'IKEA', categoria: 'acquisti', domini: ['ikea.com'] },
  { nome: 'Booking.com', categoria: 'acquisti', domini: ['booking.com'] },
  { nome: 'Airbnb', categoria: 'acquisti', domini: ['airbnb.com', 'airbnb.ch'] },
  // Trasporti
  { nome: 'Swiss (Miles & More)', categoria: 'trasporti', domini: ['swiss.com', 'miles-and-more.com'] },
  { nome: 'easyJet', categoria: 'trasporti', domini: ['easyjet.com'] },
  { nome: 'Mobility', categoria: 'trasporti', domini: ['mobility.ch'] },
  { nome: 'TCS', categoria: 'trasporti', domini: ['tcs.ch'] },
  // Enti pubblici
  { nome: 'ch.ch / servizi federali', categoria: 'pubblica amministrazione', domini: ['admin.ch', 'ch.ch', 'agov.ch'] },
  { nome: 'Cantone Ticino', categoria: 'pubblica amministrazione', domini: ['ti.ch'] },
  { nome: 'eTax / dichiarazione d\'imposta', categoria: 'pubblica amministrazione', domini: ['etax.ch'] },
];

/** Un servizio del catalogo MEMORIAE, come lo restituisce /v1/fornitori. */
export interface ServizioCatalogo {
  slug: string;
  nome: string;
  categoria: string;
  domini: string[];
}

export interface AccountTrovato {
  /** Chiave unica: slug del catalogo oppure dominio principale. */
  chiave: string;
  nome: string;
  categoria: Categoria;
  /** Slug del catalogo MEMORIAE, se il servizio c'è: porta con sé le istruzioni per gli eredi. */
  fornitore?: string;
  dominio: string;
  /** Indirizzi e-mail usati per entrare (mai le password). */
  accessi: string[];
  importante: boolean;
}

export interface EsitoLettura {
  account: AccountTrovato[];
  righe: number;
  formato: string;
  /** Quante righe avevano una password (scartata): serve solo per dirlo all'utente. */
  passwordScartate: number;
}

// --- CSV ------------------------------------------------------------------------

/** Lettore CSV (RFC 4180): virgolette, virgole e a capo dentro i campi; separatore , o ; */
export function leggiCsv(testo: string): string[][] {
  const t = testo.replace(/^﻿/, '');
  const primaRiga = t.slice(0, t.indexOf('\n') >= 0 ? t.indexOf('\n') : t.length);
  const sep = (primaRiga.match(/;/g)?.length ?? 0) > (primaRiga.match(/,/g)?.length ?? 0) ? ';' : ',';
  const righe: string[][] = [];
  let riga: string[] = [];
  let campo = '';
  let tra = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (tra) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else tra = false;
      } else campo += c;
    } else if (c === '"') tra = true;
    else if (c === sep) {
      riga.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      riga.push(campo);
      campo = '';
      if (riga.some((x) => x !== '')) righe.push(riga);
      riga = [];
    } else campo += c;
  }
  riga.push(campo);
  if (riga.some((x) => x !== '')) righe.push(riga);
  return righe;
}

// --- Siti --------------------------------------------------------------------------

/** Suffissi a due livelli più comuni (per prendere «esempio.co.uk» e non «co.uk»). */
const SUFFISSI_DOPPI = new Set(['co.uk', 'org.uk', 'ac.uk', 'com.au', 'co.nz', 'co.jp', 'com.br', 'co.za', 'com.tr', 'com.mx', 'co.in', 'gv.at', 'co.at']);

/** Dominio principale di un indirizzo: «https://www.e-banking.postfinance.ch/x» → «postfinance.ch». */
export function dominioDi(indirizzo: string): string | null {
  let s = indirizzo.trim();
  if (!s) return null;
  if (/^androidapp:\/\//i.test(s)) {
    // Le app Android: «androidapp://com.netflix.mediaclient» → «netflix.com»
    const parti = s.replace(/^androidapp:\/\//i, '').split('.');
    return parti.length >= 2 ? `${parti[1]}.${parti[0]}`.toLowerCase() : null;
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let host: string;
  try {
    host = new URL(s).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/\.$/, '');
  if (!host.includes('.') || /^\d+(\.\d+){3}$/.test(host) || host === 'localhost') return null;
  const parti = host.split('.');
  const ultimi2 = parti.slice(-2).join('.');
  if (SUFFISSI_DOPPI.has(ultimi2) && parti.length >= 3) return parti.slice(-3).join('.');
  return ultimi2;
}

const NOMI_COLONNE = {
  sito: ['url', 'login_uri', 'website', 'web site', 'uri', 'sito', 'indirizzo', 'origin_url', 'hostname', 'login url'],
  titolo: ['title', 'name', 'titolo', 'nome', 'account'],
  utente: ['username', 'login_username', 'user name', 'login', 'email', 'nome utente', 'user'],
  password: ['password', 'login_password', 'pass'],
};

function colonna(intestazione: string[], nomi: string[]): number {
  const h = intestazione.map((x) => x.trim().toLowerCase());
  for (const n of nomi) {
    const i = h.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

function formatoDi(intestazione: string[]): string {
  const h = intestazione.map((x) => x.trim().toLowerCase()).join(',');
  if (h.includes('login_uri')) return 'Bitwarden';
  if (h.includes('otpauth')) return 'Password di Apple (Mac o iPhone)';
  if (h.includes('httprealm') || h.includes('formactionorigin')) return 'Firefox';
  if (h.startsWith('name,url,username,password')) return 'Chrome, Edge o Brave';
  return 'elenco CSV';
}

const pareEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s.trim());
const capitalizza = (d: string) => {
  const base = d.split('.')[0]!;
  return base.charAt(0).toUpperCase() + base.slice(1);
};

/**
 * Legge il file esportato e restituisce gli account trovati. Le password non escono da questa funzione.
 */
export function trovaAccount(testo: string, catalogo: ServizioCatalogo[]): EsitoLettura {
  const righe = leggiCsv(testo);
  if (righe.length < 2) throw new Error('Il file non contiene righe: è proprio l\'elenco delle password esportato in formato CSV?');
  const [intestazione, ...dati] = righe as [string[], ...string[][]];
  const cSito = colonna(intestazione, NOMI_COLONNE.sito);
  if (cSito < 0) throw new Error('Nel file non c\'è una colonna con i siti (URL). Esporta l\'elenco delle password in formato CSV e riprova.');
  const cTitolo = colonna(intestazione, NOMI_COLONNE.titolo);
  const cUtente = colonna(intestazione, NOMI_COLONNE.utente);
  const cPassword = colonna(intestazione, NOMI_COLONNE.password);

  const indice = new Map<string, { nome: string; categoria: Categoria; fornitore?: string }>();
  for (const n of NOTI) for (const d of n.domini) indice.set(d, { nome: n.nome, categoria: n.categoria });
  // Il catalogo MEMORIAE vince: ha le istruzioni per gli eredi.
  for (const s of catalogo) {
    for (const d of s.domini) indice.set(d, { nome: s.nome, categoria: categoriaCatalogo(s.categoria), fornitore: s.slug });
  }

  const trovati = new Map<string, AccountTrovato>();
  let passwordScartate = 0;
  for (const r of dati) {
    if (cPassword >= 0 && r[cPassword]) passwordScartate++;
    // Alcuni elenchi (Bitwarden) mettono più indirizzi nella stessa cella, separati da a capo o virgole.
    const indirizzi = (r[cSito] ?? '').split(/[\n,]+/);
    const utente = cUtente >= 0 ? (r[cUtente] ?? '').trim() : '';
    for (const ind of indirizzi) {
      const dominio = dominioDi(ind);
      if (!dominio) continue;
      const noto = indice.get(dominio);
      const chiave = noto?.fornitore ?? dominio;
      const esistente = trovati.get(chiave);
      const accesso = pareEmail(utente) ? utente.toLowerCase() : null;
      if (esistente) {
        if (accesso && !esistente.accessi.includes(accesso)) esistente.accessi.push(accesso);
        continue;
      }
      const titolo = cTitolo >= 0 ? (r[cTitolo] ?? '').trim() : '';
      const nome = noto?.nome ?? (titolo && !/^https?:/i.test(titolo) && titolo.length < 60 ? titolo : capitalizza(dominio));
      const categoria = noto?.categoria ?? 'altro';
      trovati.set(chiave, {
        chiave,
        nome,
        categoria,
        fornitore: noto?.fornitore,
        dominio,
        accessi: accesso ? [accesso] : [],
        importante: IMPORTANTI.includes(categoria),
      });
      break;
    }
  }
  const ordine = Object.keys(NOME_CATEGORIA) as Categoria[];
  const account = [...trovati.values()].sort(
    (a, b) => ordine.indexOf(a.categoria) - ordine.indexOf(b.categoria) || a.nome.localeCompare(b.nome, 'it'),
  );
  return { account, righe: dati.length, formato: formatoDi(intestazione), passwordScartate };
}

function categoriaCatalogo(c: string): Categoria {
  if (c === 'banca') return 'banca';
  if (c === 'pagamenti') return 'pagamenti';
  if (c === 'social') return 'social';
  if (c === 'telefonia') return 'telefonia';
  if (c === 'trasporti') return 'trasporti';
  if (c === 'identità digitale') return 'pubblica amministrazione';
  if (c === 'cloud e posta') return 'e-mail';
  if (c === 'cloud e dispositivi') return 'cloud';
  if (c === 'password manager') return 'cloud';
  return 'altro';
}

/** Somma annua degli abbonamenti indicati dall'utente (importi mensili in franchi). */
export function totaleAnnuo(importiMensili: (number | undefined)[]): number {
  return Math.round(importiMensili.reduce<number>((s, x) => s + (x && x > 0 ? x : 0), 0) * 12);
}
