// API-Layer: Sprachliche Klammer um Firebase Storage.
// Stellt die gleiche Schnittstelle bereit, die alle Views verwenden.

import { readJson, writeJson, uploadFile, deleteFile, uploadBelegFile } from './firebase.js';
import { DEFAULT_EINSTELLUNGEN, DEFAULT_KONTENPLAN, DEFAULT_VORLAGEN, BELEG_PORTAL_URL, KONTENPLAN_2026_ERGAENZUNGEN, VORANSCHLAG_2026 } from './defaults.js';
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
  // Ergänzt den Kontenplan um die Konten aus Budget 2026 – nur fehlende
  // Konten werden hinzugefügt, bestehende bleiben unverändert (Buchungen
  // referenzieren sie ggf. schon).
  seedKontenplan2026: async () => {
    const list = await api.listKonten();
    const byNr = new Map(list.map((k) => [String(k.nummer), k]));
    let added = 0;
    let updated = 0;
    for (const k of KONTENPLAN_2026_ERGAENZUNGEN) {
      const existing = byNr.get(String(k.nummer));
      if (!existing) {
        list.push({ ...k });
        added++;
      } else {
        // Bezeichnung / Typ / Kategorie auf Excel-Stand updaten, wenn sie
        // abweichen. Bestehende Konten werden NICHT gelöscht (Buchungen
        // könnten dranhängen), nur angepasst.
        let changed = false;
        if (existing.bezeichnung !== k.bezeichnung) { existing.bezeichnung = k.bezeichnung; changed = true; }
        if (existing.typ !== k.typ) { existing.typ = k.typ; changed = true; }
        if ((existing.kategorie || '') !== (k.kategorie || '')) { existing.kategorie = k.kategorie || ''; changed = true; }
        if (changed) updated++;
      }
    }
    list.sort((a, b) => String(a.nummer).localeCompare(String(b.nummer)));
    if (added > 0 || updated > 0) {
      await writeJson('kontenplan', list);
    }
    return { added, updated, total: list.length };
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
      bezahlt: b.bezahlt === true,
      faellig_am: b.faellig_am || '',
      externalBeleg: b.externalBeleg || null,
      rechnungInfo: b.rechnungInfo || null,
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
    const merged = { ...list[idx], ...b, id: list[idx].id, betrag: Number(b.betrag ?? list[idx].betrag) };
    if (b.bezahlt !== undefined) merged.bezahlt = b.bezahlt === true;
    if (b.faellig_am !== undefined) merged.faellig_am = b.faellig_am || '';
    if (b.externalBeleg !== undefined) merged.externalBeleg = b.externalBeleg || null;
    if (b.rechnungInfo !== undefined) merged.rechnungInfo = b.rechnungInfo || null;
    list[idx] = merged;
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
  // Findet eine Buchung anhand der externen Beleg-ID (sp-ar-belege Portal).
  // Sucht über alle Geschäftsjahre.
  findBuchungByExternalBelegId: async (spArId) => {
    if (!spArId) return null;
    const jahre = await readJson('geschaeftsjahre', []);
    for (const j of jahre.sort((a, b) => b.jahr - a.jahr)) {
      const list = await readJson(`buchungen-${j.jahr}`, []);
      const found = list.find((b) => b.externalBeleg?.spArId === spArId);
      if (found) return { buchung: found, jahr: j.jahr };
    }
    return null;
  },

  // ===== Sektionen =====
  listSektionen: () => readJson('sektionen', []),
  saveSektion: async (s) => {
    if (!s.name) throw new Error('Sektionsname ist Pflicht');
    const list = await api.listSektionen();
    const sektion = {
      id: uid('s-'),
      name: s.name,
      kontakt_name: s.kontakt_name || '',
      kontakt_email: s.kontakt_email || '',
      adresse: s.adresse || '',
      plz: s.plz || '',
      ort: s.ort || '',
      anzahl_mitglieder: Number(s.anzahl_mitglieder || 0),
      beitrag_pro_mitglied: Number(s.beitrag_pro_mitglied || 0),
      status: s.status || 'aktiv',
      notizen: s.notizen || '',
      erstellt_am: new Date().toISOString(),
    };
    list.push(sektion);
    await writeJson('sektionen', list);
    return sektion;
  },
  updateSektion: async (id, s) => {
    const list = await api.listSektionen();
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error('Sektion nicht gefunden');
    list[idx] = {
      ...list[idx],
      ...s,
      id: list[idx].id,
      anzahl_mitglieder: Number(s.anzahl_mitglieder ?? list[idx].anzahl_mitglieder),
      beitrag_pro_mitglied: Number(s.beitrag_pro_mitglied ?? list[idx].beitrag_pro_mitglied),
    };
    await writeJson('sektionen', list);
    return list[idx];
  },
  deleteSektion: async (id) => {
    const list = await api.listSektionen();
    const newList = list.filter((x) => x.id !== id);
    await writeJson('sektionen', newList);
    return { ok: true };
  },

  // ===== Voranschlag / Budget =====
  getBudget: async (jahr) => readJson(`budget-${jahr}`, null),
  saveBudget: async (jahr, positionen, notizen = '') => {
    const budget = {
      jahr: Number(jahr),
      positionen: Array.isArray(positionen) ? positionen : [],
      notizen,
      aktualisiert_am: new Date().toISOString(),
    };
    await writeJson(`budget-${jahr}`, budget);
    return budget;
  },
  deleteBudget: async (jahr) => {
    await writeJson(`budget-${jahr}`, null);
    return { ok: true };
  },
  // Importiert das Budget 2026 aus dem Excel-Sheet. Sorgt zuerst dafür, dass
  // alle Konten im Plan existieren (seedKontenplan2026), dann speichert die
  // Positionen unter budget-2026. Liefert ein Resultat mit Diagnose.
  seedVoranschlag2026: async ({ overwrite = false } = {}) => {
    const existing = await api.getBudget(2026);
    if (existing && !overwrite) {
      return { written: false, reason: 'Budget 2026 existiert bereits – overwrite nicht gesetzt.' };
    }
    const kontoSeed = await api.seedKontenplan2026();
    const konten = await api.listKonten();
    const kontoSet = new Set(konten.map((k) => String(k.nummer)));
    const valid = VORANSCHLAG_2026.filter((p) => kontoSet.has(String(p.konto)));
    const skipped = VORANSCHLAG_2026.length - valid.length;
    const budget = await api.saveBudget(2026, valid, 'Importiert aus Excel-Budget 2026 (SP AR).');
    // Sicherstellen, dass Geschäftsjahr 2026 existiert
    const jahre = await api.listJahre();
    if (!jahre.find((j) => j.jahr === 2026)) {
      try { await api.saveJahr({ jahr: 2026 }); } catch {}
    }
    return { written: true, kontenAdded: kontoSeed.added, positionen: valid.length, skipped, budget };
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
      // Buchungs-Referenzen (Forderung + Zahlung), werden automatisch gefüllt
      forderungsBuchungId: r.forderungsBuchungId || null,
      zahlungsBuchungId: r.zahlungsBuchungId || null,
      bezahltAm: r.bezahltAm || null,
      // Synchronisierung mit Quantus (via sp-ar-belege Bus)
      quantusSynced: r.quantusSynced === true,
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

  // ===== Rechnungs-Workflow (auto-Buchung + Quantus-Sync) =====
  // Wird beim Erstellen einer Rechnung aufgerufen. Erstellt automatisch die
  // Forderungsbuchung (Soll Forderung / Haben Ertrag) und meldet die Rechnung
  // an das sp-ar-belege Portal (Quantus pollt von dort).
  startRechnungsWorkflow: async (jahr, rechnung, options = {}) => {
    const einst = await api.getEinstellungen();
    const sollKonto = options.sollKonto || einst.konto_forderungen || '1100';
    const habenKonto = options.habenKonto
      || (rechnung.empfaenger_typ === 'sektion' ? (einst.konto_sektionsbeitrag || '3001') : (einst.konto_sektionsbeitrag || '3001'));

    // 1. Forderungsbuchung erstellen
    const forderung = await api.saveBuchung(jahr, {
      datum: rechnung.datum,
      beleg_nr: rechnung.nummer,
      beschreibung: `Rechnung ${rechnung.nummer}: ${rechnung.empfaenger_name}${rechnung.beschreibung ? ' – ' + rechnung.beschreibung : ''}`,
      soll: sollKonto,
      haben: habenKonto,
      betrag: rechnung.total,
      bezahlt: false,
      faellig_am: rechnung.faellig_am || '',
      rechnungInfo: {
        rechnungId: rechnung.id,
        rechnungJahr: jahr,
        rechnungNummer: rechnung.nummer,
        typ: 'forderung',
      },
    });

    // 2. Rechnung mit Buchungs-Referenz aktualisieren
    await api.updateRechnung(jahr, rechnung.id, {
      forderungsBuchungId: forderung.id,
      quantusSynced: false,
    });

    // 3. An sp-ar-belege Portal melden (Quantus pollt von dort)
    try {
      const rechnungUrl = `${location.origin}${location.pathname}#rechnungen?id=${encodeURIComponent(rechnung.id)}`;
      const url = `${BELEG_PORTAL_URL}/.netlify/functions/rechnung-submit`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: rechnung.id,
          nummer: rechnung.nummer,
          empfaenger_name: rechnung.empfaenger_name,
          empfaenger_typ: rechnung.empfaenger_typ,
          empfaenger_id: rechnung.empfaenger_id,
          beschreibung: rechnung.beschreibung,
          betrag: rechnung.total,
          datum: rechnung.datum,
          faellig_am: rechnung.faellig_am,
          jahr,
          buchungId: forderung.id,
          buchungJahr: jahr,
          rechnungUrl,
        }),
      });
      if (r.ok) {
        await api.updateRechnung(jahr, rechnung.id, { quantusSynced: true });
      }
    } catch (err) {
      console.warn('Quantus-Sync fehlgeschlagen:', err);
    }

    return forderung;
  },

  // Sendet alle Rechnungen ans Portal, die beim Erstellen noch nicht
  // synchronisiert werden konnten (Portal nicht erreichbar zu dem Zeitpunkt).
  retrySyncRechnungen: async () => {
    const jahre = await readJson('geschaeftsjahre', []);
    let retried = 0;
    for (const j of jahre) {
      const list = await readJson(`rechnungen-${j.jahr}`, []);
      for (const r of list) {
        if (r.quantusSynced === true || r.status === 'bezahlt') continue;
        if (!r.forderungsBuchungId) continue;
        try {
          const rechnungUrl = `${location.origin}${location.pathname}#rechnungen?id=${encodeURIComponent(r.id)}`;
          const url = `${BELEG_PORTAL_URL}/.netlify/functions/rechnung-submit`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: r.id,
              nummer: r.nummer,
              empfaenger_name: r.empfaenger_name,
              empfaenger_typ: r.empfaenger_typ,
              empfaenger_id: r.empfaenger_id,
              beschreibung: r.beschreibung,
              betrag: r.total,
              datum: r.datum,
              faellig_am: r.faellig_am,
              jahr: j.jahr,
              buchungId: r.forderungsBuchungId,
              buchungJahr: j.jahr,
              rechnungUrl,
            }),
          });
          if (res.ok) {
            r.quantusSynced = true;
            retried++;
          }
        } catch {}
      }
      if (retried > 0) await writeJson(`rechnungen-${j.jahr}`, list);
    }
    return { retried };
  },

  // Holt alle Rechnungs-Status aus dem Portal (Quantus hat dort "bezahlt"
  // markiert, sobald der User die Aufgabe abgeschlossen hat) und erstellt
  // bei jeder als bezahlt markierten Rechnung die Zahlungsbuchung
  // (Soll Bank / Haben Forderung). Wird beim Öffnen der Rechnungen-View
  // bzw. App-Start aufgerufen.
  syncRechnungenFromPortal: async () => {
    let processed = 0;
    let portalRechnungen;
    try {
      const url = `${BELEG_PORTAL_URL}/.netlify/functions/rechnung-list`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Portal HTTP ${r.status}`);
      const data = await r.json();
      portalRechnungen = Array.isArray(data.rechnungen) ? data.rechnungen : [];
    } catch (err) {
      console.warn('Rechnungs-Portal nicht erreichbar:', err);
      return { processed: 0, error: err.message };
    }
    const einst = await api.getEinstellungen();
    const bankKonto = einst.konto_bank || '1020';
    const forderungsKonto = einst.konto_forderungen || '1100';

    for (const portal of portalRechnungen) {
      if (portal.status !== 'bezahlt') continue;
      if (portal.zahlungVerbuchtAm) continue; // Bereits verbucht
      const jahr = portal.buchungJahr || portal.jahr;
      if (!jahr) continue;
      const rechnungen = await api.listRechnungen(jahr);
      const rechnung = rechnungen.find((r) => r.id === portal.id);
      if (!rechnung) continue;
      if (rechnung.zahlungsBuchungId) {
        // Buchung schon vorhanden – nur Portal-Marker setzen
        try {
          await fetch(`${BELEG_PORTAL_URL}/.netlify/functions/rechnung-list?action=mark`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: portal.id, zahlungVerbuchtAm: new Date().toISOString() }),
          });
        } catch {}
        continue;
      }
      try {
        const zahlung = await api.saveBuchung(jahr, {
          datum: (portal.bezahltAm || new Date().toISOString()).slice(0, 10),
          beleg_nr: rechnung.nummer + '-Z',
          beschreibung: `Zahlungseingang Rechnung ${rechnung.nummer}: ${rechnung.empfaenger_name}`,
          soll: bankKonto,
          haben: forderungsKonto,
          betrag: rechnung.total,
          bezahlt: true,
          rechnungInfo: {
            rechnungId: rechnung.id,
            rechnungJahr: jahr,
            rechnungNummer: rechnung.nummer,
            typ: 'zahlung',
          },
        });
        // Forderungsbuchung als bezahlt markieren
        if (rechnung.forderungsBuchungId) {
          await api.updateBuchung(jahr, rechnung.forderungsBuchungId, { bezahlt: true });
        }
        // Rechnung als bezahlt markieren
        await api.updateRechnung(jahr, rechnung.id, {
          status: 'bezahlt',
          zahlungsBuchungId: zahlung.id,
          bezahltAm: portal.bezahltAm || new Date().toISOString(),
        });
        // Portal-Marker setzen
        try {
          await fetch(`${BELEG_PORTAL_URL}/.netlify/functions/rechnung-list?action=mark`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: portal.id,
              zahlungsBuchungId: zahlung.id,
              zahlungVerbuchtAm: new Date().toISOString(),
            }),
          });
        } catch {}
        processed++;
      } catch (err) {
        console.warn('Zahlungsbuchung fehlgeschlagen für Rechnung', rechnung.nummer, err);
      }
    }
    return { processed };
  },

  // ===== Inbox (eingegangene Belege aus sp-ar-belege Portal) =====
  // Holt alle Belege vom externen Portal (Netlify Function).
  fetchPortalBelege: async () => {
    const url = `${BELEG_PORTAL_URL}/.netlify/functions/beleg-list`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Portal HTTP ${r.status}`);
    const data = await r.json();
    return Array.isArray(data.belege) ? data.belege : [];
  },
  // CORS-Proxy-URL für die Beleg-Datei. Direkter fetch() auf Firebase Storage
  // wird vom Browser geblockt (kein Access-Control-Allow-Origin auf dem Bucket),
  // daher gehen alle Beleg-Downloads für die KI-Analyse über diesen Proxy
  // (sp-ar-belege Netlify Function, die die Datei aus Firebase Storage zieht
  // und mit CORS:* an buchhaltung-sp-ar zurückliefert).
  belegProxyUrl: (spArId) =>
    `${BELEG_PORTAL_URL}/.netlify/functions/beleg-proxy?id=${encodeURIComponent(spArId)}`,

  // Direkt-Upload eines Belegs aus der buchhaltung-Inbox. Lädt die Datei
  // in den gleichen Firebase Storage Pfad wie das sp-ar-belege Portal
  // ('belege/...') und registriert die Metadaten via beleg-submit. Damit
  // taucht der Beleg in der Inbox auf wie ein extern eingereichter Beleg
  // und durchläuft denselben Verbuchungs-Workflow.
  uploadBelegToPortal: async (file, meta = {}, onProgress) => {
    if (!file) throw new Error('Keine Datei ausgewählt');
    const up = await uploadBelegFile(file, onProgress);
    const fileBaseName = (file.name || '').replace(/\.[^.]+$/, '').trim();
    const payload = {
      name: (meta.name || '').trim() || 'Buchhaltung (direkt)',
      title: (meta.title || '').trim() || fileBaseName || `Beleg vom ${new Date().toLocaleDateString('de-CH')}`,
      amount: Number(meta.amount) > 0 ? Number(meta.amount) : 0,
      dueDate: meta.dueDate || null,
      paid: meta.paid === true,
      comment: (meta.comment || '').trim(),
      fileName: file.name,
      fileType: file.type,
      fileSize: up.size,
      hasFile: true,
      firebaseUrl: up.url,
      firebasePath: up.path,
      firebaseFileId: up.fileId,
      submittedAt: new Date().toISOString(),
      userProvidedFields: {
        name: !!meta.name, title: !!meta.title,
        amount: !!(meta.amount && Number(meta.amount) > 0),
        dueDate: !!meta.dueDate, comment: !!meta.comment,
      },
    };
    const r = await fetch(`${BELEG_PORTAL_URL}/.netlify/functions/beleg-submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Portal-Submit fehlgeschlagen (${r.status})`);
    return { id: data.id, firebaseUrl: up.url, firebasePath: up.path };
  },
  // Markiert einen Beleg im Portal (Status / Buchungs-Referenz).
  markPortalBeleg: async (spArId, payload) => {
    const url = `${BELEG_PORTAL_URL}/.netlify/functions/beleg-list?action=mark`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: spArId, ...payload }),
    });
    if (!r.ok) {
      let msg = `Portal mark fehlgeschlagen (${r.status})`;
      try { const e = await r.json(); msg = e.error || msg; } catch {}
      throw new Error(msg);
    }
    return r.json();
  },
  // Lokaler Inbox-State (Firestore): pro sp-ar-belege-ID ein Objekt mit
  // KI-Analyse, Draft, Buchungs-Referenz.
  getInboxState: () => readJson('inbox-state', {}),
  saveInboxEntry: async (spArId, patch) => {
    if (!spArId) throw new Error('spArId required');
    const state = await api.getInboxState();
    const current = state[spArId] || {};
    state[spArId] = { ...current, ...patch, lastUpdated: new Date().toISOString() };
    await writeJson('inbox-state', state);
    return state[spArId];
  },
  deleteInboxEntry: async (spArId) => {
    const state = await api.getInboxState();
    if (state[spArId]) {
      delete state[spArId];
      await writeJson('inbox-state', state);
    }
    return { ok: true };
  },

  // ===== Chat-Assistent: Sessions in Firestore =====
  // Eine Session: { id, title, messages: [{role, text, ts}], createdAt, updatedAt }
  listChatSessions: async () => {
    const map = await readJson('chat-sessions', {});
    return Object.values(map).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  },
  getChatSession: async (id) => {
    const map = await readJson('chat-sessions', {});
    return map[id] || null;
  },
  saveChatSession: async (session) => {
    if (!session?.id) throw new Error('Session braucht eine ID');
    const map = await readJson('chat-sessions', {});
    map[session.id] = {
      ...session,
      messages: Array.isArray(session.messages) ? session.messages : [],
      updatedAt: new Date().toISOString(),
      createdAt: session.createdAt || new Date().toISOString(),
    };
    await writeJson('chat-sessions', map);
    return map[session.id];
  },
  deleteChatSession: async (id) => {
    const map = await readJson('chat-sessions', {});
    if (map[id]) {
      delete map[id];
      await writeJson('chat-sessions', map);
    }
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
