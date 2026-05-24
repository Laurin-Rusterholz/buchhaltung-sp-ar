import { api } from '../api.js';
import { escapeHtml, formatDate } from '../utils.js';
import { modal, toast, confirmDialog } from '../components.js';

export default {
  async render(container) {
    let belege = await api.listBelege();

    container.innerHTML = `
      <div class="page-header">
        <h2>Belege</h2>
        <div class="actions">
          <button class="primary" id="upload">+ Beleg hochladen</button>
        </div>
      </div>
      <div class="card">
        <div class="toolbar">
          <input type="search" id="filter" placeholder="Suchen…" />
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

    const renderRows = () => {
      const q = filter.value.toLowerCase();
      const rows = belege
        .filter((b) => !q || `${b.bezeichnung} ${b.dateiname} ${b.tags || ''}`.toLowerCase().includes(q))
        .sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));

      tbody.innerHTML = rows.length === 0
        ? '<tr><td colspan="6" class="muted center">Noch keine Belege hochgeladen.</td></tr>'
        : rows.map((b) => `
          <tr>
            <td>${formatDate(b.datum)}</td>
            <td><strong>${escapeHtml(b.bezeichnung || '')}</strong></td>
            <td><a href="/api/belege/${escapeHtml(b.id)}/file" target="_blank">${escapeHtml(b.dateiname)}</a></td>
            <td class="num muted small">${formatSize(b.groesse)}</td>
            <td class="muted small">${escapeHtml(b.tags || '')}</td>
            <td class="right">
              <button class="sm danger" data-delete="${escapeHtml(b.id)}">Löschen</button>
            </td>
          </tr>
        `).join('');
    };

    filter.oninput = renderRows;
    renderRows();

    container.querySelector('#upload').onclick = () => openUpload();

    tbody.addEventListener('click', async (e) => {
      const deleteId = e.target?.dataset?.delete;
      if (deleteId) {
        if (!(await confirmDialog('Beleg wirklich löschen?'))) return;
        try {
          await api.deleteBeleg(deleteId);
          belege = await api.listBelege();
          renderRows();
          toast('Gelöscht', 'success');
        } catch (err) { toast(err.message, 'error'); }
      }
    });

    function openUpload() {
      const today = new Date().toISOString().slice(0, 10);
      const m = modal({
        title: 'Beleg hochladen',
        body: `
          <div class="form-grid">
            <div class="input-group full"><label>Datei (PDF, JPG, PNG)</label><input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg" /></div>
            <div class="input-group full"><label>Bezeichnung</label><input name="bezeichnung" placeholder="z.B. Restaurant Krone Quittung" /></div>
            <div class="input-group"><label>Datum</label><input name="datum" type="date" value="${today}" /></div>
            <div class="input-group"><label>Tags (kommagetrennt)</label><input name="tags" placeholder="z.B. spesen, vorstand" /></div>
          </div>
        `,
        footer: `<button data-cancel>Abbrechen</button><button class="primary" data-save>Hochladen</button>`,
      });
      m.footerEl.querySelector('[data-cancel]').onclick = m.close;
      m.footerEl.querySelector('[data-save]').onclick = async () => {
        const fileInput = m.bodyEl.querySelector('[name="file"]');
        if (!fileInput.files?.[0]) { toast('Bitte Datei wählen', 'error'); return; }
        const file = fileInput.files[0];
        if (file.size > 8 * 1024 * 1024) { toast('Datei zu gross (max. 8 MB)', 'error'); return; }
        const data = {};
        m.bodyEl.querySelectorAll('[name]').forEach((el) => { if (el.name !== 'file') data[el.name] = el.value.trim(); });
        try {
          data.dateiname = file.name;
          data.mime = file.type || 'application/octet-stream';
          data.groesse = file.size;
          data.inhalt_base64 = await fileToBase64(file);
          await api.uploadBeleg(data);
          m.close();
          belege = await api.listBelege();
          renderRows();
          toast('Beleg gespeichert', 'success');
        } catch (err) { toast(err.message, 'error'); }
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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
