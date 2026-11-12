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
import { createServer } from 'node:net';
const libera = (porta) =>
  new Promise((ok) => {
    const srv = createServer().once('error', () => ok(false)).once('listening', () => srv.close(() => ok(true)));
    srv.listen(porta, 'localhost');
  });
const occupate = [];
for (const porta of [3000, 5173]) if (!(await libera(porta))) occupate.push(porta);
if (occupate.length) {
  console.log(`\nMEMORIAE sembra già aperta (porte occupate: ${occupate.join(', ')}).`);
  console.log('- Se hai un\'altra finestra del Terminale con MEMORIAE, usa quella (http://localhost:5173) oppure fermala con Ctrl+C.');
  console.log('- Se non la trovi, chiudi i programmi rimasti aperti con questo comando e poi riprova:');
  console.log('    lsof -t -i :3000 -i :5173 | xargs kill\n');
  process.exit(1);
}

console.log('Avvio MEMORIAE (server e app)… il primo avvio può richiedere qualche secondo.');
avvia('server', ['run', 'start', '-w', '@memoriae/server']);
avvia('app', ['run', 'dev', '-w', '@memoriae/web']);

// Quando entrambi rispondono, apre il browser.
const url = 'http://localhost:5173';
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    const ok = (await fetch('http://localhost:3000/health')).ok && (await fetch(url)).ok;
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
