import { api } from '../api.js';
import { state } from '../main.js';
import { escapeHtml } from '../utils.js';
import { toast } from '../components.js';
import {
  getApiKey, setApiKey, getModel, setModel,
  getClaudeApiKey, setClaudeApiKey, getClaudeModel, setClaudeModel,
  getProvider, setProvider,
  hasApiKey, testConnection,
} from '../ai.js';

export default {
  async render(container) {
    let e;
    try {
      e = await api.getEinstellungen();
    } catch (err) {
      e = { ...state.einstellungen };
    }

    const firestoreRules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /buchhaltung-sp-ar/{docId} {
      allow read, write: if true;
    }
  }
}`;

    const storageRules = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /buchhaltung-sp-ar/{allPaths=**} {
      allow read, write: if true;
    }
  }
}`;

    container.innerHTML = `
      <div class="page-header">
        <h2>Einstellungen</h2>
      </div>

      <div class="card">
        <h3>Vereinsdaten</h3>
        <div class="form-grid">
          <div class="input-group"><label>Vereinsname</label><input name="name" value="${escapeHtml(e.name || '')}" /></div>
          <div class="input-group"><label>Untertitel</label><input name="untertitel" value="${escapeHtml(e.untertitel || '')}" /></div>
          <div class="input-group full"><label>Adresse</label><input name="adresse" value="${escapeHtml(e.adresse || '')}" /></div>
          <div class="input-group"><label>PLZ</label><input name="plz" value="${escapeHtml(e.plz || '')}" /></div>
          <div class="input-group"><label>Ort</label><input name="ort" value="${escapeHtml(e.ort || '')}" /></div>
          <div class="input-group"><label>Email</label><input name="email" type="email" value="${escapeHtml(e.email || '')}" /></div>
          <div class="input-group"><label>Telefon</label><input name="telefon" value="${escapeHtml(e.telefon || '')}" /></div>
          <div class="input-group"><label>Website</label><input name="website" value="${escapeHtml(e.website || '')}" /></div>
          <div class="input-group"><label>UID / Vereins-Nr</label><input name="uid" value="${escapeHtml(e.uid || '')}" /></div>
        </div>
      </div>

      <div class="card">
        <h3>Bankverbindung</h3>
        <div class="form-grid">
          <div class="input-group"><label>Bank</label><input name="bank" value="${escapeHtml(e.bank || '')}" /></div>
          <div class="input-group"><label>IBAN</label><input name="iban" value="${escapeHtml(e.iban || '')}" placeholder="CH00 0000 0000 0000 0000 0" /></div>
          <div class="input-group"><label>BIC</label><input name="bic" value="${escapeHtml(e.bic || '')}" /></div>
          <div class="input-group"><label>QR-IBAN</label><input name="qr_iban" value="${escapeHtml(e.qr_iban || '')}" /></div>
        </div>
      </div>

      <div class="card">
        <h3>Standardkonten</h3>
        <p class="muted small">Werden bei automatisch generierten Buchungen verwendet (z.B. Eröffnung).</p>
        <div class="form-grid">
          <div class="input-group"><label>Eigenkapital-Konto</label><input name="konto_eigenkapital" value="${escapeHtml(e.konto_eigenkapital || '')}" placeholder="z.B. 2800" /></div>
          <div class="input-group"><label>Jahresergebnis-Konto</label><input name="konto_ergebnis" value="${escapeHtml(e.konto_ergebnis || '')}" placeholder="z.B. 2900" /></div>
          <div class="input-group"><label>Sektionsbeitrags-Konto</label><input name="konto_sektionsbeitrag" value="${escapeHtml(e.konto_sektionsbeitrag || '')}" placeholder="z.B. 3001" /></div>
          <div class="input-group"><label>Bank-Konto (Standard)</label><input name="konto_bank" value="${escapeHtml(e.konto_bank || '')}" placeholder="z.B. 1020" /></div>
          <div class="input-group"><label>Forderungen-Konto</label><input name="konto_forderungen" value="${escapeHtml(e.konto_forderungen || '')}" placeholder="z.B. 1100" /></div>
        </div>
      </div>

      <div class="flex mb-4">
        <button class="primary" id="save-einstellungen">Vereinsdaten speichern</button>
      </div>

      <div class="card">
        <h3>✨ KI-Funktionen</h3>
        <p class="muted small">
          API-Keys werden ausschliesslich lokal im Browser (LocalStorage) gespeichert.
          Du kannst zwischen Google Gemini und Anthropic Claude wechseln – alle
          KI-Funktionen (Buchungs-, Beleg- und Voranschlags-Vorschläge, Chat)
          nutzen den aktiven Provider.
        </p>
        <div class="form-grid">
          <div class="input-group full">
            <label>Aktiver KI-Provider</label>
            <select id="ai-provider">
              <option value="gemini" ${getProvider() === 'gemini' ? 'selected' : ''}>Google Gemini</option>
              <option value="claude" ${getProvider() === 'claude' ? 'selected' : ''}>Anthropic Claude (Sonnet 4.6)</option>
            </select>
          </div>
        </div>
      </div>

      <div class="card" id="gemini-card">
        <h3>🟦 Google Gemini</h3>
        <p class="muted small">
          Key erstellen:
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com/app/apikey</a>
        </p>
        <div class="form-grid">
          <div class="input-group full">
            <label>Gemini API Key</label>
            <input id="gemini-key" type="password" value="${escapeHtml(getApiKey())}" placeholder="AIza..." />
          </div>
          <div class="input-group">
            <label>Modell</label>
            <select id="gemini-model">
              <option value="gemini-1.5-flash" ${getModel() === 'gemini-1.5-flash' ? 'selected' : ''}>gemini-1.5-flash (schnell)</option>
              <option value="gemini-1.5-pro" ${getModel() === 'gemini-1.5-pro' ? 'selected' : ''}>gemini-1.5-pro (genauer)</option>
              <option value="gemini-2.0-flash-exp" ${getModel() === 'gemini-2.0-flash-exp' ? 'selected' : ''}>gemini-2.0-flash-exp</option>
            </select>
          </div>
          <div class="input-group">
            <label>Status</label>
            <div id="gemini-status" class="${getApiKey() ? 'badge success' : 'badge muted'}">
              ${getApiKey() ? 'Key gesetzt' : 'Kein Key'}
            </div>
          </div>
        </div>
        <div class="flex mt-2">
          <button class="primary" id="save-gemini">Gemini speichern</button>
          <button id="test-gemini" ${getApiKey() ? '' : 'disabled'}>Verbindung testen</button>
          <button class="danger" id="remove-gemini" ${getApiKey() ? '' : 'disabled'}>Entfernen</button>
        </div>
      </div>

      <div class="card" id="claude-card">
        <h3>🟪 Anthropic Claude</h3>
        <p class="muted small">
          Key erstellen:
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com/settings/keys</a>
          · Vorgewählt: Sonnet 4.6 (beste Balance aus Geschwindigkeit, Intelligenz und Kosten).
          Snapshots der Buchhaltung werden in der Chat-Funktion via Prompt-Caching
          wiederverwendet (Folgefragen ~90% billiger).
        </p>
        <div class="form-grid">
          <div class="input-group full">
            <label>Claude API Key</label>
            <input id="claude-key" type="password" value="${escapeHtml(getClaudeApiKey())}" placeholder="sk-ant-api03-..." />
          </div>
          <div class="input-group">
            <label>Modell</label>
            <select id="claude-model">
              <option value="claude-sonnet-4-6" ${getClaudeModel() === 'claude-sonnet-4-6' ? 'selected' : ''}>claude-sonnet-4-6 (empfohlen)</option>
              <option value="claude-opus-4-7" ${getClaudeModel() === 'claude-opus-4-7' ? 'selected' : ''}>claude-opus-4-7 (intelligenter, teurer)</option>
              <option value="claude-haiku-4-5" ${getClaudeModel() === 'claude-haiku-4-5' ? 'selected' : ''}>claude-haiku-4-5 (am schnellsten/billigsten)</option>
            </select>
          </div>
          <div class="input-group">
            <label>Status</label>
            <div id="claude-status" class="${getClaudeApiKey() ? 'badge success' : 'badge muted'}">
              ${getClaudeApiKey() ? 'Key gesetzt' : 'Kein Key'}
            </div>
          </div>
        </div>
        <div class="flex mt-2">
          <button class="primary" id="save-claude">Claude speichern</button>
          <button id="test-claude" ${getClaudeApiKey() ? '' : 'disabled'}>Verbindung testen</button>
          <button class="danger" id="remove-claude" ${getClaudeApiKey() ? '' : 'disabled'}>Entfernen</button>
        </div>
      </div>

      <div class="card">
        <h3>🔧 Firebase-Setup</h3>
        <p class="muted small">
          Strukturierte Daten (Konten, Buchungen, Mitglieder, …) liegen in
          <strong>Firestore</strong>, Belegdateien in <strong>Firebase Storage</strong>.
          Setup ist einmalig pro Projekt.
        </p>

        <h4>1. Firestore aktivieren</h4>
        <ol class="muted small" style="padding-left:20px;line-height:1.7">
          <li><a href="https://console.firebase.google.com/project/jupidu-36804/firestore" target="_blank" rel="noopener">Firebase Console → Firestore Database</a> öffnen.</li>
          <li>Falls noch nicht aktiviert: <strong>„Create database"</strong> klicken.</li>
          <li>Modus: <strong>Production mode</strong>, Region: <code>eur3 (europe-west)</code> (oder beliebig).</li>
        </ol>

        <h4>2. Firestore Security Rules</h4>
        <p class="muted small">In der Firestore-Konsole → Tab <strong>„Rules"</strong> einfügen und Publish:</p>
        <pre style="background:#0f172a;color:#e2e8f0;padding:14px;border-radius:6px;overflow:auto;font-size:12px;line-height:1.5;"><code>${escapeHtml(firestoreRules)}</code></pre>
        <button id="copy-firestore-rules" class="sm mt-2">Firestore-Rules kopieren</button>

        <h4 class="mt-4">3. Storage Security Rules (für Belege)</h4>
        <p class="muted small">
          Falls deine bestehenden Storage-Rules schon offen sind
          (<code>match /{allPaths=**} { allow read, write: if true; }</code>),
          ist nichts zu tun. Andernfalls in Storage → Rules ergänzen:
        </p>
        <pre style="background:#0f172a;color:#e2e8f0;padding:14px;border-radius:6px;overflow:auto;font-size:12px;line-height:1.5;"><code>${escapeHtml(storageRules)}</code></pre>

        <p class="muted small mt-4">
          ⚠️ Diese Rules erlauben anonymen Zugriff. Für den Produktivbetrieb mit
          Firebase Authentication absichern.
        </p>
      </div>
    `;

    // Vereinsdaten speichern
    const STAMMDATEN_FELDER = [
      'name', 'untertitel', 'adresse', 'plz', 'ort', 'email', 'telefon', 'website', 'uid',
      'bank', 'iban', 'bic', 'qr_iban',
      'konto_eigenkapital', 'konto_ergebnis', 'konto_sektionsbeitrag', 'konto_bank',
    ];
    container.querySelector('#save-einstellungen').onclick = async () => {
      const data = {};
      for (const f of STAMMDATEN_FELDER) {
        const el = container.querySelector(`[name="${f}"]`);
        if (el) data[f] = el.value.trim();
      }
      try {
        await api.saveEinstellungen(data);
        state.einstellungen = { ...state.einstellungen, ...data };
        if (data.name) {
          document.querySelector('#brand').textContent = data.name;
          document.title = `Buchhaltung – ${data.name}`;
        }
        if (data.untertitel) document.querySelector('#brand-subtitle').textContent = data.untertitel;
        toast('Einstellungen gespeichert', 'success');
      } catch (err) { toast(err.message, 'error'); }
    };

    // Provider-Auswahl
    const providerSel = container.querySelector('#ai-provider');
    providerSel.onchange = () => {
      setProvider(providerSel.value);
      toast(`Aktiver Provider: ${providerSel.value === 'claude' ? 'Anthropic Claude' : 'Google Gemini'}`, 'success');
    };

    // Gemini API Key
    const keyInput = container.querySelector('#gemini-key');
    const modelSel = container.querySelector('#gemini-model');
    const statusEl = container.querySelector('#gemini-status');
    const testBtn = container.querySelector('#test-gemini');
    const removeBtn = container.querySelector('#remove-gemini');

    container.querySelector('#save-gemini').onclick = () => {
      setApiKey(keyInput.value);
      setModel(modelSel.value);
      const has = !!getApiKey();
      statusEl.className = `badge ${has ? 'success' : 'muted'}`;
      statusEl.textContent = has ? 'Key gesetzt' : 'Kein Key';
      testBtn.disabled = !has;
      removeBtn.disabled = !has;
      toast('Gemini-Einstellungen gespeichert', 'success');
    };

    testBtn.onclick = async () => {
      const prev = getProvider();
      setProvider('gemini');
      testBtn.disabled = true;
      try {
        const ok = await testConnection();
        toast(ok ? 'Gemini-Verbindung OK' : 'Verbindung steht, aber unerwartete Antwort', ok ? 'success' : 'error');
      } catch (err) { toast(err.message, 'error'); }
      setProvider(prev);
      testBtn.disabled = false;
    };

    removeBtn.onclick = () => {
      setApiKey('');
      keyInput.value = '';
      statusEl.className = 'badge muted';
      statusEl.textContent = 'Kein Key';
      testBtn.disabled = true;
      removeBtn.disabled = true;
      toast('Gemini Key entfernt', 'success');
    };

    // Claude API Key
    const claudeKeyInput = container.querySelector('#claude-key');
    const claudeModelSel = container.querySelector('#claude-model');
    const claudeStatusEl = container.querySelector('#claude-status');
    const claudeTestBtn = container.querySelector('#test-claude');
    const claudeRemoveBtn = container.querySelector('#remove-claude');

    container.querySelector('#save-claude').onclick = () => {
      setClaudeApiKey(claudeKeyInput.value);
      setClaudeModel(claudeModelSel.value);
      const has = !!getClaudeApiKey();
      claudeStatusEl.className = `badge ${has ? 'success' : 'muted'}`;
      claudeStatusEl.textContent = has ? 'Key gesetzt' : 'Kein Key';
      claudeTestBtn.disabled = !has;
      claudeRemoveBtn.disabled = !has;
      toast('Claude-Einstellungen gespeichert', 'success');
    };

    claudeTestBtn.onclick = async () => {
      // Test temporär auf Claude umschalten, danach Provider zurücksetzen.
      const prev = getProvider();
      setProvider('claude');
      claudeTestBtn.disabled = true;
      try {
        const ok = await testConnection();
        toast(ok ? 'Claude-Verbindung OK' : 'Verbindung steht, aber unerwartete Antwort', ok ? 'success' : 'error');
      } catch (err) { toast(err.message, 'error'); }
      setProvider(prev);
      claudeTestBtn.disabled = false;
    };

    claudeRemoveBtn.onclick = () => {
      setClaudeApiKey('');
      claudeKeyInput.value = '';
      claudeStatusEl.className = 'badge muted';
      claudeStatusEl.textContent = 'Kein Key';
      claudeTestBtn.disabled = true;
      claudeRemoveBtn.disabled = true;
      toast('Claude Key entfernt', 'success');
    };

    container.querySelector('#copy-firestore-rules').onclick = () => {
      navigator.clipboard.writeText(firestoreRules).then(
        () => toast('Firestore-Rules in Zwischenablage', 'success'),
        () => toast('Konnte nicht kopieren', 'error'),
      );
    };
  },
};
