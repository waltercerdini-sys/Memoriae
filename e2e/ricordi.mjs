/**
 * Prova dell'Intervista dei ricordi: risposta a voce (microfono simulato) e scritta, ascolto, promemoria.
 * Prerequisiti: npm run prova. Uso: node e2e/ricordi.mjs [cartella-screenshot]
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'e2e-screenshot';
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const context = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2, permissions: ['microphone'] });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
});
const shot = (n) => page.screenshot({ path: join(OUT, `ricordi-${n}.png`), fullPage: true });
const step = (m) => console.log(`• ${m}`);

await page.goto(BASE);
await page.getByRole('button', { name: 'Crea la tua cassaforte' }).click();
await page.getByLabel('Nome e cognome').fill('Ida Rossi');
await page.getByLabel('E-mail').fill(`ida+${Date.now()}@example.ch`);
await page.getByRole('button', { name: 'Continua' }).click();
await page.getByLabel('Ho stampato o scritto il codice').check();
await page.getByRole('button', { name: 'Vai alla cassaforte' }).click();
await page.getByText(/pronta al 10%/).waitFor();

await page.getByRole('tab', { name: 'Persone' }).click();
await page.getByRole('button', { name: 'Aggiungi una persona' }).click();
await page.getByRole('radio', { name: /^Destinatario/ }).check();
await page.getByLabel('Nome', { exact: true }).fill('Luca (nipote)');
await page.getByRole('button', { name: 'Salva' }).click();
await page.getByText('Luca (nipote)').first().waitFor();
await page.getByRole('tab', { name: 'Voci' }).click();

await page.getByRole('button', { name: /Il libro dei ricordi/ }).click();
await page.getByRole('heading', { name: 'Il libro dei ricordi', level: 1 }).waitFor();
await page.getByText('Scegli almeno una persona').waitFor();
await page.getByRole('checkbox', { name: 'Luca (nipote)' }).check();
await page.getByText('Per Luca (nipote)').waitFor();
const prima = await page.locator('.domanda-settimana .domanda').innerText();
step(`domanda: ${prima}`);

// Risposta a voce: 2 secondi di microfono simulato.
await page.getByRole('button', { name: '● Rispondi a voce' }).click();
await page.getByText(/Sto registrando/).waitFor();
await page.waitForTimeout(2200);
await shot('01-registrazione');
await page.getByRole('button', { name: '■ Ho finito' }).click();
await page.locator('.registratore audio').waitFor();
await page.getByRole('button', { name: 'Salva nel libro' }).click();
await page.getByText('Salvato nel libro dei ricordi').waitFor();
await page.locator('.elenco-ricordi li', { hasText: prima }).waitFor();
step('risposta a voce cifrata e salvata');

// Ascolto: il file si decifra nel browser.
await page.locator('.elenco-ricordi li', { hasText: prima }).getByRole('button', { name: '▶ Ascolta' }).click();
await page.locator('.elenco-ricordi li audio').waitFor();
const durata = await page.locator('.elenco-ricordi li audio').evaluate((a) => new Promise((ok) => (a.readyState >= 1 ? ok(a.duration) : a.addEventListener('loadedmetadata', () => ok(a.duration)))));
if (!(durata > 0.5)) throw new Error(`Registrazione vuota (${durata})`);
step(`ascolto della risposta: ${Number(durata).toFixed(1)} s`);

// La domanda successiva è un'altra; «Un'altra domanda» la salta; risposta scritta.
const seconda = await page.locator('.domanda-settimana .domanda').innerText();
if (seconda === prima) throw new Error('La domanda non è cambiata dopo la risposta');
await page.getByRole('button', { name: "Un'altra domanda" }).click();
const terza = await page.locator('.domanda-settimana .domanda').innerText();
if (terza === seconda) throw new Error('«Un\'altra domanda» non ha cambiato domanda');
await page.getByRole('button', { name: 'Preferisco scrivere' }).click();
await page.getByLabel('La tua risposta').fill('Giocavamo a nascondino nel fienile dei nonni, fino a sera.');
await page.getByRole('button', { name: 'Salva nel libro' }).click();
await page.locator('.elenco-ricordi li', { hasText: 'fienile' }).waitFor();
step('domanda saltata e risposta scritta');

// Promemoria settimanale.
await page.getByLabel(/Mandami un promemoria ogni settimana/).check();
await page.reload();
await page.getByRole('button', { name: 'Accedi con la passkey' }).click();
await page.getByRole('button', { name: /Il libro dei ricordi/ }).waitFor();
await page.getByRole('button', { name: /Il libro dei ricordi/ }).click();
await page.getByRole('checkbox', { name: /Mandami un promemoria ogni settimana/, checked: true }).waitFor({ timeout: 10000 });
await shot('02-libro');
step('promemoria settimanale salvato');

// Le risposte non compaiono nell'elenco delle voci né nella percentuale.
await page.getByRole('button', { name: "‹ Torna all'elenco" }).click();
await page.getByText('2 risposte').waitFor();
if (await page.locator('ul.voci li').count()) throw new Error('Le risposte compaiono nell\'elenco delle voci');
step('le risposte stanno nel libro, non nell\'elenco');

await browser.close();
console.log('Intervista dei ricordi: prova superata');
