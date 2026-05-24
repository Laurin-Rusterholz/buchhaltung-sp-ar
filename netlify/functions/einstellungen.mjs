import { readJson as readStored, writeJson } from './lib/storage.mjs';
import { json, error, readJson } from './lib/response.mjs';
import { DEFAULT_EINSTELLUNGEN } from './lib/defaults.mjs';

export default async (req) => {
  if (req.method === 'GET') {
    const data = await readStored('einstellungen', DEFAULT_EINSTELLUNGEN);
    return json(data);
  }
  if (req.method === 'PUT') {
    const body = await readJson(req);
    if (!body) return error('Ungültige Daten', 400);
    const current = await readStored('einstellungen', DEFAULT_EINSTELLUNGEN);
    const merged = { ...current, ...body };
    await writeJson('einstellungen', merged);
    return json(merged);
  }
  return error('Methode nicht erlaubt', 405);
};

export const config = { path: '/api/einstellungen' };
