/** Elenca le voci del catalogo da ricontrollare (mai verificate o verificate da più di 6 mesi). */
import { providersToRecheck } from '../src/db/seed-providers';

const lista = providersToRecheck();
if (lista.length === 0) console.log('Catalogo aggiornato: nessuna voce da ricontrollare.');
for (const p of lista) {
  console.log(`- ${p.name}: ${p.verifiedAt ? `verificato il ${p.verifiedAt}` : 'mai verificato'}${p.sourceUrl ? ` · ${p.sourceUrl}` : ''}`);
}
