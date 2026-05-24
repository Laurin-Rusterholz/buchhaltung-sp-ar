import { api } from '../api.js';
import { state } from '../main.js';
import { escapeHtml, formatDate, currentYear } from '../utils.js';
import { modal, toast, confirmDialog } from '../components.js';
import { analyzeBeleg, hasApiKey } from '../ai.js';

const MONATE = [
  '01-Januar', '02-Februar', '03-Maerz', '04-April', '05-Mai', '06-Juni',
  '07-Juli', '08-August', '09-September', '10-Oktober', '11-November', '12-Dezember',
];

export default {
  async render(container) {
    let belege = await api.listBelege();

    container.innerHTML = `
      <div class="page-header">
        <h2>Belege</h2>
        <div class="actions">
          <button id="zip-export">📦 ZIP nach Monat</button>
          <button class="primary" id="upload">+ Beleg hochladen</button>
        </div>
      </div>
      <div class="card">
        <div class="toolbar">
          <input type="search" id="filter" placeholder="Suchen…" />
          <select id="filter-year">
            <option value="">Alle Jahre</option>
          </select>
          <div class="spacer"></div>
          <div class="muted small" id="count"></div>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr><th>Datum</th><th>Bezeichnung</th><th>Datei</th><th class="num">Grösse</th><th>Tags</th><th></th></tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `;

    const tbody = container.querySelector('tbody');
    const filter = container.querySelector('#filter');
    const filterYear = container.querySelector('#filter-year');
    const countEl = container.querySelector('#count');

    const updateYearFilter = () => {
      const years = Array.from(new Set(belege.map((b) => (b.datum || '').slice(0, 4)).filter(Boolean))).sort();
      filterYear.innerHTML = '<option value="">Alle Jahre</option>' +
        years.map((y) => `<option value="${y}">${y}</option>`).join('');
    };
    updateYearFilter();

    const renderRows = () => {
      const q = filter.value.toLowerCase();
      const y = filterYear.value;
      const rows = belege
        .filter((b) => {
          if (y && !(b.datum || '').startsWith(y)) return false;
          if (q && !`${b.bezeichnung} ${b.dateiname} ${b.tags || ''}`.toLowerCase().includes(q)) return false;
          return true;
        })
        .sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));

      countEl.textContent = `${rows.length} von ${belege.length}`;
      tbody.innerHTML = rows.length === 0
        ? '<tr><td colspan="6" class="muted center">Noch keine Belege hochgeladen.</td></tr>'
        : rows.map((b) => `
          <tr>
            <td>${formatDate(b.datum)}</td>
            <td>
              <strong>${escapeHtml(b.bezeichnung || '')}</strong>
              ${b.ai_analyse ? '<span class="badge success" style="margin-left:6px">AI</span>' : ''}
            </td>
            <td><a href="${escapeHtml(b.url)}" target="_blank" rel="noopener">${escapeHtml(b.dateiname)}</a></td>
            <td class="num muted small">${formatSize(b.groesse)}</td>
            <td class="muted small">${escapeHtml(b.tags || '')}</td>
            <td class="right">
              ${b.ai_analyse ? `<button class="sm primary" data-buchung="${escapeHtml(b.id)}">→ Buchung</button>` : ''}
              <button class="sm danger" data-delete="${escapeHtml(b.id)}">Löschen</button>
            </td>
          </tr>
        `).join('');
    };

    filter.oninput = renderRows;
    filterYear.onchange = renderRows;
    renderRows();

    container.querySelector('#upload').onclick = () => openUpload();
    container.querySelector('#zip-export').onclick = () => openZipExport();

    tbody.addEventListener('click', async (e) => {
      const deleteId = e.target?.dataset?.delete;
      const buchungId = e.target?.dataset?.buchung;
      if (deleteId) {
        if (!(await confirmDialog('Beleg wirklich löschen?'))) return;
        try {
          await api.deleteBeleg(deleteId);
          belege = await api.listBelege();
          updateYearFilter();
          renderRows();
          toast('Gelöscht', 'success');
        } catch (err) { toast(err.message, 'error'); }
      }
      if (buchungId) {
        const beleg = belege.find((b) => b.id === buchungId);
        createBuchungFromBeleg(beleg);
      }
    });

    function createBuchungFromBeleg(beleg) {
      if (!beleg?.ai_analyse) return;
      const ai = beleg.ai_analyse;
      const bankFallback = state.einstellungen?.konto_bank || '';
      state.pendingBuchung = {
        datum: ai.datum || beleg.datum,
        beleg_nr: '',
        beschreibung: ai.beschreibung || beleg.bezeichnung || '',
        // Beide Konten aus AI-Analyse, sonst Fallback
        soll: ai.konto_soll || ai.konto_vorschlag || (ai.ist_einnahme ? bankFallback : ''),
        haben: ai.konto_haben || (ai.ist_einnahme ? '' : bankFallback),
        betrag: ai.betrag || '',
        beleg_id: beleg.id,
      };
      location.hash = 'buchungen';
    }

    function openZipExport() {
      const m = modal({
        title: '📦 Belege als ZIP exportieren',
        body: `
          <p class="muted small">Lädt alle Belege herunter und packt sie in eine ZIP-Datei.
          Struktur: <code>&lt;Jahr&gt;/&lt;MM-Monat&gt;/&lt;Datei&gt;</code></p>
          <div class="form-grid">
            <div class="input-group">
              <label>Jahr</label>
              <select id="zip-year">
                <option value="">Alle Jahre</option>
                ${Array.from(new Set(belege.map((b) => (b.datum || '').slice(0, 4)).filter(Boolean))).sort().map((y) => `<option value="${y}" ${y === String(currentYear()) ? 'selected' : ''}>${y}</option>`).join('')}
              </select>
            </div>
          </div>
          <div id="zip-progress" class="hidden mt-4">
            <div class="muted small" id="zip-status">Lädt…</div>
            <progress id="zip-bar" value="0" max="1" style="width:100%;margin-top:6px"></progress>
          </div>
          <div id="zip-error" class="hidden mt-4"></div>
        `,
        footer: `<button data-cancel>Abbrechen</button><button class="primary" id="zip-start">Export starten</button>`,
      });

      const yearSel = m.bodyEl.querySelector('#zip-year');
      const progress = m.bodyEl.querySelector('#zip-progress');
      const status = m.bodyEl.querySelector('#zip-status');
      const bar = m.bodyEl.querySelector('#zip-bar');
      const errorEl = m.bodyEl.querySelector('#zip-error');
      const startBtn = m.footerEl.querySelector('#zip-start');

      m.footerEl.querySelector('[data-cancel]').onclick = m.close;
      startBtn.onclick = async () => {
        if (typeof JSZip === 'undefined') {
          errorEl.innerHTML = '<div class="empty">JSZip nicht geladen.</div>';
          errorEl.classList.remove('hidden');
          return;
        }
        const year = yearSel.value;
        const filtered = belege.filter((b) => !year || (b.datum || '').startsWith(year));
        if (filtered.length === 0) {
          errorEl.innerHTML = '<div class="empty">Keine Belege in diesem Zeitraum.</div>';
          errorEl.classList.remove('hidden');
          return;
        }

        startBtn.disabled = true;
        progress.classList.remove('hidden');
        errorEl.classList.add('hidden');

        const zip = new JSZip();
        let done = 0;
        const failed = [];

        for (const b of filtered) {
          status.textContent = `Lade ${b.dateiname}… (${done + 1} / ${filtered.length})`;
          try {
            const res = await fetch(b.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const yyyy = (b.datum || 'unbekannt').slice(0, 4) || 'unbekannt';
            const mm = Number((b.datum || '').slice(5, 7));
            const monat = mm >= 1 && mm <= 12 ? MONATE[mm - 1] : 'unbekannt';
            const folder = `${yyyy}/${monat}`;
            // Eindeutiger Name: <datum>_<bezeichnung>.<ext>
            const ext = b.dateiname.match(/\.[^.]+$/)?.[0] || '';
            const base = `${b.datum || ''}_${b.bezeichnung || b.dateiname.replace(ext, '')}`.replace(/[^\w.\- ]/g, '_').slice(0, 80);
            zip.file(`${folder}/${base}${ext}`, blob);
            done++;
            bar.value = done / filtered.length;
          } catch (err) {
            console.error('Fehler beim Laden', b, err);
            failed.push({ name: b.dateiname, error: err.message });
          }
        }

        if (failed.length === filtered.length) {
          errorEl.innerHTML = `
            <div class="empty" style="text-align:left">
              <strong>Konnte keine Datei laden.</strong><br>
              Vermutlich ist CORS auf dem Storage-Bucket nicht konfiguriert.
              In Cloud Shell mit dem Projekt <code>jupidu-36804</code>:
              <pre style="background:#0f172a;color:#e2e8f0;padding:10px;margin-top:8px;font-size:11px;border-radius:4px;overflow:auto"><code>echo '[{"origin":["https://${location.host}"],"method":["GET","HEAD"],"maxAgeSeconds":3600}]' > cors.json
gsutil cors set cors.json gs://jupidu-36804.firebasestorage.app</code></pre>
            </div>
          `;
          errorEl.classList.remove('hidden');
          startBtn.disabled = false;
          progress.classList.add('hidden');
          return;
        }

        status.textContent = 'Erstelle ZIP-Archiv…';
        const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
          bar.value = metadata.percent / 100;
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(zipBlob);
        a.download = `belege-${year || 'alle'}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);

        if (failed.length > 0) {
          toast(`Fertig – ${failed.length} Datei(en) konnten nicht geladen werden`, 'error');
        } else {
          toast('ZIP heruntergeladen', 'success');
        }
        m.close();
      };
    }

    function openUpload() {
      const today = new Date().toISOString().slice(0, 10);
      const m = modal({
        title: 'Beleg hochladen',
        body: `
          <div class="form-grid">
            <div class="input-group full">
              <label>Datei (PDF, JPG, PNG, …)</label>
              <input name="file" type="file" />
              ${hasApiKey() ? '<div class="ai-hint"><button type="button" class="ai sm" id="ai-analyze" disabled>✨ Automatisch analysieren</button><span id="ai-status" class="muted small">Datei wählen, dann analysieren</span></div>' : '<div class="ai-hint muted small">Auto-Analyse: Gemini Key in Einstellungen hinterlegen</div>'}
            </div>
            <div class="input-group full">
              <label>Bezeichnung</label>
              <input name="bezeichnung" placeholder="z.B. Restaurant Krone Quittung" />
            </div>
            <div class="input-group"><label>Datum</label><input name="datum" type="date" value="${today}" /></div>
            <div class="input-group"><label>Tags (kommagetrennt)</label><input name="tags" placeholder="z.B. spesen, vorstand" /></div>
            <div class="input-group full">
              <div id="ai-result" class="ai-result hidden"></div>
              <div id="upload-progress" class="muted small hidden">
                Lädt hoch… <span id="upload-pct">0%</span>
              </div>
            </div>
          </div>
        `,
        footer: `
          <button data-cancel>Abbrechen</button>
          <button class="primary" data-save>Hochladen</button>
        `,
      });

      const fileInput = m.bodyEl.querySelector('[name="file"]');
      const progressEl = m.bodyEl.querySelector('#upload-progress');
      const pctEl = m.bodyEl.querySelector('#upload-pct');
      const saveBtn = m.footerEl.querySelector('[data-save]');
      const aiBtn = m.bodyEl.querySelector('#ai-analyze');
      const aiStatus = m.bodyEl.querySelector('#ai-status');
      const aiResult = m.bodyEl.querySelector('#ai-result');

      let aiAnalyse = null;

      fileInput.onchange = () => {
        if (aiBtn) {
          aiBtn.disabled = !fileInput.files?.[0];
          aiStatus.textContent = fileInput.files?.[0] ? '' : 'Datei wählen, dann analysieren';
        }
      };

      if (aiBtn) {
        aiBtn.onclick = async () => {
          const file = fileInput.files?.[0];
          if (!file) return;
          aiBtn.disabled = true;
          aiStatus.textContent = 'Gemini analysiert…';
          aiResult.classList.add('hidden');
          try {
            const konten = await api.listKonten();
            const result = await analyzeBeleg(file, konten);
            aiAnalyse = result;
            if (result.bezeichnung) m.bodyEl.querySelector('[name="bezeichnung"]').value = result.bezeichnung;
            if (result.datum) m.bodyEl.querySelector('[name="datum"]').value = result.datum;
            if (result.tags) m.bodyEl.querySelector('[name="tags"]').value = result.tags;
            aiResult.classList.remove('hidden');
            const sollKonto = konten.find((k) => k.nummer === result.konto_soll);
            const habenKonto = konten.find((k) => k.nummer === result.konto_haben);
            aiResult.innerHTML = `
              <strong>Erkannt (${result.ist_einnahme ? 'Einnahme' : 'Ausgabe'}):</strong><br>
              ${result.vendor ? `Anbieter: <strong>${escapeHtml(result.vendor)}</strong><br>` : ''}
              ${result.betrag ? `Betrag: <strong>CHF ${escapeHtml(result.betrag)}</strong><br>` : ''}
              ${sollKonto ? `Soll: <strong>${escapeHtml(sollKonto.nummer)} ${escapeHtml(sollKonto.bezeichnung)}</strong><br>` : (result.konto_soll ? `Soll: ${escapeHtml(result.konto_soll)}<br>` : '')}
              ${habenKonto ? `Haben: <strong>${escapeHtml(habenKonto.nummer)} ${escapeHtml(habenKonto.bezeichnung)}</strong><br>` : (result.konto_haben ? `Haben: ${escapeHtml(result.konto_haben)}<br>` : '')}
              <span class="muted small">Nach dem Upload kannst du direkt eine Buchung daraus erstellen.</span>
            `;
            aiStatus.textContent = '✓ analysiert';
          } catch (err) {
            aiStatus.textContent = `Fehler: ${err.message}`;
            toast(err.message, 'error');
          }
          aiBtn.disabled = false;
        };
      }

      m.footerEl.querySelector('[data-cancel]').onclick = m.close;
      saveBtn.onclick = async () => {
        const file = fileInput.files?.[0];
        if (!file) { toast('Bitte Datei wählen', 'error'); return; }
        if (file.size > 50 * 1024 * 1024) { toast('Datei zu gross (max. 50 MB)', 'error'); return; }

        const meta = {
          bezeichnung: m.bodyEl.querySelector('[name="bezeichnung"]').value.trim(),
          datum: m.bodyEl.querySelector('[name="datum"]').value,
          tags: m.bodyEl.querySelector('[name="tags"]').value.trim(),
          ai_analyse: aiAnalyse,
        };

        saveBtn.disabled = true;
        progressEl.classList.remove('hidden');
        try {
          const beleg = await api.uploadBeleg(file, meta, (p) => {
            pctEl.textContent = `${Math.round(p * 100)}%`;
          });
          belege = await api.listBelege();
          updateYearFilter();
          renderRows();
          m.close();

          if (aiAnalyse) {
            // Direkt Buchung erstellen?
            const create = await confirmDialog(
              'Beleg gespeichert. Jetzt Buchung dazu erstellen (mit AI-Vorschlag vorausgefüllt)?',
              { confirmLabel: 'Buchung erstellen', danger: false },
            );
            if (create) {
              createBuchungFromBeleg(beleg);
              return;
            }
          }
          toast('Beleg gespeichert', 'success');
        } catch (err) {
          toast(err.message, 'error');
          saveBtn.disabled = false;
          progressEl.classList.add('hidden');
        }
      };
    }
  },
};

function formatSize(b) {
  if (!b) return '';
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  if (b > 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
}
