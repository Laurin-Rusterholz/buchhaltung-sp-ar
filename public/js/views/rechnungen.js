import { api } from '../api.js';
import { state } from '../main.js';
import { escapeHtml, formatChf, formatDate, todayIso, uid } from '../utils.js';
import { modal, toast, confirmDialog } from '../components.js';

const STATUS_BADGE = {
  offen: 'warning',
  bezahlt: 'success',
  storniert: 'muted',
  gemahnt: 'danger',
};

export default {
  async render(container) {
    const jahr = state.aktuellesJahr;
    let [rechnungen, sektionen] = await Promise.all([
      api.listRechnungen(jahr),
      api.listSektionen(),
    ]);

    const totals = {
      offen: rechnungen.filter((r) => r.status === 'offen').reduce((s, r) => s + Number(r.total || 0), 0),
      bezahlt: rechnungen.filter((r) => r.status === 'bezahlt').reduce((s, r) => s + Number(r.total || 0), 0),
    };

    container.innerHTML = `
      <div class="page-header">
        <h2>Rechnungen ${jahr}</h2>
        <div class="actions">
          <button class="primary" id="add">+ Neue Rechnung</button>
        </div>
      </div>

      <div class="cards-grid">
        <div class="kpi"><div class="kpi-label">Offen</div><div class="kpi-value">CHF ${formatChf(totals.offen)}</div></div>
        <div class="kpi"><div class="kpi-label">Bezahlt</div><div class="kpi-value positive">CHF ${formatChf(totals.bezahlt)}</div></div>
        <div class="kpi"><div class="kpi-label">Anzahl</div><div class="kpi-value">${rechnungen.length}</div></div>
      </div>

      <div class="card">
        <div class="toolbar">
          <input type="search" id="filter" placeholder="Suchen…" />
          <select id="filter-status">
            <option value="">Alle Status</option>
            <option value="offen">Offen</option>
            <option value="bezahlt">Bezahlt</option>
            <option value="gemahnt">Gemahnt</option>
            <option value="storniert">Storniert</option>
          </select>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Nr</th><th>Datum</th><th>Fällig</th><th>Empfänger</th>
                <th>Beschreibung</th><th class="num">Total CHF</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `;

    const tbody = container.querySelector('tbody');
    const filter = container.querySelector('#filter');
    const filterStatus = container.querySelector('#filter-status');

    const renderRows = () => {
      const q = filter.value.toLowerCase();
      const st = filterStatus.value;
      const rows = rechnungen
        .filter((r) => {
          if (st && r.status !== st) return false;
          if (q && !`${r.nummer} ${r.empfaenger_name} ${r.beschreibung}`.toLowerCase().includes(q)) return false;
          return true;
        })
        .sort((a, b) => (b.nummer || '').localeCompare(a.nummer || ''));

      tbody.innerHTML = rows.length === 0
        ? '<tr><td colspan="8" class="muted center">Keine Rechnungen vorhanden.</td></tr>'
        : rows.map((r) => `
          <tr>
            <td><strong>${escapeHtml(r.nummer)}</strong></td>
            <td>${formatDate(r.datum)}</td>
            <td>${formatDate(r.faellig_am)}</td>
            <td>${escapeHtml(r.empfaenger_name || '')}</td>
            <td class="muted small">${escapeHtml(r.beschreibung || '')}</td>
            <td class="num">${formatChf(r.total || 0)}</td>
            <td><span class="badge ${STATUS_BADGE[r.status] || 'muted'}">${escapeHtml(r.status)}</span></td>
            <td class="right">
              <button class="sm" data-view="${escapeHtml(r.id)}">Ansehen</button>
              <button class="sm" data-edit="${escapeHtml(r.id)}">Bearbeiten</button>
              <button class="sm danger" data-delete="${escapeHtml(r.id)}">Löschen</button>
            </td>
          </tr>
        `).join('');
    };

    filter.oninput = renderRows;
    filterStatus.onchange = renderRows;
    renderRows();

    container.querySelector('#add').onclick = () => openForm();

    tbody.addEventListener('click', async (e) => {
      const editId = e.target?.dataset?.edit;
      const deleteId = e.target?.dataset?.delete;
      const viewId = e.target?.dataset?.view;
      if (editId) openForm(rechnungen.find((r) => r.id === editId));
      if (viewId) showInvoice(rechnungen.find((r) => r.id === viewId));
      if (deleteId) {
        if (!(await confirmDialog('Rechnung wirklich löschen?'))) return;
        try {
          await api.deleteRechnung(jahr, deleteId);
          rechnungen = await api.listRechnungen(jahr);
          renderRows();
          toast('Gelöscht', 'success');
        } catch (err) { toast(err.message, 'error'); }
      }
    });

    function showInvoice(r) {
      if (!r) return;
      const v = state.einstellungen || {};
      const positionen = (r.positionen || []).map((p) => `
        <tr>
          <td>${escapeHtml(p.bezeichnung)}</td>
          <td class="num">${p.menge}</td>
          <td class="num">${formatChf(p.preis)}</td>
          <td class="num">${formatChf(Number(p.menge) * Number(p.preis))}</td>
        </tr>
      `).join('');
      modal({
        title: `Rechnung ${r.nummer}`,
        body: `
          <div class="report" style="padding:20px;">
            <div class="flex between">
              <div>
                <div class="bold">${escapeHtml(v.name || 'Verein')}</div>
                <div class="muted small">${escapeHtml(v.adresse || '')}<br>${escapeHtml(v.plz || '')} ${escapeHtml(v.ort || '')}</div>
              </div>
              <div class="right">
                <div class="bold">Rechnung ${escapeHtml(r.nummer)}</div>
                <div class="muted small">Datum: ${formatDate(r.datum)}<br>Fällig: ${formatDate(r.faellig_am)}</div>
              </div>
            </div>
            <div class="mt-4">
              <div class="bold">${escapeHtml(r.empfaenger_name || '')}</div>
              <div class="muted small">${escapeHtml(r.empfaenger_adresse || '').replace(/\n/g, '<br>')}</div>
            </div>
            <p class="mt-4">${escapeHtml(r.beschreibung || '')}</p>
            <table class="data mt-4">
              <thead><tr><th>Bezeichnung</th><th class="num">Menge</th><th class="num">Preis</th><th class="num">Total CHF</th></tr></thead>
              <tbody>${positionen}</tbody>
              <tfoot><tr><td colspan="3" class="right">Total</td><td class="num">${formatChf(r.total || 0)}</td></tr></tfoot>
            </table>
            ${v.iban ? `<p class="mt-4 muted small">Zahlung auf IBAN ${escapeHtml(v.iban)} unter Angabe der Rechnungsnummer ${escapeHtml(r.nummer)}.</p>` : ''}
          </div>
        `,
        footer: `<button data-cancel>Schliessen</button><button class="primary" onclick="window.print()">Drucken</button>`,
      }).footerEl.querySelector('[data-cancel]').onclick = (e) => e.target.closest('.modal-backdrop').remove();
    }

    function openForm(rechnung) {
      const isNew = !rechnung;
      const r = rechnung || {
        nummer: nextNummer(rechnungen, jahr),
        datum: todayIso(),
        faellig_am: '',
        empfaenger_typ: 'sektion',
        empfaenger_id: '',
        empfaenger_name: '',
        empfaenger_adresse: '',
        beschreibung: `Sektionsbeitrag ${jahr}`,
        positionen: [{ id: uid(), bezeichnung: '', menge: 1, preis: 0 }],
        status: 'offen',
      };

      const md = modal({
        title: isNew ? 'Neue Rechnung' : `Rechnung ${r.nummer} bearbeiten`,
        body: '',
        footer: `<button data-cancel>Abbrechen</button><button class="primary" data-save>Speichern</button>`,
      });

      const draw = () => {
        const optionsSektionen = sektionen
          .filter((s) => (s.status || 'aktiv') === 'aktiv')
          .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${s.anzahl_mitglieder || 0} Mitglieder)</option>`).join('');
        md.bodyEl.innerHTML = `
          <div class="form-grid">
            <div class="input-group"><label>Rechnungs-Nr</label><input name="nummer" value="${escapeHtml(r.nummer)}" /></div>
            <div class="input-group"><label>Status</label>
              <select name="status">
                <option value="offen" ${r.status === 'offen' ? 'selected' : ''}>Offen</option>
                <option value="bezahlt" ${r.status === 'bezahlt' ? 'selected' : ''}>Bezahlt</option>
                <option value="gemahnt" ${r.status === 'gemahnt' ? 'selected' : ''}>Gemahnt</option>
                <option value="storniert" ${r.status === 'storniert' ? 'selected' : ''}>Storniert</option>
              </select>
            </div>
            <div class="input-group"><label>Datum</label><input name="datum" type="date" value="${escapeHtml(r.datum)}" /></div>
            <div class="input-group"><label>Fällig am</label><input name="faellig_am" type="date" value="${escapeHtml(r.faellig_am || '')}" /></div>
            <div class="input-group"><label>Empfänger-Typ</label>
              <select name="empfaenger_typ">
                <option value="sektion" ${r.empfaenger_typ === 'sektion' ? 'selected' : ''}>Sektion</option>
                <option value="extern" ${r.empfaenger_typ === 'extern' ? 'selected' : ''}>Extern</option>
              </select>
            </div>
            <div class="input-group" id="sektion-wrap">
              <label>Sektion wählen</label>
              <select name="empfaenger_id"><option value="">— wählen —</option>${optionsSektionen}</select>
            </div>
            <div class="input-group full"><label>Empfänger Name</label><input name="empfaenger_name" value="${escapeHtml(r.empfaenger_name || '')}" /></div>
            <div class="input-group full"><label>Empfänger Adresse</label><textarea name="empfaenger_adresse">${escapeHtml(r.empfaenger_adresse || '')}</textarea></div>
            <div class="input-group full"><label>Beschreibung / Betreff</label><input name="beschreibung" value="${escapeHtml(r.beschreibung || '')}" /></div>
          </div>
          <h4 class="mt-4">Positionen</h4>
          <table class="data" id="pos-tab">
            <thead><tr><th>Bezeichnung</th><th class="num">Menge</th><th class="num">Preis</th><th class="num">Total</th><th></th></tr></thead>
            <tbody>
              ${r.positionen.map((p, i) => `
                <tr data-pos="${i}">
                  <td><input data-field="bezeichnung" value="${escapeHtml(p.bezeichnung)}" /></td>
                  <td><input data-field="menge" type="number" step="0.01" value="${p.menge}" class="right" /></td>
                  <td><input data-field="preis" type="number" step="0.05" value="${p.preis}" class="right" /></td>
                  <td class="num">${formatChf(Number(p.menge) * Number(p.preis))}</td>
                  <td><button class="sm danger" data-remove="${i}">×</button></td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot><tr><td colspan="3" class="right">Total</td><td class="num" id="pos-total">${formatChf(calcTotal(r.positionen))}</td><td></td></tr></tfoot>
          </table>
          <button class="mt-2" data-add-pos>+ Position</button>
        `;
        md.bodyEl.querySelector('[name="empfaenger_id"]').value = r.empfaenger_id || '';
      };
      draw();

      md.bodyEl.addEventListener('change', (e) => {
        const t = e.target;
        if (t.name === 'empfaenger_id' && t.value) {
          const sel = sektionen.find((s) => s.id === t.value);
          if (sel) {
            md.bodyEl.querySelector('[name="empfaenger_name"]').value = sel.name;
            md.bodyEl.querySelector('[name="empfaenger_adresse"]').value = [
              sel.kontakt_name,
              sel.adresse,
              `${sel.plz || ''} ${sel.ort || ''}`.trim(),
            ].filter(Boolean).join('\n');
            // Position automatisch ergänzen: Anzahl × Beitrag
            if (sel.anzahl_mitglieder && sel.beitrag_pro_mitglied) {
              const erste = r.positionen[0];
              if (erste && !erste.bezeichnung) {
                erste.bezeichnung = `Sektionsbeitrag ${jahr} (${sel.anzahl_mitglieder} Mitglieder × CHF ${sel.beitrag_pro_mitglied})`;
                erste.menge = Number(sel.anzahl_mitglieder);
                erste.preis = Number(sel.beitrag_pro_mitglied);
                draw();
              }
            }
          }
        }
        const row = t.closest('tr[data-pos]');
        if (row) {
          const idx = Number(row.dataset.pos);
          if (t.dataset.field === 'menge' || t.dataset.field === 'preis') {
            r.positionen[idx][t.dataset.field] = Number(t.value);
          } else if (t.dataset.field) {
            r.positionen[idx][t.dataset.field] = t.value;
          }
          row.children[3].textContent = formatChf(Number(r.positionen[idx].menge) * Number(r.positionen[idx].preis));
          md.bodyEl.querySelector('#pos-total').textContent = formatChf(calcTotal(r.positionen));
        }
      });

      md.bodyEl.addEventListener('click', (e) => {
        if (e.target.matches('[data-add-pos]')) {
          r.positionen.push({ id: uid(), bezeichnung: '', menge: 1, preis: 0 });
          draw();
        }
        if (e.target.matches('[data-remove]')) {
          r.positionen.splice(Number(e.target.dataset.remove), 1);
          draw();
        }
      });

      md.footerEl.querySelector('[data-cancel]').onclick = md.close;
      md.footerEl.querySelector('[data-save]').onclick = async () => {
        const data = { positionen: r.positionen };
        md.bodyEl.querySelectorAll('[name]').forEach((el) => (data[el.name] = el.value.trim ? el.value.trim() : el.value));
        data.total = calcTotal(r.positionen);
        if (!data.nummer || !data.datum || !data.empfaenger_name) {
          toast('Nummer, Datum und Empfänger sind Pflicht', 'error'); return;
        }
        try {
          if (isNew) await api.saveRechnung(jahr, data);
          else await api.updateRechnung(jahr, rechnung.id, data);
          md.close();
          rechnungen = await api.listRechnungen(jahr);
          renderRows();
          toast('Gespeichert', 'success');
        } catch (err) { toast(err.message, 'error'); }
      };
    }
  },
};

function calcTotal(positionen) {
  return positionen.reduce((s, p) => s + Number(p.menge || 0) * Number(p.preis || 0), 0);
}

function nextNummer(rechnungen, jahr) {
  const max = rechnungen
    .map((r) => Number((r.nummer || '').split('-').pop()))
    .filter((n) => Number.isFinite(n))
    .reduce((m, n) => Math.max(m, n), 0);
  return `${jahr}-${String(max + 1).padStart(4, '0')}`;
}
