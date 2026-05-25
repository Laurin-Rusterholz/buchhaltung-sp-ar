import { api } from '../api.js';
import { state } from '../main.js';
import { formatChf, escapeHtml, formatDate, downloadFile } from '../utils.js';
import { modal, toast } from '../components.js';
import { generateFinanzbericht, hasApiKey } from '../ai.js';

// Sehr leichtgewichtiger Markdown-Renderer (Überschriften, Fett, Italic,
// Listen, Tabellen, Code). Reicht für die KI-Berichte.
function renderMarkdown(md) {
  if (!md) return '';
  let s = escapeHtml(md);
  // Code-Blöcke
  s = s.replace(/```([\s\S]*?)```/g, (_, c) => `<pre>${c}</pre>`);
  // Inline-Code
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Überschriften
  s = s.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  s = s.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  s = s.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  // Bold, Italic
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Listen
  s = s.replace(/(^|\n)(\s*[-*]\s+.+(?:\n\s*[-*]\s+.+)*)/g, (m, p1, list) => {
    const items = list.split('\n').filter(Boolean).map((l) => l.replace(/^\s*[-*]\s+/, '<li>') + '</li>').join('');
    return `${p1}<ul>${items}</ul>`;
  });
  // Doppelte Newlines → Absätze
  s = s.split(/\n{2,}/).map((para) => {
    if (/^<(h\d|ul|ol|pre|table)/.test(para.trim())) return para;
    return `<p>${para.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return s;
}

export default {
  async render(container) {
    const jahr = state.aktuellesJahr;
    container.innerHTML = `
      <div class="page-header">
        <h2>Berichte ${jahr}</h2>
        <div class="actions">
          <select id="report-typ">
            <option value="bilanz">Bilanz</option>
            <option value="erfolg">Erfolgsrechnung</option>
            <option value="konto">Kontoauszug</option>
          </select>
          <select id="konto-select" class="hidden"></select>
          <button id="ai-bericht" class="ai" ${hasApiKey() ? '' : 'disabled title="Claude Key in Einstellungen hinterlegen"'}>✨ AI-Finanzbericht</button>
          <button id="print" class="primary">Drucken / PDF</button>
        </div>
      </div>
      <div id="report-area"></div>
    `;

    const sel = container.querySelector('#report-typ');
    const kontoSelect = container.querySelector('#konto-select');
    const area = container.querySelector('#report-area');

    const konten = await api.listKonten();
    konten.sort((a, b) => a.nummer.localeCompare(b.nummer));
    kontoSelect.innerHTML = konten.map((k) => `<option value="${escapeHtml(k.nummer)}">${escapeHtml(k.nummer)} ${escapeHtml(k.bezeichnung)}</option>`).join('');

    container.querySelector('#print').onclick = () => window.print();

    const draw = async () => {
      area.innerHTML = '<div class="loader">Lädt…</div>';
      const v = state.einstellungen || {};
      kontoSelect.classList.toggle('hidden', sel.value !== 'konto');
      try {
        if (sel.value === 'bilanz') {
          const b = await api.bilanz(jahr);
          area.innerHTML = renderBilanz(b, jahr, v);
        } else if (sel.value === 'erfolg') {
          const er = await api.erfolgsrechnung(jahr);
          area.innerHTML = renderErfolg(er, jahr, v);
        } else {
          const k = await api.kontoauszug(jahr, kontoSelect.value);
          area.innerHTML = renderKonto(k, jahr, v);
        }
      } catch (err) {
        area.innerHTML = `<div class="empty">Fehler: ${err.message}</div>`;
      }
    };

    sel.onchange = draw;
    kontoSelect.onchange = draw;
    draw();

    // === AI-Finanzbericht ===
    container.querySelector('#ai-bericht').onclick = () => openAiBericht();

    function openAiBericht() {
      const m = modal({
        title: '✨ AI-Finanzbericht generieren',
        body: `
          <p class="muted small">
            Claude vergleicht das Budget mit den tatsächlichen Buchungen und
            schreibt einen Bericht in Markdown. Konkrete Belegnummern oder
            Vendor-Namen werden bewusst NICHT zitiert – die Ursachen werden
            thematisch zusammengefasst.
          </p>
          <div class="form-grid">
            <div class="input-group">
              <label>Bericht-Typ</label>
              <select id="bericht-typ">
                <option value="budget" selected>Budget vs. Ist (detailliert)</option>
                <option value="jahresrueckblick">Jahresrückblick (erzählerisch)</option>
                <option value="kompakt">Executive Summary (kompakt)</option>
              </select>
            </div>
          </div>
          <div id="bericht-status" class="muted small mt-2"></div>
          <div id="bericht-output" class="ai-result hidden mt-4" style="max-height:55vh;overflow-y:auto"></div>
        `,
        footer: `
          <button data-cancel>Schliessen</button>
          <button id="bericht-copy" class="hidden">Markdown kopieren</button>
          <button id="bericht-download" class="hidden">Als .md herunterladen</button>
          <button class="primary" id="bericht-go">✨ Generieren</button>
        `,
      });
      const typSel = m.bodyEl.querySelector('#bericht-typ');
      const statusEl = m.bodyEl.querySelector('#bericht-status');
      const outputEl = m.bodyEl.querySelector('#bericht-output');
      const goBtn = m.footerEl.querySelector('#bericht-go');
      const copyBtn = m.footerEl.querySelector('#bericht-copy');
      const downloadBtn = m.footerEl.querySelector('#bericht-download');
      m.footerEl.querySelector('[data-cancel]').onclick = m.close;
      let lastMarkdown = '';

      goBtn.onclick = async () => {
        goBtn.disabled = true;
        copyBtn.classList.add('hidden');
        downloadBtn.classList.add('hidden');
        outputEl.classList.add('hidden');
        statusEl.textContent = 'Lade Daten (Buchungen, Konten, Budget)…';
        try {
          const [buchungen, konten, budget, einstellungen] = await Promise.all([
            api.listBuchungen(jahr),
            api.listKonten(),
            api.getBudget(jahr),
            api.getEinstellungen(),
          ]);
          if (!buchungen.length) {
            statusEl.innerHTML = '<span style="color:var(--color-danger)">Keine Buchungen in diesem Jahr – kein Bericht möglich.</span>';
            goBtn.disabled = false;
            return;
          }
          statusEl.textContent = `Claude analysiert ${buchungen.length} Buchungen und vergleicht mit Budget (${budget?.positionen?.length || 0} Positionen)…`;
          const md = await generateFinanzbericht({
            jahr, buchungen, konten, budget, einstellungen, type: typSel.value,
          });
          lastMarkdown = md;
          outputEl.innerHTML = renderMarkdown(md);
          outputEl.classList.remove('hidden');
          statusEl.textContent = '✓ Bericht erstellt.';
          copyBtn.classList.remove('hidden');
          downloadBtn.classList.remove('hidden');
        } catch (err) {
          statusEl.innerHTML = `<span style="color:var(--color-danger)">Fehler: ${escapeHtml(err.message)}</span>`;
        }
        goBtn.disabled = false;
      };

      copyBtn.onclick = async () => {
        try { await navigator.clipboard.writeText(lastMarkdown); toast('Markdown in die Zwischenablage kopiert', 'success'); }
        catch { toast('Kopieren fehlgeschlagen', 'error'); }
      };
      downloadBtn.onclick = () => {
        const name = `Finanzbericht-${jahr}-${typSel.value}.md`;
        downloadFile(name, lastMarkdown, 'text/markdown');
      };
    }
  },
};

function reportHeader(title, jahr, v) {
  return `
    <div class="report-header">
      <h2>${escapeHtml(v.name || 'Verein')}</h2>
      <div>${escapeHtml(title)} – Geschäftsjahr ${jahr}</div>
      <div class="muted small">${escapeHtml(v.adresse || '')} ${escapeHtml(v.plz || '')} ${escapeHtml(v.ort || '')}</div>
    </div>
  `;
}

function renderBilanz(b, jahr, v) {
  const sec = (title, eintraege) => `
    <div class="report-section">
      <h3>${title}</h3>
      ${eintraege.map((e) => `
        <div class="report-line">
          <span>${escapeHtml(e.nummer)} ${escapeHtml(e.bezeichnung)}</span>
          <span>CHF ${formatChf(e.saldo)}</span>
        </div>
      `).join('')}
    </div>
  `;
  return `
    <div class="report">
      ${reportHeader('Bilanz', jahr, v)}
      <div class="report-cols">
        <div>
          ${sec('Aktiven', b.aktiven)}
          <div class="report-line grand-total"><span>Total Aktiven</span><span>CHF ${formatChf(b.total_aktiven)}</span></div>
        </div>
        <div>
          ${sec('Passiven', b.passiven)}
          <div class="report-line total"><span>Vereinsvermögen</span><span>CHF ${formatChf(b.eigenkapital)}</span></div>
          <div class="report-line"><span>Jahresergebnis</span><span>CHF ${formatChf(b.jahresergebnis)}</span></div>
          <div class="report-line grand-total"><span>Total Passiven</span><span>CHF ${formatChf(b.total_passiven)}</span></div>
        </div>
      </div>
    </div>
  `;
}

function renderErfolg(er, jahr, v) {
  const sec = (title, eintraege) => `
    <div class="report-section">
      <h3>${title}</h3>
      ${eintraege.map((e) => `
        <div class="report-line">
          <span>${escapeHtml(e.nummer)} ${escapeHtml(e.bezeichnung)}</span>
          <span>CHF ${formatChf(e.saldo)}</span>
        </div>
      `).join('')}
    </div>
  `;
  const ergebnis = er.total_ertrag - er.total_aufwand;
  return `
    <div class="report">
      ${reportHeader('Erfolgsrechnung', jahr, v)}
      ${sec('Ertrag', er.ertrag)}
      <div class="report-line total"><span>Total Ertrag</span><span>CHF ${formatChf(er.total_ertrag)}</span></div>
      ${sec('Aufwand', er.aufwand)}
      <div class="report-line total"><span>Total Aufwand</span><span>CHF ${formatChf(er.total_aufwand)}</span></div>
      <div class="report-line grand-total"><span>${ergebnis >= 0 ? 'Gewinn' : 'Verlust'}</span><span>CHF ${formatChf(ergebnis)}</span></div>
    </div>
  `;
}

function renderKonto(k, jahr, v) {
  return `
    <div class="report">
      ${reportHeader(`Kontoauszug ${k.nummer} ${k.bezeichnung}`, jahr, v)}
      <table class="data">
        <thead>
          <tr>
            <th>Datum</th><th>Beleg</th><th>Beschreibung</th>
            <th>Gegenkonto</th>
            <th class="num">Soll</th><th class="num">Haben</th><th class="num">Saldo</th>
          </tr>
        </thead>
        <tbody>
          ${k.zeilen.map((z) => `
            <tr>
              <td>${formatDate(z.datum)}</td>
              <td>${escapeHtml(z.beleg_nr || '')}</td>
              <td>${escapeHtml(z.beschreibung)}</td>
              <td class="muted">${escapeHtml(z.gegenkonto)}</td>
              <td class="num">${z.soll ? formatChf(z.soll) : ''}</td>
              <td class="num">${z.haben ? formatChf(z.haben) : ''}</td>
              <td class="num">${formatChf(z.saldo)}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="4">Schlusssaldo</td>
            <td class="num">${formatChf(k.total_soll)}</td>
            <td class="num">${formatChf(k.total_haben)}</td>
            <td class="num">${formatChf(k.saldo)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}
