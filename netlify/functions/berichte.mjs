import { readJson as readStored, writeJson } from './lib/storage.mjs';
import { json, error, pathSegments, param } from './lib/response.mjs';
import { bilanz, erfolgsrechnung, kontoauszug } from './lib/accounting.mjs';
import { DEFAULT_KONTENPLAN, DEFAULT_EINSTELLUNGEN } from './lib/defaults.mjs';

async function loadKonten() {
  let konten = await readStored('kontenplan', null);
  if (!konten) {
    konten = DEFAULT_KONTENPLAN;
    await writeJson('kontenplan', konten);
  }
  return konten;
}

export default async (req) => {
  const segs = pathSegments(req, 'berichte');
  const typ = segs[0];
  const jahr = Number(param(req, 'jahr'));
  if (!jahr) return error('Parameter "jahr" fehlt');

  const [konten, buchungen, einstellungen] = await Promise.all([
    loadKonten(),
    readStored(`buchungen/${jahr}`, []),
    readStored('einstellungen', DEFAULT_EINSTELLUNGEN),
  ]);

  if (typ === 'bilanz') {
    return json(bilanz(konten, buchungen, einstellungen));
  }
  if (typ === 'erfolgsrechnung') {
    return json(erfolgsrechnung(konten, buchungen));
  }
  if (typ === 'kontoauszug') {
    const nr = param(req, 'konto');
    const konto = konten.find((k) => k.nummer === nr);
    if (!konto) return error('Konto nicht gefunden', 404);
    return json(kontoauszug(konto, buchungen));
  }
  return error('Unbekannter Berichtstyp', 404);
};

export const config = { path: ['/api/berichte/*'] };
