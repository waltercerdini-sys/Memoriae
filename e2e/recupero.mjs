/**
 * Prova del recupero dell'accesso: la cassaforte creata sul "dispositivo A" viene recuperata
 * sul "dispositivo B" con il codice e-mail e il codice di recupero stampato; poi il dispositivo A non entra più.
 *
 * Prerequisiti: server su :3000 (in sviluppo, con MAIL_OUTBOX) e app su :5173.
 * Uso: MAIL_OUTBOX=packages/server/data/posta.log node e2e/recupero.mjs [cartella-screenshot]
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
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
  });
  const shot = (n) => page.screenshot({ path: join(OUT, `recupero-${name}-${n}.png`), fullPage: true });
  return { context, page, shot };
}

const email = `walter+${Date.now()}@example.ch`;

// --- Dispositivo A: crea la cassaforte e una voce ---------------------------
const A = await device('A');
await A.page.goto(BASE);
await A.page.getByRole('button', { name: 'Crea la tua cassaforte' }).click();
await A.page.getByLabel('Nome e cognome').fill('Walter Prova');
await A.page.getByLabel('E-mail').fill(email);
await A.page.getByRole('button', { name: 'Continua' }).click();
const codiceStampato = (await A.page.getByLabel('Codice di recupero').textContent()).trim();
await A.page.getByLabel('Ho stampato o scritto il codice').check();
await A.page.getByRole('button', { name: 'Vai alla cassaforte' }).click();
await A.page.getByRole('button', { name: 'Aggiungi una voce' }).click();
await A.page.getByRole('button', { name: /^Istruzione/ }).click();
await A.page.getByLabel('Titolo').fill('Chiavi della cassetta di sicurezza');
await A.page.getByLabel('Note per chi resta').fill('Sono nel cassetto della scrivania, a sinistra.');
await A.page.getByRole('button', { name: 'Salva nella cassaforte' }).click();
await A.page.getByRole('button', { name: /Chiavi della cassetta/ }).waitFor();
step('dispositivo A: cassaforte con una voce');

// --- Dispositivo B: recupero ------------------------------------------------
const B = await device('B');
await B.page.goto(BASE);
await B.page.getByRole('button', { name: 'Ho già una cassaforte' }).click();
await B.page.getByRole('button', { name: 'Ho perso la passkey o ho cambiato dispositivo' }).click();
await B.shot('01-email');
await B.page.getByLabel('E-mail dell\'account').fill(email);
await B.page.getByRole('button', { name: 'Mandami il codice' }).click();
await B.page.getByRole('heading', { name: 'Controlla la tua e-mail' }).waitFor();

const mail = readFileSync(OUTBOX, 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l))
  .reverse()
  .find((m) => m.to === email && /codice è \d{6}/.test(m.text));
const codiceEmail = mail.text.match(/codice è (\d{6})/)[1];
step(`codice e-mail letto dalla posta di sviluppo: ${codiceEmail}`);
await B.page.getByLabel('Codice ricevuto').fill(codiceEmail);
await B.shot('02-codice-email');
await B.page.getByRole('button', { name: 'Continua' }).click();

await B.page.getByRole('heading', { name: 'Il tuo codice di recupero' }).waitFor();
// Ricopiato "come capita": minuscolo e con spazi al posto dei trattini.
await B.page.getByLabel('Codice di recupero').fill(codiceStampato.toLowerCase().replace(/-/g, ' '));
await B.shot('03-codice-stampato');
await B.page.getByRole('button', { name: 'Apri la cassaforte' }).click();
await B.page.getByRole('heading', { name: 'Crea una nuova passkey' }).waitFor();
await B.shot('04-nuova-passkey');
await B.page.getByRole('button', { name: 'Crea la passkey' }).click();
await B.page.getByRole('button', { name: /Chiavi della cassetta/ }).waitFor();
await B.shot('05-cassaforte-recuperata');
step('dispositivo B: cassaforte recuperata con la voce intatta');

// Il dispositivo B riapre la cassaforte da solo dopo un ricaricamento.
await B.page.reload();
await B.page.getByRole('button', { name: 'Accedi con la passkey' }).click();
await B.page.getByRole('button', { name: /Chiavi della cassetta/ }).waitFor();
step('dispositivo B: riapertura con la nuova passkey');

// --- Dispositivo A non entra più ---------------------------------------------
await A.page.reload();
await A.page.getByRole('heading', { name: 'Benvenuto' }).or(A.page.getByRole('heading', { name: 'La tua vita digitale, in ordine' })).waitFor();
await A.page.getByRole('button', { name: 'Ho già una cassaforte' }).click();
await A.page.getByRole('button', { name: 'Accedi con la passkey' }).click();
await A.page.getByRole('alert').waitFor();
const msg = await A.page.getByRole('alert').textContent();
if (!/non riconosciuta|non riuscito/i.test(msg)) throw new Error(`Il dispositivo A doveva essere respinto, messaggio: ${msg}`);
await A.shot('06-vecchio-dispositivo-respinto');
step(`dispositivo A respinto: «${msg.trim()}»`);

await browser.close();
console.log('Recupero completo superato');
