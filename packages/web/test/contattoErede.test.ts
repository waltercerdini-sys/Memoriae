import { describe, expect, it } from 'vitest';
import { mancanzeErede } from '../src/contattoErede';
import { calcolaProntezza } from '../src/prontezza';
import type { ContenutoVoce, Voce } from '../src/vault';

const voce = (c: Partial<ContenutoVoce>): Voce =>
  ({ id: 'v1', tipo: 'account', emergenza: false, contenuto: { titolo: 'Apple', note: '', ...c }, remota: {} }) as unknown as Voce;

describe('contatto erede', () => {
  it('chiede di scrivere chi è il contatto se la funzione risulta impostata', () => {
    expect(mancanzeErede(voce({ fornitore: 'apple', impostatoDaVivo: true }), 'Apple')).toEqual([
      'Scrivi chi hai indicato come contatto erede per Apple (apri la voce).',
    ]);
    expect(mancanzeErede(voce({ fornitore: 'apple' }), 'Apple')).toEqual([]);
  });

  it('per Apple chiede la chiave e un secondo contatto', () => {
    const m = mancanzeErede(voce({ fornitore: 'apple', erede: { contatti: ['Anna'] } }), 'Apple');
    expect(m).toHaveLength(2);
    expect(m[0]).toContain('chiave di accesso');
    expect(m[1]).toContain('seconda persona');
  });

  it('la chiave conta solo se il documento è ancora allegato', () => {
    const doc = { id: 'f1', nome: 'chiave.pdf', tipo: 'application/pdf', dimensione: 10 };
    const conChiave = voce({ fornitore: 'apple', files: [doc], erede: { contatti: ['Anna', 'Luca'], chiaveFileId: 'f1' } });
    expect(mancanzeErede(conChiave, 'Apple')).toEqual([]);
    const tolta = voce({ fornitore: 'apple', files: [], erede: { contatti: ['Anna', 'Luca'], chiaveFileId: 'f1' } });
    expect(mancanzeErede(tolta, 'Apple')).toHaveLength(1);
  });

  it('Facebook ammette un solo contatto e non ha chiave', () => {
    expect(mancanzeErede(voce({ fornitore: 'facebook', erede: { contatti: ['Anna'] } }), 'Facebook')).toEqual([]);
  });

  it('i passi compaiono nell\'indicatore di prontezza', () => {
    const f = { slug: 'apple', nome: 'Apple (iCloud, iPhone, Mac)', daVivi: ['x'] } as never;
    const p = calcolaProntezza([voce({ fornitore: 'apple', impostatoDaVivo: true, erede: { contatti: ['Anna'] } })], [], [f], true);
    expect(p.passi.some((x) => x.includes('chiave di accesso del contatto erede di Apple'))).toBe(true);
  });
});
