/**
 * Il piano scelto sul sito («Scegli Essenziale», «Scegli Famiglia», «Prova gratis»): arriva come ?piano=…
 * e viene ricordato per questa visita, finché la persona crea la cassaforte e apre la pagina del piano.
 */
export type PianoScelto = 'essenziale' | 'famiglia' | 'prova';
const CHIAVE = 'memoriae-piano-scelto';

function leggiDallIndirizzo(): void {
  try {
    const q = new URLSearchParams(window.location.search);
    const p = q.get('piano');
    if (p !== 'essenziale' && p !== 'famiglia' && p !== 'prova') return;
    sessionStorage.setItem(CHIAVE, p);
    q.delete('piano');
    const resto = q.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (resto ? `?${resto}` : ''));
  } catch {
    // senza memoria del browser: si sceglie il piano dall'app, come sempre
  }
}
leggiDallIndirizzo();

export function pianoScelto(): PianoScelto | null {
  try {
    const p = sessionStorage.getItem(CHIAVE);
    return p === 'essenziale' || p === 'famiglia' || p === 'prova' ? p : null;
  } catch {
    return null;
  }
}

export function dimenticaPianoScelto(): void {
  try {
    sessionStorage.removeItem(CHIAVE);
  } catch {
    // niente da fare
  }
}

export const NOME_PIANO: Record<PianoScelto, string> = { essenziale: 'Essenziale', famiglia: 'Famiglia', prova: 'Prova gratuita' };
