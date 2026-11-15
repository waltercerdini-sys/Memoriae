import { describe, expect, it } from 'vitest';
import { AIUTO, type ContestoAiuto } from '../src/aiuto';

const situazioni: ContestoAiuto[] = [
  {},
  { voci: 0, persone: 0, fiduciari: 0 },
  { voci: 12, daCompletare: 3, persone: 2, fiduciari: 0, daInvitare: 1, lettere: 1, ricordi: 4, controlloAttivo: false, decesso: true },
  { voci: 12, daCompletare: 0, persone: 2, fiduciari: 1, daInvitare: 0, controlloAttivo: true },
];

describe('aiuto contestuale', () => {
  it('ogni pagina ha un testo breve e da 1 a 4 passi in ogni situazione', () => {
    for (const [pagina, t] of Object.entries(AIUTO)) {
      expect(t.quiPuoi.length, pagina).toBeLessThan(220);
      for (const c of situazioni) {
        const passi = t.passi(c);
        expect(passi.length, pagina).toBeGreaterThan(0);
        expect(passi.length, pagina).toBeLessThanOrEqual(4);
        for (const p of passi) expect(p.length, pagina).toBeLessThan(160);
      }
    }
  });

  it('i passi seguono la situazione', () => {
    expect(AIUTO.voci.passi({ voci: 0 })[0]).toContain('Trova tutto');
    expect(AIUTO.voci.passi({ voci: 5, daCompletare: 2, fiduciari: 1 })[0]).toContain('2 voci da completare');
    expect(AIUTO.voci.passi({ voci: 5, daCompletare: 0, fiduciari: 0 })[0]).toContain('persona di fiducia');
    expect(AIUTO.persone.passi({ persone: 0 })[0]).toContain('Aggiungi una persona');
    expect(AIUTO.persone.passi({ persone: 3, fiduciari: 1, daInvitare: 2 })[0]).toContain('2 persone non hanno');
    expect(AIUTO.protezione.passi({ controlloAttivo: false })[0]).toContain('Riattiva il controllo');
    expect(AIUTO['cassaforte-ricevuta'].passi({ decesso: true })[0]).toContain('I primi 30 giorni');
  });
});
