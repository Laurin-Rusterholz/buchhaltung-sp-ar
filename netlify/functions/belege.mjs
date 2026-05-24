import { readJson as readStored, writeJson, fileStore } from './lib/storage.mjs';
import { json, error, readJson, pathSegments } from './lib/response.mjs';

function uid() {
  return 'bl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function loadMeta() {
  return (await readStored('belege-meta', null)) || [];
}

export default async (req) => {
  const segs = pathSegments(req, 'belege');
  const id = segs[0];
  const action = segs[1];

  if (req.method === 'GET' && id && action === 'file') {
    const files = fileStore();
    const meta = (await loadMeta()).find((b) => b.id === id);
    if (!meta) return new Response('Not Found', { status: 404 });
    const blob = await files.get(`belege/${id}`, { type: 'arrayBuffer' });
    if (!blob) return new Response('Not Found', { status: 404 });
    return new Response(blob, {
      headers: {
        'content-type': meta.mime || 'application/octet-stream',
        'content-disposition': `inline; filename="${encodeURIComponent(meta.dateiname)}"`,
        'cache-control': 'private, max-age=3600',
      },
    });
  }

  if (req.method === 'GET') {
    const list = await loadMeta();
    return json(list);
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    if (!body?.inhalt_base64 || !body?.dateiname) return error('Datei fehlt');
    const id = uid();
    const buffer = Uint8Array.from(atob(body.inhalt_base64), (c) => c.charCodeAt(0));
    const files = fileStore();
    await files.set(`belege/${id}`, buffer);

    const list = await loadMeta();
    const meta = {
      id,
      dateiname: body.dateiname,
      bezeichnung: body.bezeichnung || body.dateiname,
      datum: body.datum || new Date().toISOString().slice(0, 10),
      mime: body.mime || 'application/octet-stream',
      groesse: Number(body.groesse || buffer.byteLength),
      tags: body.tags || '',
      erstellt_am: new Date().toISOString(),
    };
    list.push(meta);
    await writeJson('belege-meta', list);
    return json(meta, { status: 201 });
  }

  if (req.method === 'DELETE' && id) {
    const list = await loadMeta();
    const idx = list.findIndex((b) => b.id === id);
    if (idx < 0) return error('Beleg nicht gefunden', 404);
    list.splice(idx, 1);
    await writeJson('belege-meta', list);
    await fileStore().delete(`belege/${id}`);
    return json({ ok: true });
  }

  return error('Methode nicht erlaubt', 405);
};

export const config = { path: ['/api/belege', '/api/belege/*'] };
