/**
 * Prova completa nel browser, con una passkey virtuale di Chrome (anche con estensione PRF).
 *
 * Prerequisiti: server su :3000 e app (vite) su :5173.
 * Uso: node e2e/percorso.mjs [cartella-screenshot]
 * Con SENZA_PRF=1 simula un dispositivo senza PRF: si prova la password di riserva.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'e2e-screenshot';
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });
// Playwright: quello installato nel progetto o, in sua assenza, quello di sistema.
const { chromium } = createRequire(import.meta.url)('playwright');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
    hasPrf: process.env.SENZA_PRF !== '1',
  },
});

const shot = async (name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
const step = (msg) => console.log(`• ${msg}`);

await page.goto(BASE);
await page.getByRole('heading', { name: 'La tua vita digitale, in ordine' }).waitFor();
await shot('01-benvenuto');
step('benvenuto');

await page.getByRole('button', { name: 'Crea la tua cassaforte' }).click();
await page.getByLabel('Nome e cognome').fill('Rosa Bianchi');
await page.getByLabel('E-mail').fill(`rosa+${Date.now()}@example.ch`);
await shot('02-registrazione');
await page.getByRole('button', { name: 'Continua' }).click();

const codice = page.getByLabel('Codice di recupero');
const password = page.getByRole('heading', { name: 'Scegli una password per la cassaforte' });
await Promise.race([codice.waitFor({ timeout: 20000 }), password.waitFor({ timeout: 20000 })]);
if (await password.isVisible()) {
  step('PRF non disponibile: uso la password di riserva');
  await page.getByLabel('Password', { exact: true }).fill('una frase lunga e sicura');
  await page.getByLabel('Ripeti la password').fill('una frase lunga e sicura');
  await page.getByRole('button', { name: 'Crea la cassaforte' }).click();
  await codice.waitFor();
} else {
  step('passkey con PRF: nessuna password necessaria');
}
const testoCodice = (await codice.textContent())?.trim();
console.log(`  codice di recupero: ${testoCodice}`);
await shot('03-codice-recupero');

await page.getByLabel('Ho stampato o scritto il codice').check();
await page.getByRole('button', { name: 'Vai alla cassaforte' }).click();
await page.getByRole('heading', { name: /La cassaforte di Rosa/ }).waitFor();
await shot('04-cassaforte-vuota');
step('cassaforte creata');

await page.getByRole('button', { name: 'Aggiungi una voce' }).click();
await shot('05-scegli-tipo');
await page.getByRole('button', { name: /^Account/ }).click();
await page.getByLabel('Titolo').fill('Conto PostFinance');
await page.getByLabel('Servizio').selectOption('paypal');
await page.getByLabel('Note per chi resta').fill('Consulente: sig. Rossi, filiale di Mendrisio.\nLa procura è nella cassaforte di casa.');
await page.getByLabel(/^Documenti/).setInputFiles([
  { name: 'estratto-conto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 estratto conto di prova') },
  { name: 'procura.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 procura firmata') },
]);
await page.getByText('procura.pdf').waitFor();
await page.getByLabel(/Serve anche in caso di emergenza/).check();
await shot('06-nuova-voce');
await page.getByRole('button', { name: 'Salva nella cassaforte' }).click();
await page.getByRole('button', { name: /Conto PostFinance/ }).waitFor();
await shot('07-elenco');
await page.getByText('2 documenti').waitFor();
step('voce con due documenti salvata');

await page.getByRole('button', { name: /Conto PostFinance/ }).click();
await page.getByRole('heading', { name: 'Conto PostFinance' }).waitFor();
await shot('08-dettaglio');
async function scarica(nome, atteso) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: nome, exact: true }).click()]);
  const testo = readFileSync(await download.path(), 'utf8');
  if (testo !== atteso) throw new Error(`File decifrato diverso: ${testo}`);
}
await scarica('estratto-conto.pdf', '%PDF-1.7 estratto conto di prova');
await scarica('procura.pdf', '%PDF-1.7 procura firmata');
step('documenti scaricati e decifrati correttamente');

// Aggiungo altri due documenti alla voce esistente e ne tolgo uno.
await page.getByLabel(/Aggiungi documenti/).setInputFiles([
  { name: 'contratto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 contratto') },
  { name: 'foto-tessera.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('JPEG finto') },
]);
await page.getByRole('button', { name: 'Carica 2 documenti' }).click();
await page.getByRole('button', { name: 'foto-tessera.jpg', exact: true }).waitFor();
await scarica('contratto.pdf', '%PDF-1.7 contratto');
const riga = page.locator('.elenco-documenti li', { hasText: 'procura.pdf' });
await riga.getByRole('button', { name: 'Togli' }).click();
await riga.getByRole('button', { name: 'Sì, togli' }).click();
await page.getByRole('button', { name: 'procura.pdf', exact: true }).waitFor({ state: 'detached' });
await shot('08b-documenti');
step('documenti aggiunti e tolti dal dettaglio');

// Ricarico: la chiave della cassaforte non sopravvive in memoria, va riaperta con la passkey.
await page.reload();
await page.getByRole('button', { name: 'Accedi con la passkey' }).click();
const apriPwd = page.getByRole('heading', { name: 'Password della cassaforte' });
const elenco = page.getByRole('button', { name: /Conto PostFinance/ });
await Promise.race([elenco.waitFor({ timeout: 20000 }), apriPwd.waitFor({ timeout: 20000 })]);
if (await apriPwd.isVisible()) {
  await page.getByLabel('Password').fill('una frase lunga e sicura');
  await page.getByRole('button', { name: 'Apri' }).click();
  await elenco.waitFor();
}
await shot('09-riaperta');
step('cassaforte riaperta dopo il ricaricamento');

await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
await browser.close();
console.log('Percorso completo superato');
