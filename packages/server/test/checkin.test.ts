import { describe, expect, it } from 'vitest';
import { evaluateCheckin, recordCheckin, recordReminderSent, type CheckinSchedule } from '../src/domain/checkin';

const DAY = 24 * 60 * 60 * 1000;
const t0 = new Date('2027-01-01T09:00:00Z');
const at = (days: number) => new Date(t0.getTime() + days * DAY);

const base: CheckinSchedule = {
  intervalDays: 30,
  maxReminders: 3,
  reminderSpacingDays: 3,
  lastCheckinAt: t0,
  remindersSent: 0,
  lastReminderAt: null,
  paused: false,
};

describe('controllo periodico', () => {
  it('è in regola prima della scadenza', () => {
    expect(evaluateCheckin(base, at(29))).toEqual({ state: 'in-regola', nextDueAt: at(30) });
  });

  it('dopo la scadenza manda 3 promemoria a 3 giorni di distanza, poi segnala il controllo mancato', () => {
    let s = base;
    expect(evaluateCheckin(s, at(30))).toEqual({ state: 'promemoria-da-inviare', reminderNumber: 1 });
    s = recordReminderSent(s, at(30));
    expect(evaluateCheckin(s, at(32)).state).toBe('in-attesa-di-risposta');
    expect(evaluateCheckin(s, at(33))).toEqual({ state: 'promemoria-da-inviare', reminderNumber: 2 });
    s = recordReminderSent(s, at(33));
    s = recordReminderSent(s, at(36));
    expect(evaluateCheckin(s, at(38)).state).toBe('in-attesa-di-risposta');
    expect(evaluateCheckin(s, at(39))).toEqual({ state: 'mancato' });
  });

  it('un "sono qui" azzera tutto', () => {
    let s = recordReminderSent(base, at(30));
    s = recordCheckin(s, at(31));
    expect(s.remindersSent).toBe(0);
    expect(evaluateCheckin(s, at(40)).state).toBe('in-regola');
  });

  it('in pausa non manda nulla (per esempio durante un caso d\'emergenza aperto)', () => {
    expect(evaluateCheckin({ ...base, paused: true }, at(100))).toEqual({ state: 'in-pausa' });
  });
});
