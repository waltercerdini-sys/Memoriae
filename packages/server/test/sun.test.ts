import { describe, expect, it } from 'vitest';
import { aesCmac, decifraPicc, macValido, sdmMac } from '../src/cards/sun';

describe('carte NTAG 424 DNA (SUN)', () => {
  it('AES-CMAC come da RFC 4493', () => {
    const k = Buffer.from('2b7e151628aed2a6abf7158809cf4f3c', 'hex');
    expect(aesCmac(k, Buffer.alloc(0)).toString('hex')).toBe('bb1d6929e95937287fa37d129b756746');
    expect(aesCmac(k, Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex')).toString('hex')).toBe('070a16b46b4d4144f79bdd9dd04a287c');
  });

  it('esempio della nota NXP AN12196 (chiavi a zero)', () => {
    const zero = Buffer.alloc(16);
    const l = decifraPicc(zero, 'EF963FF7828658A599F3041510671E88');
    expect(l).toEqual({ uid: '04DE5F1EACC040', contatore: 61 });
    expect(sdmMac(zero, l!.uid, l!.contatore).toString('hex').toUpperCase()).toBe('94EED9EE65337086');
    expect(macValido(zero, l!, '94EED9EE65337086')).toBe(true);
    expect(macValido(zero, l!, '94EED9EE65337087')).toBe(false);
  });
});
