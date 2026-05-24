import { api } from '../api.js';
import { state } from '../main.js';
import { escapeHtml, formatChf, formatDate, todayIso, downloadFile, toCsv } from '../utils.js';
import { modal, toast, confirmDialog } from '../components.js';

export default {
  async render(container) {
    const jahr = state.aktuellesJahr;
    let [buchungen, konten, belege] = await Promise.all([
      api.listBuchungen(jahr),
      api.listKonten(),
      api.listBelege(),
    ]);
    konten.sort((a, b) => a.nummer.localeCompare(b.nummer));
    const kontoMap = new Map(konten.map((k) => [k.nummer, k]));
    const belegMap = new Map(belege.map((b) => [b.id, b]));

    container.innerHTML = `
      <div class="page-header">
        <h2>Buchungen ${jahr}</h2>
        <div class="actions">
          <button id="export-csv">CSV Export</button>
          <button class="primary" id="add-buchung">+ Neue Buchung</button>
        </div>
      </div>
      <div class="card">
        <div class="toolbar">
          <input type="search" id="filter" placeholder="Suchen…" />
          <select id="filter-konto">
            <option value="">Alle Konten</option>
            ${konten.map((k) => `<option value="${escapeHtml(k.nummer)}">${escapeHtml(k.nummer)} ${escapeHtml(k.bezeichnung)}</option>`).join('')}
          </select>
          <div class="spacer"></div>
          <div class="muted small" id="summe"></div>
        </div>
        <div class="table-wrap">
          <table class="data" id="tab">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Beleg-Nr</th>
                <th>Beschreibung</th>
                <th>Soll</th>
                <th>Haben</th>
                <th class="num">Betrag CHF</th>
                <th>Beleg</th>
                <th></th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `;

    const tbody = container.querySelector('tbody');
    const filter = container.querySelector('#filter');
    const filterKonto = container.querySelector('#filter-konto');
    const summe = container.querySelector('#summe');

    const renderRows = () => {
      const q = filter.value.toLowerCase();
      const kontoNr = filterKonto.value;
      const rows = buchungen
        .filter((b) => {
          if (kontoNr && b.soll !== kontoNr && b.haben !== kontoNr) return false;
          if (q) {
            const text = `${b.datum} ${b.beleg_nr || ''} ${b.beschreibung} ${b.soll} ${b.haben}`.toLowerCase();
            if (!text.includes(q)) return false;
          }
          return true;
        })
        .sort((a, b) => b.datum.localeCompare(a.datum) || (b.beleg_nr || '').localeCompare(a.beleg_nr || ''));

      tbody.innerHTML = rows.length === 0
        ? '<tr><td colspan="8" class="muted center">Keine Buchungen vorhanden.</td></tr>'
        : rows.map((b) => `
          <tr>
            <td>${formatDate(b.datum)}</td>
            <td>${escapeHtml(b.beleg_nr || '')}</td>
            <td>${escapeHtml(b.beschreibung)}</td>
            <td>${escapeHtml(b.soll)} <span class="muted small">${escapeHtml(kontoMap.get(b.soll)?.bezeichnung || '')}</span></td>
            <td>${escapeHtml(b.haben)} <span class="muted small">${escapeHtml(kontoMap.get(b.haben)?.bezeichnung || '')}</span></td>
            <td class="num">${formatChf(b.betrag)}</td>
            <td>${b.beleg_id && belegMap.get(b.beleg_id)?.url ? `<a href="${escapeHtml(belegMap.get(b.beleg_id).url)}" target="_blank" rel="noopener">Öffnen</a>` : ''}</td>
            <td class="right">
              <button class="sm" data-edit="${escapeHtml(b.id)}">Bearbeiten</button>
              <button class="sm danger" data-delete="${escapeHtml(b.id)}">Löschen</button>
            </td>
          </tr>
        `).join('');

      const sumChf = rows.reduce((s, r) => s + Number(r.betrag), 0);
      summe.textContent = `${rows.length} Buchung${rows.length === 1 ? '' : 'en'} · Summe CHF ${formatChf(sumChf)}`;
    };

    filter.oninput = renderRows;
    filterKonto.onchange = renderRows;
    renderRows();

    container.querySelector('#export-csv').onclick = () => {
      const rows = buchungen
        .slice()
        .sort((a, b) => a.datum.localeCompare(b.datum))
        .map((b) => [b.datum, b.beleg_nr || '', b.beschreibung, b.soll, b.haben, b.betrag]);
      downloadFile(`buchungen-${jahr}.csv`, toCsv(['Datum', 'Beleg-Nr', 'Beschreibung', 'Soll', 'Haben', 'Betrag CHF'], rows), 'text/csv');
    };

    container.querySelector('#add-buchung').onclick = () => openForm();

    tbody.addEventListener('click', async (e) => {
      const editId = e.target?.dataset?.edit;
      const deleteId = e.target?.dataset?.delete;
      if (editId) openForm(buchungen.find((b) => b.id === editId));
      if (deleteId) {
        if (!(await confirmDialog('Buchung wirklich löschen?'))) return;
        try {
          await api.deleteBuchung(jahr, deleteId);
          buchungen = await api.listBuchungen(jahr);
          renderRows();
          toast('Gelöscht', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      }
    });

    function openForm(buchung) {
      const isNew = !buchung;
      const b = buchung || {
        datum: todayIso(),
        beleg_nr: '',
        beschreibung: '',
        soll: '',
        haben: '',
        betrag: '',
        beleg_id: '',
      };
      const optionsKonten = konten
        .map((k) => `<option value="${escapeHtml(k.nummer)}">${escapeHtml(k.nummer)} ${escapeHtml(k.bezeichnung)}</option>`)
        .join('');
      const optionsBelege = `<option value="">— kein Beleg —</option>` +
        belege.map((bl) => `<option value="${escapeHtml(bl.id)}">${escapeHtml(bl.bezeichnung || bl.dateiname)}</option>`).join('');

      const m = modal({
        title: isNew ? 'Neue Buchung' : 'Buchung bearbeiten',
        body: `
          <div class="form-grid">
            <div class="input-group">
              <label>Datum</label>
              <input name="datum" type="date" value="${escapeHtml(b.datum)}" />
            </div>
            <div class="input-group">
              <label>Beleg-Nr</label>
              <input name="beleg_nr" value="${escapeHtml(b.beleg_nr || '')}" placeholder="z.B. 2025-001" />
            </div>
            <div class="input-group full">
              <label>Beschreibung</label>
              <input name="beschreibung" value="${escapeHtml(b.beschreibung)}" />
            </div>
            <div class="input-group">
              <label>Soll-Konto</label>
              <select name="soll"><option value="">— wählen —</option>${optionsKonten}</select>
            </div>
            <div class="input-group">
              <label>Haben-Konto</label>
              <select name="haben"><option value="">— wählen —</option>${optionsKonten}</select>
            </div>
            <div class="input-group">
              <label>Betrag CHF</label>
              <input name="betrag" type="number" step="0.05" min="0" value="${escapeHtml(b.betrag)}" />
            </div>
            <div class="input-group">
              <label>Beleg-Verknüpfung</label>
              <select name="beleg_id">${optionsBelege}</select>
            </div>
          </div>
        `,
        footer: `<button data-cancel>Abbrechen</button><button class="primary" data-save>Speichern</button>`,
      });
      // Set selects
      m.bodyEl.querySelector('[name="soll"]').value = b.soll;
      m.bodyEl.querySelector('[name="haben"]').value = b.haben;
      m.bodyEl.querySelector('[name="beleg_id"]').value = b.beleg_id || '';

      m.footerEl.querySelector('[data-cancel]').onclick = m.close;
      m.footerEl.querySelector('[data-save]').onclick = async () => {
        const data = {};
        m.bodyEl.querySelectorAll('[name]').forEach((el) => (data[el.name] = el.value.trim()));
        data.betrag = Number(data.betrag);
        if (!data.datum || !data.beschreibung || !data.soll || !data.haben || !data.betrag) {
          toast('Bitte alle Pflichtfelder ausfüllen', 'error'); return;
        }
        if (data.soll === data.haben) {
          toast('Soll und Haben dürfen nicht identisch sein', 'error'); return;
        }
        try {
          if (isNew) await api.saveBuchung(jahr, data);
          else await api.updateBuchung(jahr, b.id, data);
          m.close();
          buchungen = await api.listBuchungen(jahr);
          renderRows();
          toast('Gespeichert', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    }
  },
};
