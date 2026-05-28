// KI-Anbindung: Anthropic Claude (Sonnet 4.6 als Default).
// API-Key liegt im LocalStorage (nicht in Firebase), damit jeder Browser
// seinen eigenen Schlüssel hat.

import { DEFAULT_KONTENPLAN } from './defaults.js';

const KEY_STORAGE = 'buchhaltung_claude_key';
const MODEL_STORAGE = 'buchhaltung_claude_model';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

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

// Wandelt unsere interne Parts-Liste in Claude content um.
// {text} → text-Block; {inline_data: {mime_type, data}} → image/document-Block.
function partsToClaudeContent(parts) {
  return parts.map((p) => {
    if (p.text != null) return { type: 'text', text: p.text };
    if (p.inline_data) {
      const mime = p.inline_data.mime_type;
      const data = p.inline_data.data;
      if (mime === 'application/pdf') {
        return { type: 'document', source: { type: 'base64', media_type: mime, data } };
      }
      if (mime?.startsWith('image/')) {
        return { type: 'image', source: { type: 'base64', media_type: mime, data } };
      }
    }
    return null;
  }).filter(Boolean);
}

async function callClaude(parts, generationConfig = {}) {
  const key = getApiKey();
  if (!key) throw new Error('Claude API Key fehlt – in den Einstellungen hinterlegen.');
  const model = getModel();
  const body = {
    model,
    max_tokens: generationConfig.maxTokens || 2048,
    messages: [{ role: 'user', content: partsToClaudeContent(parts) }],
  };
  if (generationConfig.temperature != null) body.temperature = generationConfig.temperature;
  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const err = await res.json();
      msg = err?.error?.message || msg;
    } catch {}
    throw new Error(`Claude API: ${msg}`);
  }
  const data = await res.json();
  return data.content?.find((b) => b.type === 'text')?.text || '';
}

