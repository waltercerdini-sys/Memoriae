import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { auditLog, cardOrders, users } from '../db/schema';
import type { Mailer } from '../mail/mailer';
import type { IndirizzoSpedizione } from '../payments/provider';

/** Ordine pagato: si registra l'indirizzo e si conferma per e-mail. Una sola volta per ordine. */
export async function markCardOrderPaid(db: Database, mailer: Mailer, orderId: string, a: IndirizzoSpedizione | null): Promise<boolean> {
  const [o] = await db
    .update(cardOrders)
    .set({
      status: 'pagato',
      paidAt: new Date(),
      ...(a ? { shippingName: a.nome, shippingLine1: a.riga1, shippingLine2: a.riga2 ?? null, shippingPostalCode: a.cap, shippingCity: a.citta, shippingCountry: a.paese } : {}),
    })
    .where(and(eq(cardOrders.id, orderId), eq(cardOrders.status, 'in-attesa')))
    .returning();
  if (!o) return false;
  await db.insert(auditLog).values({ actor: 'fornitore-pagamenti', action: 'carte-pagate', vaultId: o.vaultId, details: { ordine: o.id, quantita: o.quantity } });
  const [u] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, o.userId));
  if (u) {
    await mailer.send({
      to: u.email,
      subject: 'MEMORIAE – grazie, la tua Carta MEMORIAE è in preparazione',
      text:
        `Ciao ${u.name.split(' ')[0]},\nabbiamo ricevuto il pagamento per ${o.quantity === 1 ? 'una carta' : `${o.quantity} carte`} (CHF ${o.amountChf}).\n` +
        (a ? `La spediamo a: ${a.nome}, ${a.riga1}${a.riga2 ? `, ${a.riga2}` : ''}, ${a.cap} ${a.citta}.\n` : '') +
        `Quando la ricevi, avvicinala al telefono con MEMORIAE aperta per attivarla.`,
    });
  }
  return true;
}

