// Buchungs-Dossier: pro Monat ein zusammengeführtes PDF mit allen Belegen,
// sortiert nach Buchungsdatum. Bilder (JPG/PNG) werden als PDF-Seiten
// eingebettet, PDFs werden gemergt. Belege ohne unterstütztes Format
// landen als Einzeldatei im Unterordner "extras/".

import { api } from './api.js';
import { formatChf } from './utils.js';

const MONATE = [
  '01-Januar', '02-Februar', '03-Maerz', '04-April', '05-Mai', '06-Juni',
  '07-Juli', '08-August', '09-September', '10-Oktober', '11-November', '12-Dezember',
];

// Findet die Datei-URL eines Belegs einer Buchung – egal ob aus interner
// Belege-Library, aus dem sp-ar-belege Portal (externalBeleg) oder
// (zukünftig) aus einer Rechnung.
async function belegFileForBuchung(buchung, belegMap) {
  if (buchung.externalBeleg?.fileUrl) {
    return {
      url: buchung.externalBeleg.fileUrl,
      // Proxy verwenden um CORS zu umgehen (sp-ar-belege Files in Firebase)
      fetchUrl: buchung.externalBeleg.spArId
        ? api.belegProxyUrl(buchung.externalBeleg.spArId)
        : buchung.externalBeleg.fileUrl,
      fileName: buchung.externalBeleg.fileName || 'beleg',
      mime: buchung.externalBeleg.fileType || null,
      source: 'external',
    };
  }
  if (buchung.beleg_id && belegMap.get(buchung.beleg_id)) {
    const b = belegMap.get(buchung.beleg_id);
    return {
      url: b.url, fetchUrl: b.url,
      fileName: b.dateiname || 'beleg',
      mime: b.mime || null,
      source: 'internal',
    };
  }
  return null;
}

function safeFilename(s) {
  return String(s || '').replace(/[^\w.\- ]/g, '_').slice(0, 80).trim();
}

// Aus Beleg-Datei bytes lesen
async function fetchBelegBytes(fetchUrl) {
  const res = await fetch(fetchUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, mime: blob.type || '', size: bytes.length };
}

// Hängt eine Beleg-Datei an ein bestehendes PDFDocument an.
// Returns: { ok: true, pages: N } oder { ok: false, reason: '...' }
// Für Bilder: zentrierte Seite mit Bild + Trenntext oben.
// Für PDFs: alle Seiten kopieren + Trennblatt mit Titel als erste Seite.
async function appendBelegToPdf(targetPdf, belegBytes, mime, headerLine) {
  const PDFLib = window.PDFLib;
  if (!PDFLib) throw new Error('pdf-lib nicht geladen');
  const { PDFDocument, StandardFonts, rgb } = PDFLib;

  const isPdf = mime === 'application/pdf' || mime?.includes('pdf');
  const isJpg = mime === 'image/jpeg' || mime === 'image/jpg';
  const isPng = mime === 'image/png';

  // Trennblatt am Anfang jeder Buchung – schöne Übersicht
  await addSeparatorPage(targetPdf, headerLine);

  if (isPdf) {
    try {
      const src = await PDFDocument.load(belegBytes, { ignoreEncryption: true });
      const pages = await targetPdf.copyPages(src, src.getPageIndices());
      pages.forEach((p) => targetPdf.addPage(p));
      return { ok: true, pages: pages.length };
    } catch (err) {
      return { ok: false, reason: `PDF-Load: ${err.message}` };
    }
  }
  if (isJpg || isPng) {
    try {
      const img = isPng ? await targetPdf.embedPng(belegBytes) : await targetPdf.embedJpg(belegBytes);
      // Maximal A4 (595 x 842 pt) – Bild proportional einpassen
      const maxW = 555, maxH = 800;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      const page = targetPdf.addPage([595, 842]);
      page.drawImage(img, { x: (595 - w) / 2, y: (842 - h) / 2, width: w, height: h });
      return { ok: true, pages: 1 };
    } catch (err) {
      return { ok: false, reason: `Bild-Embed: ${err.message}` };
    }
  }
  return { ok: false, reason: `Nicht unterstütztes Format: ${mime || '?'}` };
}