function extractJson(text) {
  // Strip Markdown-Code-Fences falls vorhanden
  const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
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

// Lädt eine Datei von einer URL (z.B. Firebase Storage) und gibt Base64 + MIME zurück.
async function urlToBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Beleg-Download fehlgeschlagen: HTTP ${res.status}`);
  const blob = await res.blob();
  const mime = blob.type || 'application/octet-stream';
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
  return { mime, data };
}

// Fasst die letzten Buchungen kompakt zusammen – Format für die KI, damit
// sie aus den bisherigen Mustern lernt. Limit hält die Token-Kosten klein.
export function summarizeBuchungen(buchungen, konten, limit = 50) {
  if (!Array.isArray(buchungen) || buchungen.length === 0) return '';
  const recent = buchungen
    .slice()
    .sort((a, b) => (b.datum || '').localeCompare(a.datum || ''))
    .slice(0, limit);
  const kontoLabel = new Map((konten || []).map((k) => [k.nummer, k.bezeichnung]));
  return recent.map((b) => {
    const sollLbl = kontoLabel.get(b.soll) || '';
    const habenLbl = kontoLabel.get(b.haben) || '';
    return `- ${b.datum} | "${b.beschreibung || ''}" | Soll ${b.soll} ${sollLbl} → Haben ${b.haben} ${habenLbl} | CHF ${Number(b.betrag).toFixed(2)}`;
  }).join('\n');
}

// === Buchungsvorschlag aus Beschreibung ===
// `buchungen` (optional): bisherige Buchungen – die KI lernt aus den Mustern.
export async function suggestBuchung({ beschreibung, betrag, datum, konten, buchungen }) {
  // Aktiv + Passiv kommen direkt mit (alle Bilanzkonten), Aufwand/Ertrag
  // getrennt sortiert (spezifisch zuerst, Sammelkonten unten).
  const bilanz = konten.filter((k) => k.typ === 'aktiv' || k.typ === 'passiv')
    .sort((a, b) => a.nummer.localeCompare(b.nummer))
    .map((k) => `- ${k.nummer} ${k.bezeichnung} [${k.typ}${k.kategorie ? ' / ' + k.kategorie : ''}]`)
    .join('\n');
  const aufwandErtragBlock = formatKontenForAI(konten);
  const historie = summarizeBuchungen(buchungen, konten);
  const prompt = `Du bist Buchhalter:in eines Schweizer Vereins. Schlage für folgenden Geschäftsvorfall die korrekte Doppelbuchung vor.

## Vorgang
"${beschreibung}"
${betrag ? `Betrag: CHF ${betrag}` : ''}
${datum ? `Datum: ${datum}` : ''}

## Konto-Wahl – wichtig!
1. Erkenne Schlüsselwörter im Vorgang ("DV", "Vorstand", "Wahlen", "Mitgliedschaft", "Druck", "Bank", "Porto", etc.) und wähle das SPEZIFISCHSTE passende Konto.
2. Sammelkonten ("Sonstig…", "Übrig…", "Divers…", "Allgemein…") sind LETZTE OPTION – nur wenn KEIN spezifisches Konto passt UND in der "begruendung" begründet.
3. Konsistenz mit historischen Buchungen: wenn ein ähnlicher Vorgang schon gebucht wurde, nutze dasselbe Konto.

Buchungsregel: Aktiv- und Aufwand-Zugänge ins Soll; Passiv- und Ertrag-Zugänge ins Haben.

## Antwort-Format (AUSSCHLIESSLICH dieses JSON):
{
  "soll": "<Kontonummer aus Liste>",
  "haben": "<Kontonummer aus Liste>",
  "betrag": <Zahl, oder null>,
  "beschreibung": "<verfeinerte Beschreibung, die den Anlass / Verwendungszweck nennt>",
  "begruendung": "<sehr kurze Erklärung warum genau dieses Konto>"
}

## Aufwand-/Ertragskonten
${aufwandErtragBlock}

## Bilanz-Konten (Aktiv + Passiv)
${bilanz}

${historie ? `## Bisherige Buchungen (Lerne aus diesen Mustern – ähnlicher Vorgang ⇒ dasselbe Konto)\n${historie}\n` : ''}

WICHTIG: Wenn du ein Sammelkonto vorschlägst, prüfe nochmal ob nicht doch ein spezifisches Konto besser passt.`;

  const text = await callClaude([{ text: prompt }]);
  const result = extractJson(text);
  if (!result.soll || !result.haben) throw new Error('AI lieferte keine vollständige Buchung');
  return result;
}

// === Beleg-Auto-Analyse (Vision) ===
// Schlägt eine vollständige Doppelbuchung vor (Soll + Haben).
// `buchungen` (optional): bisherige Buchungen als Lern-Kontext für die KI.
export async function analyzeBeleg(file, konten, buchungen) {
  if (!file.type?.startsWith('image/') && file.type !== 'application/pdf') {
    throw new Error('Auto-Analyse nur für Bilder oder PDFs');
  }
  const data = await fileToBase64(file);
  return analyzeBelegInternal(file.type, data, konten, buchungen);
}

// Gleiche Analyse, aber Beleg-Datei wird von einer URL geladen
// (z.B. Firebase Storage URL aus dem sp-ar-belege Portal).
// Liefert zusätzlich `faelligkeit` mit, falls auf dem Beleg erkennbar.
export async function analyzeBelegFromUrl(url, konten, buchungen) {
  const { mime, data } = await urlToBase64(url);
  if (!mime.startsWith('image/') && mime !== 'application/pdf') {
    throw new Error(`Auto-Analyse nur für Bilder oder PDFs (erkannt: ${mime})`);
  }
  return analyzeBelegInternal(mime, data, konten, buchungen);
}

// Sammelkonto-Erkennung: Konten deren Bezeichnung auf eine generische
// "übrig/sonstig/divers"-Rolle hindeutet. Diese werden im KI-Prompt nach
// unten sortiert UND explizit als "letzte Option" markiert, damit die KI
// nicht reflexhaft darauf zurückfällt.
const SAMMELKONTO_REGEX = /\b(sonstig|sonstige[rs]?|übrig|uebrig|übrige[rs]?|uebrige[rs]?|diverse[rs]?|allgemein|allgemeine[rs]?|nicht\s+zuordenbar|misc)\b/i;
function isSammelkonto(k) {
  return SAMMELKONTO_REGEX.test(k.bezeichnung);
}

// Formatiert die Aufwand/Ertrag-Konten für die KI: spezifische Konten
// zuerst (sortiert nach Nummer), Sammelkonten klar getrennt darunter
// als "FALLBACK".
function formatKontenForAI(konten) {
  const aufwandErtrag = konten.filter((k) => k.typ === 'aufwand' || k.typ === 'ertrag');
  const spezifisch = aufwandErtrag.filter((k) => !isSammelkonto(k))
    .sort((a, b) => a.nummer.localeCompare(b.nummer));
  const sammel = aufwandErtrag.filter((k) => isSammelkonto(k))
    .sort((a, b) => a.nummer.localeCompare(b.nummer));
  const fmt = (k) => `- ${k.nummer} ${k.bezeichnung} [${k.typ}${k.kategorie ? ' / ' + k.kategorie : ''}]`;
  let out = '## SPEZIFISCHE Konten (bevorzugt verwenden):\n';
  out += spezifisch.map(fmt).join('\n');
  if (sammel.length) {
    out += '\n\n## SAMMELKONTEN – NUR als letzte Option, wenn KEIN spezifisches Konto passt:\n';
    out += sammel.map(fmt).join('\n');
  }
  return out;
}

async function analyzeBelegInternal(mimeType, base64Data, konten, buchungen) {
  const aufwandErtragBlock = formatKontenForAI(konten);
  const liquide = konten
    .filter((k) => k.typ === 'aktiv')
    .map((k) => `- ${k.nummer} ${k.bezeichnung}${k.kategorie ? ' [' + k.kategorie + ']' : ''}`)
    .join('\n');

  const prompt = `Analysiere diesen Beleg und schlage die korrekte Doppelbuchung vor.

## Buchungsregel
- AUSGABE/Quittung: Soll = Aufwandkonto, Haben = Zahlmittel (Bank/Kasse) ODER Verbindlichkeit
- EINNAHME: Soll = Zahlmittel (Bank/Kasse), Haben = Ertragskonto

## Konto-Wahl – wichtig, lies sorgfältig!
Geh in dieser Reihenfolge vor:

1. **Schlüsselwörter erkennen.** Lies den Beleg und die Beschreibung des Einreichers genau. Achte auf Anlass-/Kontext-Hinweise wie:
   - "DV", "Delegierten*", "Delegiertenversammlung" → gehört auf das Delegiertenversammlungs-Konto
   - "Parteitag", "PT" → Parteitag-Konto
   - "Vorstand", "Sitzung", "VS" → Vorstand-Konto
   - "Wahlen", "Wahlkampf", "Kampagne" → Wahl-Konto
   - "Mitgliedschaft", "Beitrag SPS" → Mitgliedschaftsbeiträge-Konto
   - "Geschenk", "Blumen", "Apéro" + Anlass-Wort → das jeweilige Anlass-Konto (NICHT Sammelkonto!)
   - "Druckerei", "Flyer", "Plakat" → Drucksachen-/Werbematerial
   - "Porto", "Briefmarken" → Porto
   - "IT", "Server", "Domain", "Hosting" → Informatik
   - "Bank", "Spesen", "Gebühr" + Bank-Bezug → Bankspesen

2. **Wähle das SPEZIFISCHSTE passende Konto.** Wenn z.B. ein Restaurant-Beleg "Geschenk DV" als Verwendung hat, gehört er auf "Delegiertenversammlungen" – NICHT auf "Veranstaltungen allgemein" und ERST RECHT NICHT auf "Sonstiger Betriebsaufwand".

3. **Sammelkonten sind eine LETZTE OPTION.** "Sonstig…", "Übrig…", "Diverse…", "Allgemein…" wählst du NUR wenn:
   (a) wirklich kein spezifisches Konto sinnvoll passt UND
   (b) du das in der "begruendung" explizit begründest.
   Sie sind unten als "SAMMELKONTEN" markiert.

4. **Historische Buchungen sind dein wichtigster Hinweis.** Wenn ein ähnlicher Vorgang (gleiche Beschreibung, gleicher Vendor, gleicher Anlass) bereits gebucht wurde, nutze DASSELBE Konto. Konsistenz ist wichtiger als marginale Verbesserung.

5. **Bei Mehrdeutigkeit:** wähle das Konto, dessen Bezeichnung dem Anlass am nächsten kommt. Z.B. bei "Apéro-Einkauf für Parteitag" → Parteitag-Konto (auch wenn es ein Lebensmittel-Beleg ist).

## Antwort-Format (AUSSCHLIESSLICH dieses JSON, ohne Erklärung drumherum):
{
  "ist_beleg": <true wenn das Dokument tatsächlich ein Buchhaltungsbeleg (Rechnung, Quittung, Kontoauszug, Bankbeleg) ist. false wenn es etwas anderes ist (Schulaufgabe, Briefkopf, Dossier, Notiz, Werbung). Default true.>,
  "datum": "<YYYY-MM-DD, Belegdatum, oder null>",
  "faelligkeit": "<YYYY-MM-DD. Wenn auf dem Beleg ein Fälligkeits-/Zahlungsziel steht (z.B. 'Zahlbar bis…', 'Fällig am…'), nimm das. Wenn der Beleg bereits BEZAHLT ist (Quittung, 'bezahlt am…', Kassenbon), nimm das Bezahldatum/Belegdatum. Sonst null.>",
  "betrag": <Zahl in CHF, positiv, oder null>,
  "vendor": "<Verkäufer / Anbieter, oder null>",
  "beleg_nr": "<Rechnungs-/Belegnummer wie auf dem Beleg gedruckt (z.B. 'R-2026-0123', '1234567'). Wenn keine erkennbar, null.>",
  "beschreibung": "<kurze Beschreibung des Vorgangs, der den Anlass / Verwendungszweck nennt – nicht nur den Vendor>",
  "ist_einnahme": <true wenn Einnahme, false wenn Ausgabe>,
  "bezahlt": <true wenn der Beleg BEREITS BEZAHLT ist (Quittung, Kassenbon, Barzahlung, Kontoauszug, Lastschriftbeleg, 'bezahlt am…' steht drauf, oder Zahlmittel = Bank/Kasse). false wenn es eine offene Rechnung ist mit Zahlungsziel in der Zukunft.>,
  "konto_soll": "<Kontonummer>",
  "konto_haben": "<Kontonummer>",
  "begruendung": "<sehr kurze Erklärung warum genau dieses Konto gewählt wurde – besonders wichtig wenn ein Sammelkonto verwendet wird>",
  "tags": "<kommagetrennte Stichworte, max 3>"
}

## Verfügbare Aufwand-/Ertragskonten
${aufwandErtragBlock}

## Zahlmittel-/Aktivkonten (Bank, Kasse, …)
${liquide}

${summarizeBuchungen(buchungen, konten) ? `## Bisherige Buchungen (Lerne aus diesen Mustern – ähnlicher Vorgang ⇒ dasselbe Konto)\n${summarizeBuchungen(buchungen, konten)}\n` : ''}

Verwende AUSSCHLIESSLICH Kontonummern aus den obigen Listen.

WICHTIG: Wenn du ein Sammelkonto ("Sonstig…", "Übrig…", "Divers…") wählst, prüfe nochmal ob nicht doch ein spezifisches Konto besser passt. Das ist der häufigste Fehler – falle nicht darauf zurück.

ABSOLUT WICHTIG: Antworte IMMER mit dem JSON-Schema – auch wenn das Dokument KEIN Buchhaltungsbeleg ist (z.B. Schulaufgabe, Notiz, Briefkopf, Dossier). In dem Fall:
- "ist_beleg": false setzen (sonst weglassen / true)
- Felder nach bestem Wissen ausfüllen (alle dürfen null sein wenn nicht erkennbar)
- "begruendung" enthält Erklärung was das Dokument ist und warum es kein Beleg ist
NIE Klartext zurückgeben. NIE die Antwort verweigern. IMMER das JSON-Schema befüllen.`;

  const text = await callClaude([
    { text: prompt },
    { inline_data: { mime_type: mimeType, data: base64Data } },
  ]);
  let result;
  try {
    result = extractJson(text);
  } catch (err) {
    // KI hat trotz Anweisung Klartext geliefert (z.B. "Das ist kein Beleg").
    // Wir bauen ein leeres Result mit der Erklärung als begruendung – so
    // wird der Beleg im Cache als "nicht buchbar" markiert und der
    // Prefetch fällt nicht mehr darauf.
    result = {
      ist_beleg: false,
      datum: null, faelligkeit: null, betrag: null, vendor: null,
      beleg_nr: null, beschreibung: null, ist_einnahme: null,
      bezahlt: false, konto_soll: null, konto_haben: null,
      tags: '',
      begruendung: text.trim().slice(0, 500),
    };
  }
  // Backward-Compat-Feld
  // Firestore akzeptiert keine `undefined`-Werte → immer auf null normalisieren
  result.konto_vorschlag = result.konto_soll || result.konto_vorschlag || null;
  // Vorsorglich auch andere optionale Felder die undefined sein könnten
  for (const k of ['datum', 'faelligkeit', 'betrag', 'vendor', 'beleg_nr', 'beschreibung',
                   'konto_soll', 'konto_haben', 'tags', 'begruendung', 'ist_einnahme',
                   'bezahlt', 'ist_beleg']) {
    if (result[k] === undefined) result[k] = null;
  }
  // Plausibilitäts-Heuristik: eine Rechnung mit Fälligkeit/Zahlungsziel in
  // der ZUKUNFT kann noch nicht bezahlt sein (sonst gäbe es kein offenes
  // Zahlungsziel). Korrigiert häufige KI-Fehleinschätzung.
  if (result.bezahlt === true && result.faelligkeit) {
    const faellig = new Date(result.faelligkeit);
    const heute = new Date(); heute.setHours(0, 0, 0, 0);
    if (!isNaN(faellig.getTime()) && faellig > heute) {
      result.bezahlt = false;
    }
  }
  return result;
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

  const text = await callClaude([{ text: prompt }], { temperature: 0.4 });
  const result = extractJson(text);
  if (!Array.isArray(result.konten)) throw new Error('Antwort enthält keine konten-Liste');
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

// === Mail-/Brief-Vorlage generieren ===
export async function generateVorlage(beschreibung, kontext = {}) {
  const vereinName = kontext.verein_name || 'der Verein';
  const prompt = `Erstelle eine Mail-Vorlage für ${vereinName} basierend auf folgender Anforderung:

"${beschreibung}"

Empfänger sind Sektionen einer politischen Partei. Verwende folgende
Platzhalter wo sinnvoll:
- {{sektion_name}} – Sektionsname (z.B. SP Herisau)
- {{kontakt_name}} – Kontaktperson (z.B. Präsident:in)
- {{kontakt_email}} – Kontakt-Email der Sektion
- {{sektion_adresse}}, {{sektion_plz}}, {{sektion_ort}}
- {{anzahl_mitglieder}} – Anzahl Mitglieder der Sektion
- {{beitrag_pro_mitglied}} – CHF Beitrag pro Mitglied
- {{total_beitrag}} – Total Sektionsbeitrag CHF
- {{verein_name}}, {{verein_adresse}}, {{verein_iban}}, {{verein_bank}}
- {{datum}}, {{jahr}}

Antworte AUSSCHLIESSLICH mit folgendem JSON, ohne weitere Erklärung:
{
  "name": "<Name der Vorlage>",
  "typ": "mail",
  "betreff": "<Betreff mit Platzhaltern>",
  "inhalt": "<Inhalt mit Zeilenumbrüchen \\n und Platzhaltern>"
}

Verwende die Du-Form, Schweizer Schreibweise (ss statt ß), gendergerecht
(z.B. "Liebe:r"). Halte den Ton freundlich aber sachlich.`;

  const text = await callClaude([{ text: prompt }], { temperature: 0.6 });
  return extractJson(text);
}

// === Voranschlag / Budget aus Vorjahren generieren ===
export async function generateVoranschlag({ jahr, konten, historie, sektionen, notizen }) {
  const kontenText = konten
    .filter((k) => k.typ === 'ertrag' || k.typ === 'aufwand')
    .map((k) => `${k.nummer} ${k.bezeichnung} [${k.typ}]`)
    .join('\n');

  const histText = Object.entries(historie || {})
    .map(([kontoNr, jahreData]) => {
      const k = konten.find((x) => x.nummer === kontoNr);
      const label = k ? `${k.nummer} ${k.bezeichnung}` : kontoNr;
      const j = Object.entries(jahreData)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([y, betrag]) => `${y}: CHF ${Number(betrag).toFixed(2)}`)
        .join(', ');
      return `- ${label}: ${j}`;
    })
    .join('\n');

  const sektionenText = (sektionen || [])
    .filter((s) => s.status === 'aktiv' || !s.status)
    .map((s) => `- ${s.name}: ${s.anzahl_mitglieder} Mitglieder × CHF ${s.beitrag_pro_mitglied} = CHF ${(s.anzahl_mitglieder * s.beitrag_pro_mitglied).toFixed(2)}`)
    .join('\n') || '(keine Sektionen erfasst)';

  const prompt = `Erstelle einen realistischen Voranschlag (Budget) für das Jahr ${jahr} für einen Schweizer politischen Verein (SP AR).

Aktuelle Sektionsbeiträge:
${sektionenText}

Historische Ist-Werte pro Konto (CHF):
${histText || '(keine Historie vorhanden)'}

${notizen ? `Zusätzliche Hinweise vom Kassier:\n${notizen}\n` : ''}

Verfügbare Ertrags- und Aufwandkonten:
${kontenText}

Berücksichtige:
- Realistische Schätzung basierend auf Vorjahres-Trends
- Inflation ca. 1-2% jährlich für laufende Kosten
- Sektionsbeiträge: Summe aus obigen Sektionen
- Falls keine Historie für ein Konto vorhanden ist: nur wenn typisch erwartbar, sonst weglassen
- Markiere Einmaleffekte oder spezielle Schätzungen in der "begründung"

Antworte AUSSCHLIESSLICH mit folgendem JSON-Format:
{
  "positionen": [
    {"konto": "<Kontonummer>", "betrag": <Zahl>, "begruendung": "<kurze Erklärung>"}
  ]
}

Verwende nur Kontonummern aus der obigen Liste. Betrag in CHF, positiv (Vorzeichen ergibt sich aus typ).`;

  const text = await callClaude([{ text: prompt }], { temperature: 0.3 });
  const result = extractJson(text);
  if (!Array.isArray(result.positionen)) throw new Error('Antwort enthält keine positionen-Liste');
  return result.positionen
    .filter((p) => p.konto && p.betrag != null)
    .map((p) => ({
      konto: String(p.konto).trim(),
      betrag: Math.round(Number(p.betrag) * 100) / 100,
      notiz: String(p.begruendung || '').trim(),
    }));
}

// === Test-Verbindung ===
export async function testConnection() {
  const text = await callClaude([{ text: 'Antworte mit dem Wort: OK' }]);
  return text.trim().includes('OK');
}

// === KI-Finanzbericht ===
// Vergleicht Budget vs. Ist und generiert einen Bericht in Markdown.
// erklärt Abweichungen anhand der Buchungsbeschreibungen (thematisch,
// OHNE konkrete Rechnungsnummern oder Vendor-Namen zu nennen).
//
// type: 'budget' (Soll/Ist), 'jahresrueckblick' (Erzählung), 'kompakt' (kurz).
export async function generateFinanzbericht({
  jahr, buchungen, konten, budget, einstellungen, type = 'budget',
}) {
  const kontoMap = new Map((konten || []).map((k) => [k.nummer, k]));
  // Ist-Werte pro Konto berechnen
  const istPerKonto = new Map();
  for (const b of buchungen || []) {
    const betrag = Number(b.betrag) || 0;
    if (b.soll) istPerKonto.set(b.soll, (istPerKonto.get(b.soll) || 0) + betrag);
    if (b.haben) istPerKonto.set(b.haben, (istPerKonto.get(b.haben) || 0) - betrag);
  }
  // Saldo eines Erfolgs-Kontos: Ertrag = -saldo (negativ aus haben),
  // Aufwand = +saldo (positiv aus soll). Wir wollen positive Werte.
  function istBetrag(konto) {
    const k = kontoMap.get(konto);
    const raw = istPerKonto.get(konto) || 0;
    if (!k) return raw;
    if (k.typ === 'ertrag') return -raw;        // Ertrag: positiv = "haben-Saldo"
    if (k.typ === 'aufwand') return raw;        // Aufwand: positiv = "soll-Saldo"
    return raw;
  }

  // Budget-vs-Ist Tabelle (nur Konten mit Budget oder mit Ist-Werten > 0)
  const budgetMap = new Map((budget?.positionen || []).map((p) => [String(p.konto), p]));
  const allKontoNrs = new Set([
    ...budgetMap.keys(),
    ...Array.from(istPerKonto.keys()).filter((nr) => {
      const k = kontoMap.get(nr);
      return k && (k.typ === 'ertrag' || k.typ === 'aufwand');
    }),
  ]);
  const rows = [];
  for (const nr of allKontoNrs) {
    const k = kontoMap.get(nr);
    if (!k) continue;
    if (k.typ !== 'ertrag' && k.typ !== 'aufwand') continue;
    const budgetPos = budgetMap.get(nr);
    const budget = budgetPos ? Number(budgetPos.betrag) : 0;
    const ist = istBetrag(nr);
    const abw = ist - budget;
    rows.push({ nr, name: k.bezeichnung, typ: k.typ, budget, ist, abw, notiz: budgetPos?.notiz || '' });
  }
  rows.sort((a, b) => a.nr.localeCompare(b.nr));

  const tabelle = rows.map((r) =>
    `- ${r.nr} ${r.name} [${r.typ}] | Budget: CHF ${r.budget.toFixed(2)} | Ist: CHF ${r.ist.toFixed(2)} | Abweichung: CHF ${r.abw >= 0 ? '+' : ''}${r.abw.toFixed(2)}${r.notiz ? ` | Budget-Notiz: ${r.notiz}` : ''}`
  ).join('\n');

  // Buchungs-Stichworte (nur Beschreibung + Konto + Datum, KEINE Belegnummern)
  const stichworte = (buchungen || [])
    .slice()
    .sort((a, b) => (b.datum || '').localeCompare(a.datum || ''))
    .map((b) => {
      const sollK = kontoMap.get(b.soll);
      const habenK = kontoMap.get(b.haben);
      return `- ${b.datum} | "${b.beschreibung || ''}" | ${b.soll} ${sollK?.bezeichnung || ''} → ${b.haben} ${habenK?.bezeichnung || ''} | CHF ${Number(b.betrag).toFixed(2)}`;
    })
    .slice(0, 200)  // Max 200 für Token-Budget
    .join('\n');

  // Aggregat Ertrag / Aufwand / Ergebnis
  const totalErtrag = rows.filter((r) => r.typ === 'ertrag').reduce((s, r) => s + r.ist, 0);
  const totalAufwand = rows.filter((r) => r.typ === 'aufwand').reduce((s, r) => s + r.ist, 0);
  const ergebnis = totalErtrag - totalAufwand;
  const budgetErtrag = rows.filter((r) => r.typ === 'ertrag').reduce((s, r) => s + r.budget, 0);
  const budgetAufwand = rows.filter((r) => r.typ === 'aufwand').reduce((s, r) => s + r.budget, 0);
  const budgetErgebnis = budgetErtrag - budgetAufwand;

  const vereinName = einstellungen?.name || 'der Verein';

  const typLabel = {
    budget: 'einen prägnanten Budget-vs-Ist-Bericht',
    jahresrueckblick: 'einen erzählerischen Jahresrückblick (3-4 Absätze)',
    kompakt: 'eine sehr kurze Executive Summary (max. 8 Sätze)',
  }[type] || 'einen Budget-vs-Ist-Bericht';

  const prompt = `Du bist Buchhalter:in von ${vereinName}. Erstelle ${typLabel} für das Geschäftsjahr ${jahr}.

## Aggregat
- Ertrag Ist: CHF ${totalErtrag.toFixed(2)} (Budget: CHF ${budgetErtrag.toFixed(2)})
- Aufwand Ist: CHF ${totalAufwand.toFixed(2)} (Budget: CHF ${budgetAufwand.toFixed(2)})
- Ergebnis Ist: CHF ${ergebnis.toFixed(2)} (Budget: CHF ${budgetErgebnis.toFixed(2)})

## Konten Budget vs. Ist
${tabelle || '(keine Daten)'}

## Buchungs-Stichworte (für inhaltliche Erklärungen, NICHT zitieren)
${stichworte || '(keine Buchungen)'}

Schreibe den Bericht in Markdown mit folgender Struktur (passe Tiefe an gewählten Typ an):

1. **Kennzahlen** – die wichtigsten Zahlen (Ertrag, Aufwand, Ergebnis) und ob das Budget erreicht wurde
2. **Wo wurde das Budget erreicht / über- / unterschritten** – Top 3-5 Abweichungen mit Erklärung anhand der Buchungs-Stichworte
3. **Ursachen** – thematisch zusammenfassen ("höhere Veranstaltungskosten aufgrund mehrerer Anlässe", "Wahlkampfvorbereitung treibt Position X")
4. **Fazit** – ein kurzes Schlusswort

WICHTIG:
- NIEMALS einzelne Beleg- oder Rechnungsnummern zitieren
- NIEMALS Vendor-Namen oder Firmen-Namen direkt aus den Beschreibungen zitieren (z.B. nicht "Druckerei XY", sondern "Druckkosten für Werbematerial")
- Fasse thematisch zusammen, nenne Konten-Bezeichnungen statt einzelne Einträge
- Auf Deutsch, Schweizer Schreibweise (ss statt ß)
- Beträge in CHF, formatiert mit Tausendertrennzeichen
- Beginne den Bericht direkt mit dem Inhalt (keine Einleitung "Hier ist der Bericht…")`;

  return await callClaude([{ text: prompt }], { temperature: 0.4, maxTokens: 3500 });
}

// === Chat-Assistent (mehrteilige Konversation) mit Prompt-Caching ===
// history: Array von { role: 'user'|'assistant', text }
// systemContext: kompakter Snapshot der Buchhaltung – wird als separater
// cache-fähiger Block ausgeliefert. Innerhalb einer Session (Snapshot
// identisch) wird die Folgefrage rund 90% billiger.
const CHAT_ROLE_PROMPT = `Du bist der freundliche, präzise Buchhaltungs-Assistent für einen Schweizer Verein (SP AR).
Du kannst Fragen zur Vereinsbuchhaltung beantworten, Beträge aus den bereitgestellten Daten ablesen,
Buchungsvorschläge machen und beim Verständnis der doppelten Buchführung helfen.

Antworte knapp, klar und auf Deutsch (Schweizer Konvention: ss statt ß).
Verwende Markdown für Listen, Fettdruck und Code-Blöcke wenn sinnvoll.
Wenn du eine Buchung vorschlägst, formatiere sie als: **Soll** Kto-Nr / **Haben** Kto-Nr / CHF Betrag.
Erfinde keine Konten – nutze nur jene im Kontenplan.
Wenn dir Informationen fehlen, frag konkret nach.`;

export async function chat({ history, systemContext, userMessage }) {
  const key = getApiKey();
  if (!key) throw new Error('Claude API Key fehlt – in den Einstellungen hinterlegen.');
  const model = getModel();

  const messages = [];
  for (const h of history || []) {
    messages.push({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: h.text,
    });
  }
  messages.push({ role: 'user', content: userMessage });

  // system als Block-Array: stabile Rolle zuerst, danach Buchhaltungs-Snapshot
  // mit cache_control. Da der Snapshot innerhalb einer Session identisch bleibt
  // und der Cache ein Prefix-Match ist, profitieren alle Folgefragen vom
  // gecachten Snapshot (~90% Rabatt auf den gecachten Anteil).
  const system = [
    { type: 'text', text: CHAT_ROLE_PROMPT },
    {
      type: 'text',
      text: `Aktueller Stand der Buchhaltung:\n${systemContext || '(kein Kontext verfügbar)'}`,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const body = {
    model,
    max_tokens: 1500,
    temperature: 0.4,
    system,
    messages,
  };

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const err = await res.json(); msg = err?.error?.message || msg; } catch {}
    throw new Error(`Claude API: ${msg}`);
  }
  const data = await res.json();
  if (data.usage) {
    const hit = data.usage.cache_read_input_tokens || 0;
    const write = data.usage.cache_creation_input_tokens || 0;
    if (hit || write) console.debug(`[Claude cache] read=${hit} write=${write} input=${data.usage.input_tokens}`);
  }
  return data.content?.find((b) => b.type === 'text')?.text || '';
}
