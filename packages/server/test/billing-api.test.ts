import { encryptItem, utf8 } from '@memoriae/crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Database } from '../src/db/client';
import { subscriptions } from '../src/db/schema';
import { runJobs } from '../src/jobs/scheduler';
import { MemoryMailer } from '../src/mail/mailer';
import { ensureSubscription } from '../src/payments/subscriptions';
import { StripeProvider, verifyStripeSignature } from '../src/payments/provider';
import { MemoryBlobStore } from '../src/storage/blobs';
import { DevKeyCustody } from '../src/storage/custody';
import { createFakePasskeys, createTestDatabase } from './helpers';
import { createWorld, type TestUser } from './world';

let db: Database;
let close: () => Promise<void>;
let app: FastifyInstance;
let stripeApp: FastifyInstance;
const mailer = new MemoryMailer();
const appOrigin = 'http://localhost:5173';
const { utente, inviteToken } = createWorld(() => app, mailer);
const WHSEC = 'whsec_prova_memoriae';
const stripeCalls: { url: string; body: URLSearchParams }[] = [];
const DAY = 24 * 3600 * 1000;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  const common = { db, custody: new DevKeyCustody(db, new Uint8Array(32).fill(4)), appOrigin, passkeys: createFakePasskeys(), blobs: new MemoryBlobStore(), mailer, cookieSecure: false, logLevel: 'silent' };
  app = buildApp(common);
  await app.ready();
  const fetchFn = (async (url: string, init: RequestInit) => {
    stripeCalls.push({ url, body: new URLSearchParams(String(init.body)) });
    return new Response(JSON.stringify({ url: url.includes('billing_portal') ? 'https://billing.stripe.com/p/x' : 'https://checkout.stripe.com/c/pay/x' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  stripeApp = buildApp({
    ...common,
    payments: new StripeProvider({ secretKey: 'sk_test_x', webhookSecret: WHSEC, prices: { essenziale: 'price_ess', famiglia: 'price_fam' }, fetchFn }),
  });
  await stripeApp.ready();
});
afterAll(async () => {
  await app.close();
  await stripeApp.close();
  await close();
});

const req = (a: FastifyInstance, u: TestUser | null, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  a.inject({ method, url, headers: u ? { cookie: u.session } : {}, payload: payload as never });

async function nuovaVoce(a: FastifyInstance, u: TestUser) {
  const id = randomUUID();
  const { item } = await encryptItem(u.vaultKey, id, utf8('{"titolo":"x"}'));
  return req(a, u, 'POST', '/v1/cassaforte/voci', { id, tipo: 'account', emergenza: false, chiaveVoceCifrata: item.wrappedItemKey, contenuto: item.content });
}

const scadiProva = async (u: TestUser) =>
  (await ensureSubscription(db, idOf(u)), db).update(subscriptions).set({ trialEndsAt: new Date(Date.now() - 1000) }).where(eq(subscriptions.userId, idOf(u)));
const ids = new Map<string, string>();
const idOf = (u: TestUser) => ids.get(u.email)!;
async function registra(nome: string, email: string) {
  const u = await utente(nome, email);
  const io = (await req(app, u, 'GET', '/v1/io')).json();
  ids.set(email, io.utente.id);
  return u;
}

function firmato(event: object, secret = WHSEC, t = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(event);
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return { body, header: `t=${t},v1=${sig}` };
}
const avviso = (event: object, secret?: string) => {
  const { body, header } = firmato(event, secret);
  return stripeApp.inject({ method: 'POST', url: '/v1/pagamenti/avvisi', headers: { 'content-type': 'application/json', 'stripe-signature': header }, payload: body });
};

describe('abbonamenti e pagamenti', () => {
  it('prova di 30 giorni, poi sola lettura senza toccare ciò che è pronto per gli eredi', async () => {
    const ada = await registra('Ada Rossi', 'ada.b@example.ch');
    const st = (await req(app, ada, 'GET', '/v1/abbonamento')).json();
    expect(st.stato).toBe('prova');
    expect(new Date(st.provaFinoAl).getTime() - Date.now()).toBeGreaterThan(29 * DAY);
    expect((await nuovaVoce(app, ada)).statusCode).toBe(201);

    // Una persona di fiducia per Ada, prima della scadenza.
    const bea = await registra('Bea Neri', 'bea.b@example.ch');
    const pid = randomUUID();
    await req(app, ada, 'POST', '/v1/cassaforte/persone', { id: pid, ruolo: 'fiduciario', nome: 'Bea Neri', email: bea.email });
    await req(app, ada, 'POST', `/v1/cassaforte/persone/${pid}/invito`);

    await scadiProva(ada);
    await scadiProva(bea);
    expect((await req(app, ada, 'GET', '/v1/abbonamento')).json()).toMatchObject({ stato: 'scaduto', puoScrivere: false });
    const bloccata = await nuovaVoce(app, ada);
    expect(bloccata.statusCode).toBe(402);
    expect(bloccata.json().codice).toBe('piano-richiesto');
    expect((await req(app, ada, 'POST', '/v1/cassaforte/persone', { id: randomUUID(), ruolo: 'destinatario', nome: 'Y' })).statusCode).toBe(402);
    // Resta tutto il resto: leggere, cancellare, «sono qui», accettare inviti, fare da persona di fiducia.
    const voci = (await req(app, ada, 'GET', '/v1/cassaforte/voci')).json().voci;
    expect(voci).toHaveLength(1);
    expect((await req(app, ada, 'POST', '/v1/cassaforte/sono-qui')).statusCode).toBe(200);
    expect((await req(app, bea, 'POST', '/v1/inviti/accetta', { token: inviteToken(bea.email) })).statusCode).toBe(200);
    expect((await req(app, bea, 'POST', `/v1/fiducia/${ada.vaultId}/richieste`, { ambito: 'emergenza', motivo: 'Ada è in ospedale da ieri.' })).statusCode).toBe(201);
    expect((await req(app, ada, 'DELETE', `/v1/cassaforte/voci/${voci[0].id}`)).statusCode).toBe(200);
  });

  it('pagamento di prova: la pagina finta di TWINT attiva il piano per un anno', async () => {
    const carlo = await registra('Carlo Blu', 'carlo.b@example.ch');
    await scadiProva(carlo);
    expect((await req(app, null, 'GET', '/v1/piani')).json().piani.map((p: { chfAnno: number }) => p.chfAnno)).toEqual([59, 99]);
    const { url } = (await req(app, carlo, 'POST', '/v1/abbonamento/checkout', { piano: 'essenziale' })).json();
    const id = url.match(/\?pagamento=([0-9a-f-]{36})/)[1];
    expect((await req(app, carlo, 'GET', `/v1/pagamenti/prova/${id}`)).json()).toMatchObject({ chf: 59, pagato: false });
    const altro = await registra('Dario', 'dario.b@example.ch');
    expect((await req(app, altro, 'POST', `/v1/pagamenti/prova/${id}/paga`)).statusCode).toBe(404); // non è suo
    expect((await req(app, carlo, 'POST', `/v1/pagamenti/prova/${id}/paga`)).statusCode).toBe(200);
    expect((await req(app, carlo, 'POST', `/v1/pagamenti/prova/${id}/paga`)).statusCode).toBe(404); // una volta sola
    const st = (await req(app, carlo, 'GET', '/v1/abbonamento')).json();
    expect(st).toMatchObject({ stato: 'attivo', piano: 'essenziale', puoScrivere: true, rinnovoAutomatico: true });
    expect(new Date(st.validoFinoAl).getTime() - Date.now()).toBeGreaterThan(364 * DAY);
    expect((await nuovaVoce(app, carlo)).statusCode).toBe(201);
    expect(mailer.sent.some((m) => m.to === carlo.email && m.subject.includes('Essenziale è attivo'))).toBe(true);
    expect((await req(app, carlo, 'POST', '/v1/abbonamento/checkout', { piano: 'famiglia' })).statusCode).toBe(409);
    // Il piano Essenziale non copre un secondo adulto.
    expect((await req(app, carlo, 'PUT', '/v1/abbonamento/famiglia', { email: 'x@example.ch' })).statusCode).toBe(409);
  });

  it('piano Famiglia: il secondo adulto è coperto, ognuno con la sua cassaforte', async () => {
    const elena = await registra('Elena Gialli', 'elena.b@example.ch');
    const fabio = await registra('Fabio Gialli', 'fabio.b@example.ch');
    await scadiProva(fabio);
    const { url } = (await req(app, elena, 'POST', '/v1/abbonamento/checkout', { piano: 'famiglia' })).json();
    await req(app, elena, 'POST', `/v1/pagamenti/prova/${url.split('=')[1]}/paga`);
    expect((await req(app, elena, 'PUT', '/v1/abbonamento/famiglia', { email: elena.email })).statusCode).toBe(400);
    expect((await req(app, elena, 'PUT', '/v1/abbonamento/famiglia', { email: 'FABIO.b@example.ch' })).statusCode).toBe(200);
    expect((await req(app, fabio, 'GET', '/v1/abbonamento')).json()).toMatchObject({ stato: 'attivo', copertoDa: 'Elena Gialli', puoScrivere: true });
    expect((await nuovaVoce(app, fabio)).statusCode).toBe(201);
    // Fabio non può a sua volta aggiungere qualcuno.
    expect((await req(app, fabio, 'PUT', '/v1/abbonamento/famiglia', { email: 'z@example.ch' })).statusCode).toBe(409);
    await req(app, elena, 'PUT', '/v1/abbonamento/famiglia', { email: null });
    expect((await req(app, fabio, 'GET', '/v1/abbonamento')).json().stato).toBe('scaduto');
  });

  it('Stripe: pagina di pagamento, avvisi firmati, rinnovo non riuscito, disdetta', async () => {
    const gina = await registra('Gina Viola', 'gina.b@example.ch');
    const uid = idOf(gina);
    const r = await req(stripeApp, gina, 'POST', '/v1/abbonamento/checkout', { piano: 'famiglia' });
    expect(r.json().url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const call = stripeCalls.at(-1)!;
    expect(call.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(Object.fromEntries(call.body)).toMatchObject({
      mode: 'subscription',
      'line_items[0][price]': 'price_fam',
      client_reference_id: uid,
      customer_email: gina.email,
      'subscription_data[metadata][userId]': uid,
      'subscription_data[metadata][piano]': 'famiglia',
      success_url: `${appOrigin}/?pagato=1`,
    });
    // Senza pagamento non c'è nulla da gestire.
    expect((await req(stripeApp, gina, 'POST', '/v1/abbonamento/gestisci')).statusCode).toBe(409);
    // Nessuna pagina di prova con Stripe.
    expect((await req(stripeApp, gina, 'POST', `/v1/pagamenti/prova/${randomUUID()}/paga`)).statusCode).toBe(404);

    // Firma sbagliata o vecchia: rifiutato.
    const ev1 = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: uid, customer: 'cus_G', subscription: 'sub_G', metadata: { piano: 'famiglia' } } } };
    expect((await avviso(ev1, 'whsec_sbagliato')).statusCode).toBe(400);
    expect(() => verifyStripeSignature('{}', firmato({}, WHSEC, Math.floor(Date.now() / 1000) - 3600).header, WHSEC)).toThrow(/scaduta/);
    expect((await avviso(ev1)).json()).toMatchObject({ esito: 'applicato' });
    expect((await avviso(ev1)).json()).toMatchObject({ esito: 'già-visto' });

    const end = Math.floor((Date.now() + 365 * DAY) / 1000);
    const sub = (id: string, type: string, status: string, extra: object = {}) => ({
      id,
      type,
      data: { object: { id: 'sub_G', customer: 'cus_G', status, metadata: { userId: uid, piano: 'famiglia' }, items: { data: [{ current_period_end: end }] }, cancel_at_period_end: false, ...extra } },
    });
    await avviso(sub('evt_2', 'customer.subscription.created', 'active'));
    let st = (await req(stripeApp, gina, 'GET', '/v1/abbonamento')).json();
    expect(st).toMatchObject({ stato: 'attivo', piano: 'famiglia', haPortale: true });
    expect(new Date(st.validoFinoAl).getTime()).toBe(end * 1000);
    expect((await req(stripeApp, gina, 'POST', '/v1/abbonamento/gestisci')).json().url).toMatch(/billing\.stripe\.com/);

    // Rinnovo non riuscito: avviso, ma tutto continua a funzionare.
    await avviso({ id: 'evt_3', type: 'invoice.payment_failed', data: { object: { customer: 'cus_G' } } });
    expect(mailer.sent.some((m) => m.to === gina.email && m.subject.includes('rinnovo non è andato'))).toBe(true);
    await avviso(sub('evt_4', 'customer.subscription.updated', 'past_due'));
    st = (await req(stripeApp, gina, 'GET', '/v1/abbonamento')).json();
    expect(st).toMatchObject({ stato: 'in-ritardo', puoScrivere: true });

    // Disdetta a fine periodo, poi fine: resta valido fino alla data pagata.
    await avviso(sub('evt_5', 'customer.subscription.updated', 'active', { cancel_at_period_end: true }));
    expect((await req(stripeApp, gina, 'GET', '/v1/abbonamento')).json()).toMatchObject({ stato: 'attivo', rinnovoAutomatico: false });
    await avviso(sub('evt_6', 'customer.subscription.deleted', 'canceled'));
    expect((await req(stripeApp, gina, 'GET', '/v1/abbonamento')).json()).toMatchObject({ stato: 'attivo', puoScrivere: true });
    await db.update(subscriptions).set({ paidUntil: new Date(Date.now() - 1000), trialEndsAt: new Date(Date.now() - 1000) }).where(eq(subscriptions.userId, uid));
    expect((await req(stripeApp, gina, 'GET', '/v1/abbonamento')).json()).toMatchObject({ stato: 'scaduto', puoScrivere: false });

    // Eventi che non ci riguardano.
    expect((await avviso({ id: 'evt_7', type: 'charge.succeeded', data: { object: {} } })).json().esito).toBe('ignorato');
  });

  it('avvisi di fine prova: 7 giorni prima e alla scadenza, una volta ciascuno', async () => {
    const ivo = await registra('Ivo Bruni', 'ivo.b@example.ch');
    await req(app, ivo, 'GET', '/v1/abbonamento');
    const [s] = await db.select().from(subscriptions).where(eq(subscriptions.userId, idOf(ivo)));
    const jobs = (d: Date) => runJobs({ db, mailer, appOrigin }, d);
    const conta = (re: RegExp) => mailer.sent.filter((m) => m.to === ivo.email && re.test(m.subject)).length;
    await jobs(new Date(s!.trialEndsAt.getTime() - 10 * DAY));
    expect(conta(/finisce tra pochi giorni/)).toBe(0);
    await jobs(new Date(s!.trialEndsAt.getTime() - 6 * DAY));
    await jobs(new Date(s!.trialEndsAt.getTime() - 5 * DAY));
    expect(conta(/finisce tra pochi giorni/)).toBe(1);
    await jobs(new Date(s!.trialEndsAt.getTime() + DAY));
    await jobs(new Date(s!.trialEndsAt.getTime() + 2 * DAY));
    expect(conta(/è finita/)).toBe(1);
  });
});
