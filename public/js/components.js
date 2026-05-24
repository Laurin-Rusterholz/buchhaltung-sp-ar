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
