// API-Layer: Sprachliche Klammer um Firebase Storage.
// Stellt die gleiche Schnittstelle bereit, die alle Views verwenden.

import { readJson, writeJson, uploadFile, deleteFile } from './firebase.js';
import { DEFAULT_EINSTELLUNGEN, DEFAULT_KONTENPLAN, DEFAULT_VORLAGEN } from './defaults.js';
import { bilanz, erfolgsrechnung, kontoauszug } from './accounting.js';

function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function loadOrSeed(key, defaultValue) {
  const data = await readJson(key, null);
  if (data === null) {
    await writeJson(key, defaultValue);
    return Array.isArray(defaultValue) ? defaultValue.slice() : { ...defaultValue };
  }
  return data;
}

async function isJahrClosed(jahr) {
  const jahre = await readJson('geschaeftsjahre', []);
  return jahre.find((j) => j.jahr === Number(jahr))?.geschlossen === true;
}

export const api = {
  // ===== Einstellungen =====
  getEinstellungen: () => loadOrSeed('einstellungen', DEFAULT_EINSTELLUNGEN),
  saveEinstellungen: async (data) => {
    const current = await readJson('einstellungen', DEFAULT_EINSTELLUNGEN);
    const merged = { ...current, ...data };
    await writeJson('einstellungen', merged);
    return merged;
  },

  // ===== Kontenplan =====
  listKonten: () => loadOrSeed('kontenplan', DEFAULT_KONTENPLAN),
  saveKonto: async (k) => {
    const list = await api.listKonten();
    if (!k.nummer || !k.bezeichnung) throw new Error('Nummer und Bezeichnung sind Pflicht');
    if (list.some((x) => x.nummer === k.nummer)) throw new Error('Kontonummer existiert bereits');
    const konto = {
      nummer: String(k.nummer).trim(),
      bezeichnung: String(k.bezeichnung).trim(),
      typ: k.typ || 'aktiv',
      kategorie: k.kategorie || '',
    };
    list.push(konto);
    await writeJson('kontenplan', list);
    return konto;
  },
  updateKonto: async (nr, k) => {
    const list = await api.listKonten();
    const idx = list.findIndex((x) => x.nummer === nr);
    if (idx < 0) throw new Error('Konto nicht gefunden');
    list[idx] = {
      ...list[idx],
      bezeichnung: k.bezeichnung ?? list[idx].bezeichnung,
      typ: k.typ ?? list[idx].typ,
      kategorie: k.kategorie ?? list[idx].kategorie,
    };
    await writeJson('kontenplan', list);
    return list[idx];
  },
  deleteKonto: async (nr) => {
    const list = await api.listKonten();
    const newList = list.filter((x) => x.nummer !== nr);
    if (newList.length === list.length) throw new Error('Konto nicht gefunden');
    await writeJson('kontenplan', newList);
    return { ok: true };
  },
  replaceKontenplan: async (konten) => {
    if (!Array.isArray(konten)) throw new Error('konten muss ein Array sein');
    await writeJson('kontenplan', konten);
    return konten;
  },

  // ===== Geschäftsjahre =====
  listJahre: () => readJson('geschaeftsjahre', []),
  saveJahr: async (j) => {
    const list = await api.listJahre();
    if (!j.jahr) throw new Error('Jahr ist Pflicht');
    if (list.some((x) => x.jahr === Number(j.jahr))) throw new Error('Jahr existiert bereits');
    const jahr = {
      id: `gj-${j.jahr}`,
      jahr: Number(j.jahr),
      beginn: j.beginn || `${j.jahr}-01-01`,
      ende: j.ende || `${j.jahr}-12-31`,
      geschlossen: false,
      erstellt_am: new Date().toISOString(),
    };
    list.push(jahr);
    await writeJson('geschaeftsjahre', list);
    await writeJson(`buchungen-${jahr.jahr}`, []);
    return jahr;
  },
  updateJahr: async (id, j) => {
    const list = await api.listJahre();
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error('Geschäftsjahr nicht gefunden');
    list[idx] = { ...list[idx], ...j, jahr: list[idx].jahr };
    await writeJson('geschaeftsjahre', list);
    return list[idx];
  },
  schliessen: async (id) => {
    const list = await api.listJahre();
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error('Geschäftsjahr nicht gefunden');
    list[idx].geschlossen = true;
    list[idx].geschlossen_am = new Date().toISOString();
    await writeJson('geschaeftsjahre', list);
    return list[idx];
  },
  deleteJahr: async (id) => {
    const list = await api.listJahre();
    const j = list.find((x) => x.id === id);
    if (!j) throw new Error('Geschäftsjahr nicht gefunden');
    const newList = list.filter((x) => x.id !== id);
    await writeJson('geschaeftsjahre', newList);
    return { ok: true };
  },

  // ===== Buchungen (pro Geschäftsjahr) =====
  listBuchungen: (jahr) => readJson(`buchungen-${jahr}`, []),
  saveBuchung: async (jahr, b) => {
    if (await isJahrClosed(jahr)) throw new Error('Geschäftsjahr ist abgeschlossen');
    if (!b.datum || !b.soll || !b.haben || !b.betrag) throw new Error('Datum, Soll, Haben und Betrag sind Pflicht');
    if (b.soll === b.haben) throw new Error('Soll und Haben dürfen nicht identisch sein');
    const list = await api.listBuchungen(jahr);
    const buchung = {
      id: uid('b-'),
      datum: b.datum,
      beleg_nr: b.beleg_nr || '',
      beschreibung: b.beschreibung || '',
      soll: b.soll,
      haben: b.haben,
      betrag: Number(b.betrag),
      beleg_id: b.beleg_id || '',
      erstellt_am: new Date().toISOString(),
    };
    list.push(buchung);
    await writeJson(`buchungen-${jahr}`, list);
    return buchung;
  },
  updateBuchung: async (jahr, id, b) => {
    if (await isJahrClosed(jahr)) throw new Error('Geschäftsjahr ist abgeschlossen');
    const list = await api.listBuchungen(jahr);
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error('Buchung nicht gefunden');
    list[idx] = { ...list[idx], ...b, id: list[idx].id, betrag: Number(b.betrag ?? list[idx].betrag) };
    await writeJson(`buchungen-${jahr}`, list);
    return list[idx];
  },
  deleteBuchung: async (jahr, id) => {
    if (await isJahrClosed(jahr)) throw new Error('Geschäftsjahr ist abgeschlossen');
    const list = await api.listBuchungen(jahr);
    const newList = list.filter((x) => x.id !== id);
    await writeJson(`buchungen-${jahr}`, newList);
    return { ok: true };
  },

  // ===== Mitglieder =====
  listMitglieder: () => readJson('mitglieder', []),
  saveMitglied: async (m) => {
    if (!m.vorname && !m.nachname) throw new Error('Vorname oder Nachname erforderlich');
    const list = await api.listMitglieder();
    const mitglied = {
      id: uid('m-'),
      nummer: m.nummer || String(list.length + 1).padStart(4, '0'),
      vorname: m.vorname || '',
      nachname: m.nachname || '',
      strasse: m.strasse || '',
      plz: m.plz || '',
      ort: m.ort || '',
      email: m.email || '',
      telefon: m.telefon || '',
      eintritt: m.eintritt || '',
      austritt: m.austritt || '',
      kategorie: m.kategorie || '',
      beitrag: Number(m.beitrag || 0),
      status: m.status || 'aktiv',
      notizen: m.notizen || '',
      erstellt_am: new Date().toISOString(),
    };
    list.push(mitglied);
    await writeJson('mitglieder', list);
    return mitglied;
  },
  updateMitglied: async (id, m) => {
    const list = await api.listMitglieder();
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error('Mitglied nicht gefunden');
    list[idx] = { ...list[idx], ...m, id: list[idx].id, beitrag: Number(m.beitrag ?? list[idx].beitrag) };
    await writeJson('mitglieder', list);
    return list[idx];
  },
  deleteMitglied: async (id) => {
    const list = await api.listMitglieder();
    const newList = list.filter((x) => x.id !== id);
    await writeJson('mitglieder', newList);
    return { ok: true };
  },

  // ===== Rechnungen (pro Geschäftsjahr) =====
  listRechnungen: (jahr) => readJson(`rechnungen-${jahr}`, []),
  saveRechnung: async (jahr, r) => {
    if (!r.nummer || !r.datum) throw new Error('Nummer und Datum sind Pflicht');
    const list = await api.listRechnungen(jahr);
    const rechnung = {
      id: uid('r-'),
      nummer: r.nummer,
      datum: r.datum,
      faellig_am: r.faellig_am || '',
      empfaenger_typ: r.empfaenger_typ || 'extern',
      empfaenger_id: r.empfaenger_id || '',
      empfaenger_name: r.empfaenger_name || '',
      empfaenger_adresse: r.empfaenger_adresse || '',
      beschreibung: r.beschreibung || '',
      positionen: Array.isArray(r.positionen) ? r.positionen : [],
      total: Number(r.total || 0),
      status: r.status || 'offen',
      erstellt_am: new Date().toISOString(),
    };
    list.push(rechnung);
    await writeJson(`rechnungen-${jahr}`, list);
    return rechnung;
  },
  updateRechnung: async (jahr, id, r) => {
    const list = await api.listRechnungen(jahr);
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error('Rechnung nicht gefunden');
    list[idx] = {
      ...list[idx],
      ...r,
      id: list[idx].id,
      total: Number(r.total ?? list[idx].total),
      positionen: Array.isArray(r.positionen) ? r.positionen : list[idx].positionen,
    };
    await writeJson(`rechnungen-${jahr}`, list);
    return list[idx];
  },
  deleteRechnung: async (jahr, id) => {
    const list = await api.listRechnungen(jahr);
    const newList = list.filter((x) => x.id !== id);
    await writeJson(`rechnungen-${jahr}`, newList);
    return { ok: true };
  },

  // ===== Belege =====
  listBelege: () => readJson('belege-meta', []),
  uploadBeleg: async (file, meta = {}, onProgress) => {
    if (!file) throw new Error('Keine Datei ausgewählt');
    const id = uid('bl-');
    // Dateiname säubern (keine Sonderzeichen für Storage-Pfad)
    const safe = file.name.replace(/[^\w.\-]/g, '_');
    const subpath = `belege/${id}-${safe}`;
    const { url, fullPath } = await uploadFile(subpath, file, onProgress);

    const list = await api.listBelege();
    const belegMeta = {
      id,
      dateiname: file.name,
      bezeichnung: meta.bezeichnung || file.name,
      datum: meta.datum || new Date().toISOString().slice(0, 10),
      tags: meta.tags || '',
      mime: file.type || 'application/octet-stream',
      groesse: file.size,
      url,
      storagePath: fullPath,
      // AI-Analyse-Ergebnis falls vorhanden (für nachträgliche Buchungs-Erstellung)
      ai_analyse: meta.ai_analyse || null,
      erstellt_am: new Date().toISOString(),
    };
    list.push(belegMeta);
    await writeJson('belege-meta', list);
    return belegMeta;
  },
  deleteBeleg: async (id) => {
    const list = await api.listBelege();
    const meta = list.find((b) => b.id === id);
    if (!meta) throw new Error('Beleg nicht gefunden');
    const newList = list.filter((b) => b.id !== id);
    await writeJson('belege-meta', newList);
    if (meta.storagePath) {
      try { await deleteFile(meta.storagePath); } catch (e) { console.warn('Storage-Datei nicht gelöscht:', e); }
    }
    return { ok: true };
  },

  // ===== Vorlagen (Mails / Briefe) =====
  listVorlagen: async () => {
    const list = await readJson('vorlagen', null);
    if (list === null) {
      await writeJson('vorlagen', DEFAULT_VORLAGEN);
      return DEFAULT_VORLAGEN.slice();
    }
    return list;
  },
  saveVorlage: async (v) => {
    if (!v.name) throw new Error('Name ist Pflicht');
    const list = await api.listVorlagen();
    const vorlage = {
      id: uid('v-'),
      name: v.name,
      typ: v.typ || 'mail',
      betreff: v.betreff || '',
      inhalt: v.inhalt || '',
      erstellt_am: new Date().toISOString(),
    };
    list.push(vorlage);
    await writeJson('vorlagen', list);
    return vorlage;
  },
  updateVorlage: async (id, v) => {
    const list = await api.listVorlagen();
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error('Vorlage nicht gefunden');
    list[idx] = { ...list[idx], ...v, id: list[idx].id };
    await writeJson('vorlagen', list);
    return list[idx];
  },
  deleteVorlage: async (id) => {
    const list = await api.listVorlagen();
    const newList = list.filter((x) => x.id !== id);
    await writeJson('vorlagen', newList);
    return { ok: true };
  },

  // ===== Berichte (lokal berechnet) =====
  bilanz: async (jahr) => {
    const [konten, buchungen, einstellungen] = await Promise.all([
      api.listKonten(),
      api.listBuchungen(jahr),
      api.getEinstellungen(),
    ]);
    return bilanz(konten, buchungen, einstellungen);
  },
  erfolgsrechnung: async (jahr) => {
    const [konten, buchungen] = await Promise.all([api.listKonten(), api.listBuchungen(jahr)]);
    return erfolgsrechnung(konten, buchungen);
  },
  kontoauszug: async (jahr, kontoNr) => {
    const [konten, buchungen] = await Promise.all([api.listKonten(), api.listBuchungen(jahr)]);
    const konto = konten.find((k) => k.nummer === kontoNr);
    if (!konto) throw new Error('Konto nicht gefunden');
    return kontoauszug(konto, buchungen);
  },
};