// pdf-lib's StandardFont (Helvetica) ist WinAnsi-encoded und unterstützt
// keine Unicode-Sonderzeichen ausserhalb von Latin-1. Wir mappen die
// gängigsten Zeichen auf ASCII-Ersatz, restliche Glyphen werden auf "?"
// gesetzt damit drawText() nicht crasht.
const UNICODE_FALLBACK = {
  '→': '>', '←': '<', '⇒': '>>', '⇐': '<<', '↔': '<>',
  '•': '-', '·': '-', '–': '-', '—': '-', '…': '...',
  '✓': 'OK', '✗': 'X', '★': '*',
  ' ': ' ', '\t': '    ',
};
function sanitizeForPdf(s) {
  return String(s || '')
    .replace(/./g, (ch) => {
      if (UNICODE_FALLBACK[ch] != null) return UNICODE_FALLBACK[ch];
      const code = ch.charCodeAt(0);
      // WinAnsi-Bereich: 0x00-0x7F plus erweiterte Latin-1-Glyphen
      if (code < 0x20 && ch !== '\n') return ' ';
      if (code <= 0x7E) return ch;            // ASCII
      if (code >= 0xA0 && code <= 0xFF) return ch; // Latin-1 (ü, ö, ä etc.)
      // Specials wie € (0x20AC) – pdf-lib mapped die teils selbst, sonst Fallback
      if (ch === '€') return 'EUR';
      return '?';
    });
}

async function addSeparatorPage(pdf, text) {
  const { StandardFonts, rgb } = window.PDFLib;
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  const margin = 50;
  const lines = sanitizeForPdf(text).split('\n');
  let y = 800;
  page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: 820, width: 595, height: 6, color: rgb(0.78, 0.06, 0.18) });
  for (let i = 0; i < lines.length; i++) {
    const isHeader = i === 0;
    page.drawText(lines[i], {
      x: margin,
      y: y -= isHeader ? 30 : 22,
      size: isHeader ? 20 : 13,
      font: isHeader ? fontBold : font,
      color: isHeader ? rgb(0.78, 0.06, 0.18) : rgb(0.1, 0.1, 0.1),
    });
  }
}

