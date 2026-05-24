// Voranschlag (Budget) für ein Geschäftsjahr.
// AI-Generierung basierend auf Ist-Werten der Vorjahre.

import { api } from '../api.js';
import { state } from '../main.js';
import { escapeHtml, formatChf, currentYear, debounce } from '../utils.js';
import { modal, toast, confirmDialog } from '../components.js';
import { generateVoranschlag, hasApiKey } from '../ai.js';
import { kontoSaldo } from '../accounting.js';

export default {
  async render(container) {
    // Standardmässig nächstes Jahr (Budget plant nach vorne)
    const persistedJahr = Number(localStorage.getItem('voranschlagJahr'));
    let budgetJahr = Number.isFinite(persistedJahr) && persistedJahr > 0 ? persistedJahr : currentYear() + 1;

    const konten = await api.listKonten();
    konten.sort((a, b) => a.nummer.localeCompare(b.nummer));

    // Mögliche Quelljahre für Historie
    const jahre = state.jahre.slice().sort((a, b) => a.jahr - b.jahr);

    let budget = await api.getBudget(budgetJahr);
    let positionen = budget?.positionen || [];

    // Map konto -> betrag für schnellen Zugriff
    const positionMap = () => new Map(positionen.map((p) => [p.konto, p]));

    // Historische Ist-Werte berechnen (Aufwand/Ertrag-Konten der letzten 3 Jahre)
    async function buildHistorie() {
      const result = {};
      const relevant = konten.filter((k) => k.typ === 'ertrag' || k.typ === 'aufwand');
      const lastYears = jahre.filter((j) => j.jahr < budgetJahr).slice(-3);
      for (const j of lastYears) {
        const buchungen = await api.listBuchungen(j.jahr);
        for (const k of relevant) {
          const saldo = kontoSaldo(k.nummer, k.typ, buchungen);
          if (saldo !== 0) {
            result[k.nummer] = result[k.nummer] || {};
            result[k.nummer][j.jahr] = saldo;
          }
        }
      }
      return result;
    }

    let historie = await buildHistorie();
    // Auch aktuelles Jahr (laufendes Ist) zum Vergleich
    let currentJahrIst = {};
    if (state.jahre.find((j) => j.jahr === budgetJahr - 0)) {
      const buchungen = await api.listBuchungen(budgetJahr);
      for (const k of konten.filter((x) => x.typ === 'ertrag' || x.typ === 'aufwand')) {
        const s = kontoSaldo(k.nummer, k.typ, buchungen);
        if (s !== 0) currentJahrIst[k.nummer] = s;
      }
    }

    // Erst-Render des UI-Grundgerüsts
    const renderUI = () => {
      const jahrOptions = [];
      for (let y = currentYear() - 1; y <= currentYear() + 3; y++) {
        jahrOptions.push(`<option value="${y}" ${y === budgetJahr ? 'selected' : ''}>${y}</option>`);
      }

      const relevantKonten = konten.filter((k) => k.typ === 'ertrag' || k.typ === 'aufwand');
      const pmap = positionMap();
      const hYears = Array.from(new Set(Object.values(historie).flatMap((h) => Object.keys(h)))).sort();

      // KPIs
      const totalErtrag = positionen
        .filter((p) => konten.find((k) => k.nummer === p.konto)?.typ === 'ertrag')
        .reduce((s, p) => s + Number(p.betrag || 0), 0);
      const totalAufwand = positionen
        .filter((p) => konten.find((k) => k.nummer === p.konto)?.typ === 'aufwand')
        .reduce((s, p) => s + Number(p.betrag || 0), 0);

      container.innerHTML = `
        <div class="page-header">
          <h2>Voranschlag</h2>
          <div class="actions">
            <label class="muted small" style="display:flex;align-items:center;gap:6px">Jahr <select id="budget-jahr">${jahrOptions.join('')}</select></label>
            <span id="save-indicator" class="badge muted">Bereit</span>
            <button class="ai" id="ai-generate" ${hasApiKey() ? '' : 'disabled title="Gemini Key in Einstellungen hinterlegen"'}>✨ AI-Voranschlag</button>
            <button class="primary" id="save-budget">Manuell speichern</button>
          </div>
        </div>

        <div class="card" style="background:#eff6ff;border-color:#bfdbfe">
          <p class="small" style="margin:0;color:#1e3a8a">
            💡 <strong>Alle Felder sind direkt editierbar.</strong> Tippe Beträge und Notizen
            inline – wird automatisch nach kurzem Tippstopp gespeichert.
          </p>
        </div>

        <div class="cards-grid">
          <div class="kpi"><div class="kpi-label">Budget Ertrag ${budgetJahr}</div><div class="kpi-value positive">CHF ${formatChf(totalErtrag)}</div></div>
          <div class="kpi"><div class="kpi-label">Budget Aufwand ${budgetJahr}</div><div class="kpi-value negative">CHF ${formatChf(totalAufwand)}</div></div>
          <div class="kpi"><div class="kpi-label">Budgetiertes Ergebnis</div><div class="kpi-value ${totalErtrag - totalAufwand >= 0 ? 'positive' : 'negative'}">CHF ${formatChf(totalErtrag - totalAufwand)}</div></div>
        </div>

        <div class="card">
          <h3>Erträge</h3>
          <div class="table-wrap">${renderTable(relevantKonten.filter((k) => k.typ === 'ertrag'), pmap, hYears)}</div>
        </div>

        <div class="card">
          <h3>Aufwand</h3>
          <div class="table-wrap">${renderTable(relevantKonten.filter((k) => k.typ === 'aufwand'), pmap, hYears)}</div>
        </div>

        <div class="card">
          <h3>Allgemeine Notizen</h3>
          <textarea id="budget-notizen" rows="3" placeholder="z.B. Annahmen, Sonderfaktoren…">${escapeHtml(budget?.notizen || '')}</textarea>
        </div>
      `;

      // Jahr-Wechsel
      container.querySelector('#budget-jahr').onchange = async (e) => {
        budgetJahr = Number(e.target.value);
        localStorage.setItem('voranschlagJahr', String(budgetJahr));
        budget = await api.getBudget(budgetJahr);
        positionen = budget?.positionen || [];
        historie = await buildHistorie();
        currentJahrIst = {};
        if (state.jahre.find((j) => j.jahr === budgetJahr)) {
          const buchungen = await api.listBuchungen(budgetJahr);
          for (const k of relevantKonten) {
            const s = kontoSaldo(k.nummer, k.typ, buchungen);
            if (s !== 0) currentJahrIst[k.nummer] = s;
          }
        }
        renderUI();
      };

      // Save-Indicator-Helpers
      const indicator = container.querySelector('#save-indicator');
      const setIndicator = (state) => {
        if (!indicator) return;
        switch (state) {
          case 'dirty': indicator.className = 'badge warning'; indicator.textContent = '• Ungespeicherte Änderungen'; break;
          case 'saving': indicator.className = 'badge muted'; indicator.textContent = 'Speichert…'; break;
          case 'saved': indicator.className = 'badge success'; indicator.textContent = '✓ Gespeichert ' + new Date().toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }); break;
          case 'error': indicator.className = 'badge danger'; indicator.textContent = '⚠ Fehler'; break;
          default: indicator.className = 'badge muted'; indicator.textContent = 'Bereit';
        }
      };

      const doSave = async () => {
        setIndicator('saving');
        try {
          const notizen = container.querySelector('#budget-notizen').value;
          await api.saveBudget(budgetJahr, positionen, notizen);
          setIndicator('saved');
        } catch (err) {
          setIndicator('error');
          toast(err.message, 'error');
        }
      };
      const autoSave = debounce(doSave, 800);

      // Inline-Bearbeitung der Beträge
      container.querySelectorAll('[data-budget-input]').forEach((input) => {
        input.oninput = () => {
          const konto = input.dataset.budgetInput;
          const betrag = Number(input.value);
          const existing = positionen.find((p) => p.konto === konto);
          if (Number.isFinite(betrag) && betrag !== 0) {
            if (existing) existing.betrag = betrag;
            else positionen.push({ konto, betrag, notiz: '' });
          } else if (existing) {
            positionen = positionen.filter((p) => p.konto !== konto);
          }
          setIndicator('dirty');
          autoSave();
        };
      });
      container.querySelectorAll('[data-budget-notiz]').forEach((input) => {
        input.oninput = () => {
          const konto = input.dataset.budgetNotiz;
          const existing = positionen.find((p) => p.konto === konto);
          if (existing) existing.notiz = input.value;
          else if (input.value) positionen.push({ konto, betrag: 0, notiz: input.value });
          setIndicator('dirty');
          autoSave();
        };
      });
      const notizenEl = container.querySelector('#budget-notizen');
      if (notizenEl) {
        notizenEl.oninput = () => {
          setIndicator('dirty');
          autoSave();
        };
      }

      // Manuelle Speichern-Schaltfläche
      container.querySelector('#save-budget').onclick = doSave;

      // AI-Generierung
      container.querySelector('#ai-generate').onclick = () => openAi();
    };

    function renderTable(kontenList, pmap, hYears) {
      if (kontenList.length === 0) return '<div class="muted">Keine Konten in dieser Kategorie.</div>';
      return `
        <table class="data">
          <thead>
            <tr>
              <th>Konto</th>
              ${hYears.map((y) => `<th class="num">Ist ${y}</th>`).join('')}
              ${currentJahrIst && Object.keys(currentJahrIst).length ? `<th class="num">Ist ${budgetJahr}</th>` : ''}
              <th class="num">Budget ${budgetJahr}</th>
              <th>Notiz</th>
            </tr>
          </thead>
          <tbody>
            ${kontenList.map((k) => {
              const p = pmap.get(k.nummer) || {};
              const hist = historie[k.nummer] || {};
              return `
                <tr>
                  <td><strong>${escapeHtml(k.nummer)}</strong> ${escapeHtml(k.bezeichnung)}</td>
                  ${hYears.map((y) => `<td class="num muted">${hist[y] != null ? formatChf(hist[y]) : '—'}</td>`).join('')}
                  ${currentJahrIst && Object.keys(currentJahrIst).length ? `<td class="num muted">${currentJahrIst[k.nummer] != null ? formatChf(currentJahrIst[k.nummer]) : '—'}</td>` : ''}
                  <td class="num">
                    <input type="number" step="0.05" min="0" data-budget-input="${escapeHtml(k.nummer)}"
                      value="${p.betrag || ''}" style="text-align:right;width:120px" />
                  </td>
                  <td>
                    <input data-budget-notiz="${escapeHtml(k.nummer)}" value="${escapeHtml(p.notiz || '')}" placeholder="optional" />
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              ${hYears.map((y) => {
                const t = kontenList.reduce((s, k) => s + (historie[k.nummer]?.[y] || 0), 0);
                return `<td class="num">${formatChf(t)}</td>`;
              }).join('')}
              ${currentJahrIst && Object.keys(currentJahrIst).length ? `<td class="num">${formatChf(kontenList.reduce((s, k) => s + (currentJahrIst[k.nummer] || 0), 0))}</td>` : ''}
              <td class="num">${formatChf(kontenList.reduce((s, k) => s + Number(pmap.get(k.nummer)?.betrag || 0), 0))}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      `;
    }

    function openAi() {
      if (!hasApiKey()) {
        toast('Gemini API Key fehlt – in Einstellungen hinterlegen', 'error');
        return;
      }
      const m = modal({
        title: `✨ Voranschlag ${budgetJahr} generieren`,
        body: `
          <p class="muted small">
            Gemini erstellt einen Voranschlag basierend auf den Ist-Werten der
            Vorjahre und den aktuell erfassten Sektionen.
            Anschliessend kannst du jede Position anpassen.
          </p>
          <div class="input-group full">
            <label>Zusätzliche Hinweise (optional)</label>
            <textarea id="ai-notiz" rows="3" placeholder="z.B. Geplante Veranstaltung kostet voraussichtlich CHF 2000, Personalaufwand bleibt stabil…"></textarea>
          </div>
          <div id="ai-output" class="hidden"></div>
        `,
        footer: `
          <button data-cancel>Abbrechen</button>
          <button class="ai" id="ai-go">✨ Generieren</button>
          <button class="primary hidden" id="ai-apply">Übernehmen</button>
        `,
      });
      const output = m.bodyEl.querySelector('#ai-output');
      const goBtn = m.footerEl.querySelector('#ai-go');
      const applyBtn = m.footerEl.querySelector('#ai-apply');
      let suggestion = null;

      m.footerEl.querySelector('[data-cancel]').onclick = m.close;

      goBtn.onclick = async () => {
        goBtn.disabled = true;
        output.classList.remove('hidden');
        output.innerHTML = '<div class="loader">Gemini erstellt Voranschlag (kann etwas dauern)…</div>';
        try {
          const sektionen = await api.listSektionen();
          const notiz = m.bodyEl.querySelector('#ai-notiz').value.trim();
          suggestion = await generateVoranschlag({
            jahr: budgetJahr,
            konten,
            historie,
            sektionen,
            notizen: notiz,
          });
          output.innerHTML = `
            <h4>Vorschlag (${suggestion.length} Positionen)</h4>
            <div class="table-wrap" style="max-height:340px;overflow:auto">
              <table class="data">
                <thead><tr><th>Konto</th><th class="num">Budget CHF</th><th>Begründung</th></tr></thead>
                <tbody>
                  ${suggestion.map((p) => {
                    const k = konten.find((x) => x.nummer === p.konto);
                    return `<tr>
                      <td>${escapeHtml(p.konto)} ${escapeHtml(k?.bezeichnung || '')}</td>
                      <td class="num">${formatChf(p.betrag)}</td>
                      <td class="muted small">${escapeHtml(p.notiz || '')}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `;
          applyBtn.classList.remove('hidden');
        } catch (err) {
          output.innerHTML = `<div class="empty">Fehler: ${escapeHtml(err.message)}</div>`;
        }
        goBtn.disabled = false;
      };

      applyBtn.onclick = async () => {
        if (!suggestion) return;
        const replace = await confirmDialog(
          `Voranschlag ${budgetJahr} durch ${suggestion.length} AI-Positionen ersetzen? (Bestehende Eingaben werden überschrieben)`,
          { confirmLabel: 'Übernehmen', danger: false },
        );
        if (!replace) return;
        positionen = suggestion.map((p) => ({ konto: p.konto, betrag: p.betrag, notiz: p.notiz }));
        try {
          await api.saveBudget(budgetJahr, positionen, m.bodyEl.querySelector('#ai-notiz').value);
          m.close();
          budget = await api.getBudget(budgetJahr);
          renderUI();
          toast('Voranschlag übernommen', 'success');
        } catch (err) { toast(err.message, 'error'); }
      };
    }

    renderUI();
  },
};
