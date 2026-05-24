// Gemini-API-Anbindung. API-Key liegt im LocalStorage (nicht in Firebase),
// damit jeder Browser seinen eigenen Schlüssel hat.

import { DEFAULT_KONTENPLAN } from './defaults.js';

const KEY_STORAGE = 'buchhaltung_gemini_key';
const MODEL_STORAGE = 'buchhaltung_gemini_model';
const DEFAULT_MODEL = 'gemini-1.5-flash';

export function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || '';
}

export function setApiKey(k) {
  if (k) localStorage.setItem(KEY_STORAGE, String(k).trim());
  else localStorage.removeItem(KEY_STORAGE);
}

export function hasApiKey() {
  return !!getApiKey();
}

export function getModel() {
  return localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL;
}

export function setModel(m) {
  if (m) localStorage.setItem(MODEL_STORAGE, m);
  else localStorage.removeItem(MODEL_STORAGE);
}

async function callGemini(parts, generationConfig = {}) {
  const key = getApiKey();
  if (!key) throw new Error('Gemini API Key fehlt – in den Einstellungen hinterlegen.');
  const model = getModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.2, ...generationConfig },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const err = await res.json();
      msg = err?.error?.message || msg;
    } catch {}
    throw new Error(`Gemini API: ${msg}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function extractJson(text) {
  // Strip Markdown-Code-Fences falls vorhanden
  const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  // Erstes vollständiges JSON-Objekt extrahieren
  const start = cleaned.indexOf('{');
  if (start < 0) throw new Error('AI-Antwort enthielt kein JSON: ' + text.slice(0, 200));
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === '{') depth++;
    else if (cleaned[i] === '}') {
      depth--;
      if (depth === 0) {
        return JSON.parse(cleaned.slice(start, i + 1));
      }
    }
  }
  throw new Error('AI-Antwort: kein vollständiges JSON gefunden');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// === Buchungsvorschlag aus Beschreibung ===
export async function suggestBuchung({ beschreibung, betrag, datum, konten }) {
  const list = konten
    .map((k) => `${k.nummer} ${k.bezeichnung} [${k.typ}]`)
    .join('\n');
  const prompt = `Du bist Buchhalter:in eines Schweizer Vereins. Schlage für folgenden Geschäftsvorfall die korrekte Doppelbuchung vor.

Vorgang: "${beschreibung}"
${betrag ? `Betrag: CHF ${betrag}` : ''}
${datum ? `Datum: ${datum}` : ''}

Verfügbare Konten:
${list}

Antworte AUSSCHLIESSLICH mit folgendem JSON, ohne weitere Erklärungen:
{
  "soll": "<Kontonummer aus Liste>",
  "haben": "<Kontonummer aus Liste>",
  "betrag": <Zahl, oder null>,
  "beschreibung": "<verfeinerte Beschreibung>",
  "begruendung": "<sehr kurze Erklärung warum>"
}

Wichtig: Aktiv- und Aufwand-Zugänge ins Soll; Passiv- und Ertrag-Zugänge ins Haben.`;

  const text = await callGemini([{ text: prompt }]);
  const result = extractJson(text);
  if (!result.soll || !result.haben) throw new Error('AI lieferte keine vollständige Buchung');
  return result;
}

// === Beleg-Auto-Analyse (Vision) ===
export async function analyzeBeleg(file, konten) {
  if (!file.type?.startsWith('image/') && file.type !== 'application/pdf') {
    throw new Error('Auto-Analyse nur für Bilder oder PDFs');
  }
  const aufwandErtrag = konten
    .filter((k) => k.typ === 'aufwand' || k.typ === 'ertrag')
    .map((k) => `${k.nummer} ${k.bezeichnung} [${k.typ}]`)
    .join('\n');

  const data = await fileToBase64(file);
  const prompt = `Analysiere diesen Beleg/Quittung und extrahiere die Informationen.

Antworte AUSSCHLIESSLICH mit folgendem JSON, ohne weitere Erklärungen:
{
  "datum": "<YYYY-MM-DD>",
  "betrag": <Zahl in CHF>,
  "vendor": "<Verkäufer / Anbieter>",
  "beschreibung": "<kurze Beschreibung des Vorgangs>",
  "konto_vorschlag": "<Kontonummer aus Liste>",
  "tags": "<kommagetrennte Stichworte, max 3>"
}

Verfügbare Aufwand-/Ertragskonten:
${aufwandErtrag}`;

  const text = await callGemini([
    { text: prompt },
    { inline_data: { mime_type: file.type, data } },
  ]);
  return extractJson(text);
}

// === Kontenplan basierend auf Vereins-Beschreibung generieren ===
export async function generateKontenplan(beschreibung) {
  const standard = DEFAULT_KONTENPLAN
    .map((k) => `${k.nummer} ${k.bezeichnung} [${k.typ}]`)
    .join('\n');
  const prompt = `Erstelle einen passenden Schweizer Vereins-Kontenplan basierend auf folgender Vereins-Beschreibung:

"${beschreibung}"

Als Ausgangspunkt dient dieser Standard-Kontenplan:
${standard}

Passe ihn an: Lasse irrelevante Konten weg, ergänze typische Konten für die Aktivitäten des Vereins. Halte dich an die Schweizer Konventionen (1000-1999 Aktiv, 2000-2999 Passiv, 3000-3999 Ertrag, 4000-8999 Aufwand).

Antworte AUSSCHLIESSLICH mit folgendem JSON, ohne weitere Erklärung:
{
  "konten": [
    {"nummer": "1000", "bezeichnung": "Kasse", "typ": "aktiv", "kategorie": "liquid"}
  ]
}

typ muss exakt einer dieser Werte sein: "aktiv", "passiv", "ertrag", "aufwand".`;

  const text = await callGemini([{ text: prompt }], { temperature: 0.4 });
  const result = extractJson(text);
  if (!Array.isArray(result.konten)) throw new Error('Antwort enthält keine konten-Liste');
  // Validieren / normalisieren
  const valid = ['aktiv', 'passiv', 'ertrag', 'aufwand'];
  return result.konten
    .filter((k) => k.nummer && k.bezeichnung && valid.includes(k.typ))
    .map((k) => ({
      nummer: String(k.nummer).trim(),
      bezeichnung: String(k.bezeichnung).trim(),
      typ: k.typ,
      kategorie: k.kategorie || '',
    }));
}

// === Test-Verbindung ===
export async function testConnection() {
  const text = await callGemini([{ text: 'Antworte mit dem Wort: OK' }]);
  return text.trim().includes('OK');
}
