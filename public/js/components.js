// Wiederverwendbare UI-Komponenten: Modal, Toast, Confirm

import { $, escapeHtml } from './utils.js';

export function toast(message, type = 'info') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  }, 2800);
}

export function modal({ title, body, footer, onClose } = {}) {
  const root = $('#modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>${escapeHtml(title || '')}</h3>
        <button class="ghost" data-close>×</button>
      </div>
      <div class="modal-body"></div>
      <div class="modal-footer"></div>
    </div>
  `;
  root.appendChild(backdrop);

  const bodyEl = backdrop.querySelector('.modal-body');
  const footerEl = backdrop.querySelector('.modal-footer');

  if (body instanceof HTMLElement) bodyEl.appendChild(body);
  else if (typeof body === 'string') bodyEl.innerHTML = body;

  if (footer instanceof HTMLElement) footerEl.appendChild(footer);
  else if (typeof footer === 'string') footerEl.innerHTML = footer;

  const close = () => {
    backdrop.remove();
    onClose?.();
  };

  backdrop.querySelector('[data-close]').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  return { backdrop, bodyEl, footerEl, close };
}

export function confirmDialog(message, { confirmLabel = 'Löschen', danger = true } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title: 'Bestätigung',
      body: `<p>${escapeHtml(message)}</p>`,
      footer: `
        <button data-cancel>Abbrechen</button>
        <button class="${danger ? 'danger' : 'primary'}" data-ok>${escapeHtml(confirmLabel)}</button>
      `,
      onClose: () => resolve(false),
    });
    m.footerEl.querySelector('[data-cancel]').addEventListener('click', () => { m.close(); resolve(false); });
    m.footerEl.querySelector('[data-ok]').addEventListener('click', () => { m.backdrop.remove(); resolve(true); });
  });
}

// Verbessert ein bestehendes <select>-Element zu einer durchsuchbaren Combobox.
// Der User kann tippen (Nummer oder Bezeichnung), bekommt eine gefilterte
// Liste und wählt per Klick / Pfeiltasten / Enter. Das ursprüngliche <select>
// bleibt im DOM (versteckt), sodass jede bestehende Form-Lese-Logik
// (querySelector('[name="soll"]').value) unverändert funktioniert.
//
// Optionen-Format: Es werden die <option>-Elemente des Selects genutzt.
// .value ist der zu speichernde Wert (z.B. Kontonummer). .textContent ist
// das Such-/Anzeige-Label (z.B. "1020 Raiffeisenbank Heiden").
export function enhanceSelect(selectEl, { placeholder } = {}) {
  if (!selectEl || selectEl.dataset.enhanced === '1') return;
  selectEl.dataset.enhanced = '1';

  const options = Array.from(selectEl.options).map((o) => ({
    value: o.value,
    label: o.textContent.trim(),
    isPlaceholder: !o.value,
  }));

  const wrap = document.createElement('div');
  wrap.className = 'combo';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'combo-input';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = placeholder || (options.find((o) => o.isPlaceholder)?.label) || 'Suchen…';
  const list = document.createElement('div');
  list.className = 'combo-list hidden';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'combo-clear';
  clearBtn.innerHTML = '×';
  clearBtn.title = 'Auswahl zurücksetzen';
  clearBtn.tabIndex = -1;
  wrap.appendChild(input);
  wrap.appendChild(clearBtn);
  wrap.appendChild(list);

  selectEl.style.display = 'none';
  selectEl.insertAdjacentElement('afterend', wrap);

  let highlighted = -1;
  let filtered = options;

  function setValue(val) {
    selectEl.value = val;
    const opt = options.find((o) => o.value === val);
    input.value = opt && !opt.isPlaceholder ? opt.label : '';
    clearBtn.style.display = val ? 'flex' : 'none';
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function openList() {
    renderList();
    list.classList.remove('hidden');
    highlighted = filtered.findIndex((o) => o.value === selectEl.value);
    updateHighlight();
  }
  function closeList() {
    list.classList.add('hidden');
    highlighted = -1;
    // Falls Input nicht zu einer gültigen Auswahl passt → zurücksetzen auf
    // den aktuellen Wert (damit der User keinen halben Suchstring liegen lässt).
    const opt = options.find((o) => o.value === selectEl.value);
    input.value = opt && !opt.isPlaceholder ? opt.label : '';
  }
  function filter(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) filtered = options.filter((o) => !o.isPlaceholder);
    else filtered = options.filter((o) => !o.isPlaceholder && o.label.toLowerCase().includes(q));
    renderList();
    highlighted = filtered.length > 0 ? 0 : -1;
    updateHighlight();
  }
  function renderList() {
    if (filtered.length === 0) {
      list.innerHTML = '<div class="combo-empty">keine Treffer</div>';
      return;
    }
    list.innerHTML = filtered.map((o, i) => {
      const isSel = o.value === selectEl.value;
      return `<div class="combo-opt${isSel ? ' selected' : ''}" data-i="${i}">${escapeHtml(o.label)}</div>`;
    }).join('');
    Array.from(list.children).forEach((child) => {
      const i = Number(child.dataset.i);
      if (Number.isFinite(i)) {
        child.addEventListener('mousedown', (e) => {
          e.preventDefault();
          setValue(filtered[i].value);
          closeList();
        });
        child.addEventListener('mousemove', () => {
          highlighted = i;
          updateHighlight();
        });
      }
    });
  }
  function updateHighlight() {
    Array.from(list.children).forEach((child, i) => {
      child.classList.toggle('highlight', i === highlighted);
    });
    const el = list.children[highlighted];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('focus', () => {
    filtered = options.filter((o) => !o.isPlaceholder);
    openList();
  });
  input.addEventListener('input', () => filter(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.classList.contains('hidden')) openList();
      else { highlighted = Math.min(filtered.length - 1, highlighted + 1); updateHighlight(); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlighted = Math.max(0, highlighted - 1);
      updateHighlight();
    } else if (e.key === 'Enter') {
      if (highlighted >= 0 && filtered[highlighted]) {
        e.preventDefault();
        setValue(filtered[highlighted].value);
        closeList();
        input.blur();
      }
    } else if (e.key === 'Escape') {
      closeList();
      input.blur();
    } else if (e.key === 'Tab') {
      if (highlighted >= 0 && filtered[highlighted] && !list.classList.contains('hidden')) {
        setValue(filtered[highlighted].value);
      }
      closeList();
    }
  });
  // Klick ausserhalb schliesst
  document.addEventListener('mousedown', (e) => {
    if (!wrap.contains(e.target)) closeList();
  });
  clearBtn.addEventListener('click', (e) => {
    e.preventDefault();
    setValue('');
    input.focus();
  });

  // Externe value-Änderungen am Select reflektieren (z.B. KI-Auto-Fill)
  const observer = new MutationObserver(() => {
    const opt = options.find((o) => o.value === selectEl.value);
    input.value = opt && !opt.isPlaceholder ? opt.label : '';
    clearBtn.style.display = selectEl.value ? 'flex' : 'none';
  });
  observer.observe(selectEl, { attributes: true, attributeFilter: ['value'] });
  // Setter-Hijack: wenn Code .value = X setzt, soll die UI auch refreshen.
  const valDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(selectEl, 'value', {
    get() { return valDesc.get.call(this); },
    set(v) {
      valDesc.set.call(this, v);
      const opt = options.find((o) => o.value === v);
      input.value = opt && !opt.isPlaceholder ? opt.label : '';
      clearBtn.style.display = v ? 'flex' : 'none';
    },
    configurable: true,
  });

  // Initial-Sync (falls bei der Erstellung schon ein Wert da war)
  setValue(selectEl.value);
}
