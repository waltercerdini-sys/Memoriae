/**
 * Avvia MEMORIAE sul proprio computer per provarla, con un solo comando:  npm run prova
 *
 * Non serve installare Postgres: il database è una cartella (data/db) gestita da PGlite.
 * Le e-mail non vengono spedite: compaiono qui nel terminale.
 * Per fermare tutto: Ctrl+C.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(root, 'data');
mkdirSync(data, { recursive: true });

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  console.error(`Serve Node.js 20 o più recente (hai la ${process.versions.node}). Scaricalo da https://nodejs.org`);
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: `pglite:${join(data, 'db')}`,
  BLOB_DIR: join(data, 'file'),
  MAIL_OUTBOX: join(data, 'posta.log'),
  CUSTODY_KEY_FILE: join(data, 'custodia.key'),
  LOG_LEVEL: 'warn',
  HOST: 'localhost',
  // Prove: l'attesa dopo la verifica dura 2 minuti invece di 14 giorni / 72 ore,
  // e i lavori periodici (promemoria, rilasci) girano ogni 15 secondi.
  ATTESA_PROVA_SECONDI: process.env.ATTESA_PROVA_SECONDI ?? '120',
  JOBS_INTERVAL_SECONDS: process.env.JOBS_INTERVAL_SECONDS ?? '15',
};

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Dopo aver scaricato una versione nuova serve `npm install`: se manca, lo facciamo noi.
const lock = join(root, 'package-lock.json');
const stamp = join(root, 'node_modules', '.memoriae-installato');
const impronta = existsSync(lock) ? createHash('sha256').update(readFileSync(lock)).digest('hex') : '';
const bin = (n) => join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${n}.cmd` : n);
const installato = existsSync(bin('tsx')) && existsSync(bin('vite')) && existsSync(stamp) && readFileSync(stamp, 'utf8') === impronta;
if (!installato) {
  console.log('Preparo gli strumenti (npm install): la prima volta può richiedere un paio di minuti…\n');
  const r = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0 || !existsSync(bin('tsx')) || !existsSync(bin('vite'))) {
    console.error('\nL\'installazione non è riuscita. Copia le righe qui sopra e mandale a Claude.');
    process.exit(1);
  }
  writeFileSync(stamp, impronta);
}
const figli = [];
function avvia(nome, args) {
  const p = spawn(npm, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  const scrivi = (buf) => {
    for (const riga of buf.toString().split('\n')) if (riga.trim()) console.log(`[${nome}] ${riga}`);
  };
  p.stdout.on('data', scrivi);
  p.stderr.on('data', scrivi);
  p.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`\n[${nome}] si è fermato con un errore (codice ${code}). Copia le righe qui sopra e mandale a Claude.`);
      ferma(code);
    }
  });
  figli.push(p);
}

function ferma(code = 0) {
  for (const p of figli) {
    try {
      // Ferma anche i processi avviati da npm (gruppo intero).
      if (process.platform !== 'win32' && p.pid) process.kill(-p.pid, 'SIGTERM');
      else p.kill('SIGTERM');
    } catch {
      // già fermo
    }
  }
  process.exit(code);
}
for (const segnale of ['SIGINT', 'SIGTERM']) {
  process.on(segnale, () => {
    console.log('\nFermo MEMORIAE…');
    ferma(0);
  });
}

// Se MEMORIAE è già aperta (per esempio in un'altra finestra del Terminale), le porte sono occupate.
import { connect, createServer } from 'node:net';
// Sul Mac «localhost» può essere sia 127.0.0.1 sia ::1: si controllano entrambi, e si prova anche a collegarsi.
const prova = (porta, host) =>
  new Promise((ok) => {
    const srv = createServer().once('error', (e) => ok(e.code !== 'EADDRINUSE')).once('listening', () => srv.close(() => ok(true)));
    srv.listen(porta, host);
  });
const risponde = (porta, host) =>
  new Promise((ok) => {
    const c = connect({ port: porta, host }).once('connect', () => { c.destroy(); ok(true); }).once('error', () => ok(false));
    c.setTimeout(800, () => { c.destroy(); ok(false); });
  });
const libera = async (porta) =>
  (await prova(porta, '127.0.0.1')) && (await prova(porta, '::1')) && !(await risponde(porta, '127.0.0.1')) && !(await risponde(porta, '::1'));
/** Risponde MEMORIAE su quella porta? (server: /health; app: la pagina con il titolo MEMORIAE) */
async function eMemoriae(porta, tipo) {
  try {
    const r = await fetch(`http://localhost:${porta}${tipo === 'server' ? '/health' : '/'}`, { signal: AbortSignal.timeout(1500) });
    const t = await r.text();
    return tipo === 'server' ? t.includes('"stato"') : t.includes('<title>MEMORIAE</title>');
  } catch {
    return false;
  }
}
async function scegliPorta(preferita, riserva) {
  if (await libera(preferita)) return preferita;
  for (const p of riserva) if (await libera(p)) return p;
  return null;
}

const intervallo = (da, n) => Array.from({ length: n }, (_, i) => da + i);

// MEMORIAE è già aperta in un'altra finestra? Allora basta usare quella.
for (const porta of [5173, ...intervallo(5180, 20)]) {
  if (!(await libera(porta)) && (await eMemoriae(porta, 'app'))) {
    console.log(`\nMEMORIAE è già aperta in un'altra finestra del Terminale: http://localhost:${porta}`);
    console.log('Per fermarla: in quella finestra premi Ctrl+C. Se non la trovi, riavvia il computer.\n');
    if (process.platform === 'darwin') spawn('open', [`http://localhost:${porta}`]);
    process.exit(0);
  }
}

// Un altro programma del computer può usare le porte di MEMORIAE: in quel caso se ne scelgono altre, da sole.
const portaServer = await scegliPorta(3000, intervallo(3100, 20));
const portaApp = await scegliPorta(5173, intervallo(5180, 20));
if (!portaServer || !portaApp) {
  console.log('\nNon trovo porte libere per avviare MEMORIAE. Riavvia il computer e riprova.\n');
  process.exit(1);
}
if (portaServer !== 3000 || portaApp !== 5173) {
  console.log(`(Le porte abituali sono occupate da un altro programma: uso ${portaServer} per il server e ${portaApp} per l'app.)`);
}
const url = `http://localhost:${portaApp}`;
Object.assign(env, {
  PORT: String(portaServer),
  WEBAUTHN_ORIGINS: url,
  APP_ORIGIN: url,
  MEMORIAE_SERVER_PORT: String(portaServer),
  MEMORIAE_WEB_PORT: String(portaApp),
});

console.log('Avvio MEMORIAE (server e app)… il primo avvio può richiedere qualche secondo.');
avvia('server', ['run', 'start', '-w', '@memoriae/server']);
avvia('app', ['run', 'dev', '-w', '@memoriae/web']);

// Quando entrambi rispondono, apre il browser.
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    const ok = (await fetch(`http://localhost:${portaServer}/health`)).ok && (await fetch(url)).ok;
    if (ok) {
      console.log(`\n✅ MEMORIAE è pronta: ${url}\n   Le e-mail di prova (codici, inviti) compariranno qui sotto.\n   In prova l'attesa prima di un'apertura dura ${env.ATTESA_PROVA_SECONDI} secondi.\n   Per fermare: Ctrl+C\n`);
      if (process.platform === 'darwin') spawn('open', [url]);
      break;
    }
  } catch {
    // non ancora pronti
  }
  if (i === 59) console.log('Il server non risponde ancora: guarda gli errori qui sopra.');
}
