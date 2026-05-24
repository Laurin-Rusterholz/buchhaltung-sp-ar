import { readJson as readStored, writeJson } from './lib/storage.mjs';
import { json, error, readJson, pathSegments } from './lib/response.mjs';

function uid() {
  return 'm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function loadMitglieder() {
  return (await readStored('mitglieder', null)) || [];
}

export default async (req) => {
  const segs = pathSegments(req, 'mitglieder');
  const id = segs[0];

  if (req.method === 'GET') {
    return json(await loadMitglieder());
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    if (!body?.vorname && !body?.nachname) return error('Vorname oder Nachname erforderlich');
    const list = await loadMitglieder();
    const m = {
      id: uid(),
      nummer: body.nummer || String(list.length + 1).padStart(4, '0'),
      vorname: body.vorname || '',
      nachname: body.nachname || '',
      strasse: body.strasse || '',
      plz: body.plz || '',
      ort: body.ort || '',
      email: body.email || '',
      telefon: body.telefon || '',
      eintritt: body.eintritt || '',
      austritt: body.austritt || '',
      kategorie: body.kategorie || '',
      beitrag: Number(body.beitrag || 0),
      status: body.status || 'aktiv',
      notizen: body.notizen || '',
      erstellt_am: new Date().toISOString(),
    };
    list.push(m);
    await writeJson('mitglieder', list);
    return json(m, { status: 201 });
  }

  if (req.method === 'PUT' && id) {
    const body = await readJson(req);
    const list = await loadMitglieder();
    const idx = list.findIndex((m) => m.id === id);
    if (idx < 0) return error('Mitglied nicht gefunden', 404);
    list[idx] = {
      ...list[idx],
      ...body,
      id: list[idx].id,
      beitrag: Number(body.beitrag ?? list[idx].beitrag),
    };
    await writeJson('mitglieder', list);
    return json(list[idx]);
  }

  if (req.method === 'DELETE' && id) {
    const list = await loadMitglieder();
    const idx = list.findIndex((m) => m.id === id);
    if (idx < 0) return error('Mitglied nicht gefunden', 404);
    list.splice(idx, 1);
    await writeJson('mitglieder', list);
    return json({ ok: true });
  }

  return error('Methode nicht erlaubt', 405);
};

export const config = { path: ['/api/mitglieder', '/api/mitglieder/*'] };
