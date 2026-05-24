import { readJson as readStored, writeJson, dataStore } from './lib/storage.mjs';
import { json, error, readJson, pathSegments } from './lib/response.mjs';

async function loadJahre() {
  return (await readStored('geschaeftsjahre', null)) || [];
}

async function saveJahre(list) {
  await writeJson('geschaeftsjahre', list);
}

export default async (req) => {
  const segs = pathSegments(req, 'geschaeftsjahre');
  const id = segs[0];
  const action = segs[1];

  if (req.method === 'GET') {
    return json(await loadJahre());
  }

  if (req.method === 'POST' && id && action === 'schliessen') {
    const list = await loadJahre();
    const idx = list.findIndex((j) => j.id === id);
    if (idx < 0) return error('Geschäftsjahr nicht gefunden', 404);
    list[idx].geschlossen = true;
    list[idx].geschlossen_am = new Date().toISOString();
    await saveJahre(list);
    return json(list[idx]);
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    if (!body?.jahr) return error('Jahr ist Pflicht');
    const list = await loadJahre();
    if (list.some((j) => j.jahr === Number(body.jahr))) return error('Jahr existiert bereits');
    const j = {
      id: `gj-${body.jahr}`,
      jahr: Number(body.jahr),
      beginn: body.beginn || `${body.jahr}-01-01`,
      ende: body.ende || `${body.jahr}-12-31`,
      geschlossen: false,
      erstellt_am: new Date().toISOString(),
    };
    list.push(j);
    await saveJahre(list);
    // Leeres Buchungsjournal anlegen
    await writeJson(`buchungen/${j.jahr}`, []);
    return json(j, { status: 201 });
  }

  if (req.method === 'PUT' && id) {
    const body = await readJson(req);
    const list = await loadJahre();
    const idx = list.findIndex((j) => j.id === id);
    if (idx < 0) return error('Geschäftsjahr nicht gefunden', 404);
    list[idx] = { ...list[idx], ...body, jahr: list[idx].jahr };
    await saveJahre(list);
    return json(list[idx]);
  }

  if (req.method === 'DELETE' && id) {
    const list = await loadJahre();
    const j = list.find((x) => x.id === id);
    if (!j) return error('Geschäftsjahr nicht gefunden', 404);
    const newList = list.filter((x) => x.id !== id);
    await saveJahre(newList);
    // Buchungsjournal des Jahres löschen
    await dataStore().delete(`buchungen/${j.jahr}`);
    await dataStore().delete(`rechnungen/${j.jahr}`);
    return json({ ok: true });
  }

  return error('Methode nicht erlaubt', 405);
};

export const config = { path: ['/api/geschaeftsjahre', '/api/geschaeftsjahre/*'] };
