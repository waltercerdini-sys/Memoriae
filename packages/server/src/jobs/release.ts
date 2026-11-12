import { and, eq, inArray, lte } from 'drizzle-orm';
import { activationCases, auditLog, persons, users, vaults } from '../db/schema';
import { release, type ActivationCase } from '../domain/activation';
import type { JobContext } from './scheduler';

/**
 * Fine dell'attesa: i casi verificati e non bloccati diventano «rilasciati».
 * Rilasciato non vuol dire aperto: la metà MEMORIAE esce solo quando una persona di fiducia
 * la chiede dall'app, e la cassaforte si apre nel suo browser.
 */
export async function releaseDueCases({ db, mailer, appOrigin }: JobContext, now: Date): Promise<number> {
  const due = await db
    .select()
    .from(activationCases)
    .where(and(eq(activationCases.status, 'in-attesa'), lte(activationCases.waitingUntil, now)));
  for (const c of due) {
    const next = release({ scope: c.scope, status: c.status, waitingUntil: c.waitingUntil } as ActivationCase, now);
    await db
      .update(activationCases)
      .set({ status: next.status, releasedAt: next.releasedAt, accessExpiresAt: next.accessExpiresAt ?? null, blockTokenHash: null, updatedAt: now })
      .where(and(eq(activationCases.id, c.id), eq(activationCases.status, 'in-attesa')));
    await db.insert(auditLog).values({ actor: 'sistema', action: 'attivazione-rilasciata', vaultId: c.vaultId, details: { caso: c.id, ambito: c.scope } });

    const [owner] = await db.select({ name: users.name, email: users.email }).from(vaults).innerJoin(users, eq(users.id, vaults.ownerId)).where(eq(vaults.id, c.vaultId));
    const fiduciari = await db
      .select({ nome: persons.name, email: users.email })
      .from(persons)
      .innerJoin(users, eq(users.id, persons.userId))
      .where(and(eq(persons.vaultId, c.vaultId), eq(persons.inviteStatus, 'accettato'), inArray(persons.role, ['fiduciario', 'fiduciario-destinatario'])));
    const durata = c.scope === 'emergenza' ? ' L\'accesso d\'emergenza vale 30 giorni.' : '';
    for (const f of fiduciari) {
      await mailer.send({
        to: f.email,
        subject: `MEMORIAE – puoi aprire la cassaforte di ${owner?.name}`,
        text:
          `Ciao ${f.nome.split(' ')[0]},\nl'attesa è finita e nessuno ha bloccato la richiesta.${durata}\n` +
          `Entra nell'app e premi «Apri»: vedrai ciò che ${owner?.name} ha lasciato per te, e i pacchetti per le altre persone partiranno da soli.\n${appOrigin}`,
      });
    }
    if (owner && c.scope === 'emergenza') {
      await mailer.send({
        to: owner.email,
        subject: 'MEMORIAE – accesso d\'emergenza concesso',
        text: `Le tue persone di fiducia possono vedere le voci d'emergenza per 30 giorni. Se stai bene puoi chiudere l'accesso dall'app: ${appOrigin}`,
      });
    }
  }
  return due.length;
}
