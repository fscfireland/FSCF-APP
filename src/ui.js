// Small UI helpers: icons, toasts, in-page dialogs and sheets.
import { escapeHtml } from './viewer.js';

export const esc = escapeHtml;

const P = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  up: '<path d="M5 15l7-7 7 7"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  play: '<path d="M8 5l11 7-11 7z" fill="currentColor"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  report: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 17v-3M12 17v-6M15 17v-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  pin: '<path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M20 20l-4-4"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-4-4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 9"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  plan: '<path d="M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2z"/><path d="M9 3v16M15 5v16"/>',
  sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  door: '<path d="M6 21V3h12v18"/><path d="M3 21h18"/><circle cx="14.5" cy="12" r="1"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}
export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

let toastTimer;
export function toast(msg, kind = '') {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.className = 'toast show ' + kind;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 2800);
}

// In-page modal dialog. Returns a promise of the button value clicked.
// `body` is HTML; inputs inside it can be read from the returned form.
export function dialog({ title, body = '', buttons = [{ label: 'OK', value: true, kind: 'primary' }], onOpen }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
      <form class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h2 class="modal-title">${esc(title)}</h2>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          ${buttons.map((b, i) => `<button type="${b.kind?.includes('primary') ? 'submit' : 'button'}" class="btn ${b.kind || 'ghost'}" data-i="${i}">${esc(b.label)}</button>`).join('')}
        </div>
      </form>`;
    document.body.append(wrap);
    const form = $('form', wrap);
    const done = (value) => {
      const data = Object.fromEntries(new FormData(form).entries());
      wrap.remove();
      resolve({ value, data, form });
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const b = buttons.find((x) => x.kind?.includes('primary'));
      done(b ? b.value : true);
    });
    $$('button[type=button]', wrap).forEach((btn) => btn.addEventListener('click', () => done(buttons[btn.dataset.i].value)));
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap) done(null);
    });
    onOpen?.(form);
    setTimeout(() => $('input, select, textarea', form)?.focus(), 50);
  });
}

export async function confirmBox(title, message, okLabel = 'Delete', danger = true) {
  const r = await dialog({
    title,
    body: `<p>${esc(message)}</p>`,
    buttons: [
      { label: 'Cancel', value: false },
      { label: okLabel, value: true, kind: danger ? 'primary danger' : 'primary' },
    ],
  });
  return r.value === true;
}

export function busy(msg) {
  let el = $('#busy');
  if (!el) {
    el = document.createElement('div');
    el.id = 'busy';
    el.className = 'busy';
    el.innerHTML = '<div class="busy-card"><div class="spinner"></div><p></p></div>';
    document.body.append(el);
  }
  el.hidden = false;
  $('p', el).textContent = msg;
  return {
    update: (m) => ($('p', el).textContent = m),
    done: () => (el.hidden = true),
  };
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
