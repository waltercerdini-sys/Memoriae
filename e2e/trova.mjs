/**
 * Prova di «Trova tutto»: importazione dall'elenco password esportato da Chrome.
 * Controlla che nessuna password lasci il browser.
 * Prerequisiti: npm run prova. Uso: node e2e/trova.mjs [cartella-screenshot]
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'e2e-screenshot';
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
});
const shot = (n) => page.screenshot({ path: join(OUT, `trova-${n}.png`), fullPage: true });
const step = (m) => console.log(`• ${m}`);

// Ogni richiesta al server viene controllata: le password non devono mai partire.
const SEGRETO = 'Pw-Segreta-Mai-Inviare-9137';
const fughe = [];
page.on('request', (r) => {
  const body = r.postDataBuffer();
  if (body && body.toString('latin1').includes(SEGRETO)) fughe.push(r.url());
});

await page.goto(BASE);
await page.getByRole('button', { name: 'Crea la tua cassaforte' }).click();
await page.getByLabel('Nome e cognome').fill('Rosa Bianchi');
await page.getByLabel('E-mail').fill(`rosa+${Date.now()}@example.ch`);
await page.getByRole('button', { name: 'Continua' }).click();
await page.getByLabel('Ho stampato o scritto il codice').check();
await page.getByRole('button', { name: 'Vai alla cassaforte' }).click();
await page.getByText(/pronta al 10%/).waitFor();
await page.getByRole('button', { name: 'Trova tutto' }).click();
await page.getByRole('heading', { name: 'Trova tutto' }).waitFor();
await shot('01-istruzioni');

const csv = [
  'name,url,username,password,note',
  `e-finance.postfinance.ch,https://www.e-finance.postfinance.ch/,rosa@bluewin.ch,${SEGRETO},`,
  `accounts.google.com,https://accounts.google.com/,rosa.bianchi@gmail.com,${SEGRETO},`,
  `appleid.apple.com,https://appleid.apple.com/,rosa@icloud.com,${SEGRETO},`,
  `www.swisscom.ch,https://www.swisscom.ch/login,rosa@bluewin.ch,${SEGRETO},`,
  `my.helsana.ch,https://my.helsana.ch/,rosa@bluewin.ch,${SEGRETO},`,
  `www.netflix.com,https://www.netflix.com/ch-it/login,rosa@bluewin.ch,${SEGRETO},`,
  `open.spotify.com,https://accounts.spotify.com/,rosa@bluewin.ch,${SEGRETO},`,
  `www.galaxus.ch,https://www.galaxus.ch/,rosa@bluewin.ch,${SEGRETO},`,
  `forum.giardinaggio.it,https://forum.giardinaggio.it/,rosa77,${SEGRETO},`,
].join('\n');
await page.locator('input[type=file]').setInputFiles({ name: 'Chrome Passwords.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
await page.getByRole('heading', { name: 'Abbiamo trovato 9 account' }).waitFor();
await page.getByText('9 password lette e scartate').waitFor();
await page.locator('li', { hasText: 'Netflix' }).getByRole('textbox').fill('18,90');
await page.locator('li', { hasText: 'Spotify' }).getByRole('textbox').fill('12.95');
await page.getByText(/Paghi circa CHF 382 all'anno/).waitFor();
await shot('02-risultato');
step('9 account trovati, abbonamenti: CHF 382 all\'anno');

// Proposte: importanti e abbonamenti selezionati, il resto no (Galaxus, forum).
await page.getByRole('button', { name: 'Aggiungi 7 voci alla cassaforte' }).click();
await page.getByText('Aggiunte 7 voci alla cassaforte').waitFor();
await page.getByRole('button', { name: /PostFinance/ }).waitFor();
await page.getByText('CHF 18.90 al mese').waitFor();
await page.getByText(/Abbonamenti in elenco: circa CHF 382 all'anno/).waitFor();
await shot('03-inventario');
step('7 voci aggiunte all\'inventario');

// Istruzioni per gli eredi e «fatto» per la funzione da vivi.
await page.getByRole('button', { name: /Apple/ }).click();
await page.getByText('Contatto erede').first().waitFor();
await page.getByLabel('Fatto: ho impostato questa funzione').check();
await page.waitForTimeout(800); // salvataggio cifrato
await page.getByRole('button', { name: "Torna all'elenco" }).click();
await page.getByRole('button', { name: 'Cosa manca?' }).click();
await page.getByText(/Decidi a chi vanno/).waitFor();
await shot('04-prontezza');
step('prontezza e prossimi passi visibili');

// Una seconda importazione non crea doppioni.
await page.getByRole('button', { name: 'Trova tutto' }).click();
await page.locator('input[type=file]').setInputFiles({ name: 'Chrome Passwords.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
await page.getByText('Già nella cassaforte').first().waitFor();
if (!(await page.getByRole('button', { name: 'Aggiungi 0 voci alla cassaforte' }).isDisabled())) throw new Error('Doppioni proposti');
step('seconda importazione: nessun doppione');

if (fughe.length) throw new Error(`Password inviate al server: ${fughe.join(', ')}`);
step('nessuna password è uscita dal browser');
await browser.close();
console.log('Trova tutto: prova superata');
