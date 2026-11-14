import { readdirSync } from 'node:fs';
import { join, parse } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Sul Mac (e su Windows) i nomi dei file non distinguono maiuscole e minuscole:
 * «TrovaTutto.tsx» e «trovatutto.ts» diventano lo stesso modulo e l'app si rompe.
 * Due file della stessa cartella non devono avere lo stesso nome a meno delle maiuscole.
 */
function cartelle(dir: string): string[] {
  return [dir, ...readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => cartelle(join(dir, d.name)))];
}

describe('nomi dei file', () => {
  it('nessuna collisione tra maiuscole e minuscole', () => {
    for (const dir of cartelle(join(import.meta.dirname, '..', 'src'))) {
      const visti = new Map<string, string>();
      for (const f of readdirSync(dir)) {
        const chiave = parse(f).name.toLowerCase();
        expect(visti.get(chiave), `${dir}: ${f} e ${visti.get(chiave)}`).toBeUndefined();
        visti.set(chiave, f);
      }
    }
  });
});
