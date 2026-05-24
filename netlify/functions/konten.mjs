import { readJson as readStored, writeJson } from './lib/storage.mjs';
import { json, error, readJson, pathSegments } from './lib/response.mjs';
import { DEFAULT_KONTENPLAN } from './lib/defaults.mjs';

async function loadKonten() {
  let konten = await readStored('kontenplan', null);
  if (!konten) {
    konten = DEFAULT_KONTENPLAN;
    await writeJson('kontenplan', konten);
  }
  return konten;
}

export default async (req) => {
  const segs = pathSegments(req, 'konten');
  const nr = decodeURIComponent(segs[0] || '');

  if (req.method === 'GET') {
    const list = await loadKonten();
    return json(list);
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    if (!body?.nummer || !body?.bezeichnung) return error('Nummer und Bezeichnung sind Pflicht');
    const list = await loadKonten();
    if (list.some((k) => k.nummer === body.nummer)) return error('Kontonummer existiert bereits');
    const k = {
      nummer: String(body.nummer).trim(),
      bezeichnung: String(body.bezeichnung).trim(),
      typ: body.typ || 'aktiv',
      kategorie: body.kategorie || '',
    };
    list.push(k);
    await writeJson('kontenplan', list);
    return json(k, { status: 201 });
  }

  if (req.method === 'PUT' && nr) {
    const body = await readJson(req);
    const list = await loadKonten();
    const idx = list.findIndex((k) => k.nummer === nr);
    if (idx < 0) return error('Konto nicht gefunden', 404);
    list[idx] = {
      ...list[idx],
      bezeichnung: body.bezeichnung ?? list[idx].bezeichnung,
      typ: body.typ ?? list[idx].typ,
      kategorie: body.kategorie ?? list[idx].kategorie,
    };
    await writeJson('kontenplan', list);
    return json(list[idx]);
  }

  if (req.method === 'DELETE' && nr) {
    const list = await loadKonten();
    const idx = list.findIndex((k) => k.nummer === nr);
    if (idx < 0) return error('Konto nicht gefunden', 404);
    list.splice(idx, 1);
    await writeJson('kontenplan', list);
    return json({ ok: true });
  }

  return error('Methode nicht erlaubt', 405);
};

export const config = { path: ['/api/konten', '/api/konten/*'] };
