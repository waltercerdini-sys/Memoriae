import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Database } from '../db/client';
import { users } from '../db/schema';
import type { Mailer } from '../mail/mailer';

/**
 * Promemoria settimanale dell'Intervista dei ricordi, solo per chi l'ha acceso.
 * L'e-mail non contiene la domanda né le risposte: il server non sa a cosa si è già risposto (è cifrato).
 */
export async function memoriesReminders(db: Database, mailer: Mailer, appOrigin: string, now = new Date()): Promise<number> {
  const settimanaFa = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const daAvvisare = await db
    .select({ id: users.id, nome: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.memoriesReminder, true), or(isNull(users.memoriesReminderSentAt), lt(users.memoriesReminderSentAt, settimanaFa))));
  for (const u of daAvvisare) {
    await mailer.send({
      to: u.email,
      subject: 'MEMORIAE – la domanda della settimana',
      text:
        `Ciao ${u.nome.split(' ')[0]},\nnel tuo Libro dei ricordi ti aspetta una nuova domanda. Bastano due minuti: puoi rispondere a voce o scrivendo.\n` +
        `${appOrigin}\n\nNon vuoi più questo promemoria? Spegnilo nel Libro dei ricordi.`,
    });
    await db.update(users).set({ memoriesReminderSentAt: now }).where(eq(users.id, u.id));
  }
  return daAvvisare.length;
}
