import { describe, expect, it } from 'vitest';
import { dominioDi, leggiCsv, totaleAnnuo, trovaAccount, type ServizioCatalogo } from '../src/elencoPassword';

const catalogo: ServizioCatalogo[] = [
  { slug: 'postfinance', nome: 'PostFinance', categoria: 'banca', domini: ['postfinance.ch'] },
  { slug: 'google', nome: 'Google (Gmail, Drive, Foto, Android)', categoria: 'cloud e dispositivi', domini: ['google.com', 'gmail.com'] },
  { slug: 'swisscom', nome: 'Swisscom', categoria: 'telefonia', domini: ['swisscom.ch', 'bluewin.ch'] },
];

const SEGRETO = 'Segreto!Mai-Inviare-42';

describe('Trova tutto', () => {
  it('legge i CSV con virgolette, a capo e punto e virgola', () => {
    expect(leggiCsv('a,b\n"x, y","riga\nnuova"\n')).toEqual([['a', 'b'], ['x, y', 'riga\nnuova']]);
    expect(leggiCsv('﻿a;b\r\n1;2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(leggiCsv('a,b\n"con ""virgolette""",2')).toEqual([['a', 'b'], ['con "virgolette"', '2']]);
  });

  it('ricava il sito principale', () => {
    expect(dominioDi('https://www.e-finance.postfinance.ch/ef/secure/')).toBe('postfinance.ch');
    expect(dominioDi('accounts.google.com')).toBe('google.com');
    expect(dominioDi('https://shop.example.co.uk/login')).toBe('example.co.uk');
    expect(dominioDi('androidapp://com.netflix.mediaclient')).toBe('netflix.com');
    expect(dominioDi('http://192.168.1.1')).toBeNull();
    expect(dominioDi('')).toBeNull();
  });

  it('Chrome: riconosce banche, catalogo e abbonamenti, senza mai restituire le password', () => {
    const csv = [
      'name,url,username,password,note',
      `e-finance.postfinance.ch,https://e-finance.postfinance.ch/,rosa@bluewin.ch,${SEGRETO},`,
      `accounts.google.com,https://accounts.google.com/signin,rosa.bianchi@gmail.com,${SEGRETO},`,
      `mail.google.com,https://mail.google.com/,rosa@gmail.com,${SEGRETO},`,
      `netflix.com,https://www.netflix.com/login,rosa@bluewin.ch,${SEGRETO},`,
      `www.cdt.ch,https://www.cdt.ch/,rosa,${SEGRETO},`,
      `forum.bricolage.it,https://forum.bricolage.it/,rosa77,${SEGRETO},`,
      `router,http://192.168.1.1,admin,${SEGRETO},`,
    ].join('\n');
    const e = trovaAccount(csv, catalogo);
    expect(e.formato).toBe('Chrome, Edge o Brave');
    expect(e.righe).toBe(7);
    expect(e.passwordScartate).toBe(7);
    expect(JSON.stringify(e)).not.toContain(SEGRETO);
    const per = Object.fromEntries(e.account.map((a) => [a.chiave, a]));
    expect(per.postfinance).toMatchObject({ nome: 'PostFinance', categoria: 'banca', fornitore: 'postfinance', importante: true, accessi: ['rosa@bluewin.ch'] });
    // Due righe Google diventano un solo account, con entrambi gli indirizzi.
    expect(per.google!.accessi.sort()).toEqual(['rosa.bianchi@gmail.com', 'rosa@gmail.com']);
    expect(per['netflix.com']).toMatchObject({ nome: 'Netflix', categoria: 'abbonamento', importante: false });
    expect(per['cdt.ch']).toMatchObject({ nome: 'Corriere del Ticino', categoria: 'abbonamento', accessi: [] });
    expect(per['bricolage.it']).toMatchObject({ categoria: 'altro', nome: 'forum.bricolage.it' });
    expect(per['192.168.1.1']).toBeUndefined();
    // Prima le banche.
    expect(e.account[0]!.categoria).toBe('banca');
  });

  it('Apple, Bitwarden e Firefox', () => {
    const apple = trovaAccount(`Title,URL,Username,Password,Notes,OTPAuth\nSwisscom,https://login.swisscom.ch,rosa@bluewin.ch,${SEGRETO},,\n`, catalogo);
    expect(apple.formato).toBe('Password di Apple (Mac o iPhone)');
    expect(apple.account[0]).toMatchObject({ fornitore: 'swisscom', categoria: 'telefonia' });

    const bw = trovaAccount(
      `folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,Banca,,,0,"https://www.zkb.ch,https://ebanking.zkb.ch",rosa,${SEGRETO},\n,,note,Nota sicura,testo,,0,,,,\n`,
      catalogo,
    );
    expect(bw.formato).toBe('Bitwarden');
    expect(bw.account).toHaveLength(1);
    expect(bw.account[0]).toMatchObject({ nome: 'Zürcher Kantonalbank', categoria: 'banca' });

    const ff = trovaAccount(`"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n"https://www.coinbase.com","rosa@bluewin.ch","${SEGRETO}",,"https://www.coinbase.com","{1}","1","2","3"\n`, catalogo);
    expect(ff.formato).toBe('Firefox');
    expect(ff.account[0]).toMatchObject({ nome: 'Coinbase', categoria: 'crypto', importante: true });
    expect(JSON.stringify([apple, bw, ff])).not.toContain(SEGRETO);
  });

  it('spiega cosa non va con un file sbagliato', () => {
    expect(() => trovaAccount('solo una riga', catalogo)).toThrow(/non contiene righe/);
    expect(() => trovaAccount('a,b\n1,2', catalogo)).toThrow(/colonna con i siti/);
  });

  it('somma gli abbonamenti indicati', () => {
    expect(totaleAnnuo([18.9, undefined, 12.95, -3])).toBe(382);
  });
});
