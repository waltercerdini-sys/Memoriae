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
| `packages/server` | Server: API (Fastify), passkey e sessioni, schema del database (Drizzle, PostgreSQL), casi di attivazione, controllo periodico, catalogo fornitori |
| `packages/web` | App web (React, Vite): registrazione con passkey, codice di recupero, inventario cifrato nel browser |
| `packages/site` | Sito vetrina: presentazione, prezzi, condizioni d'uso, protezione dei dati, note legali |
| `e2e/` | Prova completa nel browser con passkey virtuale di Chrome |

## Provare l'app sul proprio computer (il modo più semplice)

Serve solo **Node.js** (installer da https://nodejs.org, versione LTS). Poi, nella cartella del progetto:

```bash
npm run prova   # installa ciò che serve (se manca), avvia tutto e apre il browser su http://localhost:5173
```

Non serve Postgres: i dati di prova stanno nella cartella `data/` (si può cancellare per ricominciare).
Le e-mail (codici, inviti, promemoria, collegamenti «blocca») compaiono nel terminale. Per fermare: Ctrl+C.

In prova l'attesa prima di un'apertura dura 2 minuti (invece di 14 giorni o 72 ore) e chiunque può fare
da operatore, ma mai sulle cassaforti in cui è coinvolto. Per provare tutto il percorso servono quattro
persone: si usano finestre diverse del browser (per esempio Safari, Chrome e una finestra privata).

## Sito vetrina

```bash
npm run sito      # http://localhost:5174
```

I dati dell'azienda (indirizzo, IDI, e-mail, telefono, IVA, dominio) stanno in un solo file,
`packages/site/azienda.json`: i valori tra parentesi quadre compaiono evidenziati in giallo finché non vengono completati.
Le condizioni d'uso e l'informativa sulla protezione dei dati sono bozze da far verificare a un giurista.

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
npm run dev -w @memoriae/web               # http://localhost:5173

# Prova completa nel browser (server e app avviati)
node e2e/percorso.mjs                      # passkey con PRF
SENZA_PRF=1 node e2e/percorso.mjs          # dispositivo senza PRF: password di riserva
node e2e/recupero.mjs                      # passkey persa: recupero su un nuovo dispositivo
node e2e/persone.mjs                       # persone di fiducia, invito via e-mail, volontà e pacchetti
# con ATTESA_PROVA_SECONDI=5 JOBS_INTERVAL_SECONDS=5 npm run prova:
MAIL_OUTBOX=data/posta.log node e2e/attivazione.mjs   # richiesta, blocco, verifica, attesa, apertura, consegna
node e2e/piano.mjs                                    # prova gratuita, scelta del piano, pagamento simulato
```

In sviluppo le e-mail (per esempio il codice di recupero) non vengono spedite: compaiono nel terminale
del server e nel file `packages/server/data/posta.log`.

## Accesso e apertura della cassaforte

- **Entrare** (dimostrare chi sei): sempre con la passkey (Face ID, impronta, PIN).
- **Aprire la cassaforte** (decifrare): con il segreto PRF della stessa passkey, che resta nel browser.
  Se il dispositivo non supporta PRF, con una password di almeno 12 caratteri (Argon2id).
- **Codice di recupero**: obbligatorio alla creazione, mostrato una sola volta, da stampare.
- **Passkey persa**: servono il codice di 6 cifre inviato per e-mail **e** il codice di recupero stampato.
  Il browser apre la cassaforte con il codice; al server arriva solo un verificatore. Alla fine le vecchie
  passkey e sessioni vengono disattivate e l'utente riceve un avviso per e-mail.

Ogni modifica su GitHub passa dai controlli automatici (tipi, test, migrazioni su Postgres).
Hosting previsto: Infomaniak Public Cloud (Svizzera).

## Persone e volontà

- **Persone di fiducia**: ricevono una metà della chiave di rilascio (cifrata per loro) e le voci d'emergenza.
- **Destinatari**: ricevono solo le voci assegnate. Senza account, il loro pacchetto lo apre una persona di fiducia.
- Per accettare un invito serve una propria cassaforte (è lì che si riceve in modo sicuro).
- Le assegnazioni stanno dentro le voci cifrate; il browser del proprietario ricostruisce i pacchetti a ogni modifica.
- Le metà MEMORIAE vanno nella custodia: in sviluppo cifrate con una chiave in `data/custodia.key`,
  in produzione in un servizio di gestione chiavi separato (da scegliere).

## Controllo periodico e attivazione

- **Sono qui**: ogni 7, 30 o 90 giorni MEMORIAE chiede se va tutto bene (un clic nell'e-mail, oppure entrare nell'app).
  Dopo 3 promemoria senza risposta avvisa le persone di fiducia. Non apre nulla.
- **Richiesta**: una persona di fiducia chiede l'apertura per *emergenza* o *decesso*, spiega e allega un documento
  (cifrato dal server, lo legge solo l'operatore). Il proprietario riceve subito un collegamento per bloccarla.
- **Verifica**: un operatore MEMORIAE (`OPERATOR_EMAILS`) prende in carico e approva o respinge.
  Non può mai decidere su cassaforti in cui è coinvolto.
- **Attesa**: 14 giorni (decesso) o 72 ore (emergenza). Il proprietario può bloccare fino all'ultimo.
- **Apertura**: la metà MEMORIAE esce solo verso una persona di fiducia; l'unione con la sua metà avviene nel suo
  browser, che apre i pacchetti, consegna quelli cifrati per i destinatari e mostra quelli da consegnare a mano.
- **Emergenza**: solo le voci d'emergenza, per 30 giorni; il proprietario può chiudere l'accesso prima.

## Catalogo dei servizi

Per ogni servizio (Apple, Google, Microsoft, Facebook, PayPal, Bitwarden, SwissID, TWINT, PostFinance, UBS,
Raiffeisen, Swisscom, FFS, …) il catalogo dice cosa fare da vivi e cosa dovranno fare gli eredi, con la pagina
ufficiale e la data di verifica. Ogni voce è «verificato», «parziale» o «da-verificare»; gli eredi vedono le
indicazioni accanto alle voci ricevute. Le procedure cambiano: le voci vanno ricontrollate ogni 6 mesi
(`npm run catalogo:da-ricontrollare -w @memoriae/server`).

## Piani e pagamenti

- **Prova gratuita** di 30 giorni con tutte le funzioni, senza dati di pagamento.
- **Essenziale** CHF 59/anno, **Famiglia** CHF 99/anno (due adulti, ognuno con la sua cassaforte). Prezzi da validare.
- Pagamento con **TWINT o carta** sulla pagina sicura di Stripe; rinnovo annuale automatico, disdetta e ricevute
  dalla pagina del fornitore. MEMORIAE non vede né conserva dati di carte o conti.
- Senza piano dopo la prova la cassaforte diventa di sola lettura: si legge, si cancella, si riceve, si fa da
  persona di fiducia, e ciò che è pronto per gli eredi resta valido. **Il pagamento non blocca mai un'apertura.**
- In prova (`npm run prova`) il pagamento è simulato da una pagina dell'app.
- Per Stripe: creare i due prezzi annuali in CHF, attivare TWINT nei metodi di pagamento, impostare l'avviso
  (webhook) su `/v1/pagamenti/avvisi` con gli eventi `checkout.session.completed`, `customer.subscription.*`,
  `invoice.payment_failed`, e attivare il portale clienti.

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
