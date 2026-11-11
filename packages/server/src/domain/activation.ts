/**
 * Casi di attivazione: la macchina a stati che decide QUANDO la metà MEMORIAE può essere consegnata.
 *
 *   richiesta ──► in-verifica ──► in-attesa ──► rilasciata
 *        │             │              │
 *        │             └─► respinta   │
 *        └──────────── bloccata ◄─────┘   (l'utente risponde: in qualsiasi momento prima del rilascio)
 *
 * Regole fisse:
 * - nessun rilascio senza la decisione di un operatore umano;
 * - nessun rilascio prima della fine del periodo d'attesa;
 * - l'emergenza dà un accesso a tempo; il decesso no.
 */

export type ReleaseScope = 'decesso' | 'emergenza';
export type ActivationStatus = 'richiesta' | 'in-verifica' | 'respinta' | 'in-attesa' | 'bloccata' | 'rilasciata';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Periodo d'attesa dopo la verifica, durante il quale l'utente riceve avvisi e può bloccare. */
export const WAITING_PERIOD_MS: Record<ReleaseScope, number> = {
  decesso: 14 * DAY,
  emergenza: 72 * HOUR,
};

/** Durata dell'accesso in emergenza, dopo il rilascio. */
export const EMERGENCY_ACCESS_MS = 30 * DAY;

export interface ActivationCase {
  scope: ReleaseScope;
  status: ActivationStatus;
  reviewedBy?: string | null;
  reviewNote?: string | null;
  waitingUntil?: Date | null;
  releasedAt?: Date | null;
  accessExpiresAt?: Date | null;
}

export class ActivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivationError';
  }
}

function expect(c: ActivationCase, allowed: ActivationStatus[], action: string): void {
  if (!allowed.includes(c.status)) {
    throw new ActivationError(`Impossibile ${action}: il caso è "${c.status}"`);
  }
}

export function startReview(c: ActivationCase, operator: string): ActivationCase {
  expect(c, ['richiesta'], 'avviare la verifica');
  if (!operator.trim()) throw new ActivationError('Serve il nome dell\'operatore');
  return { ...c, status: 'in-verifica', reviewedBy: operator };
}

export function reject(c: ActivationCase, operator: string, note: string): ActivationCase {
  expect(c, ['in-verifica'], 'respingere');
  if (!note.trim()) throw new ActivationError('Indica il motivo del rifiuto');
  return { ...c, status: 'respinta', reviewedBy: operator, reviewNote: note };
}

export function approve(c: ActivationCase, operator: string, now: Date): ActivationCase {
  expect(c, ['in-verifica'], 'approvare');
  if (c.reviewedBy && c.reviewedBy !== operator) {
    throw new ActivationError('La verifica va conclusa dallo stesso operatore che l\'ha avviata');
  }
  return {
    ...c,
    status: 'in-attesa',
    reviewedBy: operator,
    waitingUntil: new Date(now.getTime() + WAITING_PERIOD_MS[c.scope]),
  };
}

/** L'utente risponde: il caso si chiude subito, in qualsiasi fase prima del rilascio. */
export function blockByOwner(c: ActivationCase): ActivationCase {
  expect(c, ['richiesta', 'in-verifica', 'in-attesa'], 'bloccare');
  return { ...c, status: 'bloccata' };
}

export function release(c: ActivationCase, now: Date): ActivationCase {
  expect(c, ['in-attesa'], 'rilasciare');
  if (!c.waitingUntil || now.getTime() < c.waitingUntil.getTime()) {
    throw new ActivationError('Il periodo d\'attesa non è ancora finito');
  }
  return {
    ...c,
    status: 'rilasciata',
    releasedAt: now,
    accessExpiresAt: c.scope === 'emergenza' ? new Date(now.getTime() + EMERGENCY_ACCESS_MS) : null,
  };
}

/** Può il servizio di gestione chiavi consegnare la metà MEMORIAE per questo caso, adesso? */
export function mayReleaseMemoriaeHalf(c: ActivationCase, now: Date): boolean {
  if (c.status !== 'rilasciata') return false;
  if (c.scope === 'emergenza') {
    return !!c.accessExpiresAt && now.getTime() < c.accessExpiresAt.getTime();
  }
  return true;
}
