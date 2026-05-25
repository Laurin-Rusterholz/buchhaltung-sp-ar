// Vorlagen-Verwaltung: Mail- und Brief-Templates mit Platzhalter-Substitution

import { api } from '../api.js';
import { state } from '../main.js';
import { escapeHtml, currentYear } from '../utils.js';
import { modal, toast, confirmDialog } from '../components.js';
import { generateVorlage, hasApiKey } from '../ai.js';

const VERFUEGBARE_PLATZHALTER = [
  // Sektion
  { var: 'sektion_name', desc: 'Sektionsname' },
  { var: 'kontakt_name', desc: 'Kontaktperson Sektion' },
  { var: 'kontakt_email', desc: 'Kontakt-Email Sektion' },
  { var: 'sektion_adresse', desc: 'Sektion-Adresse' },
  { var: 'sektion_plz', desc: 'PLZ' },
  { var: 'sektion_ort', desc: 'Ort' },
  { var: 'anzahl_mitglieder', desc: 'Anzahl Mitglieder' },
  { var: 'beitrag_pro_mitglied', desc: 'Beitrag pro Mitglied CHF' },
  { var: 'total_beitrag', desc: 'Total Beitrag CHF' },
  // Verein
  { var: 'verein_name', desc: 'Vereinsname' },
  { var: 'verein_adresse', desc: 'Vereinsadresse' },
  { var: 'verein_email', desc: 'Vereins-Email' },
  { var: 'verein_iban', desc: 'IBAN' },
  { var: 'verein_bank', desc: 'Bank' },
  // Zeit
  { var: 'jahr', desc: 'Aktuelles Jahr' },
  { var: 'datum', desc: 'Heutiges Datum' },
];