// Erzeugt ein Buchungs-Dossier-ZIP für eines oder mehrere Jahre. Pro Monat
// ein zusammengeführtes PDF mit allen Belegen, sortiert nach Buchungs-
// datum. Belege ohne unterstütztes Format landen als Original-Datei in
// einem "extras/"-Subordner mit gleichem Namensschema.
//
// onProgress({ phase, current, total, message })
export async function generateBuchungsDossier({ jahre, onProgress } = {}) {
  if (typeof window.JSZip === 'undefined') throw new Error('JSZip nicht geladen');
  if (typeof window.PDFLib === 'undefined') throw new Error('pdf-lib nicht geladen');
  const log = (status) => { try { onProgress?.(status); } catch {} };

  const zip = new window.JSZip();
  log({ phase: 'load', message: 'Lade Buchungen, Belege, Konten…' });

  const [konten, belegeMeta] = await Promise.all([
    api.listKonten(),
    api.listBelege().catch(() => []),
  ]);
  const kontoMap = new Map(konten.map((k) => [k.nummer, k]));
  const belegMap = new Map(belegeMeta.map((b) => [b.id, b]));

  // Alle Buchungen einsammeln und gruppieren nach Jahr-Monat
  const allBuchungen = [];
  for (const j of jahre) {
    const list = await api.listBuchungen(j).catch(() => []);
    for (const b of list) allBuchungen.push({ ...b, jahr: j });
  }

  // Pro Buchungsdatum sortieren
  allBuchungen.sort((a, b) => (a.datum || '').localeCompare(b.datum || ''));

  // Gruppieren
  const groups = new Map(); // key: 'YYYY/MM' → [buchungen]
  for (const b of allBuchungen) {
    const yyyy = (b.datum || 'unbekannt').slice(0, 4) || 'unbekannt';
    const mm = Number((b.datum || '').slice(5, 7));
    const monat = mm >= 1 && mm <= 12 ? MONATE[mm - 1] : 'unbekannt';
    const key = `${yyyy}/${monat}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }

  let processed = 0;
  let totalBelege = 0;
  let failed = 0;
  let extras = 0;
  const groupCount = groups.size;
  let gIdx = 0;

  const { PDFDocument } = window.PDFLib;

  for (const [key, buchungen] of groups) {
    gIdx++;
    log({ phase: 'group', current: gIdx, total: groupCount, message: `Verarbeite ${key} (${buchungen.length} Buchungen)…` });

    const monatPdf = await PDFDocument.create();
    // Deckblatt
    const yyyy = key.split('/')[0];
    const monat = key.split('/')[1];
    await addSeparatorPage(monatPdf, `Buchungs-Dossier ${monat} ${yyyy}\n${buchungen.length} Buchung${buchungen.length === 1 ? '' : 'en'}\nSortiert nach Buchungsdatum`);
    let monatHadBelege = false;

    for (const b of buchungen) {
      processed++;
      const fileInfo = await belegFileForBuchung(b, belegMap);
      if (!fileInfo) continue;
      totalBelege++;
      log({ phase: 'fetch', current: processed, total: allBuchungen.length, message: `Lade Beleg zu ${b.datum}: ${b.beschreibung || ''}` });

      try {
        const { bytes, mime } = await fetchBelegBytes(fileInfo.fetchUrl);
        const headerLine = [
          `${b.datum} – ${b.beschreibung || '(ohne Beschreibung)'}`,
          `Soll ${b.soll} ${kontoMap.get(b.soll)?.bezeichnung || ''}  >  Haben ${b.haben} ${kontoMap.get(b.haben)?.bezeichnung || ''}`,
          `CHF ${formatChf(b.betrag)}${b.beleg_nr ? ' · Beleg-Nr ' + b.beleg_nr : ''}`,
        ].join('\n');

        const res = await appendBelegToPdf(monatPdf, bytes, mime || fileInfo.mime, headerLine);
        if (res.ok) {
          monatHadBelege = true;
        } else {
          // Fallback: als Original-Datei in extras/
          const safeBase = safeFilename(`${b.datum}_${b.beleg_nr || ''}_${b.beschreibung || ''}`);
          const ext = fileInfo.fileName.match(/\.[^.]+$/)?.[0] || '';
          zip.file(`${key}/extras/${safeBase}${ext}`, bytes);
          extras++;
        }
      } catch (err) {
        console.warn(`Beleg-Verarbeitung fehlgeschlagen für Buchung ${b.id}:`, err);
        failed++;
        // Versuchen, den Beleg trotzdem als Original-Datei beizulegen wenn
        // die Bytes schon geladen sind (sonst nichts).
        try {
          const { bytes } = await fetchBelegBytes(fileInfo.fetchUrl);
          const safeBase = safeFilename(`${b.datum}_${b.beleg_nr || ''}_${b.beschreibung || ''}`);
          const ext = fileInfo.fileName.match(/\.[^.]+$/)?.[0] || '';
          zip.file(`${key}/extras/${safeBase}${ext}`, bytes);
          extras++;
        } catch {}
      }
    }

    // PDF speichern (nur wenn es mindestens Belege oder Deckblatt hat)
    if (monatHadBelege || monatPdf.getPageCount() > 0) {
      const pdfBytes = await monatPdf.save();
      zip.file(`${key}.pdf`, pdfBytes);
    }
  }

  log({ phase: 'zip', message: 'Erstelle ZIP-Archiv…' });
  const zipBlob = await zip.generateAsync({ type: 'blob' }, (m) => {
    log({ phase: 'zip-progress', message: `ZIP… ${Math.round(m.percent)}%` });
  });

  return {
    blob: zipBlob,
    stats: {
      gruppen: groupCount,
      buchungen: allBuchungen.length,
      belege: totalBelege,
      extras,
      failed,
    },
  };
}
