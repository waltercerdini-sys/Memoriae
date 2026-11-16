/**
 * Prova della Carta MEMORIAE: ordine con indirizzo, preparazione e spedizione (Operatore),
 * lotto del fornitore (codici QR, chiavi, file di consegna, magazzino), abbinamento con il codice stampato,
 * attivazione, lettura da parte di chi la trova (chip e QR di riserva), avviso, disattivazione. Senza carta vera:
 * in prova l'Operatore genera il collegamento che scriverebbe il chip.
 * Prerequisiti: npm run prova. Uso: node e2e/carta.mjs [cartella-screenshot]
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'e2e-screenshot';
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const step = (m) => console.log(`• ${m}`);
const UID = `04${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('')}`.toUpperCase();

const context = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
});
const shot = (p, n) => p.screenshot({ path: join(OUT, `carta-${n}.png`), fullPage: true });
const accedi = async () => {
  await page.getByRole('button', { name: 'Accedi con la passkey' }).click();
  await page.getByText(/pronta al/).waitFor();
};

await page.goto(BASE);
await page.getByRole('button', { name: 'Crea la tua cassaforte' }).click();
await page.getByLabel('Nome e cognome').fill('Rosa Bianchi');
await page.getByLabel('E-mail').fill(`rosa+${Date.now()}@example.ch`);
await page.getByRole('button', { name: 'Continua' }).click();
await page.getByLabel('Ho stampato o scritto il codice').check();
await page.getByRole('button', { name: 'Vai alla cassaforte' }).click();
await page.getByText(/pronta al 10%/).waitFor();

// Ordine: una carta, regalo, indirizzo nella pagina di pagamento.
await page.getByRole('tab', { name: 'Protezione' }).click();
await page.getByRole('button', { name: /Carta MEMORIAE/ }).click();
await page.getByRole('heading', { name: 'Carta MEMORIAE', level: 1 }).waitFor();
await page.getByText('La carta non apre la tua cassaforte.').waitFor();
await page.getByLabel(/È un regalo/).check();
await shot(page, '01-ordina');
await page.getByRole('button', { name: 'Ordina e paga' }).click();
await page.getByRole('heading', { name: 'Carta MEMORIAE: CHF 25.–' }).waitFor();
await page.getByLabel('Nome e cognome').fill('Giulia Bianchi');
await page.getByLabel('Presso (c/o), facoltativo').fill('Casa anziani Al Lago');
await page.getByLabel('Via e numero').fill('Via Lunga 1');
await page.getByLabel('NPA').fill('6822');
await page.getByLabel('Località').fill('Arogno');
await shot(page, '02-indirizzo');
await page.getByRole('button', { name: 'Paga con TWINT (prova)' }).click();
await page.getByText('Abbiamo ricevuto l\'ordine della Carta MEMORIAE').waitFor();
await accedi();
step('ordine pagato con l\'indirizzo di spedizione');

// Operatore: nuovo lotto per il fornitore, consegna (file con gli UID), magazzino.
await page.getByRole('tab', { name: 'Operatore' }).click();
await page.getByRole('heading', { name: 'Carte da spedire (1)' }).waitFor();
const LOTTO = `Prova ${Date.now()}`;
await page.getByLabel('Nome del lotto').fill(LOTTO);
await page.getByLabel('Numero di carte').fill('2');
await page.getByRole('button', { name: 'Crea il lotto' }).click();
const lotto = page.locator('.lotto-carte', { hasText: LOTTO });
await lotto.getByText('Chiave SDM File Read (chiave 2), solo per questo lotto').waitFor();
await shot(page, '03-lotto');
const [download] = await Promise.all([page.waitForEvent('download'), lotto.getByRole('button', { name: 'Scarica i codici dei QR (CSV)' }).click()]);
const codici = readFileSync(await download.path(), 'utf8')
  .replace(/^\uFEFF/, '')
  .split(/\r?\n/)
  .slice(1)
  .map((r) => r.split(';'));
if (codici.length !== 2 || !/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(codici[0][1])) throw new Error('CSV dei codici non valido');
// Il file che rimanda il fornitore alla consegna: UID e codice di ogni carta.
const UID2 = `04${UID.slice(2, 12)}FF`;
const consegna = `UID;Codice\r\n${UID};${codici[0][1]}\r\n${UID2};${codici[1][1]}\r\n`;
await lotto.locator('input[type=file]').setInputFiles({ name: 'consegna.csv', mimeType: 'text/csv', buffer: Buffer.from(consegna) });
await page.getByText(new RegExp(`Lotto «${LOTTO}»: 2 carte registrate`)).waitFor();
await lotto.getByText('2 carte ordinate · 2 consegnate · 2 in magazzino · 0 assegnate').waitFor();
step('lotto creato, codici QR scaricati, file del fornitore importato: 2 carte in magazzino');

// Ordine: si prende una carta dal magazzino e si scrive il codice stampato.
await page.locator('.ordine-carte').getByText('Giulia Bianchi').waitFor();
await page.locator('.ordine-carte').getByText('c/o Casa anziani Al Lago').waitFor();
await page.getByLabel('Codice della carta (o UID)').fill(codici[0][1].toLowerCase());
await shot(page, '04-operatore');
await page.getByRole('button', { name: "Abbina all'ordine" }).click();
await page.getByLabel('Numero di spedizione (facoltativo)').fill('99.00.123456.78901234');
await page.getByRole('button', { name: 'Spedito' }).click();
await page.getByRole('heading', { name: 'Carte da spedire (0)' }).waitFor();
await lotto.getByText('2 carte ordinate · 2 consegnate · 1 in magazzino · 1 assegnate').waitFor();
step('carta del magazzino abbinata con il codice stampato e spedita');

let ultimo = null;
const nuovoTocco = async () => {
  await page.getByRole('button', { name: `Prova la carta ${UID.slice(-4)}` }).click();
  const link = page.getByRole('link', { name: 'Apri come se avessi avvicinato la carta' });
  await link.waitFor();
  await page.waitForFunction((prima) => document.querySelector('a[href*="/c?picc="]')?.getAttribute('href') !== prima, ultimo);
  ultimo = await link.getAttribute('href');
  return ultimo;
};

// La proprietaria avvicina la carta con MEMORIAE aperta: si attiva.
const attiva = await nuovoTocco();
const p2 = await context.newPage();
await p2.goto(attiva);
await p2.getByRole('heading', { name: 'Carta attivata ✓' }).waitFor();
await shot(p2, '05-attivata');
// Lo stesso collegamento una seconda volta non vale.
await p2.goto(attiva);
await p2.getByRole('heading', { name: 'Avvicina di nuovo la carta' }).waitFor();
await p2.close();
step('attivata dalla proprietaria; collegamento ripetuto rifiutato');

// Chi la trova (un altro telefono, senza accesso): avvisa le persone di fiducia.
const sconosciuto = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
const s = await sconosciuto.newPage();
await s.goto(await nuovoTocco());
await s.getByRole('heading', { name: 'Questa carta appartiene a Rosa B.' }).waitFor();
await s.getByLabel('Messaggio (facoltativo)').fill('Trovata sul treno per Lugano');
await shot(s, '06-trovata');
await s.getByRole('button', { name: 'Avvisa le persone di fiducia' }).click();
await s.getByText(/Grazie!/).waitFor();
await shot(s, '07-avvisato');
step('chi la trova vede «Rosa B.» e manda l\'avviso');

// Telefono senza NFC: il QR di riserva stampato sulla carta porta alla stessa pagina.
const qr = await sconosciuto.newPage();
await qr.goto(codici[0][2]);
await qr.getByRole('heading', { name: 'Questa carta appartiene a Rosa B.' }).waitFor();
// Il QR di una carta ancora in magazzino non dice nulla.
await qr.goto(codici[1][2]);
await qr.getByRole('heading', { name: 'Carta non ancora consegnata' }).waitFor();
await qr.close();
step('QR di riserva: funziona anche senza NFC; quello di una carta in magazzino non dice nulla');

// Carta persa: disattivata.
await page.getByRole('tab', { name: 'Protezione' }).click();
await page.getByRole('button', { name: /Carta MEMORIAE/ }).click();
await page.getByText('Attiva', { exact: true }).waitFor();
await page.getByRole('button', { name: "L'ho persa: disattiva" }).click();
await page.getByRole('button', { name: 'Sì, disattiva' }).click();
await page.getByText('Disattivata', { exact: true }).waitFor();
await page.getByRole('button', { name: '‹ Indietro' }).click();
await page.getByRole('tab', { name: 'Operatore' }).click();
await s.goto(await nuovoTocco());
await s.getByRole('heading', { name: 'Carta disattivata' }).waitFor();
step('carta disattivata dalla proprietaria');

await browser.close();
console.log('Carta MEMORIAE: prova superata');
