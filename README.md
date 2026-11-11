# MEMORIAE

La regia svizzera dell'eredità digitale: inventario, volontà e fiduciari in un unico posto,
senza custodire password né chiavi crypto. Progetto di Valmara14 Sagl (Arogno).

## Principi

1. **Conoscenza zero:** tutto è cifrato nel browser; il server conserva solo dati cifrati.
2. **Nessuna credenziale custodita:** niente password di terzi, niente frasi di recupero crypto.
3. **Nessun rilascio automatico:** verifica umana e periodo d'attesa prima di ogni rilascio.
4. **Rilascio selettivo:** ogni destinatario apre solo le voci assegnate a lui.
5. **Dati in Svizzera.**

Il documento di architettura completo è nel progetto Claude "Eredità digitale per la Confederazione Elvetica".

## Struttura

| Cartella | Contenuto |
| --- | --- |
| `packages/crypto` | Nucleo di cifratura: cassaforte, voci, pacchetti destinatario, rilascio a due metà, recupero, impronta |
| `packages/server` | Server: API (Fastify), schema del database (Drizzle, PostgreSQL), casi di attivazione, controllo periodico, catalogo fornitori |

## Comandi

```bash
npm install
npm test          # test di tutti i pacchetti (il server usa un Postgres in memoria)
npm run typecheck # controllo dei tipi

# Sviluppo locale del server
cp .env.example .env
docker compose up -d                       # Postgres 16
npm run db:migrate -w @memoriae/server     # migrazioni + catalogo fornitori
npm run dev -w @memoriae/server            # http://localhost:3000/health
```

Ogni modifica su GitHub passa dai controlli automatici (tipi, test, migrazioni su Postgres).
Hosting previsto: Infomaniak Public Cloud (Svizzera).

## Regole del server

- Il server riceve solo buste cifrate nel browser; le metà MEMORIAE delle chiavi stanno nel servizio di gestione chiavi, non nel database.
- Un controllo periodico mancato **non** attiva nulla: avvisa i fiduciari.
- Nessun rilascio senza verifica di un operatore e fine del periodo d'attesa (14 giorni decesso, 72 ore emergenza).
- Il registro eventi non si può modificare né cancellare (vincolo nel database).

## Nucleo di cifratura in breve

- Ogni voce ha la sua chiave (XChaCha20-Poly1305); le chiavi delle voci sono cifrate con la chiave della cassaforte.
- La chiave della cassaforte si apre con la passkey (WebAuthn PRF), una password (Argon2id) o il codice di recupero stampato.
- Chiave di rilascio = unione della **metà MEMORIAE** (una per scopo: decesso, emergenza) e della **metà fiduciari**.
  Nessuna delle due da sola apre nulla.
- I pacchetti destinatario hanno due strati: esterno con la chiave di rilascio, interno con la chiave pubblica del destinatario.
- Recupero sociale opzionale: soglia di fiduciari (Shamir) + metà MEMORIAE di recupero.
- Librerie: `libsodium-wrappers-sumo`, `shamir-secret-sharing` (verificata esternamente). Nessuna crittografia scritta in casa.

Prima del lancio il nucleo di cifratura e il flusso di attivazione devono passare un test di sicurezza indipendente.
