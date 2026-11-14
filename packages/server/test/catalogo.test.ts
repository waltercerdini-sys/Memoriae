import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/client';
import { providers } from '../src/db/schema';
import { seedProviders } from '../src/db/seed-providers';
import { checkProviderSources, improntaPagina } from '../src/jobs/catalogo';
import { MemoryMailer } from '../src/mail/mailer';
import { createTestDatabase } from './helpers';

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await seedProviders(db);
});
afterAll(async () => close());

const DAY = 24 * 3600 * 1000;
const scheda = async (slug: string) => (await db.select().from(providers).where(eq(providers.slug, slug)))[0]!;

describe('controllo delle pagine ufficiali', () => {
  it('l\'impronta ignora script, stili e spazi', () => {
    expect(improntaPagina('<p>Ciao   mondo</p><script>var x=1</script>')).toBe(improntaPagina('<div>Ciao mondo</div><style>a{}</style>'));
    expect(improntaPagina('<p>Ciao mondo</p>')).not.toBe(improntaPagina('<p>Ciao mondo nuovo</p>'));
  });

  it('pagina invariata: solo la data; cambiata: da ricontrollare e e-mail; poi la revisione', async () => {
    const mailer = new MemoryMailer();
    const pagine = new Map<string, string>();
    const fetchPage = async (url: string) => {
      if (url.includes('apple')) return pagine.get('apple') ?? '<p>Contatto erede: istruzioni</p>';
      if (url.includes('fb.com')) throw new Error('offline');
      return `<p>pagina ${url}</p>`;
    };
    const ctx = { db, mailer, appOrigin: 'http://x', operatori: ['olga@example.ch'], fetchPage };
    const t0 = new Date();

    // Primo giro: riferimento preso, Facebook irraggiungibile.
    const n = await checkProviderSources(ctx, t0);
    expect(n).toBeGreaterThan(10);
    expect(await scheda('apple')).toMatchObject({ sourceStatus: 'invariata', needsReview: false });
    expect(await scheda('facebook')).toMatchObject({ sourceStatus: 'irraggiungibile', needsReview: true });
    expect(mailer.sent.filter((m) => m.to === 'olga@example.ch')).toHaveLength(1);

    // Il giorno dopo non si ricontrolla nulla (una volta alla settimana).
    expect(await checkProviderSources(ctx, new Date(t0.getTime() + DAY))).toBe(0);

    // Una settimana dopo: Apple cambiata, Facebook di nuovo raggiungibile.
    pagine.set('apple', '<p>Contatto erede: nuove istruzioni</p>');
    const fetch2 = async (url: string) => (url.includes('fb.com') ? '<p>fb</p>' : fetchPage(url));
    await checkProviderSources({ ...ctx, fetchPage: fetch2 }, new Date(t0.getTime() + 8 * DAY));
    const apple = await scheda('apple');
    expect(apple).toMatchObject({ sourceStatus: 'cambiata', needsReview: true });
    expect(mailer.sent.at(-1)!.text).toContain('Apple');
    // Facebook non aveva un riferimento: diventa il riferimento, ma resta da rivedere finché un operatore non conferma.
    expect((await scheda('facebook')).sourceHash).not.toBeNull();

    // La pagina è ancora cambiata la settimana dopo: nessun nuovo avviso.
    const prima = mailer.sent.length;
    await checkProviderSources({ ...ctx, fetchPage: fetch2 }, new Date(t0.getTime() + 16 * DAY));
    expect(mailer.sent.length).toBe(prima);

    // Le istruzioni non sono cambiate da sole.
    expect(apple.livingSteps).toEqual((await scheda('apple')).livingSteps);

    // Un riavvio (seed) non riporta indietro una data di verifica più recente.
    await db.update(providers).set({ verifiedAt: new Date('2030-01-01') }).where(eq(providers.slug, 'apple'));
    await seedProviders(db);
    expect((await scheda('apple')).verifiedAt!.toISOString().slice(0, 4)).toBe('2030');
  });
});
