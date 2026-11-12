/**
 * Prova di persone, inviti e volontà su due dispositivi:
 * Rosa nomina Anna (fiducia) e Giulia (destinataria senza e-mail), Anna accetta dal link dell'e-mail,
 * Rosa assegna una voce a entrambe e l'app prepara i pacchetti.
 *
 * Prerequisiti: server su :3000 (sviluppo, con MAIL_OUTBOX) e app su :5173.
 * Uso: MAIL_OUTBOX=packages/server/data/posta.log node e2e/persone.mjs [cartella-screenshot]
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'e2e-screenshot';
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUTBOX = process.env.MAIL_OUTBOX ?? 'packages/server/data/posta.log';
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const step = (msg) => console.log(`• ${msg}`);

async function device(name) {
  const context = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
  });
  return { page, shot: (n) => page.screenshot({ path: join(OUT, `persone-${name}-${n}.png`), fullPage: true }) };
}

async function creaCassaforte(page, nome, email) {
  await page.getByRole('button', { name: 'Crea la tua cassaforte' }).click();
  await page.getByLabel('Nome e cognome').fill(nome);
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Continua' }).click();
  await page.getByLabel('Ho stampato o scritto il codice').check();
  await page.getByRole('button', { name: 'Vai alla cassaforte' }).click();
  await page.getByRole('heading', { name: /La cassaforte di/ }).waitFor();
}

const t = Date.now();
const emailRosa = `rosa+${t}@example.ch`;
const emailAnna = `anna+${t}@example.ch`;

// --- Rosa: cassaforte, una voce, due persone -------------------------------
const R = await device('rosa');
await R.page.goto(BASE);
await creaCassaforte(R.page, 'Rosa Bianchi', emailRosa);
await R.page.getByRole('button', { name: 'Aggiungi una voce' }).click();
await R.page.getByRole('button', { name: /^Cartella/ }).click();
await R.page.getByLabel('Titolo').fill('Foto di famiglia 1990–2025');
await R.page.getByRole('button', { name: 'Salva nella cassaforte' }).click();
await R.page.getByRole('button', { name: /Foto di famiglia/ }).waitFor();

await R.page.getByRole('tab', { name: 'Persone' }).click();
await R.page.getByRole('button', { name: 'Aggiungi una persona' }).click();
await R.page.getByRole('radio', { name: /^Persona di fiducia/ }).check();
await R.page.getByLabel('Nome', { exact: true }).fill('Anna Verdi');
await R.page.getByRole('textbox', { name: 'E-mail' }).fill(emailAnna);
await R.shot('01-nuova-persona');
await R.page.getByRole('button', { name: 'Salva' }).click();
await R.page.getByText('Invito inviato').waitFor();

await R.page.getByRole('button', { name: 'Aggiungi una persona' }).click();
await R.page.getByRole('radio', { name: /^Destinatario/ }).check();
await R.page.getByLabel('Nome', { exact: true }).fill('Giulia (nipote)');
await R.page.getByRole('button', { name: 'Salva' }).click();
await R.page.getByText('Giulia (nipote)').waitFor();
await R.page.getByText('Finché nessuna persona di fiducia accetta').waitFor();
await R.shot('02-persone-in-attesa');
step('Rosa: Anna invitata, Giulia aggiunta senza e-mail');

// --- Anna: apre l'invito, crea la sua cassaforte, accetta ------------------
const mail = readFileSync(OUTBOX, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).reverse().find((m) => m.to === emailAnna);
const link = mail.text.match(/https?:\/\/\S+\?invito=[A-Za-z0-9_-]{43}/)[0];
step(`invito letto dalla posta di sviluppo: ${mail.subject}`);
const A = await device('anna');
await A.page.goto(link);
await A.page.getByRole('heading', { name: 'Rosa Bianchi ti ha scelto' }).waitFor();
await A.shot('01-invito');
await creaCassaforte(A.page, 'Anna Verdi', emailAnna);
await A.page.getByRole('button', { name: 'Accetta' }).click();
await A.page.getByText('Hai accettato').waitFor();
await A.page.getByText('Sei persona di fiducia o destinatario per: Rosa Bianchi').waitFor();
await A.shot('02-accettato');
step('Anna: invito accettato');

// --- Rosa: riapre, vede l'accettazione, assegna la voce --------------------
await R.page.reload();
await R.page.getByRole('button', { name: 'Accedi con la passkey' }).click();
await R.page.getByRole('heading', { name: /La cassaforte di Rosa/ }).waitFor();
await R.page.getByRole('tab', { name: 'Persone' }).click();
await R.page.getByText('Ha accettato').waitFor();
await R.page.getByText('Tutto pronto').waitFor();
await R.shot('03-persone-pronto');
step('Rosa: rilascio impostato con Anna');

await R.page.getByRole('tab', { name: 'Voci' }).click();
await R.page.getByRole('button', { name: /Foto di famiglia/ }).click();
await R.page.getByLabel('Giulia (nipote)').check();
await R.page.getByLabel('Anna Verdi').check();
await R.page.getByRole('button', { name: 'Salva le volontà' }).click();
await R.page.getByText('Volontà salvate.').waitFor();
await R.shot('04-volonta');
await R.page.getByRole('button', { name: "Torna all'elenco" }).click();
await R.page.getByText('Per: Anna Verdi, Giulia (nipote)').waitFor();
await R.page.getByRole('tab', { name: 'Persone' }).click();
const esito = await R.page.locator('.esito').first().textContent();
await R.shot('05-pacchetti');
step(`Rosa: ${esito.trim()}`);

await browser.close();
console.log('Persone e volontà: prova superata');
