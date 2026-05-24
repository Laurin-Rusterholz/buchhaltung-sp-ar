import { readJson as readStored, writeJson } from './lib/storage.mjs';
import { json, error, readJson, pathSegments, param } from './lib/response.mjs';

function uid() {
  return 'r-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function loadRechnungen(jahr) {
  return (await readStored(`rechnungen/${jahr}`, null)) || [];
}

async function saveRechnungen(jahr, list) {
  await writeJson(`rechnungen/${jahr}`, list);
}

export default async (req) => {
  const segs = pathSegments(req, 'rechnungen');
  const id = segs[0];
  const jahr = Number(param(req, 'jahr'));
  if (!jahr) return error('Parameter "jahr" fehlt');

  if (req.method === 'GET') {
    return json(await loadRechnungen(jahr));
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    if (!body?.nummer || !body?.datum) return error('Nummer und Datum sind Pflicht');
    const list = await loadRechnungen(jahr);
    const r = {
      id: uid(),
      nummer: body.nummer,
      datum: body.datum,
      faellig_am: body.faellig_am || '',
      empfaenger_typ: body.empfaenger_typ || 'extern',
      empfaenger_id: body.empfaenger_id || '',
      empfaenger_name: body.empfaenger_name || '',
      empfaenger_adresse: body.empfaenger_adresse || '',
      beschreibung: body.beschreibung || '',
      positionen: Array.isArray(body.positionen) ? body.positionen : [],
      total: Number(body.total || 0),
      status: body.status || 'offen',
      erstellt_am: new Date().toISOString(),
    };
    list.push(r);
    await saveRechnungen(jahr, list);
    return json(r, { status: 201 });
  }

  if (req.method === 'PUT' && id) {
    const body = await readJson(req);
    const list = await loadRechnungen(jahr);
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return error('Rechnung nicht gefunden', 404);
    list[idx] = {
      ...list[idx],
      ...body,
      id: list[idx].id,
      total: Number(body.total ?? list[idx].total),
      positionen: Array.isArray(body.positionen) ? body.positionen : list[idx].positionen,
    };
    await saveRechnungen(jahr, list);
    return json(list[idx]);
  }

  if (req.method === 'DELETE' && id) {
    const list = await loadRechnungen(jahr);
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return error('Rechnung nicht gefunden', 404);
    list.splice(idx, 1);
    await saveRechnungen(jahr, list);
    return json({ ok: true });
  }

  return error('Methode nicht erlaubt', 405);
};

export const config = { path: ['/api/rechnungen', '/api/rechnungen/*'] };
