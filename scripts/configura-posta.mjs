/**
 * Attiva l'invio vero delle e-mail anche nelle prove:  npm run posta
 *
 * Chiede la casella da cui spedire (Infomaniak, Gmail o altro), prova a inviare un'e-mail
 * a quella stessa casella e, se va bene, salva le impostazioni nel file .env della cartella.
 * Il file .env resta solo sul tuo computer: non finisce su GitHub.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const require = createRequire(join(root, 'packages', 'server', 'package.json'));
let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch {
  console.error('Manca un componente: esegui prima  npm install  e poi di nuovo  npm run posta');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const righeInput = rl[Symbol.asyncIterator]();
let nascosto = false;
const scriviOriginale = rl._writeToOutput?.bind(rl);
if (scriviOriginale) rl._writeToOutput = (s) => scriviOriginale(nascosto ? '' : s);
async function chiedi(q) {
  process.stdout.write(q);
  const { value } = await righeInput.next();
  return (value ?? '').trim();
}
async function chiediNascosto(q) {
  process.stdout.write(q);
  nascosto = true;
  const { value } = await righeInput.next();
  nascosto = false;
  process.stdout.write('\n');
  return value ?? '';
}

console.log('\nInvio vero delle e-mail di MEMORIAE (inviti, promemoria, codici)\n');
console.log('Da quale casella vuoi spedire?');
console.log('  1) Infomaniak (consigliato: è dove andrà MEMORIAE)');
console.log('  2) Gmail (serve una «password per le app», non quella normale)');
console.log('  3) Altro servizio');
const scelta = (await chiedi('Scrivi 1, 2 o 3 e premi Invio: ')) || '1';
let host = 'mail.infomaniak.com';
let port = 465;
if (scelta === '2') host = 'smtp.gmail.com';
if (scelta === '3') {
  host = await chiedi('Server SMTP (es. smtp.esempio.ch): ');
  port = Number((await chiedi('Porta (Invio = 465): ')) || 465);
}
const user = await chiedi('Indirizzo e-mail della casella: ');
const password = await chiediNascosto('Password della casella (non si vede mentre scrivi): ');
rl.close();

if (!user.includes('@') || !password || !host) {
  console.error('\nDati incompleti: riprova con  npm run posta');
  process.exit(1);
}

console.log(`\nProvo a spedire un'e-mail di prova a ${user}…`);
const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass: password }, connectionTimeout: 15000 });
try {
  await transport.sendMail({
    from: `MEMORIAE <${user}>`,
    to: user,
    subject: 'MEMORIAE – prova di invio riuscita',
    text: 'Se leggi questo messaggio, MEMORIAE può spedire inviti, promemoria e codici anche durante le prove.',
  });
} catch (e) {
  console.error(`\nL'invio non è riuscito: ${e.message}`);
  if (scelta === '2') console.error('Con Gmail serve una «password per le app»: myaccount.google.com › Sicurezza › Password per le app.');
  else console.error('Controlla indirizzo e password (con Infomaniak: la password della casella e-mail, non quella dell\'account Infomaniak).');
  process.exit(1);
}

// Salva nel file .env, sostituendo eventuali impostazioni precedenti.
const valori = { SMTP_HOST: host, SMTP_PORT: String(port), SMTP_USER: user, SMTP_PASSWORD: password, MAIL_FROM: `MEMORIAE <${user}>` };
const righe = existsSync(envPath) ? readFileSync(envPath, 'utf8').split('\n').filter((r) => !/^(SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASSWORD|MAIL_FROM)=/.test(r)) : [];
while (righe.length && righe.at(-1) === '') righe.pop();
// Tra apici singoli il valore resta com'è (anche con caratteri speciali nella password).
const q = (v) => {
  for (const apice of ["'", '"', '`']) if (!v.includes(apice)) return `${apice}${v}${apice}`;
  console.error('La password contiene tutti e tre i tipi di apici: scegline una diversa.');
  process.exit(1);
};
righe.push('', '# Invio vero delle e-mail (impostato con npm run posta)', ...Object.entries(valori).map(([k, v]) => `${k}=${q(v)}`), '');
writeFileSync(envPath, righe.join('\n'), { mode: 0o600 });

console.log(`\n✅ Fatto. Ti è arrivata un'e-mail di prova in ${user}.`);
console.log('Da ora, con  npm run prova, inviti e promemoria partono davvero (e restano anche nel terminale).');
console.log('Per tornare alle sole e-mail nel terminale: cancella dal file .env le righe che iniziano con SMTP_.\n');
