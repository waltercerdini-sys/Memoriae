import { useMemo, useState } from 'react';
import type { Fornitore } from './api';
import { NOME_CATEGORIA, totaleAnnuo, trovaAccount, type AccountTrovato, type Categoria, type EsitoLettura } from './trovatutto';
import { aggiungiVoce, type Voce } from './vault';

type Fonte = 'apple' | 'chrome' | 'firefox' | 'bitwarden' | 'altro';

const FONTI: { id: Fonte; nome: string; passi: string[] }[] = [
  {
    id: 'apple',
    nome: 'Mac o iPhone',
    passi: [
      'Sul Mac apri l\'app Password (oppure Safari › Impostazioni › Password).',
      'Menu File › Esporta tutte le password in un file…',
      'Salva il file sulla Scrivania: si chiama per esempio «Password.csv».',
    ],
  },
  {
    id: 'chrome',
    nome: 'Chrome o Edge',
    passi: [
      'Apri Chrome › menu ⋮ › Password e compilazione automatica › Gestore delle password di Google.',
      'Impostazioni › Esporta password › Scarica file.',
      'Il file si chiama «Chrome Passwords.csv» e finisce nella cartella Download.',
    ],
  },
  {
    id: 'firefox',
    nome: 'Firefox',
    passi: ['Scrivi about:logins nella barra degli indirizzi.', 'Menu ⋯ in alto a destra › Esporta credenziali.', 'Salva il file «logins.csv».'],
  },
  {
    id: 'bitwarden',
    nome: 'Bitwarden',
    passi: ['Apri la cassaforte web di Bitwarden › Strumenti › Esporta cassaforte.', 'Formato: .csv › Conferma il formato.', 'Salva il file.'],
  },
  {
    id: 'altro',
    nome: 'Altro',
    passi: ['Quasi tutti i gestori di password sanno esportare un file .csv (cerca «Esporta» nelle impostazioni).', 'Basta che contenga una colonna con i siti (URL).'],
  },
];

const chf = (n: number) => `CHF ${n.toLocaleString('de-CH')}`;

