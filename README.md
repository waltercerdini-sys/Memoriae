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

## Comandi

```bash
npm install
npm test          # test di tutti i pacchetti
npm run typecheck # controllo dei tipi
```

## Nucleo di cifratura in breve

- Ogni voce ha la sua chiave (XChaCha20-Poly1305); le chiavi delle voci sono cifrate con la chiave della cassaforte.
- La chiave della cassaforte si apre con la passkey (WebAuthn PRF), una password (Argon2id) o il codice di recupero stampato.
- Chiave di rilascio = unione della **metà MEMORIAE** (una per scopo: decesso, emergenza) e della **metà fiduciari**.
  Nessuna delle due da sola apre nulla.
- I pacchetti destinatario hanno due strati: esterno con la chiave di rilascio, interno con la chiave pubblica del destinatario.
- Recupero sociale opzionale: soglia di fiduciari (Shamir) + metà MEMORIAE di recupero.
- Librerie: `libsodium-wrappers-sumo`, `shamir-secret-sharing` (verificata esternamente). Nessuna crittografia scritta in casa.

Prima del lancio il nucleo di cifratura e il flusso di attivazione devono passare un test di sicurezza indipendente.
