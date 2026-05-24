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
  async render(container, params = {}) {
    const jahr = state.aktuellesJahr;
    // Erst Portal-Sync: prüfen ob in Quantus bereits Rechnungen als bezahlt
    // markiert wurden → Zahlungsbuchungen werden dann automatisch erstellt.
    try {
      const result = await api.syncRechnungenFromPortal();
      if (result.processed > 0) {
        toast(`${result.processed} Zahlungseingang/-eingänge automatisch verbucht`, 'success');
      }
    } catch (err) { console.warn('Rechnungs-Sync fehlgeschlagen:', err); }

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
          <button id="batch">📨 Sektionsbeitrags-Rechnungen</button>
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
    container.querySelector('#batch').onclick = () => openBatch();

    // Deep-Link aus Quantus: #rechnungen?id=<id> öffnet die Rechnung direkt im Pop-up.
    // Falls in einem anderen Jahr → durch alle Jahre suchen.
    if (params?.id) {
      let target = rechnungen.find((r) => r.id === params.id);
      if (!target) {
        // In anderen Jahren suchen
        try {
          const jahre = await api.listJahre();
          for (const j of jahre.sort((a, b) => b.jahr - a.jahr)) {
            if (j.jahr === jahr) continue;
            const list = await api.listRechnungen(j.jahr);
            const f = list.find((r) => r.id === params.id);
            if (f) {
              toast(`Rechnung liegt im Jahr ${j.jahr} – wechsle Jahr.`, 'info');
              localStorage.setItem('aktuellesJahr', String(j.jahr));
              location.reload();
              return;
            }
          }
        } catch {}
      }
      if (target) {
        setTimeout(() => showInvoice(target), 100);
      } else {
        toast('Rechnung nicht gefunden', 'error');
      }
    }

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
      const html = buildInvoiceHtml(r, v);
      const m = modal({
        title: `Rechnung ${r.nummer}`,
        body: html,
        footer: `
          <button data-cancel>Schliessen</button>
          <button id="inv-print">🖨 Drucken / PDF</button>
          <button class="primary" id="inv-window">📄 Als Dokument öffnen</button>
        `,
      });
      m.footerEl.querySelector('[data-cancel]').onclick = m.close;
      m.footerEl.querySelector('#inv-print').onclick = () => printInvoice(r, v);
      m.footerEl.querySelector('#inv-window').onclick = () => printInvoice(r, v);
    }

    function buildInvoiceHtml(r, v) {
      const positionen = (r.positionen || []).map((p) => `
        <tr>
          <td>${escapeHtml(p.bezeichnung)}</td>
          <td class="num">${p.menge}</td>
          <td class="num">${formatChf(p.preis)}</td>
          <td class="num">${formatChf(Number(p.menge) * Number(p.preis))}</td>
        </tr>
      `).join('');
      return `
        <div class="invoice-doc" style="padding:20px; background:white;">
          <div class="flex between" style="margin-bottom:32px">
            <div>
              <div class="bold" style="font-size:18px;color:#c8102e">${escapeHtml(v.name || 'Verein')}</div>
              ${v.untertitel ? `<div class="muted small">${escapeHtml(v.untertitel)}</div>` : ''}
              <div class="muted small mt-2">${escapeHtml(v.adresse || '')}${v.plz || v.ort ? `<br>${escapeHtml(v.plz || '')} ${escapeHtml(v.ort || '')}` : ''}</div>
              ${v.email ? `<div class="muted small">${escapeHtml(v.email)}</div>` : ''}
            </div>
            <div class="right">
              <div style="font-size:24px;font-weight:700">RECHNUNG</div>
              <div class="muted small mt-2">
                Nr.: <strong>${escapeHtml(r.nummer)}</strong><br>
                Datum: ${formatDate(r.datum)}<br>
                ${r.faellig_am ? `Fällig: ${formatDate(r.faellig_am)}` : ''}
              </div>
            </div>
          </div>

          <div style="margin-bottom:24px">
            <div class="muted small">An:</div>
            <div class="bold" style="font-size:15px">${escapeHtml(r.empfaenger_name || '')}</div>
            <div style="white-space:pre-line">${escapeHtml(r.empfaenger_adresse || '')}</div>
          </div>

          ${r.beschreibung ? `<p style="font-size:15px;margin-bottom:16px"><strong>${escapeHtml(r.beschreibung)}</strong></p>` : ''}

          <table class="data" style="margin-bottom:16px">
            <thead><tr><th>Bezeichnung</th><th class="num">Menge</th><th class="num">Preis CHF</th><th class="num">Total CHF</th></tr></thead>
            <tbody>${positionen}</tbody>
            <tfoot><tr><td colspan="3" class="right"><strong>Total</strong></td><td class="num"><strong>${formatChf(r.total || 0)}</strong></td></tr></tfoot>
          </table>

          <div style="margin-top:32px;padding-top:16px;border-top:1px solid #ddd">
            <div class="bold" style="margin-bottom:6px">Zahlungsinformationen</div>
            ${v.bank ? `<div class="small">Bank: ${escapeHtml(v.bank)}</div>` : ''}
            ${v.iban ? `<div class="small">IBAN: <code>${escapeHtml(v.iban)}</code></div>` : ''}
            ${v.bic ? `<div class="small">BIC: ${escapeHtml(v.bic)}</div>` : ''}
            <div class="small mt-2">Bitte gib bei der Überweisung die Rechnungsnummer <strong>${escapeHtml(r.nummer)}</strong> als Vermerk an.</div>
            ${r.faellig_am ? `<div class="small mt-2">Zahlbar bis <strong>${formatDate(r.faellig_am)}</strong>.</div>` : ''}
          </div>

          <div style="margin-top:32px;font-size:11px;color:#888">
            Vielen Dank für die solidarische Unterstützung.
          </div>
        </div>
      `;
    }

    function printInvoice(r, v) {
      const w = window.open('', '_blank');
      if (!w) { toast('Popup blockiert – im Browser erlauben', 'error'); return; }
      w.document.write(`
        <!DOCTYPE html>
        <html><head>
          <title>Rechnung ${escapeHtml(r.nummer)}</title>
          <style>
            * { box-sizing: border-box; }
            body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 14px; line-height: 1.5; color: #1f2330; max-width: 700px; margin: 40px auto; padding: 0 20px; }
            .flex { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
            .right { text-align: right; }
            .num { text-align: right; font-variant-numeric: tabular-nums; }
            .muted { color: #6b7280; }
            .small { font-size: 12px; }
            .bold { font-weight: 600; }
            .mt-2 { margin-top: 6px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
            th { text-align: left; background: #f9fafb; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; }
            tfoot td { border-top: 2px solid #1f2330; border-bottom: none; }
            code { background: #f3f4f6; padding: 1px 6px; border-radius: 3px; font-family: monospace; }
            @media print { body { margin: 20px; } }
          </style>
        </head><body>${buildInvoiceHtml(r, v)}<script>window.onload=()=>window.print()</script></body></html>
      `);
      w.document.close();
    }


    function openBatch() {
      const aktive = sektionen.filter((s) => (s.status || 'aktiv') === 'aktiv');
      if (aktive.length === 0) {
        toast('Keine aktiven Sektionen vorhanden', 'error');
        return;
      }
      const today = todayIso();
      const inThirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const m = modal({
        title: `Sektionsbeitrags-Rechnungen für ${jahr} erstellen`,
        body: `
          <p class="muted small">
            Erstellt eine Rechnung pro ausgewählter Sektion mit dem
            jeweiligen Mitgliederbeitrag aus den Sektions-Stammdaten.
          </p>
          <div class="form-grid">
            <div class="input-group"><label>Rechnungsdatum</label><input name="datum" type="date" value="${today}" /></div>
            <div class="input-group"><label>Fällig am</label><input name="faellig_am" type="date" value="${inThirtyDays}" /></div>
            <div class="input-group full"><label>Betreff</label><input name="beschreibung" value="Sektionsbeitrag ${jahr}" /></div>
          </div>
          <h4>Sektionen wählen</h4>
          <div class="table-wrap" style="max-height:320px;overflow:auto">
            <table class="data">
              <thead><tr><th><input type="checkbox" id="check-all" checked /></th><th>Sektion</th><th class="num">Mitglieder</th><th class="num">Beitrag/Kopf</th><th class="num">Total CHF</th></tr></thead>
              <tbody>
                ${aktive.map((s) => {
                  const total = Number(s.anzahl_mitglieder || 0) * Number(s.beitrag_pro_mitglied || 0);
                  return `
                    <tr>
                      <td><input type="checkbox" class="batch-check" data-id="${escapeHtml(s.id)}" ${total > 0 ? 'checked' : ''} /></td>
                      <td>${escapeHtml(s.name)}</td>
                      <td class="num">${s.anzahl_mitglieder || 0}</td>
                      <td class="num">${formatChf(s.beitrag_pro_mitglied || 0)}</td>
                      <td class="num bold">${formatChf(total)}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="4" class="right">Total ausgewählt</td>
                  <td class="num bold" id="batch-total">CHF ${formatChf(aktive.reduce((s, x) => s + Number(x.anzahl_mitglieder || 0) * Number(x.beitrag_pro_mitglied || 0), 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        `,
        footer: `<button data-cancel>Abbrechen</button><button class="primary" id="batch-create">Rechnungen erstellen</button>`,
      });

      const checkAll = m.bodyEl.querySelector('#check-all');
      const updateTotal = () => {
        const checked = m.bodyEl.querySelectorAll('.batch-check:checked');
        let total = 0;
        checked.forEach((cb) => {
          const s = aktive.find((x) => x.id === cb.dataset.id);
          if (s) total += Number(s.anzahl_mitglieder || 0) * Number(s.beitrag_pro_mitglied || 0);
        });
        m.bodyEl.querySelector('#batch-total').textContent = `CHF ${formatChf(total)}`;
      };
      checkAll.onchange = () => {
        m.bodyEl.querySelectorAll('.batch-check').forEach((cb) => (cb.checked = checkAll.checked));
        updateTotal();
      };
      m.bodyEl.querySelectorAll('.batch-check').forEach((cb) => (cb.onchange = updateTotal));

      m.footerEl.querySelector('[data-cancel]').onclick = m.close;
      m.footerEl.querySelector('#batch-create').onclick = async () => {
        const datum = m.bodyEl.querySelector('[name="datum"]').value;
        const faellig = m.bodyEl.querySelector('[name="faellig_am"]').value;
        const beschreibung = m.bodyEl.querySelector('[name="beschreibung"]').value;
        const selectedIds = Array.from(m.bodyEl.querySelectorAll('.batch-check:checked')).map((cb) => cb.dataset.id);
        if (selectedIds.length === 0) { toast('Keine Sektion ausgewählt', 'error'); return; }

        const btn = m.footerEl.querySelector('#batch-create');
        btn.disabled = true;
        let created = 0;
        let failed = 0;
        let nextNum = nextNummer(rechnungen, jahr).replace(/\d+$/, (n) => Number(n));

        for (const id of selectedIds) {
          const s = aktive.find((x) => x.id === id);
          if (!s) continue;
          const total = Number(s.anzahl_mitglieder || 0) * Number(s.beitrag_pro_mitglied || 0);
          if (total <= 0) continue;
          try {
            // Aktuelle Liste neu lesen für korrekte Nummerierung in der Schleife
            const aktList = await api.listRechnungen(jahr);
            const nr = nextNummer(aktList, jahr);
            const newRechnung = await api.saveRechnung(jahr, {
              nummer: nr,
              datum,
              faellig_am: faellig,
              empfaenger_typ: 'sektion',
              empfaenger_id: s.id,
              empfaenger_name: s.name,
              empfaenger_adresse: [s.kontakt_name, s.adresse, `${s.plz || ''} ${s.ort || ''}`.trim()].filter(Boolean).join('\n'),
              beschreibung,
              positionen: [{
                id: `pos-${id}`,
                bezeichnung: `Sektionsbeitrag ${jahr}: ${s.anzahl_mitglieder} Mitglieder × CHF ${s.beitrag_pro_mitglied}`,
                menge: Number(s.anzahl_mitglieder),
                preis: Number(s.beitrag_pro_mitglied),
              }],
              total,
              status: 'offen',
            });
            // Auto-Buchung + Quantus-Task
            try {
              await api.startRechnungsWorkflow(jahr, newRechnung);
            } catch (wfErr) {
              console.warn('Workflow-Fehler bei', s.name, wfErr);
            }
            created++;
          } catch (err) {
            console.error('Batch-Fehler bei', s.name, err);
            failed++;
          }
        }

        m.close();
        rechnungen = await api.listRechnungen(jahr);
        renderRows();
        if (failed > 0) {
          toast(`${created} Rechnungen erstellt, ${failed} fehlgeschlagen`, 'error');
        } else {
          toast(`${created} Rechnungen erstellt`, 'success');
        }
      };
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
          if (isNew) {
            const created = await api.saveRechnung(jahr, data);
            // Automatisch Forderungsbuchung + Quantus-Task starten
            try {
              await api.startRechnungsWorkflow(jahr, created);
              toast('Rechnung erstellt – Buchung + Quantus-Aufgabe automatisch angelegt', 'success');
            } catch (wfErr) {
              console.error(wfErr);
              toast(`Rechnung gespeichert, Workflow-Fehler: ${wfErr.message}`, 'error');
            }
          } else {
            await api.updateRechnung(jahr, rechnung.id, data);
            toast('Gespeichert', 'success');
          }
          md.close();
          rechnungen = await api.listRechnungen(jahr);
          renderRows();
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