/** «Trova tutto»: dall'elenco delle password all'inventario, in pochi minuti. */
export function TrovaTutto(p: { vaultKey: Uint8Array; fornitori: Fornitore[]; voci: Voce[]; onFatto: (aggiunte: number) => Promise<void>; onAnnulla: () => void }) {
  const [fonte, setFonte] = useState<Fonte>('apple');
  const [esito, setEsito] = useState<EsitoLettura | null>(null);
  const [scelti, setScelti] = useState<Set<string>>(new Set());
  const [importi, setImporti] = useState<Record<string, string>>({});
  const [errore, setErrore] = useState<string | null>(null);
  const [avanzamento, setAvanzamento] = useState<{ fatte: number; totale: number } | null>(null);

  const gia = useMemo(() => {
    const s = new Set<string>();
    for (const v of p.voci) {
      if (v.contenuto.fornitore) s.add(v.contenuto.fornitore);
      if (v.contenuto.dominio) s.add(v.contenuto.dominio);
    }
    return s;
  }, [p.voci]);
  const giaPresente = (a: AccountTrovato) => gia.has(a.chiave) || gia.has(a.dominio);

  async function leggi(file: File) {
    setErrore(null);
    try {
      const testo = await file.text();
      const catalogo = p.fornitori.map((f) => ({ slug: f.slug, nome: f.nome, categoria: f.categoria, domini: f.domini }));
      const e = trovaAccount(testo, catalogo);
      setEsito(e);
      setScelti(new Set(e.account.filter((a) => (a.importante || a.categoria === 'abbonamento') && !giaPresente(a)).map((a) => a.chiave)));
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Non riesco a leggere il file');
    }
  }

  if (!esito) {
    const f = FONTI.find((x) => x.id === fonte)!;
    return (
      <section className="passo">
        <h1>Trova tutto</h1>
        <p>
          In pochi minuti MEMORIAE prepara l'elenco dei tuoi account partendo dall'elenco delle password che il tuo computer già
          conosce. Poi decidi tu cosa tenere.
        </p>
        <div className="riquadro evidenza">
          <p>
            <strong>Le password restano a te.</strong> Il file viene letto qui, sul tuo dispositivo, e non viene mai inviato. MEMORIAE
            tiene solo il nome dei siti e l'indirizzo e-mail con cui entri.
          </p>
        </div>
        <h2>1. Esporta l'elenco delle password</h2>
        <div className="schede" role="tablist">
          {FONTI.map((x) => (
            <button key={x.id} role="tab" aria-selected={fonte === x.id} className={fonte === x.id ? 'attiva' : ''} onClick={() => setFonte(x.id)}>
              {x.nome}
            </button>
          ))}
        </div>
        <ol>
          {f.passi.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
        <h2>2. Scegli il file</h2>
        <label className="zona-file">
          <span>Scegli il file esportato (.csv)</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void leggi(file);
              e.target.value = '';
            }}
          />
        </label>
        {errore && <p className="avviso">{errore}</p>}
        <button className="link" onClick={p.onAnnulla}>
          Annulla
        </button>
      </section>
    );
  }

  const importanti = esito.account.filter((a) => a.importante);
  const abbonamenti = esito.account.filter((a) => a.categoria === 'abbonamento');
  const daAggiungere = esito.account.filter((a) => scelti.has(a.chiave) && !giaPresente(a));
  const importo = (a: AccountTrovato) => {
    const n = Number((importi[a.chiave] ?? '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const totale = totaleAnnuo(abbonamenti.filter((a) => scelti.has(a.chiave)).map(importo));
  const perCategoria = (Object.keys(NOME_CATEGORIA) as Categoria[])
    .map((c) => ({ c, lista: esito.account.filter((a) => a.categoria === c) }))
    .filter((g) => g.lista.length > 0);

  async function aggiungi() {
    setErrore(null);
    setAvanzamento({ fatte: 0, totale: daAggiungere.length });
    try {
      let fatte = 0;
      for (const a of daAggiungere) {
        const chfMese = importo(a);
        await aggiungiVoce(p.vaultKey, {
          tipo: 'account',
          emergenza: false,
          titolo: a.nome,
          note: a.accessi.length ? `Accesso con: ${a.accessi.join(', ')}` : '',
          fornitore: a.fornitore,
          extra: {
            categoria: a.categoria,
            dominio: a.dominio,
            ...(a.accessi.length ? { accessi: a.accessi } : {}),
            ...(chfMese ? { abbonamento: { chfMese } } : {}),
          },
        });
        fatte++;
        setAvanzamento({ fatte, totale: daAggiungere.length });
      }
      await p.onFatto(fatte);
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Salvataggio non riuscito');
      setAvanzamento(null);
    }
  }

  return (
    <section className="passo larga">
      <h1>Abbiamo trovato {esito.account.length} account</h1>
      <p>
        <strong>{importanti.length}</strong> sono importanti per i tuoi eredi (banche, posta, assicurazioni…).{' '}
        {abbonamenti.length > 0 && (
          <>
            <strong>{abbonamenti.length}</strong> sono servizi che spesso hanno un abbonamento.
          </>
        )}
      </p>
      <p className="tenue">
        Letto un file di {esito.formato} con {esito.righe} righe. {esito.passwordScartate > 0 && `${esito.passwordScartate} password lette e scartate: nessuna è stata salvata né inviata.`}
      </p>

      {perCategoria.map(({ c, lista }) => (
        <details key={c} className="gruppo-account" open={c !== 'altro'}>
          <summary>
            {NOME_CATEGORIA[c]} <span className="tenue">({lista.length})</span>
          </summary>
          <ul className="elenco-account">
            {lista.map((a) => {
              const presente = giaPresente(a);
              return (
                <li key={a.chiave}>
                  <label className="spunta">
                    <input
                      type="checkbox"
                      disabled={presente}
                      checked={presente || scelti.has(a.chiave)}
                      onChange={(e) => {
                        const n = new Set(scelti);
                        if (e.target.checked) n.add(a.chiave);
                        else n.delete(a.chiave);
                        setScelti(n);
                      }}
                    />
                    <span>
                      <b>{a.nome}</b>
                      {a.fornitore && <span className="pillola chiara">istruzioni per gli eredi</span>}
                      <br />
                      <span className="tenue">
                        {presente ? 'Già nella cassaforte' : a.accessi.length ? `Accesso con ${a.accessi.join(', ')}` : a.dominio}
                      </span>
                    </span>
                  </label>
                  {c === 'abbonamento' && scelti.has(a.chiave) && !presente && (
                    <label className="importo">
                      CHF al mese
                      <input
                        inputMode="decimal"
                        placeholder="non lo pago"
                        value={importi[a.chiave] ?? ''}
                        onChange={(e) => setImporti({ ...importi, [a.chiave]: e.target.value })}
                      />
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      ))}

      {totale > 0 && (
        <div className="riquadro evidenza">
          <p>
            Paghi circa <strong>{chf(totale)} all'anno</strong> in abbonamenti. Chi resta dovrà disdirli: ora sono tutti in elenco.
          </p>
        </div>
      )}

      <div className="riquadro">
        <p>Dopo l'importazione cancella il file esportato e svuota il Cestino: contiene le tue password in chiaro.</p>
      </div>
      {errore && <p className="avviso">{errore}</p>}
      <button className="primario" disabled={daAggiungere.length === 0 || !!avanzamento} onClick={aggiungi}>
        {avanzamento
          ? `Cifro e salvo… ${avanzamento.fatte} di ${avanzamento.totale}`
          : daAggiungere.length === 1
            ? 'Aggiungi 1 voce alla cassaforte'
            : `Aggiungi ${daAggiungere.length} voci alla cassaforte`}
      </button>
      <button className="link" onClick={() => setEsito(null)}>
        Scegli un altro file
      </button>
    </section>
  );
}
