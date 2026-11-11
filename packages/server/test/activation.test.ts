import { describe, expect, it } from 'vitest';
import {
  ActivationError,
  approve,
  blockByOwner,
  EMERGENCY_ACCESS_MS,
  mayReleaseMemoriaeHalf,
  reject,
  release,
  startReview,
  WAITING_PERIOD_MS,
  type ActivationCase,
} from '../src/domain/activation';

const t0 = new Date('2027-03-01T10:00:00Z');
const later = (ms: number) => new Date(t0.getTime() + ms);
const nuovo = (scope: ActivationCase['scope']): ActivationCase => ({ scope, status: 'richiesta' });

describe('casi di attivazione', () => {
  it('percorso completo per un decesso: verifica, attesa di 14 giorni, rilascio', () => {
    let c = startReview(nuovo('decesso'), 'walter');
    c = approve(c, 'walter', t0);
    expect(c.status).toBe('in-attesa');
    expect(c.waitingUntil).toEqual(later(WAITING_PERIOD_MS.decesso));

    expect(() => release(c, later(WAITING_PERIOD_MS.decesso - 1))).toThrow(ActivationError);
    c = release(c, later(WAITING_PERIOD_MS.decesso));
    expect(c.status).toBe('rilasciata');
    expect(c.accessExpiresAt).toBeNull();
    expect(mayReleaseMemoriaeHalf(c, later(365 * 24 * 3600 * 1000))).toBe(true);
  });

  it('in emergenza l\'attesa è di 72 ore e l\'accesso scade', () => {
    let c = approve(startReview(nuovo('emergenza'), 'walter'), 'walter', t0);
    c = release(c, later(WAITING_PERIOD_MS.emergenza));
    const expires = c.accessExpiresAt!;
    expect(expires).toEqual(later(WAITING_PERIOD_MS.emergenza + EMERGENCY_ACCESS_MS));
    expect(mayReleaseMemoriaeHalf(c, new Date(expires.getTime() - 1))).toBe(true);
    expect(mayReleaseMemoriaeHalf(c, expires)).toBe(false);
  });

  it('senza verifica umana non si arriva al rilascio', () => {
    expect(() => approve(nuovo('decesso'), 'walter', t0)).toThrow(ActivationError);
    expect(() => release(nuovo('decesso'), t0)).toThrow(ActivationError);
    expect(mayReleaseMemoriaeHalf(nuovo('decesso'), t0)).toBe(false);
  });

  it('l\'utente può bloccare in ogni fase prima del rilascio', () => {
    expect(blockByOwner(nuovo('decesso')).status).toBe('bloccata');
    expect(blockByOwner(startReview(nuovo('decesso'), 'w')).status).toBe('bloccata');
    const waiting = approve(startReview(nuovo('decesso'), 'w'), 'w', t0);
    const blocked = blockByOwner(waiting);
    expect(blocked.status).toBe('bloccata');
    expect(() => release(blocked, later(WAITING_PERIOD_MS.decesso))).toThrow(ActivationError);
    expect(mayReleaseMemoriaeHalf(blocked, later(WAITING_PERIOD_MS.decesso))).toBe(false);
  });

  it('dopo il rilascio non si può più bloccare', () => {
    const c = release(approve(startReview(nuovo('decesso'), 'w'), 'w', t0), later(WAITING_PERIOD_MS.decesso));
    expect(() => blockByOwner(c)).toThrow(ActivationError);
  });

  it('un rifiuto richiede un motivo e chiude il caso', () => {
    const inReview = startReview(nuovo('decesso'), 'walter');
    expect(() => reject(inReview, 'walter', ' ')).toThrow(ActivationError);
    const rejected = reject(inReview, 'walter', 'Documento illeggibile');
    expect(rejected.status).toBe('respinta');
    expect(() => approve(rejected, 'walter', t0)).toThrow(ActivationError);
  });

  it('la verifica la conclude lo stesso operatore che l\'ha avviata', () => {
    const inReview = startReview(nuovo('decesso'), 'walter');
    expect(() => approve(inReview, 'altro', t0)).toThrow(ActivationError);
  });
});
