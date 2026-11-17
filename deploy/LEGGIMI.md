# MEMORIAE sul server (Infomaniak Public Cloud)

Un solo server Ubuntu 24.04 con Docker: **Postgres** (database), **app** (server Node con API e lavori
periodici, più app web e sito già compilati) e **Caddy** (HTTPS automatico con Let's Encrypt).

| Indirizzo | Cosa |
|---|---|
| https://app.memoriae.ch | l'app (le chiamate `/v1/*` vanno al server) |
| https://memoriae.ch | il sito (`www.` rimanda qui) |

## 1. DNS (Manager Infomaniak › Domini › memoriae.ch › Zona DNS)

| Tipo | Nome | Valore |
|---|---|---|
| A | `app` | indirizzo IPv4 del server |
| AAAA | `app` | indirizzo IPv6 del server |
| A | *(vuoto, cioè memoriae.ch)* | indirizzo IPv4 del server |
| AAAA | *(vuoto)* | indirizzo IPv6 del server |
| A | `www` | indirizzo IPv4 del server |

Se nella zona ci sono già record A/AAAA per `memoriae.ch` o `www` (pagina di parcheggio di Infomaniak), vanno sostituiti.
**Non toccare** i record MX e quelli della posta.

## 2. Installazione (una volta)

Dal Mac, nella cartella del progetto scaricata da GitHub:

```
scp deploy/installa.sh ubuntu@INDIRIZZO-IP:
ssh ubuntu@INDIRIZZO-IP
bash installa.sh
```

Lo script installa Docker, chiede di aggiungere una *deploy key* su GitHub (sola lettura), scarica il codice in
`/opt/memoriae`, crea `deploy/.env`, accende tutto e programma il backup notturno.

**Subito dopo:** copia `deploy/dati/app/custodia.key` su una chiavetta (vedi il messaggio finale dello script).
Senza quella chiave le cassaforti non si possono più aprire per gli eredi.

## 3. Anteprima e produzione

Lo script parte in **anteprima**: app e sito chiedono nome e password, i pagamenti sono di prova e l'attesa dopo la
verifica dura 10 minuti. Serve per provare con telefoni veri, passkey vere e le prime Carte MEMORIAE.

In anteprima le e-mail non partono: si leggono con

```
tail -n 60 /opt/memoriae/deploy/dati/app/posta.log
```

(con le impostazioni SMTP in `.env` partono anche davvero).

**Per passare alla produzione**, in `/opt/memoriae/deploy/.env`:

1. `CADDYFILE=Caddyfile` (niente più nome e password)
2. `NODE_ENV=production` e togliere `ATTESA_PROVA_SECONDI`
3. `PAYMENTS_PROVIDER=stripe` con `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ESSENZIALE`, `STRIPE_PRICE_FAMIGLIA`
   (avvisi Stripe su `https://app.memoriae.ch/v1/pagamenti/avvisi`)
4. `SMTP_HOST=mail.infomaniak.com`, `SMTP_PORT=465`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM=MEMORIAE <info@memoriae.ch>`
5. `OPERATOR_EMAILS=…` (gli operatori che verificano le aperture)

poi `cd /opt/memoriae/deploy && sudo docker compose up -d`. Se manca qualcosa, il server non parte e il registro
dice cosa (vedi sotto). **`WEBAUTHN_RP_ID` non va mai cambiato** dopo il lancio.

## 4. Lavoro di tutti i giorni

| Cosa | Comando (sul server) |
|---|---|
| Aggiornare all'ultima versione di GitHub | `bash /opt/memoriae/deploy/aggiorna.sh` (fa prima un backup) |
| Vedere se tutto è acceso | `cd /opt/memoriae/deploy && sudo docker compose ps` |
| Leggere il registro dell'app | `cd /opt/memoriae/deploy && sudo docker compose logs --tail 100 app` |
| Backup a mano | `bash /opt/memoriae/deploy/backup.sh` |

I backup (database e file cifrati, ultimi 14 giorni) stanno in `deploy/dati/backup`. Sono sullo stesso server:
il prossimo passo è copiarli ogni notte anche sull'object storage del Public Cloud.
