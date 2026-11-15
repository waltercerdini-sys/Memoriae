/**
 * Prova della Carta MEMORIAE: ordine con indirizzo, preparazione e spedizione (Operatore),
 * attivazione, lettura da parte di chi la trova, avviso, disattivazione. Senza carta vera:
 * in prova l'Operatore genera il collegamento che scriverebbe il chip.
 * Prerequisiti: npm run prova. Uso: node e2e/carta.mjs [cartella-screenshot]
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
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
await page.getByRole('button', { name: '💳 Carta MEMORIAE' }).click();
await page.getByRole('heading', { name: 'Carta MEMORIAE', level: 1 }).waitFor();
await page.getByText('La carta non apre la tua cassaforte.').waitFor();
await page.getByLabel(/È un regalo/).check();
await shot(page, '01-ordina');
await page.getByRole('button', { name: 'Ordina e paga' }).click();
await page.getByRole('heading', { name: 'Carta MEMORIAE: CHF 25.–' }).waitFor();
await page.getByLabel('Nome e cognome').fill('Giulia Bianchi');
await page.getByLabel('Via e numero').fill('Via Lunga 1');
await page.getByLabel('NPA').fill('6822');
await page.getByLabel('Località').fill('Arogno');
await shot(page, '02-indirizzo');
await page.getByRole('button', { name: 'Paga con TWINT (prova)' }).click();
await page.getByText('Abbiamo ricevuto l\'ordine della Carta MEMORIAE').waitFor();
await accedi();
step('ordine pagato con l\'indirizzo di spedizione');

// Operatore: chiavi, abbinamento, spedizione.
await page.getByRole('tab', { name: 'Operatore' }).click();
await page.getByRole('heading', { name: 'Carte da spedire (1)' }).waitFor();
await page.locator('.ordine-carte').getByText('Giulia Bianchi').waitFor();
await page.getByLabel('UID della carta').fill(UID.toLowerCase());
await page.getByRole('button', { name: 'Chiavi' }).click();
await page.getByText(`Da scrivere nella carta ${UID}`).waitFor();
await shot(page, '03-operatore');
await page.getByRole('button', { name: "Abbina all'ordine" }).click();
await page.getByLabel('Numero di spedizione (facoltativo)').fill('99.00.123456.78901234');
await page.getByRole('button', { name: 'Spedito' }).click();
await page.getByRole('heading', { name: 'Carte da spedire (0)' }).waitFor();
step('carta abbinata all\'ordine e spedita');

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
await shot(p2, '04-attivata');
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
await shot(s, '05-trovata');
await s.getByRole('button', { name: 'Avvisa le persone di fiducia' }).click();
await s.getByText(/Grazie!/).waitFor();
await shot(s, '06-avvisato');
step('chi la trova vede «Rosa B.» e manda l\'avviso');

// Carta persa: disattivata.
await page.getByRole('button', { name: '‹ Torna alle voci' }).click();
await page.getByRole('button', { name: '💳 Carta MEMORIAE' }).click();
await page.getByText('Attiva', { exact: true }).waitFor();
await page.getByRole('button', { name: "L'ho persa: disattiva" }).click();
await page.getByRole('button', { name: 'Sì, disattiva' }).click();
await page.getByText('Disattivata', { exact: true }).waitFor();
await page.getByRole('button', { name: "‹ Torna all'elenco" }).click();
await page.getByRole('tab', { name: 'Operatore' }).click();
await s.goto(await nuovoTocco());
await s.getByRole('heading', { name: 'Carta disattivata' }).waitFor();
step('carta disattivata dalla proprietaria');

await browser.close();
console.log('Carta MEMORIAE: prova superata');
