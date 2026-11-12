import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Pagamenti: MEMORIAE non tocca mai carte o conti. Manda l'utente alla pagina del fornitore
 * (TWINT o carta) e riceve dal fornitore un avviso firmato quando qualcosa cambia.
 */
export type Plan = 'essenziale' | 'famiglia';

/** Prezzi annui in franchi (ipotesi del dossier, da validare con notai e fiduciarie). */
export const PLANS: Record<Plan, { nome: string; chfAnno: number; descrizione: string }> = {
  essenziale: { nome: 'Essenziale', chfAnno: 59, descrizione: '1 persona: inventario, volontà, persone di fiducia, controllo periodico' },
  famiglia: { nome: 'Famiglia', chfAnno: 99, descrizione: '2 adulti, ognuno con la sua cassaforte: tutto l\'Essenziale' },
};

export interface CheckoutRequest {
  userId: string;
  email: string;
  plan: Plan;
  customerId: string | null;
  successUrl: string;
  cancelUrl: string;
}

/** Evento del fornitore, già verificato e tradotto nel linguaggio di MEMORIAE. */
export type PaymentEvent =
  | {
      id: string;
      kind: 'abbonamento';
      userId: string | null;
      customerId: string;
      subscriptionId: string;
      plan: Plan | null;
      status: 'attivo' | 'in-ritardo' | 'annullato';
      paidUntil: Date | null;
      cancelAtPeriodEnd: boolean;
    }
  | { id: string; kind: 'checkout-completato'; userId: string; customerId: string; subscriptionId: string | null; plan: Plan | null }
  | { id: string; kind: 'pagamento-fallito'; customerId: string }
  | { id: string; kind: 'ignorato'; type: string };

export interface PaymentProvider {
  readonly name: 'prova' | 'stripe';
  createCheckout(req: CheckoutRequest): Promise<{ url: string }>;
  /** Pagina del fornitore per cambiare metodo di pagamento, scaricare ricevute o disdire. */
  createPortal(customerId: string, returnUrl: string): Promise<{ url: string }>;
  /** Verifica la firma e traduce l'evento. Lancia un errore se la firma non è valida. */
  parseWebhook(rawBody: string, signature: string | undefined): Promise<PaymentEvent>;
}

// ---------------------------------------------------------------------------
// Stripe (TWINT, carte). Chiamate dirette all'API REST, senza librerie aggiuntive.
// ---------------------------------------------------------------------------

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  prices: Record<Plan, string>;
  /** Tolleranza sull'orario della firma, in secondi. */
  toleranceSeconds?: number;
  fetchFn?: typeof fetch;
}

function form(params: Record<string, string | number | boolean | undefined>): string {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.append(k, String(v));
  return body.toString();
}

const STRIPE_STATUS: Record<string, 'attivo' | 'in-ritardo' | 'annullato'> = {
  active: 'attivo',
  trialing: 'attivo',
  past_due: 'in-ritardo',
  unpaid: 'in-ritardo',
  incomplete: 'in-ritardo',
  canceled: 'annullato',
  incomplete_expired: 'annullato',
  paused: 'annullato',
};

/** Verifica la firma «Stripe-Signature» (t=…, v1=…) come da documentazione Stripe. */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, toleranceSeconds = 300, now = Date.now()): void {
  if (!header) throw new Error('Firma mancante');
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || signatures.length === 0) throw new Error('Firma non valida');
  if (Math.abs(now / 1000 - Number(t)) > toleranceSeconds) throw new Error('Firma scaduta');
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const ok = signatures.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!ok) throw new Error('Firma non valida');
}

export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  private readonly fetchFn: typeof fetch;
  constructor(private readonly cfg: StripeConfig) {
    this.fetchFn = cfg.fetchFn ?? fetch;
  }

  private async post<T>(path: string, params: Record<string, string | number | boolean | undefined>): Promise<T> {
    const res = await this.fetchFn(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.cfg.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form(params),
    });
    const data = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`Stripe: ${data.error?.message ?? res.status}`);
    return data;
  }

  async createCheckout(req: CheckoutRequest) {
    const s = await this.post<{ url: string }>('checkout/sessions', {
      mode: 'subscription',
      'line_items[0][price]': this.cfg.prices[req.plan],
      'line_items[0][quantity]': 1,
      // TWINT e carte: l'elenco preciso si decide nel pannello Stripe (metodi di pagamento attivi).
      client_reference_id: req.userId,
      ...(req.customerId ? { customer: req.customerId } : { customer_email: req.email }),
      'metadata[userId]': req.userId,
      'metadata[piano]': req.plan,
      'subscription_data[metadata][userId]': req.userId,
      'subscription_data[metadata][piano]': req.plan,
      locale: 'it',
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
    });
    return { url: s.url };
  }

  async createPortal(customerId: string, returnUrl: string) {
    const s = await this.post<{ url: string }>('billing_portal/sessions', { customer: customerId, return_url: returnUrl, locale: 'it' });
    return { url: s.url };
  }

  async parseWebhook(rawBody: string, signature: string | undefined): Promise<PaymentEvent> {
    verifyStripeSignature(rawBody, signature, this.cfg.webhookSecret, this.cfg.toleranceSeconds);
    const ev = JSON.parse(rawBody) as { id: string; type: string; data: { object: Record<string, unknown> } };
    const o = ev.data.object as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const plan = (p: unknown): Plan | null => (p === 'essenziale' || p === 'famiglia' ? p : null);
    switch (ev.type) {
      case 'checkout.session.completed':
        return {
          id: ev.id,
          kind: 'checkout-completato',
          userId: String(o.client_reference_id ?? o.metadata?.userId ?? ''),
          customerId: String(o.customer),
          subscriptionId: o.subscription ? String(o.subscription) : null,
          plan: plan(o.metadata?.piano),
        };
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        // Nelle versioni recenti dell'API la fine del periodo sta sulle singole voci.
        const end = o.current_period_end ?? o.items?.data?.[0]?.current_period_end;
        return {
          id: ev.id,
          kind: 'abbonamento',
          userId: o.metadata?.userId ?? null,
          customerId: String(o.customer),
          subscriptionId: String(o.id),
          plan: plan(o.metadata?.piano),
          status: ev.type === 'customer.subscription.deleted' ? 'annullato' : (STRIPE_STATUS[String(o.status)] ?? 'in-ritardo'),
          paidUntil: typeof end === 'number' ? new Date(end * 1000) : null,
          cancelAtPeriodEnd: !!o.cancel_at_period_end,
        };
      }
      case 'invoice.payment_failed':
        return { id: ev.id, kind: 'pagamento-fallito', customerId: String(o.customer) };
      default:
        return { id: ev.id, kind: 'ignorato', type: ev.type };
    }
  }
}

// ---------------------------------------------------------------------------
// Prova (solo sviluppo): una pagina dell'app imita quella di TWINT, nessun denaro si muove.
// ---------------------------------------------------------------------------

export class TrialProvider implements PaymentProvider {
  readonly name = 'prova' as const;
  constructor(private readonly createTrialCheckout: (req: CheckoutRequest) => Promise<string>, private readonly appOrigin: string) {}

  async createCheckout(req: CheckoutRequest) {
    const id = await this.createTrialCheckout(req);
    return { url: `${this.appOrigin}/?pagamento=${id}` };
  }

  async createPortal(_customerId: string, returnUrl: string) {
    return { url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}portale=prova` };
  }

  async parseWebhook(): Promise<PaymentEvent> {
    throw new Error('In prova non arrivano avvisi dal fornitore');
  }
}
