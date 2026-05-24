import { getStore } from '@netlify/blobs';

export function dataStore() {
  return getStore({ name: 'data', consistency: 'strong' });
}

export function fileStore() {
  return getStore({ name: 'files', consistency: 'strong' });
}

export async function readJson(key, fallback = null) {
  const store = dataStore();
  const raw = await store.get(key, { type: 'json' });
  return raw ?? fallback;
}

export async function writeJson(key, value) {
  const store = dataStore();
  await store.setJSON(key, value);
  return value;
}

export async function listJson(prefix) {
  const store = dataStore();
  const out = [];
  for await (const entry of store.list({ prefix })) {
    out.push(entry.key);
  }
  return out;
}
