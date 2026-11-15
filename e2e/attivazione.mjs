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

const posteDi = (to) => readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.to === to).length;
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
  await R.page.getByText('Salvato ✓').waitFor();
  await R.page.getByRole('button', { name: "Torna all'elenco", exact: true }).click();
}
await R.page.getByText('Per Marco Bianchi').first().waitFor();
// Due lettere per Marco: una da aprire subito, una nel 2040.
async function lettera(titolo, testo, giorno) {
  await R.page.getByRole('tab', { name: 'Ricordi' }).click();
  await R.page.getByRole('button', { name: '✉ Scrivi una lettera' }).click();
  await R.page.getByRole('checkbox', { name: 'Marco Bianchi' }).check();
  if (giorno) await R.page.getByLabel('Giorno', { exact: true }).fill(giorno);
  else await R.page.getByRole('radio', { name: /Appena possibile/ }).check();
  await R.page.getByLabel('Titolo').fill(titolo);
  await R.page.getByLabel('La lettera').fill(testo);
  await R.shot(`lettera-${giorno ? 'data' : 'subito'}`);
  await R.page.getByRole('button', { name: 'Chiudi la lettera nella cassaforte' }).click();
  await R.page.getByText('Lettera chiusa nella cassaforte').waitFor();
}
await lettera('Per Marco, adesso', 'Caro Marco,\n\nsono fiera di te.', null);
await lettera('Per i tuoi 40 anni', 'Caro Marco, oggi compi 40 anni.', '2040-05-12');
await R.page.getByText('Si apre il 12 maggio 2040').waitFor();
step('Rosa: due lettere per Marco, una per il 12 maggio 2040');

// Una lettera per due persone: Marco e Lucia, che non è tra le persone (solo l'indirizzo e-mail).
await R.page.getByRole('button', { name: '✉ Scrivi una lettera' }).click();
await R.page.getByRole('heading', { name: 'Lettera per il futuro' }).waitFor();
await R.page.getByRole('checkbox', { name: 'Marco Bianchi' }).check();
await R.page.getByLabel('Nome', { exact: true }).fill('Lucia');
await R.page.getByLabel('E-mail', { exact: true }).fill('lucia.prova@example.ch');
await R.page.getByRole('button', { name: 'Aggiungi un indirizzo e-mail' }).click();
await R.page.getByText('(lucia.prova@example.ch)').waitFor();
await R.page.getByRole('radio', { name: /Appena possibile/ }).check();
await R.page.getByLabel('Titolo').fill('Per voi due');
await R.page.getByLabel('La lettera').fill('Cari Marco e Lucia, volatevi bene.');
await R.shot('lettera-due-persone');
await R.page.getByRole('button', { name: 'Chiudi la lettera nella cassaforte (2 persone)' }).click();
await R.page.getByText('Lettera chiusa nella cassaforte').waitFor();
await R.page.locator('li', { hasText: 'Per voi due' }).getByText('Per Marco Bianchi e Lucia').waitFor();
if (posteDi('lucia.prova@example.ch') > 0) throw new Error('Lucia ha ricevuto un invito: la lettera doveva restare una sorpresa');
await R.page.getByRole('tab', { name: 'Persone' }).click();
await R.page.getByRole('heading', { name: 'Ricevono solo lettere' }).waitFor();
await R.page.getByRole('tab', { name: 'Ricordi' }).click();
step('Rosa: una lettera per Marco e per Lucia (solo e-mail, nessun invito)');

// Libro dei ricordi per Marco: una risposta scritta.
await R.page.getByRole('button', { name: /Il libro dei ricordi/ }).click();
await R.page.getByRole('checkbox', { name: 'Marco Bianchi' }).check();
await R.page.getByText('Per Marco Bianchi').waitFor();
await R.page.getByRole('button', { name: 'Preferisco scrivere' }).click();
await R.page.getByLabel('La tua risposta').fill('La casa di via Lunga, con il pergolato di glicine.');
await R.page.getByRole('button', { name: 'Salva nel libro' }).click();
await R.page.locator('.elenco-ricordi li', { hasText: 'glicine' }).waitFor();
await R.page.getByRole('button', { name: '‹ Indietro' }).click();
step('Rosa: una risposta nel libro dei ricordi per Marco');

