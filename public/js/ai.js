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

  const text = await callClaude([{ text: prompt }]);
  const result = extractJson(text);
  if (!result.soll || !result.haben) throw new Error('AI lieferte keine vollständige Buchung');
  return result;
}

// === Beleg-Auto-Analyse (Vision) ===
// Schlägt eine vollständige Doppelbuchung vor (Soll + Haben).
export async function analyzeBeleg(file, konten) {
  if (!file.type?.startsWith('image/') && file.type !== 'application/pdf') {
    throw new Error('Auto-Analyse nur für Bilder oder PDFs');
  }
  const data = await fileToBase64(file);
  return analyzeBelegInternal(file.type, data, konten);
}

// Gleiche Analyse, aber Beleg-Datei wird von einer URL geladen
// (z.B. Firebase Storage URL aus dem sp-ar-belege Portal).
// Liefert zusätzlich `faelligkeit` mit, falls auf dem Beleg erkennbar.
export async function analyzeBelegFromUrl(url, konten) {
  const { mime, data } = await urlToBase64(url);
  if (!mime.startsWith('image/') && mime !== 'application/pdf') {
    throw new Error(`Auto-Analyse nur für Bilder oder PDFs (erkannt: ${mime})`);
  }
  return analyzeBelegInternal(mime, data, konten);
}

async function analyzeBelegInternal(mimeType, base64Data, konten) {
  const aufwandErtrag = konten
    .filter((k) => k.typ === 'aufwand' || k.typ === 'ertrag')
    .map((k) => `${k.nummer} ${k.bezeichnung} [${k.typ}]`)
    .join('\n');
  const liquide = konten
    .filter((k) => k.typ === 'aktiv')
    .map((k) => `${k.nummer} ${k.bezeichnung}`)
    .join('\n');

  const prompt = `Analysiere diesen Beleg und schlage eine vollständige Doppelbuchung vor.

Regel:
- Bei einer AUSGABE/Quittung: Soll = Aufwandkonto, Haben = Zahlmittel (Bank/Kasse)
- Bei einer EINNAHME: Soll = Zahlmittel (Bank/Kasse), Haben = Ertragskonto

Antworte AUSSCHLIESSLICH mit folgendem JSON, ohne Erklärung:
{
  "datum": "<YYYY-MM-DD, Belegdatum>",
  "faelligkeit": "<YYYY-MM-DD, Fälligkeitsdatum falls auf Beleg erkennbar (Zahlung bis…), sonst null>",
  "betrag": <Zahl in CHF, positiv>,
  "vendor": "<Verkäufer / Anbieter>",
  "beschreibung": "<kurze Beschreibung des Vorgangs>",
  "ist_einnahme": <true wenn Einnahme, false wenn Ausgabe>,
  "konto_soll": "<Kontonummer>",
  "konto_haben": "<Kontonummer>",
  "tags": "<kommagetrennte Stichworte, max 3>"
}

Aufwand/Ertrag-Konten:
${aufwandErtrag}

Zahlmittel / Aktivkonten (Bank, Kasse, …):
${liquide}

Verwende AUSSCHLIESSLICH Kontonummern aus den obigen Listen.`;

  const text = await callClaude([
    { text: prompt },
    { inline_data: { mime_type: mimeType, data: base64Data } },
  ]);
  const result = extractJson(text);
  // Backward-Compat-Feld
  result.konto_vorschlag = result.konto_soll || result.konto_vorschlag;
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
