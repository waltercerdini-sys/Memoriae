import { and, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { activationCases, auditLog, items, persons, recipientPackages, users, vaults } from '../db/schema';
import type { JobContext } from './scheduler';

/**
 * Lettere nel tempo: il giorno scelto avvisa chi la riceve.
 * Solo per cassaforti già aperte per decesso; le lettere «appena possibile» arrivano con l'apertura stessa.
 */
export async function notifyDueLetters({ db, mailer, appOrigin }: JobContext, now: Date): Promise<number> {
  const due = await db
    .select({ it: items, owner: users.name })
    .from(items)
    .innerJoin(vaults, eq(vaults.id, items.vaultId))
    .innerJoin(users, eq(users.id, vaults.ownerId))
    .where(and(eq(items.type, 'lettera'), isNotNull(items.deliverAt), lte(items.deliverAt, now), isNull(items.letterNotifiedAt)));
  let sent = 0;
  for (const { it, owner } of due) {
    const [aperta] = await db
      .select({ id: activationCases.id })
      .from(activationCases)
      .where(and(eq(activationCases.vaultId, it.vaultId), eq(activationCases.scope, 'decesso'), eq(activationCases.status, 'rilasciata')))
      .limit(1);
    if (!aperta) continue; // il proprietario è in vita: la lettera aspetta
    const [dest] = it.letterRecipientId
      ? await db
          .select({ p: persons, email: users.email })
          .from(persons)
          .leftJoin(users, eq(users.id, persons.userId))
          .where(eq(persons.id, it.letterRecipientId))
      : [];
    const [pacchetto] = it.letterRecipientId
      ? await db
          .select({ id: recipientPackages.id })
          .from(recipientPackages)
          .where(and(eq(recipientPackages.recipientId, it.letterRecipientId), eq(recipientPackages.scope, 'decesso'), isNotNull(recipientPackages.deliveredInner)))
      : [];
    const nome = owner.split(' ')[0];
    if (dest?.email && pacchetto) {
      await mailer.send({
        to: dest.email,
        subject: `MEMORIAE – oggi si apre una lettera di ${owner}`,
        text: `Ciao ${dest.p.name.split(' ')[0]},\n${nome} aveva scritto una lettera per te, da aprire proprio oggi.\nLa trovi in MEMORIAE, nella scheda «Per gli altri»: ${appOrigin}`,
      });
      sent++;
    } else {
      // Destinatario senza account (o pacchetto non ancora consegnato): avvisiamo le persone di fiducia.
      const fiduciari = await db
        .select({ nome: persons.name, email: users.email })
        .from(persons)
        .innerJoin(users, eq(users.id, persons.userId))
        .where(and(eq(persons.vaultId, it.vaultId), eq(persons.inviteStatus, 'accettato'), inArray(persons.role, ['fiduciario', 'fiduciario-destinatario'])));
      for (const f of fiduciari) {
        await mailer.send({
          to: f.email,
          subject: `MEMORIAE – oggi si apre la lettera di ${owner} per ${dest?.p.name ?? 'una persona'}`,
          text:
            `Ciao ${f.nome.split(' ')[0]},\n${nome} aveva preparato una lettera per ${dest?.p.name ?? 'una persona a lei cara'}, da consegnare oggi.\n` +
            `Aprila in MEMORIAE (scheda «Per gli altri» › Apri) e consegnala tu: ${appOrigin}`,
        });
        sent++;
      }
    }
    await db.update(items).set({ letterNotifiedAt: now }).where(eq(items.id, it.id));
    await db.insert(auditLog).values({ actor: 'sistema', action: 'lettera-consegnata', vaultId: it.vaultId, details: { voce: it.id } });
  }
  return sent;
}
