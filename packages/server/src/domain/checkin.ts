/**
 * Controllo periodico "sono qui".
 *
 * Un controllo mancato NON attiva nulla da solo: avvisa i fiduciari, che possono
 * aprire una richiesta. Il rilascio passa sempre dalla verifica di un operatore.
 */

export interface CheckinSchedule {
  intervalDays: number;
  maxReminders: number;
  reminderSpacingDays: number;
  lastCheckinAt: Date;
  remindersSent: number;
  lastReminderAt: Date | null;
  paused: boolean;
}

export type CheckinState =
  | { state: 'in-regola'; nextDueAt: Date }
  | { state: 'promemoria-da-inviare'; reminderNumber: number }
  | { state: 'in-attesa-di-risposta'; nextActionAt: Date }
  | { state: 'mancato' }
  | { state: 'in-pausa' };

const DAY = 24 * 60 * 60 * 1000;

export function evaluateCheckin(s: CheckinSchedule, now: Date): CheckinState {
  if (s.paused) return { state: 'in-pausa' };
  const dueAt = new Date(s.lastCheckinAt.getTime() + s.intervalDays * DAY);
  if (now.getTime() < dueAt.getTime()) return { state: 'in-regola', nextDueAt: dueAt };

  const nextReminderAt = s.lastReminderAt ? new Date(s.lastReminderAt.getTime() + s.reminderSpacingDays * DAY) : dueAt;
  if (now.getTime() < nextReminderAt.getTime()) {
    return { state: 'in-attesa-di-risposta', nextActionAt: nextReminderAt };
  }
  if (s.remindersSent < s.maxReminders) {
    return { state: 'promemoria-da-inviare', reminderNumber: s.remindersSent + 1 };
  }
  return { state: 'mancato' };
}

export function recordCheckin(s: CheckinSchedule, now: Date): CheckinSchedule {
  return { ...s, lastCheckinAt: now, remindersSent: 0, lastReminderAt: null };
}

export function recordReminderSent(s: CheckinSchedule, now: Date): CheckinSchedule {
  return { ...s, remindersSent: s.remindersSent + 1, lastReminderAt: now };
}
