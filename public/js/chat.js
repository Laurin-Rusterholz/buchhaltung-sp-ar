// Schwebendes KI-Chat-Widget unten rechts.
// Verwendet Gemini (Key aus Einstellungen) und übergibt einen kompakten
// Snapshot der Buchhaltungsdaten als Kontext, damit der Chat konkrete
// Fragen beantworten kann ("wie viel hat Sektion X bezahlt", etc.).

import { api } from './api.js';
import { state } from './main.js';
import { escapeHtml, formatChf } from './utils.js';
import { chat, hasApiKey } from './ai.js';

const HISTORY_KEY = 'buchhaltung_chat_history';
const SUGGESTIONS = [
  'Welche Rechnungen sind noch offen?',
  'Wie hoch sind die Sektionsbeiträge dieses Jahr?',
  'Wieviel Aufwand hatten wir bisher?',
  'Was ist eine doppelte Buchung?',
];

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { return []; }
}
function saveHistory(history) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-30))); } catch {}
}

// Sehr leichtgewichtiger Markdown-Renderer (Fett, Italic, Code, Linien, Listen).
function renderMarkdown(text) {
  let html = escapeHtml(text);
  // Code-Blöcke
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre>${code}</pre>`);
  // Inline-Code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold + Italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Listenzeilen
  html = html.replace(/(^|\n)[*-] (.+)/g, '$1<li>$2</li>');
  html = html.replace(/(<li>.*?<\/li>(\s*<li>.*?<\/li>)*)/gs, '<ul>$1</ul>');
  // Zeilenumbrüche
  html = html.replace(/\n/g, '<br>');
  return html;
}

// Erstellt einen kompakten, aber informativen Snapshot für den KI-Kontext.
async function buildSystemContext() {
  const jahr = state.aktuellesJahr;
  try {
    const [konten, buchungen, sektionen, rechnungen, einst] = await Promise.all([
      api.listKonten(),
      api.listBuchungen(jahr),
      api.listSektionen(),
      api.listRechnungen(jahr),
      api.getEinstellungen(),
    ]);
    const lines = [];
    lines.push(`Verein: ${einst.name || '—'} (${einst.untertitel || ''})`);
    lines.push(`Aktuelles Geschäftsjahr: ${jahr}`);
    lines.push('');
    lines.push('## Kontenplan (Auszug, Nr / Bezeichnung / Typ)');
    konten.forEach((k) => lines.push(`- ${k.nummer} ${k.bezeichnung} [${k.typ}]`));
    lines.push('');
    lines.push(`## Buchungen ${jahr} (insgesamt ${buchungen.length})`);
    const recent = buchungen.slice().sort((a, b) => (b.datum || '').localeCompare(a.datum || '')).slice(0, 25);
    recent.forEach((b) => lines.push(`- ${b.datum} | ${b.beleg_nr || ''} | ${b.soll}→${b.haben} | CHF ${formatChf(b.betrag)} | ${b.beschreibung}${b.bezahlt ? ' [bezahlt]' : ''}`));
    if (buchungen.length > 25) lines.push(`(... ${buchungen.length - 25} weitere Buchungen)`);
    lines.push('');
    lines.push(`## Rechnungen ${jahr} (${rechnungen.length})`);
    rechnungen.slice(0, 30).forEach((r) => lines.push(`- ${r.nummer} | ${r.datum} | ${r.empfaenger_name} | CHF ${formatChf(r.total)} | Status: ${r.status}${r.faellig_am ? ' | fällig ' + r.faellig_am : ''}`));
    lines.push('');
    lines.push(`## Sektionen (${sektionen.length})`);
    sektionen.forEach((s) => lines.push(`- ${s.name} | ${s.anzahl_mitglieder || 0} Mitglieder × CHF ${s.beitrag_pro_mitglied || 0} = CHF ${formatChf((s.anzahl_mitglieder || 0) * (s.beitrag_pro_mitglied || 0))}`));
    return lines.join('\n');
  } catch (e) {
    return `(Kontext konnte nicht geladen werden: ${e.message})`;
  }
}

