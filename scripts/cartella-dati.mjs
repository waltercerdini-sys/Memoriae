/**
 * Dove restano i dati delle prove: FUORI dalla cartella del programma, così scaricare
 * una nuova versione non cancella cassaforte, documenti e impostazioni della posta.
 *
 * Di solito è la cartella «MEMORIAE-prova» nella cartella Inizio (su Mac: /Users/<nome>/MEMORIAE-prova).
 * Si può cambiare con la variabile MEMORIAE_DATI. Per ripartire da zero basta cancellarla.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const dati = process.env.MEMORIAE_DATI ?? join(homedir(), 'MEMORIAE-prova');
export const fileEnv = join(dati, '.env');

/** Crea la cartella dei dati e, la prima volta, vi sposta i dati rimasti nella cartella del programma. */
export function preparaCartellaDati() {
  const nuova = !existsSync(dati);
  mkdirSync(dati, { recursive: true });
  const spostati = [];
  if (nuova) {
    const vecchi = join(root, 'data');
    for (const nome of ['db', 'file', 'custodia.key']) {
      if (existsSync(join(vecchi, nome))) {
        cpSync(join(vecchi, nome), join(dati, nome), { recursive: true });
        spostati.push(nome);
      }
    }
    if (existsSync(join(root, '.env'))) {
      cpSync(join(root, '.env'), fileEnv);
      spostati.push('.env');
    }
  }
  return { nuova, spostati };
}
