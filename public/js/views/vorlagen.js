// Vorlagen-Verwaltung: Mail- und Brief-Templates mit Platzhalter-Substitution

import { api } from '../api.js';
import { state } from '../main.js';
import { escapeHtml, todayIso, currentYear } from '../utils.js';
import { modal, toast, confirmDialog } from '../components.js';
import { generateVorlage, hasApiKey } from '../ai.js';

const VERFUEGBARE_PLATZHALTER = [
  // Mitglied
  { var: 'vorname', desc: 'Vorname' },
  { var: 'nachname', desc: 'Nachname' },
  { var: 'name', desc: 'Vorname + Nachname' },
  { var: 'anrede', desc: 'Anrede (Frau / Herr)' },
  { var: 'nummer', desc: 'Mitgliedsnummer' },
  { var: 'strasse', desc: 'Strasse' },
  { var: 'plz', desc: 'PLZ' },
  { var: 'ort', desc: 'Ort' },
  { var: 'email', desc: 'E-Mail' },
  { var: 'telefon', desc: 'Telefon' },
  { var: 'beitrag', desc: 'Jahresbeitrag CHF' },
  { var: 'kategorie', desc: 'Mitgliedstyp' },
  { var: 'eintritt', desc: 'Eintrittsdatum' },
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
    const mitglieder = await api.listMitglieder();

    container.innerHTML = `
      <div class="page-header">
        <h2>Vorlagen / Mails</h2>
        <div class="actions">
          <button class="ai" id="ai-vorlage" ${hasApiKey() ? '' : 'disabled title="Gemini Key in Einstellungen hinterlegen"'}>✨ AI-Vorlage erstellen</button>
          <button class="primary" id="add">+ Neue Vorlage</button>
        </div>
      </div>

      <div class="card">
        <p class="muted small">
          Vorlagen unterstützen Platzhalter wie <code>{{vorname}}</code>,
          <code>{{beitrag}}</code> etc. Beim Generieren wird ein Mitglied
          gewählt – die Platzhalter werden ersetzt und das Ergebnis kann
          per Mailclient versendet, in die Zwischenablage kopiert oder
          gedruckt werden.
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
            <div class="input-group"><label>Name</label><input name="name" value="${escapeHtml(v.name)}" placeholder="z.B. Mitgliederbeitrag-Aufforderung" /></div>
            <div class="input-group"><label>Typ</label>
              <select name="typ">
                <option value="mail" ${v.typ === 'mail' ? 'selected' : ''}>Mail</option>
                <option value="brief" ${v.typ === 'brief' ? 'selected' : ''}>Brief / Dokument</option>
              </select>
            </div>
            <div class="input-group full"><label>Betreff</label><input name="betreff" value="${escapeHtml(v.betreff)}" placeholder="z.B. Mitgliederbeitrag {{jahr}}" /></div>
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
        toast('Gemini API Key fehlt – in Einstellungen hinterlegen', 'error');
        return;
      }
      const m = modal({
        title: '✨ AI-Vorlage erstellen',
        body: `
          <p class="muted small">Beschreibe was die Vorlage erreichen soll.</p>
          <div class="input-group full">
            <label>Anforderung</label>
            <textarea id="ai-input" rows="4" placeholder="z.B. Eine Erinnerungsmail an Mitglieder, die ihren Beitrag noch nicht überwiesen haben. Freundlicher Ton, mit Hinweis auf Zahlungsmöglichkeiten."></textarea>
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
        output.innerHTML = '<div class="loader">Gemini denkt nach…</div>';
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
              <label>Empfänger:in wählen</label>
              <select id="empf">
                <option value="">— Mitglied auswählen —</option>
                ${mitglieder
                  .filter((mit) => mit.status === 'aktiv' || !mit.status)
                  .sort((a, b) => (a.nachname || '').localeCompare(b.nachname || ''))
                  .map((mit) => `<option value="${escapeHtml(mit.id)}">${escapeHtml(mit.nachname)}, ${escapeHtml(mit.vorname)}${mit.email ? ' &lt;' + escapeHtml(mit.email) + '&gt;' : ''}</option>`)
                  .join('')}
                ${mitglieder.length === 0 ? '<option disabled>Keine Mitglieder vorhanden</option>' : ''}
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
        const mit = mitglieder.find((x) => x.id === empfSel.value);
        const ctx = buildContext(mit, state.einstellungen);
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
        const mit = mitglieder.find((x) => x.id === empfSel.value);
        const to = mit?.email || '';
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

function buildContext(mit, einst) {
  const e = einst || {};
  const m = mit || {};
  const heute = new Date();
  return {
    vorname: m.vorname || '',
    nachname: m.nachname || '',
    name: `${m.vorname || ''} ${m.nachname || ''}`.trim(),
    anrede: '',
    nummer: m.nummer || '',
    strasse: m.strasse || '',
    plz: m.plz || '',
    ort: m.ort || '',
    email: m.email || '',
    telefon: m.telefon || '',
    beitrag: m.beitrag != null ? String(m.beitrag) : '',
    kategorie: m.kategorie || '',
    eintritt: m.eintritt || '',
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
