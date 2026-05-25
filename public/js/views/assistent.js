// Vollwertige Chat-Assistent-View: Sessions in Firestore, mehrere
// Konversationen parallel, voll bildschirmgrosser Chat mit Buchhaltungs-
// Kontext. Ergänzt das schwebende Chat-Widget (chat.js Root) um eine
// persistente Multi-Session-Variante.

import { api } from '../api.js';
import { state } from '../main.js';
import { escapeHtml, formatDate, uid } from '../utils.js';
import { toast, confirmDialog } from '../components.js';
import { chat, hasApiKey } from '../ai.js';
import { renderMarkdown, buildSystemContext } from '../chatContext.js';

const STARTER_PROMPTS = [
  'Wieviel ist im aktuellen Jahr noch offen an Rechnungen?',
  'Welche Sektionen haben am meisten Mitglieder?',
  'Vergleiche das Budget mit den Ist-Werten – wo sind die grössten Abweichungen?',
  'Welche Aufwand-Konten waren bisher am höchsten?',
  'Wie ist der Stand der Bank-/Kassenkonten?',
  'Erkläre mir die letzten 5 Buchungen kurz.',
];

export default {
  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h2>💬 Buchhaltungs-Assistent</h2>
        <div class="actions">
          <button id="ck-new" class="primary">+ Neuer Chat</button>
        </div>
      </div>
      ${!hasApiKey() ? '<div class="empty">Kein Claude API-Key in den Einstellungen hinterlegt – bitte zuerst in den <a href="#einstellungen">Einstellungen</a> ergänzen.</div>' : ''}
      <div class="chat-layout">
        <aside class="chat-sidebar-pane">
          <div class="chat-sidebar-header">
            <input id="ck-search" type="search" placeholder="Chats durchsuchen…" />
          </div>
          <div id="ck-sessions" class="chat-sessions"></div>
        </aside>
        <section class="chat-main">
          <div class="chat-header-row">
            <input id="ck-title" class="chat-title" placeholder="Titel des Chats…" />
            <div class="flex" style="gap:6px">
              <button id="ck-rename" title="Speichern" class="sm">💾</button>
              <button id="ck-delete" title="Löschen" class="sm danger">🗑</button>
            </div>
          </div>
          <div id="ck-messages" class="chat-messages"></div>
          <div id="ck-starters" class="chat-starters"></div>
          <div class="chat-input-row">
            <textarea id="ck-input" placeholder="Frage stellen…" rows="2"></textarea>
            <button id="ck-send" class="primary chat-send" title="Senden">↑</button>
          </div>
        </section>
      </div>
    `;

    const sessionsEl = container.querySelector('#ck-sessions');
    const messagesEl = container.querySelector('#ck-messages');
    const startersEl = container.querySelector('#ck-starters');
    const titleEl = container.querySelector('#ck-title');
    const inputEl = container.querySelector('#ck-input');
    const sendBtn = container.querySelector('#ck-send');
    const searchEl = container.querySelector('#ck-search');

    let sessions = [];
    let active = null;       // aktuelle Session
    let isThinking = false;

    async function loadSessions() {
      sessions = await api.listChatSessions().catch(() => []);
      renderSessionsList();
    }

    function renderSessionsList() {
      const q = (searchEl.value || '').toLowerCase().trim();
      const filtered = q
        ? sessions.filter((s) => (s.title || '').toLowerCase().includes(q) ||
            (s.messages || []).some((m) => (m.text || '').toLowerCase().includes(q)))
        : sessions;
      if (filtered.length === 0) {
        sessionsEl.innerHTML = '<div class="muted small" style="padding:14px;text-align:center">Noch keine Chats.</div>';
        return;
      }
      sessionsEl.innerHTML = filtered.map((s) => {
        const preview = (s.messages?.find((m) => m.role === 'user')?.text || '').slice(0, 60);
        return `
          <div class="chat-session-item${active?.id === s.id ? ' active' : ''}" data-id="${escapeHtml(s.id)}">
            <div class="chat-session-title">${escapeHtml(s.title || 'Ohne Titel')}</div>
            <div class="chat-session-preview muted small">${escapeHtml(preview || '(leer)')}</div>
            <div class="chat-session-meta muted small">${escapeHtml(formatDate(s.updatedAt))}</div>
          </div>
        `;
      }).join('');
      sessionsEl.querySelectorAll('.chat-session-item').forEach((el) => {
        el.addEventListener('click', () => openSession(el.dataset.id));
      });
    }

    function renderActive() {
      if (!active) {
        titleEl.value = '';
        titleEl.disabled = true;
        messagesEl.innerHTML = '<div class="empty">Wähle links einen Chat oder klicke oben rechts auf „+ Neuer Chat".</div>';
        startersEl.innerHTML = '';
        return;
      }
      titleEl.disabled = false;
      titleEl.value = active.title || '';
      if ((active.messages || []).length === 0) {
        messagesEl.innerHTML = `
          <div class="ai-msg assistant" style="max-width:100%">
            Hallo! Ich bin dein Buchhaltungs-Assistent für <strong>${escapeHtml(state.einstellungen?.name || 'den Verein')}</strong> (${state.aktuellesJahr}).<br><br>
            Ich kenne den aktuellen Kontenplan, alle Buchungen, Rechnungen, das Budget und die Sektionen.
            Frag mich z.B. nach offenen Rechnungen, Saldi, Budget-Abweichungen oder lass dir eine Buchung vorschlagen.
          </div>
        `;
        renderStarters();
      } else {
        messagesEl.innerHTML = active.messages.map((m) => `
          <div class="ai-msg ${m.role}">${m.role === 'assistant' ? renderMarkdown(m.text) : escapeHtml(m.text)}</div>
        `).join('');
        startersEl.innerHTML = '';
      }
      if (isThinking) {
        messagesEl.insertAdjacentHTML('beforeend', '<div class="ai-msg thinking">denkt nach…</div>');
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderStarters() {
      startersEl.innerHTML = STARTER_PROMPTS.map((p) => `<button data-s="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('');
      startersEl.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => send(b.dataset.s));
      });
    }

    async function openSession(id) {
      const s = sessions.find((x) => x.id === id) || await api.getChatSession(id);
      if (!s) { toast('Chat nicht gefunden', 'error'); return; }
      active = s;
      renderSessionsList();
      renderActive();
      setTimeout(() => inputEl.focus(), 50);
    }

    async function createSession() {
      const newSession = {
        id: 'cs-' + uid(),
        title: `Chat ${new Date().toLocaleDateString('de-CH')} ${new Date().toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}`,
        messages: [],
        createdAt: new Date().toISOString(),
      };
      try {
        await api.saveChatSession(newSession);
        sessions.unshift(newSession);
        await openSession(newSession.id);
      } catch (err) {
        toast('Konnte Chat nicht erstellen: ' + err.message, 'error');
      }
    }

    async function persistActive() {
      if (!active) return;
      try { await api.saveChatSession(active); } catch (err) { console.warn('Save fehlgeschlagen:', err); }
    }

    async function send(text) {
      const value = (text ?? inputEl.value ?? '').trim();
      if (!value || isThinking) return;
      if (!hasApiKey()) { toast('Bitte zuerst Claude API-Key in Einstellungen hinterlegen.', 'error'); return; }
      // Falls noch keine Session aktiv: eine erstellen
      if (!active) await createSession();
      if (!active) return;
      // Auto-Titel aus erster Frage, falls Default-Titel
      if (active.messages.length === 0) {
        active.title = value.slice(0, 60);
        titleEl.value = active.title;
      }
      active.messages.push({ role: 'user', text: value, ts: new Date().toISOString() });
      inputEl.value = '';
      inputEl.style.height = 'auto';
      isThinking = true;
      renderActive();
      await persistActive();
      try {
        const systemContext = await buildSystemContext();
        const history = active.messages.slice(0, -1).map((m) => ({ role: m.role, text: m.text }));
        const answer = await chat({ history, systemContext, userMessage: value });
        active.messages.push({ role: 'assistant', text: answer, ts: new Date().toISOString() });
        await persistActive();
        // sessions-Liste neu sortieren (updatedAt geändert)
        await loadSessions();
        await openSession(active.id);
      } catch (err) {
        active.messages.push({ role: 'assistant', text: `❌ Fehler: ${err.message}` });
        await persistActive();
      } finally {
        isThinking = false;
        renderActive();
      }
    }

    // ----- Event-Handler -----
    container.querySelector('#ck-new').onclick = createSession;
    sendBtn.onclick = () => send();
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(180, inputEl.scrollHeight) + 'px';
    });
    searchEl.addEventListener('input', renderSessionsList);

    titleEl.addEventListener('change', async () => {
      if (!active) return;
      active.title = titleEl.value.trim() || 'Ohne Titel';
      await persistActive();
      await loadSessions();
    });
    container.querySelector('#ck-rename').onclick = async () => {
      titleEl.dispatchEvent(new Event('change'));
      toast('Titel gespeichert', 'success');
    };
    container.querySelector('#ck-delete').onclick = async () => {
      if (!active) return;
      const ok = await confirmDialog(`Chat "${active.title}" wirklich löschen?`);
      if (!ok) return;
      try {
        await api.deleteChatSession(active.id);
        sessions = sessions.filter((s) => s.id !== active.id);
        active = sessions[0] || null;
        renderSessionsList();
        renderActive();
        toast('Chat gelöscht', 'success');
      } catch (err) { toast(err.message, 'error'); }
    };

    await loadSessions();
    if (sessions.length > 0) await openSession(sessions[0].id);
    else renderActive();
  },
};
