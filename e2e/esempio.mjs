/**
 * Prova di «Riempi con un esempio» (solo in anteprima): una cassaforte vuota si riempie
 * con voci, due persone senza e-mail e una lettera.
 * Prerequisiti: npm run prova. Uso: node e2e/esempio.mjs [cartella-screenshot]
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

await page.goto(BASE);
await page.getByRole('button', { name: 'Crea la tua cassaforte' }).click();
await page.getByLabel('Nome e cognome').fill('Carla Prova');
await page.getByLabel('E-mail').fill(`carla+${Date.now()}@example.ch`);
await page.getByRole('button', { name: 'Continua' }).click();
await page.getByLabel('Ho stampato o scritto il codice').check();
await page.getByRole('button', { name: 'Vai alla cassaforte' }).click();
await page.getByRole('button', { name: 'Riempi con un esempio' }).click();
await page.getByRole('button', { name: /Conto privato PostFinance/ }).waitFor();
await page.getByRole('button', { name: /Abbonamento mobile Swisscom/ }).waitFor();
await page.screenshot({ path: join(OUT, 'esempio-01-voci.png'), fullPage: true });
await page.getByRole('tab', { name: 'Persone' }).click();
await page.getByText('Giulia (figlia, esempio)').first().waitFor();
await page.getByRole('tab', { name: 'Ricordi' }).click();
await page.getByText('Per Giulia').first().waitFor();
await browser.close();
console.log('Esempio: prova superata');
