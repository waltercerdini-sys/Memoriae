/**
 * Prova del piano: prova gratuita, scelta del piano, pagina di pagamento (simulata), piano attivo.
 * Prerequisiti: npm run prova (pagamenti di prova). Uso: node e2e/piano.mjs [cartella-screenshot]
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
const shot = (n) => page.screenshot({ path: join(OUT, `piano-${n}.png`), fullPage: true });
const step = (msg) => console.log(`• ${msg}`);

await page.goto(BASE);
await page.getByRole('button', { name: 'Crea la tua cassaforte' }).click();
await page.getByLabel('Nome e cognome').fill('Lina Ferri');
await page.getByLabel('E-mail').fill(`lina+${Date.now()}@example.ch`);
await page.getByRole('button', { name: 'Continua' }).click();
await page.getByLabel('Ho stampato o scritto il codice').check();
await page.getByRole('button', { name: 'Vai alla cassaforte' }).click();
await page.getByText(/Prova gratuita: ancora (29|30) giorni/).waitFor();
await shot('01-prova');
step('prova gratuita di 30 giorni');

await page.getByRole('button', { name: 'Scegli un piano' }).click();
await page.getByRole('heading', { name: "Essenziale – CHF 59 all'anno" }).waitFor();
await page.getByRole('heading', { name: "Famiglia – CHF 99 all'anno" }).waitFor();
await shot('02-piani');
await page.getByRole('button', { name: 'Paga con TWINT o carta' }).first().click();
await page.getByRole('heading', { name: /Essenziale: CHF 59/ }).waitFor();
await shot('03-pagina-prova');
await page.getByRole('button', { name: 'Paga con TWINT (prova)' }).click();
await page.getByText('Grazie! Il pagamento è andato a buon fine').waitFor();
step('pagamento di prova completato');

await page.getByRole('button', { name: 'Accedi con la passkey' }).click();
await page.getByText('Piano Essenziale attivo.').waitFor();
await page.getByRole('button', { name: 'Il tuo piano' }).click();
await page.getByText(/pagato fino al/).waitFor();
await shot('04-attivo');
step('piano attivo per un anno');

await browser.close();
console.log('Piano: prova superata');
