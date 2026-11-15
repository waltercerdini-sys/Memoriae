import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Carte NFC NXP NTAG 424 DNA con «Secure Unique NFC» (SUN): a ogni lettura il chip scrive nel
 * collegamento i dati cifrati (UID e contatore) e un codice di controllo (CMAC) sempre diverso.
 * Algoritmi come da nota applicativa NXP AN12196 (SDM, AES-128).
 */

const ZERO_IV = Buffer.alloc(16);

function aesEcb(key: Buffer, block: Buffer): Buffer {
  const c = createCipheriv('aes-128-ecb', key, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(block), c.final()]);
}

function shiftLeft(b: Buffer): Buffer {
  const out = Buffer.alloc(b.length);
  let carry = 0;
  for (let i = b.length - 1; i >= 0; i--) {
    out[i] = ((b[i]! << 1) | carry) & 0xff;
    carry = (b[i]! & 0x80) >> 7;
  }
  return out;
}

/** AES-CMAC (RFC 4493). */
export function aesCmac(key: Buffer, msg: Buffer): Buffer {
  const L = aesEcb(key, Buffer.alloc(16));
  const k1 = shiftLeft(L);
  if (L[0]! & 0x80) k1[15]! ^= 0x87;
  const k2 = shiftLeft(k1);
  if (k1[0]! & 0x80) k2[15]! ^= 0x87;
  const n = Math.max(1, Math.ceil(msg.length / 16));
  const completo = msg.length > 0 && msg.length % 16 === 0;
  let x = Buffer.alloc(16);
  for (let i = 0; i < n; i++) {
    let blocco = msg.subarray(i * 16, i * 16 + 16);
    if (i === n - 1) {
      if (completo) blocco = Buffer.from(blocco.map((v, j) => v ^ k1[j]!));
      else {
        const p = Buffer.alloc(16);
        blocco.copy(p);
        p[blocco.length] = 0x80;
        blocco = Buffer.from(p.map((v, j) => v ^ k2[j]!));
      }
    }
    x = aesEcb(key, Buffer.from(x.map((v, j) => v ^ blocco[j]!)));
  }
  return x;
}

export interface LetturaCarta {
  uid: string; // 14 caratteri esadecimali (7 byte)
  contatore: number;
}

/** Decifra i dati della carta (UID e contatore di letture) con la chiave «meta» comune a tutte le carte. */
export function decifraPicc(chiaveMeta: Buffer, piccHex: string): LetturaCarta | null {
  if (!/^[0-9a-fA-F]{32}$/.test(piccHex)) return null;
  const d = createDecipheriv('aes-128-cbc', chiaveMeta, ZERO_IV);
  d.setAutoPadding(false);
  const p = Buffer.concat([d.update(Buffer.from(piccHex, 'hex')), d.final()]);
  // 0xC7 = UID (7 byte) e contatore (3 byte) presenti.
  if (p[0] !== 0xc7) return null;
  const uid = p.subarray(1, 8).toString('hex').toUpperCase();
  const contatore = p[8]! | (p[9]! << 8) | (p[10]! << 16);
  return { uid, contatore };
}

/** Il codice di controllo (8 byte) che la carta calcola per questa lettura. */
export function sdmMac(chiaveFile: Buffer, uidHex: string, contatore: number): Buffer {
  const sv2 = Buffer.concat([
    Buffer.from([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]),
    Buffer.from(uidHex, 'hex'),
    Buffer.from([contatore & 0xff, (contatore >> 8) & 0xff, (contatore >> 16) & 0xff]),
  ]);
  const sessione = aesCmac(chiaveFile, sv2);
  const pieno = aesCmac(sessione, Buffer.alloc(0));
  return Buffer.from([1, 3, 5, 7, 9, 11, 13, 15].map((i) => pieno[i]!));
}

export function macValido(chiaveFile: Buffer, lettura: LetturaCarta, cmacHex: string): boolean {
  if (!/^[0-9a-fA-F]{16}$/.test(cmacHex)) return false;
  const atteso = sdmMac(chiaveFile, lettura.uid, lettura.contatore);
  return timingSafeEqual(atteso, Buffer.from(cmacHex, 'hex'));
}

/**
 * Chiavi delle carte, ricavate da una chiave madre conservata sul server:
 * la «meta» è comune (serve a leggere l'UID), quella «file» è diversa per ogni carta.
 */
export function chiaviCarta(chiaveMadre: Buffer, uidHex?: string) {
  const deriva = (etichetta: string) => createHmac('sha256', chiaveMadre).update(etichetta).digest().subarray(0, 16);
  return {
    meta: deriva('memoriae-carta-meta'),
    file: uidHex ? deriva(`memoriae-carta-file:${uidHex.toUpperCase()}`) : null,
  };
}

/** Come scriverebbe il chip il collegamento per una lettura (per le prove senza carta vera). */
export function simulaLettura(chiaveMadre: Buffer, uidHex: string, contatore: number): { picc: string; cmac: string } {
  const k = chiaviCarta(chiaveMadre, uidHex);
  const blocco = Buffer.alloc(16);
  blocco[0] = 0xc7;
  Buffer.from(uidHex, 'hex').copy(blocco, 1);
  blocco[8] = contatore & 0xff;
  blocco[9] = (contatore >> 8) & 0xff;
  blocco[10] = (contatore >> 16) & 0xff;
  randomFill(blocco, 11);
  const c = createCipheriv('aes-128-cbc', k.meta, ZERO_IV);
  c.setAutoPadding(false);
  const picc = Buffer.concat([c.update(blocco), c.final()]).toString('hex').toUpperCase();
  return { picc, cmac: sdmMac(k.file!, uidHex.toUpperCase(), contatore).toString('hex').toUpperCase() };
}

function randomFill(b: Buffer, da: number) {
  const r = randomBytes(b.length - da);
  r.copy(b, da);
}
