/**
 * Prova dell'aiuto contestuale: si apre da solo alla prima visita di una pagina, una volta,
 * il pulsante «? Aiuto» lo riapre e i passi seguono la situazione.
 * Prerequisiti: npm run prova. Uso: node e2e/aiuto.mjs [cartella-screenshot]
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
// Nei test l'aiuto non si apre da solo: qui lo vogliamo, come per un utente vero.
await context.addInitScript(() => localStorage.setItem('memoriae-aiuto-auto', 'si'));
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
});
const shot = (n) => page.screenshot({ path: join(OUT, `aiuto-${n}.png`), fullPage: false });
const step = (msg) => console.log(`• ${msg}`);
const dialogo = page.getByRole('dialog');
const chiudi = () => dialogo.getByRole('button', { name: 'Ho capito' }).click();

await page.goto(BASE);
await dialogo.getByRole('heading', { name: 'Benvenuto in MEMORIAE' }).waitFor();
await shot('01-benvenuto');
await chiudi();
await dialogo.waitFor({ state: 'detached' });
step('alla prima visita si apre da solo');

await page.reload();
await page.getByRole('button', { name: 'Crea la tua cassaforte' }).waitFor();
if (await dialogo.count()) throw new Error("L'aiuto si è riaperto da solo");
await page.getByRole('button', { name: 'Aiuto' }).click();
await dialogo.getByText('Crea la tua cassaforte', { exact: false }).first().waitFor();
await page.keyboard.press('Escape');
await dialogo.waitFor({ state: 'detached' });
step('la seconda volta resta sul pulsante; Esc lo chiude');

await page.getByRole('button', { name: 'Crea la tua cassaforte' }).click();
await chiudi();
await page.getByLabel('Nome e cognome').fill('Elsa Moretti');
await page.getByLabel('E-mail').fill(`elsa+${Date.now()}@example.ch`);
await page.getByRole('button', { name: 'Continua' }).click();
await dialogo.getByRole('heading', { name: 'Il codice di recupero' }).waitFor();
await chiudi();
await page.getByLabel('Ho stampato o scritto il codice').check();
await page.getByRole('button', { name: 'Vai alla cassaforte' }).click();

// Cassaforte vuota: il primo passo è «Trova tutto».
await dialogo.getByRole('heading', { name: 'Le tue voci' }).waitFor();
await dialogo.getByText(/Tocca «Trova tutto»/).waitFor();
await shot('02-voci');
await chiudi();
step('cassaforte vuota: suggerisce «Trova tutto»');

await page.getByRole('tab', { name: 'Persone' }).click();
await dialogo.getByRole('heading', { name: 'Le persone' }).waitFor();
await dialogo.getByText('Tocca «Aggiungi una persona».').waitFor();
await chiudi();
await page.getByRole('tab', { name: 'Protezione' }).click();
await dialogo.getByRole('heading', { name: 'Protezione' }).waitFor();
await chiudi();
await page.getByRole('button', { name: /Carta MEMORIAE/ }).click();
await dialogo.getByRole('heading', { name: 'La Carta MEMORIAE' }).waitFor();
await dialogo.getByText(/Presso|presso/).first().waitFor();
await shot('03-carta');
await chiudi();
step('ogni scheda ha il suo aiuto');

await browser.close();
console.log('Aiuto contestuale: prova superata');
