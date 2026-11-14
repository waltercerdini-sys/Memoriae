import { createHash } from 'node:crypto';
import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { Database } from '../db/client';
import { auditLog, providers } from '../db/schema';
import type { Mailer } from '../mail/mailer';

/**
 * Controllo periodico delle pagine ufficiali del catalogo.
 * - Pagina invariata: si aggiorna solo la data del controllo («Pagina ufficiale controllata il …»).
 * - Pagina cambiata o non raggiungibile: la scheda passa a «da ricontrollare» e gli operatori ricevono un'e-mail.
 * Le istruzioni per gli utenti non cambiano mai da sole: le rivede sempre una persona.
 */
export type FetchPage = (url: string) => Promise<string>;

export const fetchPage: FetchPage = async (url) => {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    redirect: 'follow',
    headers: { 'user-agent': 'MEMORIAE-catalogo/1.0 (controllo pagine ufficiali)', 'accept-language': 'it-CH,it;q=0.9,de;q=0.6' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

/** Impronta del testo leggibile della pagina: script, stili e marcatori non contano. */
export function improntaPagina(html: string): string {
  const testo = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(testo).digest('hex');
}

export interface CatalogoContext {
  db: Database;
  mailer: Mailer;
  appOrigin: string;
  operatori: string[];
  fetchPage: FetchPage;
  /** Ogni quanti giorni ricontrollare una pagina. */
  ogniGiorni?: number;
}

export async function checkProviderSources(ctx: CatalogoContext, now = new Date()): Promise<number> {
  const { db, mailer, appOrigin, operatori } = ctx;
  const limite = new Date(now.getTime() - (ctx.ogniGiorni ?? 7) * 24 * 3600 * 1000);
  const daControllare = await db
    .select()
    .from(providers)
    .where(and(isNotNull(providers.sourceUrl), or(isNull(providers.sourceCheckedAt), lt(providers.sourceCheckedAt, limite))));
  const cambiate: string[] = [];
  const irraggiungibili: string[] = [];
  for (const p of daControllare) {
    let impronta: string | null = null;
    try {
      impronta = improntaPagina(await ctx.fetchPage(p.sourceUrl!));
    } catch {
      impronta = null;
    }
    if (impronta === null) {
      if (p.sourceStatus !== 'irraggiungibile') irraggiungibili.push(p.name);
      await db.update(providers).set({ sourceStatus: 'irraggiungibile', sourceCheckedAt: now, needsReview: true }).where(eq(providers.id, p.id));
    } else if (!p.sourceHash) {
      // Primo controllo: la pagina attuale diventa il riferimento.
      await db.update(providers).set({ sourceHash: impronta, sourceStatus: 'invariata', sourceCheckedAt: now }).where(eq(providers.id, p.id));
    } else if (impronta === p.sourceHash) {
      // Pagina come all'ultima verifica (anche se nel frattempo era irraggiungibile o cambiata e poi tornata com'era).
      await db
        .update(providers)
        .set({ sourceStatus: 'invariata', sourcePendingHash: null, needsReview: false, sourceCheckedAt: now })
        .where(eq(providers.id, p.id));
    } else if (impronta !== p.sourcePendingHash) {
      cambiate.push(p.name);
      await db.update(providers).set({ sourcePendingHash: impronta, sourceStatus: 'cambiata', sourceCheckedAt: now, needsReview: true }).where(eq(providers.id, p.id));
    } else {
      // Già segnalata come cambiata e non ancora rivista: nessun nuovo avviso.
      await db.update(providers).set({ sourceCheckedAt: now }).where(eq(providers.id, p.id));
    }
  }
  if (cambiate.length || irraggiungibili.length) {
    await db.insert(auditLog).values({ actor: 'sistema', action: 'catalogo-da-ricontrollare', details: { cambiate, irraggiungibili } });
    for (const op of operatori) {
      await mailer.send({
        to: op,
        subject: `MEMORIAE – catalogo: ${cambiate.length + irraggiungibili.length} schede da ricontrollare`,
        text:
          (cambiate.length ? `Pagine ufficiali cambiate:\n${cambiate.map((n) => `- ${n}`).join('\n')}\n\n` : '') +
          (irraggiungibili.length ? `Pagine non raggiungibili:\n${irraggiungibili.map((n) => `- ${n}`).join('\n')}\n\n` : '') +
          `Ricontrolla le istruzioni e conferma da Operatore › Catalogo: ${appOrigin}`,
      });
    }
  }
  return daControllare.length;
}