export default {
  async render(container) {
    let vorlagen = await api.listVorlagen();
    const sektionen = await api.listSektionen();

    container.innerHTML = `
      <div class="page-header">
        <h2>Vorlagen / Mails</h2>
        <div class="actions">
          <button class="ai" id="ai-vorlage" ${hasApiKey() ? '' : 'disabled title="Claude Key in Einstellungen hinterlegen"'}>✨ AI-Vorlage erstellen</button>
          <button class="primary" id="add">+ Neue Vorlage</button>
        </div>
      </div>

      <div class="card">
        <p class="muted small">
          Vorlagen unterstützen Platzhalter wie <code>{{sektion_name}}</code>,
          <code>{{anzahl_mitglieder}}</code>, <code>{{total_beitrag}}</code>.
          Beim Generieren wird eine Sektion gewählt – die Platzhalter werden
          ersetzt und das Ergebnis kann per Mailclient versendet, kopiert
          oder gedruckt werden.
        </p>
        <details class="mt-2">
          <summary class="muted small">Verfügbare Platzhalter anzeigen</summary>
          <div class="form-grid mt-2" style="grid-template-columns: repeat(3, 1fr);">
            ${VERFUEGBARE_PLATZHALTER.map((p) => `
              <div class="small"><code>{{${p.var}}}</code> – <span class="muted">${escapeHtml(p.desc)}</span></div>
            `).join('')}
          </div>
        </details>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Name</th><th>Typ</th><th>Betreff</th><th></th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `;

    const tbody = container.querySelector('tbody');
    const renderRows = () => {
      tbody.innerHTML = vorlagen.length === 0
        ? '<tr><td colspan="4" class="muted center">Noch keine Vorlagen.</td></tr>'
        : vorlagen.map((v) => `
          <tr>
            <td><strong>${escapeHtml(v.name)}</strong></td>
            <td><span class="badge muted">${escapeHtml(v.typ)}</span></td>
            <td class="muted small">${escapeHtml(v.betreff || '')}</td>
            <td class="right">
              <button class="sm primary" data-use="${escapeHtml(v.id)}">→ Generieren</button>
              <button class="sm" data-edit="${escapeHtml(v.id)}">Bearbeiten</button>
              <button class="sm danger" data-delete="${escapeHtml(v.id)}">Löschen</button>
            </td>
          </tr>
        `).join('');
    };
    renderRows();

    container.querySelector('#add').onclick = () => openForm();
    container.querySelector('#ai-vorlage').onclick = () => openAiVorlage();

    tbody.addEventListener('click', async (e) => {
      const editId = e.target?.dataset?.edit;
      const deleteId = e.target?.dataset?.delete;
      const useId = e.target?.dataset?.use;
      if (editId) openForm(vorlagen.find((v) => v.id === editId));
      if (useId) openGenerator(vorlagen.find((v) => v.id === useId));
      if (deleteId) {
        if (!(await confirmDialog('Vorlage wirklich löschen?'))) return;
        try {
          await api.deleteVorlage(deleteId);
          vorlagen = await api.listVorlagen();
          renderRows();
          toast('Gelöscht', 'success');
        } catch (err) { toast(err.message, 'error'); }
      }
    });

    function openForm(vorlage) {
      const isNew = !vorlage;
      const v = vorlage || { name: '', typ: 'mail', betreff: '', inhalt: '' };
      const m = modal({
        title: isNew ? 'Neue Vorlage' : `Vorlage "${v.name}" bearbeiten`,
        body: `
          <div class="form-grid">
            <div class="input-group"><label>Name</label><input name="name" value="${escapeHtml(v.name)}" placeholder="z.B. Sektionsbeitrag-Rechnung" /></div>
            <div class="input-group"><label>Typ</label>
              <select name="typ">
                <option value="mail" ${v.typ === 'mail' ? 'selected' : ''}>Mail</option>
                <option value="brief" ${v.typ === 'brief' ? 'selected' : ''}>Brief / Dokument</option>
              </select>
            </div>
            <div class="input-group full"><label>Betreff</label><input name="betreff" value="${escapeHtml(v.betreff)}" placeholder="z.B. Sektionsbeitrag {{jahr}}" /></div>
            <div class="input-group full">
              <label>Inhalt</label>
              <textarea name="inhalt" rows="14" style="font-family: 'SF Mono', Menlo, monospace; font-size: 13px;">${escapeHtml(v.inhalt)}</textarea>
            </div>
          </div>
        `,
        footer: `<button data-cancel>Abbrechen</button><button class="primary" data-save>Speichern</button>`,
      });
      m.footerEl.querySelector('[data-cancel]').onclick = m.close;
      m.footerEl.querySelector('[data-save]').onclick = async () => {
        const data = {};
        m.bodyEl.querySelectorAll('[name]').forEach((el) => (data[el.name] = el.value));
        data.name = data.name.trim();
        if (!data.name) { toast('Name ist Pflicht', 'error'); return; }
        try {
          if (isNew) await api.saveVorlage(data);
          else await api.updateVorlage(vorlage.id, data);
          m.close();
          vorlagen = await api.listVorlagen();
          renderRows();
          toast('Gespeichert', 'success');
        } catch (err) { toast(err.message, 'error'); }
      };
    }

    function openAiVorlage() {
      if (!hasApiKey()) {
        toast('Claude API Key fehlt – in Einstellungen hinterlegen', 'error');
        return;
      }
      const m = modal({
        title: '✨ AI-Vorlage erstellen',
        body: `
          <p class="muted small">Beschreibe was die Vorlage erreichen soll. Die AI nutzt Sektions-Platzhalter.</p>
          <div class="input-group full">
            <label>Anforderung</label>
            <textarea id="ai-input" rows="4" placeholder="z.B. Erinnerungsmail an Sektionen, deren Sektionsbeitrag noch offen ist. Freundlicher Ton, mit Zahlungshinweis."></textarea>
          </div>
          <div id="ai-output" class="hidden"></div>
        `,
        footer: `
          <button data-cancel>Abbrechen</button>
          <button class="ai" id="ai-generate">✨ Generieren</button>
          <button class="primary hidden" id="ai-save">Vorlage speichern</button>
        `,
      });
      const input = m.bodyEl.querySelector('#ai-input');
      const output = m.bodyEl.querySelector('#ai-output');
      const genBtn = m.footerEl.querySelector('#ai-generate');
      const saveBtn = m.footerEl.querySelector('#ai-save');
      let suggestion = null;

      m.footerEl.querySelector('[data-cancel]').onclick = m.close;

      genBtn.onclick = async () => {
        const desc = input.value.trim();
        if (!desc) { toast('Bitte Anforderung eingeben', 'error'); return; }
        genBtn.disabled = true;
        output.classList.remove('hidden');
        output.innerHTML = '<div class="loader">Claude denkt nach…</div>';
        try {
          suggestion = await generateVorlage(desc, { verein_name: state.einstellungen?.name });
          output.innerHTML = `
            <h4>Vorschlag</h4>
            <div class="input-group full"><label>Name</label><input id="ai-name" value="${escapeHtml(suggestion.name || '')}" /></div>
            <div class="input-group full"><label>Betreff</label><input id="ai-betreff" value="${escapeHtml(suggestion.betreff || '')}" /></div>
            <div class="input-group full"><label>Inhalt</label><textarea id="ai-inhalt" rows="10">${escapeHtml(suggestion.inhalt || '')}</textarea></div>
          `;
          saveBtn.classList.remove('hidden');
        } catch (err) {
          output.innerHTML = `<div class="empty">Fehler: ${escapeHtml(err.message)}</div>`;
        }
        genBtn.disabled = false;
      };

      saveBtn.onclick = async () => {
        try {
          await api.saveVorlage({
            name: m.bodyEl.querySelector('#ai-name').value.trim(),
            typ: 'mail',
            betreff: m.bodyEl.querySelector('#ai-betreff').value,
            inhalt: m.bodyEl.querySelector('#ai-inhalt').value,
          });
          m.close();
          vorlagen = await api.listVorlagen();
          renderRows();
          toast('Vorlage gespeichert', 'success');
        } catch (err) { toast(err.message, 'error'); }
      };
    }

    function openGenerator(vorlage) {
      const m = modal({
        title: `${vorlage.name} – Generieren`,
        body: `
          <div class="form-grid">
            <div class="input-group full">
              <label>Sektion wählen</label>
              <select id="empf">
                <option value="">— Sektion auswählen —</option>
                ${sektionen
                  .filter((s) => (s.status || 'aktiv') === 'aktiv')
                  .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                  .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${s.anzahl_mitglieder || 0} Mitglieder)</option>`)
                  .join('')}
                ${sektionen.length === 0 ? '<option disabled>Keine Sektionen vorhanden</option>' : ''}
              </select>
            </div>
          </div>

          <div class="card mt-4" id="preview-card" style="background:#fafafa">
            <div class="input-group full"><label>Betreff (Vorschau)</label><input id="prev-betreff" readonly /></div>
            <div class="input-group full"><label>Inhalt (Vorschau)</label><textarea id="prev-inhalt" rows="12" readonly></textarea></div>
          </div>
        `,
        footer: `
          <button data-cancel>Schliessen</button>
          <button id="copy-text">📋 Text kopieren</button>
          <button id="open-mail" class="primary">📧 Im Mailclient öffnen</button>
          <button id="print-doc">🖨 Drucken</button>
        `,
      });

      const empfSel = m.bodyEl.querySelector('#empf');
      const prevBetreff = m.bodyEl.querySelector('#prev-betreff');
      const prevInhalt = m.bodyEl.querySelector('#prev-inhalt');

      const update = () => {
        const sek = sektionen.find((x) => x.id === empfSel.value);
        const ctx = buildContext(sek, state.einstellungen);
        prevBetreff.value = substitute(vorlage.betreff || '', ctx);
        prevInhalt.value = substitute(vorlage.inhalt || '', ctx);
      };

      empfSel.onchange = update;
      update();

      m.footerEl.querySelector('[data-cancel]').onclick = m.close;

      m.footerEl.querySelector('#copy-text').onclick = () => {
        const text = `Betreff: ${prevBetreff.value}\n\n${prevInhalt.value}`;
        navigator.clipboard.writeText(text).then(
          () => toast('In Zwischenablage', 'success'),
          () => toast('Kopieren fehlgeschlagen', 'error'),
        );
      };

      m.footerEl.querySelector('#open-mail').onclick = () => {
        const sek = sektionen.find((x) => x.id === empfSel.value);
        const to = sek?.kontakt_email || '';
        const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(prevBetreff.value)}&body=${encodeURIComponent(prevInhalt.value)}`;
        window.location.href = url;
      };

      m.footerEl.querySelector('#print-doc').onclick = () => {
        const w = window.open('', '_blank');
        if (!w) { toast('Popup blockiert', 'error'); return; }
        w.document.write(`
          <!DOCTYPE html>
          <html><head><title>${escapeHtml(prevBetreff.value || vorlage.name)}</title>
          <style>
            body { font-family: Georgia, serif; max-width: 600px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #222; }
            h1 { font-size: 18px; border-bottom: 1px solid #ccc; padding-bottom: 8px; }
            pre { white-space: pre-wrap; font-family: inherit; font-size: 14px; }
          </style></head>
          <body>
            <h1>${escapeHtml(prevBetreff.value || '')}</h1>
            <pre>${escapeHtml(prevInhalt.value)}</pre>
            <script>window.onload=()=>window.print()</script>
          </body></html>
        `);
        w.document.close();
      };
    }
  },
};

function buildContext(sek, einst) {
  const e = einst || {};
  const s = sek || {};
  const total = Number(s.anzahl_mitglieder || 0) * Number(s.beitrag_pro_mitglied || 0);
  const heute = new Date();
  return {
    sektion_name: s.name || '',
    kontakt_name: s.kontakt_name || '',
    kontakt_email: s.kontakt_email || '',
    sektion_adresse: s.adresse || '',
    sektion_plz: s.plz || '',
    sektion_ort: s.ort || '',
    anzahl_mitglieder: String(s.anzahl_mitglieder || 0),
    beitrag_pro_mitglied: s.beitrag_pro_mitglied != null ? String(s.beitrag_pro_mitglied) : '',
    total_beitrag: total.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    verein_name: e.name || '',
    verein_adresse: `${e.adresse || ''} ${e.plz || ''} ${e.ort || ''}`.trim(),
    verein_email: e.email || '',
    verein_iban: e.iban || '',
    verein_bank: e.bank || '',
    jahr: String(currentYear()),
    datum: heute.toLocaleDateString('de-CH'),
  };
}

function substitute(template, ctx) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return ctx[key] != null ? ctx[key] : match;
  });
}
