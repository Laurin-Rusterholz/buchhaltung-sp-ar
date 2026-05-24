import { readJson as readStored, writeJson } from './lib/storage.mjs';
import { json, error, readJson, pathSegments, param } from './lib/response.mjs';

function uid() {
  return 'b-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function loadBuchungen(jahr) {
  return (await readStored(`buchungen/${jahr}`, null)) || [];
}

async function saveBuchungen(jahr, list) {
  await writeJson(`buchungen/${jahr}`, list);
}

async function isClosed(jahr) {
  const jahre = (await readStored('geschaeftsjahre', null)) || [];
  const j = jahre.find((x) => x.jahr === Number(jahr));
  return j?.geschlossen === true;
}

export default async (req) => {
  const segs = pathSegments(req, 'buchungen');
  const id = segs[0];
  const jahr = Number(param(req, 'jahr'));
  if (!jahr) return error('Parameter "jahr" fehlt');

  if (req.method === 'GET') {
    return json(await loadBuchungen(jahr));
  }

  if (await isClosed(jahr) && req.method !== 'GET') {
    return error('Geschäftsjahr ist abgeschlossen', 409);
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    if (!body?.datum || !body?.soll || !body?.haben || !body?.betrag) {
      return error('Datum, Soll, Haben und Betrag sind Pflicht');
    }
    const list = await loadBuchungen(jahr);
    const b = {
      id: uid(),
      datum: body.datum,
      beleg_nr: body.beleg_nr || '',
      beschreibung: body.beschreibung || '',
      soll: body.soll,
      haben: body.haben,
      betrag: Number(body.betrag),
      beleg_id: body.beleg_id || '',
      erstellt_am: new Date().toISOString(),
    };
    list.push(b);
    await saveBuchungen(jahr, list);
    return json(b, { status: 201 });
  }

  if (req.method === 'PUT' && id) {
    const body = await readJson(req);
    const list = await loadBuchungen(jahr);
    const idx = list.findIndex((b) => b.id === id);
    if (idx < 0) return error('Buchung nicht gefunden', 404);
    list[idx] = {
      ...list[idx],
      ...body,
      id: list[idx].id,
      betrag: Number(body.betrag ?? list[idx].betrag),
    };
    await saveBuchungen(jahr, list);
    return json(list[idx]);
  }

  if (req.method === 'DELETE' && id) {
    const list = await loadBuchungen(jahr);
    const idx = list.findIndex((b) => b.id === id);
    if (idx < 0) return error('Buchung nicht gefunden', 404);
    list.splice(idx, 1);
    await saveBuchungen(jahr, list);
    return json({ ok: true });
  }

  return error('Methode nicht erlaubt', 405);
};

export const config = { path: ['/api/buchungen', '/api/buchungen/*'] };
