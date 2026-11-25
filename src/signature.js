// Signature pad: sign with a finger (or mouse) in a box. Returns a PNG
// trimmed to the ink, as { data, w, h }, or null if cancelled.

import { dialog, $ } from './ui.js';

export async function signaturePad({ title = 'Sign here', name = '', askName = true, saved = null } = {}) {
  let ink = false;
  let useSaved = false;
  const r = await dialog({
    title,
    body: `
      ${askName ? `<label class="field"><span>Name</span><input name="name" id="sig-name" value="${name.replace(/"/g, '&quot;')}" required placeholder="Full name"></label>` : ''}
      <div class="sig-wrap"><canvas id="sig-pad" aria-label="Signature box: sign with your finger"></canvas><span class="sig-line">Sign above the line</span></div>
      <div class="row-btns">
        <button type="button" class="btn sm" id="sig-clear">Clear</button>
        ${saved ? '<button type="button" class="btn sm" id="sig-saved">Use my saved signature</button>' : ''}
      </div>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Save signature', value: true, kind: 'primary' }],
    onOpen: (form) => {
      const c = $('#sig-pad', form);
      const box = c.getBoundingClientRect();
      const ratio = Math.max(2, window.devicePixelRatio || 1);
      c.width = Math.round((box.width || 320) * ratio);
      c.height = Math.round((box.height || 160) * ratio);
      const g = c.getContext('2d');
      g.scale(ratio, ratio);
      g.lineWidth = 2.4;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = '#10223a';
      let drawing = false;
      const pt = (e) => {
        const b = c.getBoundingClientRect();
        return [e.clientX - b.left, e.clientY - b.top];
      };
      c.addEventListener('pointerdown', (e) => {
        drawing = true;
        useSaved = false;
        c.setPointerCapture(e.pointerId);
        g.beginPath();
        g.moveTo(...pt(e));
        e.preventDefault();
      });
      c.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        g.lineTo(...pt(e));
        g.stroke();
        ink = true;
      });
      const end = () => (drawing = false);
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', end);
      $('#sig-clear', form).onclick = () => {
        g.clearRect(0, 0, c.width, c.height);
        ink = false;
        useSaved = false;
      };
      const sv = $('#sig-saved', form);
      if (sv) {
        sv.onclick = () => {
          const img = new Image();
          img.onload = () => {
            g.clearRect(0, 0, c.width, c.height);
            const bw = c.width / ratio;
            const bh = c.height / ratio;
            const k = Math.min((bw * 0.9) / img.width, (bh * 0.8) / img.height);
            g.drawImage(img, (bw - img.width * k) / 2, (bh - img.height * k) / 2, img.width * k, img.height * k);
            ink = true;
            useSaved = true;
          };
          img.src = saved.data;
        };
      }
      form._sig = c;
    },
  });
  if (r.value !== true) return null;
  if (useSaved && saved) return { ...saved, name: (r.data.name || name).trim() };
  if (!ink) return null;
  return { ...trim(r.form._sig), name: (r.data.name || name || '').trim() };
}

// Crop the canvas to the drawn part, with a small margin
function trim(c) {
  const g = c.getContext('2d');
  const { width: w, height: h } = c;
  const px = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return { data: c.toDataURL('image/png'), w, h };
  const m = 8;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w, x1 + m); y1 = Math.min(h, y1 + m);
  const out = document.createElement('canvas');
  out.width = x1 - x0;
  out.height = y1 - y0;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { data: out.toDataURL('image/png'), w: out.width, h: out.height };
}
