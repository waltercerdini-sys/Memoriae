import {
  addFiduciary,
  buildRecipientPackage,
  createReleaseSetup,
  decodePublicKey,
  ownerReleaseKey,
  wipe,
  type PackageItemKey,
} from '@memoriae/crypto';
import { api, ApiError, type PacchettoRemoto, type Persona } from './api';
import { chiaveVoce, type Voce } from './vault';

/**
 * Prepara, nel browser del proprietario, tutto ciò che servirà al rilascio:
 * - la prima volta che una persona di fiducia accetta: crea le due metà della chiave di rilascio;
 * - per ogni nuova persona di fiducia: le cifra la sua metà;
 * - ricostruisce i pacchetti: per ogni persona le voci assegnate (decesso),
 *   per ogni persona di fiducia le voci d'emergenza.
 * Il server riceve solo dati cifrati e le metà destinate alla custodia.
 */

export const eFiduciario = (p: Persona) => p.ruolo === 'fiduciario' || p.ruolo === 'fiduciario-destinatario';

export type StatoRilascio =
  | { stato: 'senza-fiduciari' }
  | { stato: 'pronto'; pacchetti: number; fiduciari: number; senzaAccount: number };

const b64url = (k: Uint8Array) => {
  let s = '';
  for (const b of k) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Una sola sincronizzazione alla volta (due chiamate parallele creerebbero rilasci in conflitto). */
let inCorso: Promise<StatoRilascio> | null = null;

export function sincronizzaRilascio(vaultId: string, vaultKey: Uint8Array, voci: Voce[]): Promise<StatoRilascio> {
  const prossima = (inCorso ?? Promise.resolve(null as unknown as StatoRilascio))
    .catch(() => null)
    .then(() => sincronizza(vaultId, vaultKey, voci));
  inCorso = prossima;
  return prossima;
}

async function sincronizza(vaultId: string, vaultKey: Uint8Array, voci: Voce[]): Promise<StatoRilascio> {
  const { persone } = await api.persone();
  const accettati = persone.filter((p) => p.statoInvito === 'accettato' && p.chiavePubblica);
  const fiduciari = accettati.filter(eFiduciario);
  if (fiduciari.length === 0) return { stato: 'senza-fiduciari' };

  const conChiave = async (p: Persona) => ({ personId: p.id, publicKey: await decodePublicKey(p.chiavePubblica!) });
  const r = await api.rilascio();
  let ownerCopy = r.copiaProprietario;
  if (!r.configurato || !ownerCopy) {
    const setup = await createReleaseSetup(vaultId, vaultKey, await Promise.all(fiduciari.map(conChiave)));
    try {
      await api.impostaRilascio({
        copiaProprietario: setup.ownerCopy,
        metaMemoriae: { decesso: b64url(setup.memoriaeHalves.decesso), emergenza: b64url(setup.memoriaeHalves.emergenza) },
        metaFiduciari: setup.sealedFiduciaryHalves.map((h) => ({ personaId: h.personId, sigillata: h.sealed })),
      });
      ownerCopy = setup.ownerCopy;
    } catch (e) {
      // Un altro dispositivo l'ha già impostato: si usa il suo.
      if (!(e instanceof ApiError && e.status === 409)) throw e;
      return sincronizza(vaultId, vaultKey, voci);
    } finally {
      await wipe(setup.memoriaeHalves.decesso, setup.memoriaeHalves.emergenza);
    }
  } else {
    for (const f of fiduciari.filter((p) => !p.haMetaFiduciario)) {
      const sealed = await addFiduciary(vaultId, vaultKey, ownerCopy, await conChiave(f));
      await api.metaFiduciario(f.id, sealed.sealed);
    }
  }

  const kDecesso = await ownerReleaseKey(vaultId, vaultKey, ownerCopy, 'decesso');
  const kEmergenza = await ownerReleaseKey(vaultId, vaultKey, ownerCopy, 'emergenza');
  const chiavi = new Map<string, Uint8Array>();
  for (const v of voci) chiavi.set(v.id, await chiaveVoce(vaultKey, v));
  const items = (vs: Voce[]): PackageItemKey[] => vs.map((v) => ({ itemId: v.id, itemKey: chiavi.get(v.id)! }));

  const pacchetti: PacchettoRemoto[] = [];
  let senzaAccount = 0;
  for (const p of persone) {
    const assegnate = voci.filter((v) => v.contenuto.destinatari?.includes(p.id));
    if (assegnate.length === 0) continue;
    const accettato = p.statoInvito === 'accettato' && !!p.chiavePubblica;
    if (!accettato) senzaAccount++;
    const pkg = await buildRecipientPackage({
      vaultId,
      packageId: `${p.id}:decesso`,
      scope: 'decesso',
      releaseKey: kDecesso,
      recipientId: p.id,
      recipientPublicKey: accettato ? await decodePublicKey(p.chiavePubblica!) : undefined,
      items: items(assegnate),
    });
    pacchetti.push({ destinatarioId: p.id, ambito: 'decesso', tipo: pkg.kind, esterno: pkg.outer });
  }
  const urgenti = voci.filter((v) => v.emergenza);
  if (urgenti.length > 0) {
    for (const f of fiduciari) {
      const pkg = await buildRecipientPackage({
        vaultId,
        packageId: `${f.id}:emergenza`,
        scope: 'emergenza',
        releaseKey: kEmergenza,
        recipientId: f.id,
        recipientPublicKey: await decodePublicKey(f.chiavePubblica!),
        items: items(urgenti),
      });
      pacchetti.push({ destinatarioId: f.id, ambito: 'emergenza', tipo: pkg.kind, esterno: pkg.outer });
    }
  }
  await api.pacchetti(ownerCopy.nonce, pacchetti);
  await wipe(kDecesso, kEmergenza, ...chiavi.values());
  return { stato: 'pronto', pacchetti: pacchetti.length, fiduciari: fiduciari.length, senzaAccount };
}