// Prova generale: con gli occhi di Marco (scheda Persone).
await R.page.getByRole('tab', { name: 'Persone' }).click();
await R.page.getByRole('button', { name: /Guarda con gli occhi di/ }).click();
await R.page.getByRole('button', { name: /^Marco Bianchi/ }).click();
await R.page.getByRole('heading', { name: 'Con gli occhi di Marco' }).waitFor();
await R.page.getByText('Una lettera ti aspetta').waitFor();
await R.page.getByRole('heading', { name: 'Per voi due' }).waitFor();
if (await R.page.getByText('Foto per Anna').count()) throw new Error('Anteprima: Marco vede una voce non sua');
await R.shot('05-anteprima-marco');
await R.page.getByRole('button', { name: "‹ Scegli un'altra persona" }).click();
await R.page.getByRole('button', { name: '‹ Indietro' }).click();
step('Rosa: prova generale con gli occhi di Marco');

// Fascicolo per il notaio (scheda Protezione): si apre una pagina da stampare.
await R.page.getByRole('tab', { name: 'Protezione' }).click();
await R.page.getByRole('button', { name: /Fascicolo per il notaio/ }).click();
const [fascicolo] = await Promise.all([R.page.context().waitForEvent('page'), R.page.getByRole('button', { name: 'Prepara il fascicolo (PDF)' }).click()]);
await fascicolo.getByRole('heading', { name: 'Eredità digitale di Rosa Bianchi' }).waitFor();
await fascicolo.getByText('Non è un testamento e non lo sostituisce', { exact: false }).waitFor();
await fascicolo.screenshot({ path: join(OUT, 'attivazione-rosa-06-fascicolo.png'), fullPage: true });
await fascicolo.close();
await R.page.getByRole('button', { name: '‹ Indietro' }).click();
step('Rosa: fascicolo per il notaio pronto da stampare');
await R.page.getByRole('tab', { name: 'Protezione' }).click();
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

// I primi 30 giorni: spunte condivise e lettere pronte.
await A.page.getByRole('heading', { name: 'I primi 30 giorni' }).waitFor();
const passo = A.page.locator('.passi-primi-giorni li', { hasText: "Avvisare l'AVS" });
const [letteraAvs] = await Promise.all([A.page.context().waitForEvent('page'), passo.getByRole('button', { name: 'Prepara la lettera' }).click()]);
await letteraAvs.getByText('Oggetto: Comunicazione di decesso e richiesta di rendite per superstiti').waitFor();
await letteraAvs.getByText('Rosa Bianchi', { exact: false }).first().waitFor();
await letteraAvs.screenshot({ path: join(OUT, 'attivazione-anna-04-lettera-avs.png'), fullPage: true });
await letteraAvs.close();
await passo.getByRole('checkbox').check();
await passo.getByText(/Fatto \(Anna Verdi/).waitFor();
await A.shot('04-primi-giorni');
step('Anna: «I primi 30 giorni», lettera per l\'AVS pronta e passo segnato come fatto');

await rientra(M.page);
await M.page.getByRole('tab', { name: 'Per gli altri' }).click();
await M.page.getByRole('heading', { name: 'Hai ricevuto' }).waitFor();
await M.page.getByRole('button', { name: 'Apri', exact: true }).click();
await M.page.getByText('Lettera per Marco').waitFor();
await M.page.getByRole('heading', { name: 'Per Marco, adesso' }).waitFor();
await M.page.getByText('sono fiera di te.').waitFor();
await M.page.getByText('Una lettera ti aspetta').waitFor();
await M.page.getByText('Si aprirà il 12 maggio 2040').waitFor();
if (await M.page.getByText('oggi compi 40 anni').count()) throw new Error('Lettera aperta prima del giorno');
if (await M.page.getByText('Foto per Anna').count()) throw new Error('Marco vede una voce non sua');
await M.shot('01-ricevuto');
step('Marco: ha aperto la sua voce e la lettera «subito»; quella del 2040 resta chiusa');

// Le spunte sono condivise: Marco vede quello che ha fatto Anna, e segna la sua voce.
await M.page.locator('.passi-primi-giorni li', { hasText: "Avvisare l'AVS" }).getByText(/Fatto \(Anna Verdi/).waitFor();
await M.page.getByRole('heading', { name: 'Per voi due' }).waitFor();
const voceMarco = M.page.locator('li.voce', { hasText: 'Lettera per Marco' });
await voceMarco.getByRole('checkbox').check();
await M.page.getByText('Tutto sistemato. ✓').waitFor();
await M.shot('02-fatto');
step('Marco: vede il passo fatto da Anna, la lettera per due e segna la sua voce come sistemata');
await M.page.getByText('La casa di via Lunga, con il pergolato di glicine.').waitFor();
step('Marco: legge la risposta del libro dei ricordi');

await browser.close();
console.log('Attivazione: prova superata');
