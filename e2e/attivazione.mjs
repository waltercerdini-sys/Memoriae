/**
 * Prova dell'attivazione su quattro dispositivi:
 * Rosa prepara la cassaforte (Anna persona di fiducia, Marco destinatario);
 * Anna chiede un'apertura d'emergenza e Rosa la blocca dal collegamento nell'e-mail;
 * Anna chiede l'apertura per decesso, Oscar (operatore) verifica, l'attesa finisce,
 * Anna apre nel suo browser e il pacchetto di Marco parte; Marco lo apre con la sua chiave.
 *
 * Prerequisiti: ATTESA_PROVA_SECONDI=5 JOBS_INTERVAL_SECONDS=5 npm run prova
 * Uso: MAIL_OUTBOX=data/posta.log node e2e/attivazione.mjs [cartella-screenshot]
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'e2e-screenshot';
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUTBOX = process.env.MAIL_OUTBOX ?? 'data/posta.log';
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
  return { page, shot: (n) => page.screenshot({ path: join(OUT, `attivazione-${name}-${n}.png`), fullPage: true }) };
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

async function rientra(page) {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Accedi con la passkey' }).click();
  await page.getByRole('heading', { name: /La cassaforte di/ }).waitFor();
}

const posta = (to, re) => {
  const m = readFileSync(OUTBOX, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).reverse().find((x) => x.to === to && re.test(x.text));
  if (!m) throw new Error(`Nessuna e-mail per ${to}`);
  return m.text.match(re)[0];
};

async function invita(R, ruolo, nome, email, n) {
  await R.page.getByRole('tab', { name: 'Persone' }).click();
  await R.page.getByRole('button', { name: 'Aggiungi una persona' }).click();
  await R.page.getByRole('radio', { name: ruolo }).check();
  await R.page.getByLabel('Nome', { exact: true }).fill(nome);
  await R.page.getByRole('textbox', { name: 'E-mail' }).fill(email);
  await R.page.getByRole('button', { name: 'Salva' }).click();
  await R.page.getByText('Invito inviato').nth(n - 1).waitFor();
}

async function accetta(nome, email, tag) {
  const D = await device(tag);
  await D.page.goto(posta(email, /https?:\/\/\S+\?invito=[A-Za-z0-9_-]{43}/));
  await D.page.getByRole('heading', { name: 'Rosa Bianchi ti ha scelto' }).waitFor();
  await creaCassaforte(D.page, nome, email);
  await D.page.getByRole('button', { name: 'Accetta' }).click();
  await D.page.getByText('Hai accettato').waitFor();
  return D;
}

const t = Date.now();
const email = (n) => `${n}+${t}@example.ch`;

// --- Preparazione ------------------------------------------------------------
const R = await device('rosa');
await R.page.goto(BASE);
await creaCassaforte(R.page, 'Rosa Bianchi', email('rosa'));
for (const titolo of ['Lettera per Marco', 'Foto per Anna']) {
  await R.page.getByRole('tab', { name: 'Voci' }).click();
  await R.page.getByRole('button', { name: 'Aggiungi una voce' }).click();
  await R.page.getByRole('button', { name: /^Cartella/ }).click();
  await R.page.getByLabel('Titolo').fill(titolo);
  await R.page.getByRole('button', { name: 'Salva nella cassaforte' }).click();
  await R.page.getByRole('button', { name: new RegExp(titolo) }).waitFor();
}
await invita(R, /^Persona di fiducia/, 'Anna Verdi', email('anna'), 1);
await invita(R, /^Destinatario/, 'Marco Bianchi', email('marco'), 2);
const A = await accetta('Anna Verdi', email('anna'), 'anna');
const M = await accetta('Marco Bianchi', email('marco'), 'marco');

await rientra(R.page);
await R.page.getByRole('tab', { name: 'Persone' }).click();
await R.page.getByText('Tutto pronto').waitFor();
await R.page.getByRole('tab', { name: 'Voci' }).click();
for (const [titolo, chi] of [['Lettera per Marco', 'Marco Bianchi'], ['Foto per Anna', 'Anna Verdi']]) {
  await R.page.getByRole('button', { name: new RegExp(titolo) }).click();
  await R.page.getByLabel(chi).check();
  await R.page.getByRole('button', { name: 'Salva le volontà' }).click();
  await R.page.getByText('Volontà salvate.').waitFor();
  await R.page.getByRole('button', { name: "Torna all'elenco" }).click();
}
await R.page.getByText('Per: Marco Bianchi').waitFor();
await R.page.getByRole('tab', { name: 'Sono qui' }).click();
await R.page.getByRole('heading', { name: 'Controllo periodico' }).waitFor();
await R.shot('01-sono-qui');
step('Rosa: voci assegnate, controllo periodico visibile');

// --- Emergenza bloccata dal collegamento nell'e-mail ----------------------------
async function chiedi(ambito, motivo) {
  await rientra(A.page);
  await A.page.getByRole('tab', { name: 'Per gli altri' }).click();
  await A.page.getByRole('button', { name: "Chiedi l'apertura" }).click();
  await A.page.getByRole('radio', { name: ambito }).check();
  await A.page.getByLabel(/Spiega in poche righe/).fill(motivo);
  await A.shot(`richiesta-${ambito === /^Un'emergenza/ ? 'emergenza' : 'decesso'}`);
  await A.page.getByRole('button', { name: 'Invia la richiesta' }).click();
  await A.page.getByText('In attesa della verifica di un operatore MEMORIAE.').waitFor();
}
await chiedi(/^Un'emergenza/, 'Rosa non risponde al telefono da giorni.');
await A.shot('02-richiesta-inviata');
await R.page.goto(posta(email('rosa'), /https?:\/\/\S+\?blocca=[A-Za-z0-9_-]{43}/));
await R.page.getByRole('heading', { name: 'Anna Verdi ha chiesto di aprire la tua cassaforte' }).first().waitFor();
await R.shot('03-blocca');
await R.page.getByRole('button', { name: 'Sto bene: blocca la richiesta' }).first().click();
await R.page.getByRole('heading', { name: 'Richiesta bloccata' }).waitFor();
step('Rosa: emergenza bloccata con un clic dall\'e-mail');

// --- Decesso: verifica dell'operatore, attesa, apertura --------------------------
await chiedi(/è mancata/, 'Rosa è mancata il 3 novembre, ho il certificato.');
const O = await device('oscar');
await O.page.goto(BASE);
await creaCassaforte(O.page, 'Oscar Operatore', email('oscar'));
await O.page.getByRole('tab', { name: 'Operatore' }).click();
await O.page.getByRole('heading', { name: 'Da verificare (1)' }).waitFor();
await O.shot('01-da-verificare');
await O.page.getByRole('button', { name: 'Prendo in carico la verifica' }).click();
await O.page.getByRole('button', { name: /^Approva/ }).click();
await O.page.getByRole('heading', { name: 'Da verificare (0)' }).waitFor();
step('Oscar: richiesta verificata e approvata');

await rientra(R.page);
await R.page.getByText(/Periodo d'attesa fino al/).first().waitFor();
await R.shot('04-avviso-attesa');

await A.page.waitForTimeout(12_000); // attesa di prova (5 s) + giro dei lavori periodici
await rientra(A.page);
await A.page.getByRole('tab', { name: 'Per gli altri' }).click();
await A.page.getByRole('button', { name: 'Apri', exact: true }).click();
await A.page.getByText('Foto per Anna').waitFor();
await A.page.getByText('Pacchetti consegnati a: Marco Bianchi').waitFor();
await A.shot('03-aperta');
step('Anna: cassaforte aperta nel suo browser, pacchetto di Marco consegnato');

await rientra(M.page);
await M.page.getByRole('tab', { name: 'Per gli altri' }).click();
await M.page.getByRole('heading', { name: 'Hai ricevuto' }).waitFor();
await M.page.getByRole('button', { name: 'Apri', exact: true }).click();
await M.page.getByText('Lettera per Marco').waitFor();
if (await M.page.getByText('Foto per Anna').count()) throw new Error('Marco vede una voce non sua');
await M.shot('01-ricevuto');
step('Marco: ha aperto solo la sua voce');

await browser.close();
console.log('Attivazione: prova superata');
