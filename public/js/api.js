// Thin REST-Client für die Netlify-Functions

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

const get = (p) => request(p);
const post = (p, body) => request(p, { method: 'POST', body: JSON.stringify(body) });
const put = (p, body) => request(p, { method: 'PUT', body: JSON.stringify(body) });
const del = (p) => request(p, { method: 'DELETE' });

export const api = {
  // Einstellungen
  getEinstellungen: () => get('/einstellungen'),
  saveEinstellungen: (data) => put('/einstellungen', data),

  // Kontenplan
  listKonten: () => get('/konten'),
  saveKonto: (k) => post('/konten', k),
  updateKonto: (nr, k) => put(`/konten/${nr}`, k),
  deleteKonto: (nr) => del(`/konten/${nr}`),

  // Geschäftsjahre
  listJahre: () => get('/geschaeftsjahre'),
  saveJahr: (j) => post('/geschaeftsjahre', j),
  updateJahr: (id, j) => put(`/geschaeftsjahre/${id}`, j),
  deleteJahr: (id) => del(`/geschaeftsjahre/${id}`),
  schliessen: (id) => post(`/geschaeftsjahre/${id}/schliessen`, {}),

  // Buchungen
  listBuchungen: (jahr) => get(`/buchungen?jahr=${jahr}`),
  saveBuchung: (jahr, b) => post(`/buchungen?jahr=${jahr}`, b),
  updateBuchung: (jahr, id, b) => put(`/buchungen/${id}?jahr=${jahr}`, b),
  deleteBuchung: (jahr, id) => del(`/buchungen/${id}?jahr=${jahr}`),

  // Mitglieder
  listMitglieder: () => get('/mitglieder'),
  saveMitglied: (m) => post('/mitglieder', m),
  updateMitglied: (id, m) => put(`/mitglieder/${id}`, m),
  deleteMitglied: (id) => del(`/mitglieder/${id}`),

  // Rechnungen
  listRechnungen: (jahr) => get(`/rechnungen?jahr=${jahr}`),
  saveRechnung: (jahr, r) => post(`/rechnungen?jahr=${jahr}`, r),
  updateRechnung: (jahr, id, r) => put(`/rechnungen/${id}?jahr=${jahr}`, r),
  deleteRechnung: (jahr, id) => del(`/rechnungen/${id}?jahr=${jahr}`),

  // Belege
  listBelege: () => get('/belege'),
  uploadBeleg: (data) => post('/belege', data),
  getBelegUrl: (id) => `/api/belege/${id}/file`,
  deleteBeleg: (id) => del(`/belege/${id}`),

  // Berichte
  bilanz: (jahr) => get(`/berichte/bilanz?jahr=${jahr}`),
  erfolgsrechnung: (jahr) => get(`/berichte/erfolgsrechnung?jahr=${jahr}`),
  kontoauszug: (jahr, kontoNr) => get(`/berichte/kontoauszug?jahr=${jahr}&konto=${kontoNr}`),
};