export function initChat() {
  // Verhindert doppeltes Setup
  if (document.getElementById('ai-chat-fab')) return;

  const fab = document.createElement('button');
  fab.id = 'ai-chat-fab';
  fab.innerHTML = '<span class="pulse"></span>✨';
  fab.title = 'KI-Buchhaltungs-Assistent';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'ai-chat-panel';
  panel.innerHTML = `
    <div class="ai-chat-header">
      <div class="title">
        <strong>✨ Buchhaltungs-Assistent</strong>
        <span>Powered by Gemini · ${state.einstellungen?.name || 'Verein'}</span>
      </div>
      <div class="actions">
        <button data-action="clear" title="Verlauf löschen">↻</button>
        <button data-action="close" title="Schliessen">×</button>
      </div>
    </div>
    <div class="ai-chat-messages" id="ai-chat-messages"></div>
    <div class="ai-chat-suggestions" id="ai-chat-suggestions"></div>
    <div class="ai-chat-input">
      <textarea id="ai-chat-input" placeholder="Frage stellen… (z.B. wie viel ist noch offen?)" rows="1"></textarea>
      <button class="send" id="ai-chat-send" title="Senden">↑</button>
    </div>
  `;
  document.body.appendChild(panel);

  const messagesEl = panel.querySelector('#ai-chat-messages');
  const inputEl = panel.querySelector('#ai-chat-input');
  const sendBtn = panel.querySelector('#ai-chat-send');
  const suggestionsEl = panel.querySelector('#ai-chat-suggestions');

  let history = loadHistory();
  let isThinking = false;

  function renderMessages() {
    if (history.length === 0) {
      messagesEl.innerHTML = `
        <div class="ai-msg assistant">
          Hallo! Ich bin dein Buchhaltungs-Assistent.<br><br>
          Frag mich nach <strong>offenen Rechnungen</strong>, <strong>Salden</strong>, <strong>Sektionsbeiträgen</strong>
          oder lass dir eine <strong>Buchung vorschlagen</strong>.
          ${!hasApiKey() ? '<br><br>⚠️ Bitte zuerst einen Gemini API-Key in den <strong>Einstellungen</strong> hinterlegen.' : ''}
        </div>
      `;
    } else {
      messagesEl.innerHTML = history.map((m) => `
        <div class="ai-msg ${m.role}">${m.role === 'assistant' ? renderMarkdown(m.text) : escapeHtml(m.text)}</div>
      `).join('');
    }
    if (isThinking) {
      messagesEl.insertAdjacentHTML('beforeend', '<div class="ai-msg thinking">denkt nach…</div>');
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderSuggestions() {
    if (history.length > 0 || !hasApiKey()) {
      suggestionsEl.innerHTML = '';
      return;
    }
    suggestionsEl.innerHTML = SUGGESTIONS.map((s) => `<button data-suggest="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');
  }

  async function send(userText) {
    const text = (userText || inputEl.value || '').trim();
    if (!text || isThinking) return;
    if (!hasApiKey()) {
      history.push({ role: 'assistant', text: '⚠️ Kein Gemini API-Key hinterlegt. Bitte in den **Einstellungen** ergänzen.' });
      renderMessages();
      return;
    }
    history.push({ role: 'user', text });
    inputEl.value = '';
    inputEl.style.height = 'auto';
    isThinking = true;
    renderMessages();
    renderSuggestions();

    try {
      const systemContext = await buildSystemContext();
      const answer = await chat({
        history: history.slice(0, -1),  // bisheriger Verlauf, ohne die neue Frage
        systemContext,
        userMessage: text,
      });
      history.push({ role: 'assistant', text: answer });
      saveHistory(history);
    } catch (err) {
      history.push({ role: 'assistant', text: `❌ Fehler: ${err.message}` });
    } finally {
      isThinking = false;
      renderMessages();
    }
  }

  fab.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('open');
    fab.innerHTML = isOpen ? '×' : '<span class="pulse"></span>✨';
    if (isOpen) {
      renderMessages();
      renderSuggestions();
      setTimeout(() => inputEl.focus(), 100);
    }
  });

  panel.querySelector('[data-action="close"]').addEventListener('click', () => {
    panel.classList.remove('open');
    fab.innerHTML = '<span class="pulse"></span>✨';
  });

  panel.querySelector('[data-action="clear"]').addEventListener('click', () => {
    history = [];
    saveHistory(history);
    renderMessages();
    renderSuggestions();
  });

  suggestionsEl.addEventListener('click', (e) => {
    const s = e.target?.dataset?.suggest;
    if (s) send(s);
  });

  sendBtn.addEventListener('click', () => send());

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // Auto-resize Textarea
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(120, inputEl.scrollHeight) + 'px';
  });
}
