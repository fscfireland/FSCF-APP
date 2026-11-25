// Photo markup: draw arrows, lines, circles, boxes, freehand and text on a
// photo to point out a defect. The original photo is kept; the markup is
// stored as shapes (so it can be edited again) plus a finished image used in
// the app and the reports.

import { icon, esc, dialog, $, $$ } from './ui.js';
import { thumbFromCanvas } from './files.js';

const COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#ffffff', '#111111'];
const TOOLS = [
  ['arrow', 'Arrow', 'arrowTool'],
  ['line', 'Line', 'lineTool'],
  ['circle', 'Circle', 'circle'],
  ['box', 'Box', 'box'],
  ['pen', 'Pen', 'penTool'],
  ['text', 'Text', 'textTool'],
];

async function loadImage(blob) {
  if (window.createImageBitmap) return createImageBitmap(blob);
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  return img;
}

// Draw all marks onto a canvas context; coordinates are in image pixels
export function drawMarks(g, marks, w, h) {
  const big = Math.max(w, h);
  const lw = Math.max(3, big * 0.006);
  for (const m of marks) {
    g.save();
    g.strokeStyle = m.color;
    g.fillStyle = m.color;
    g.lineWidth = lw;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // a thin dark halo keeps light colours visible on bright photos
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = lw * 0.8;
    const [a, b] = [m.pts[0], m.pts[m.pts.length - 1]];
    if (m.type === 'line' || m.type === 'arrow') {
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
      if (m.type === 'arrow') {
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const L = lw * 5;
        g.beginPath();
        g.moveTo(b[0], b[1]);
        g.lineTo(b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45));
        g.lineTo(b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45));
        g.closePath();
        g.fill();
      }
    } else if (m.type === 'box') {
      g.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    } else if (m.type === 'circle') {
      g.beginPath();
      g.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2 || 1, Math.abs(b[1] - a[1]) / 2 || 1, 0, 0, Math.PI * 2);
      g.stroke();
    } else if (m.type === 'pen') {
      g.beginPath();
      m.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.stroke();
    } else if (m.type === 'text') {
      const size = big * 0.045;
      g.font = `700 ${size}px Helvetica, Arial, sans-serif`;
      g.textBaseline = 'top';
      const lines = String(m.text || '').split('\n');
      const tw = Math.max(...lines.map((l) => g.measureText(l).width));
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(a[0] - size * 0.25, a[1] - size * 0.2, tw + size * 0.5, lines.length * size * 1.2 + size * 0.3);
      g.fillStyle = m.color === '#111111' ? '#ffffff' : m.color;
      lines.forEach((l, i) => g.fillText(l, a[0], a[1] + i * size * 1.2));
    }
    g.restore();
  }
}

// Opens the editor; resolves to { marks, marked, thumb } or null if cancelled
export function markupPhoto(photo) {
  return new Promise(async (resolve) => {
    const bmp = await loadImage(photo.blob);
    const W = bmp.width;
    const H = bmp.height;
    const marks = (photo.marks || []).map((m) => ({ ...m, pts: m.pts.map((p) => [...p]) }));
    let tool = 'arrow';
    let color = COLORS[0];
    let draft = null;

    const wrap = document.createElement('div');
    wrap.className = 'pm-wrap';
    wrap.innerHTML = `
      <div class="pm-bar">
        <button class="btn ghost" id="pm-cancel">Cancel</button>
        <b>Mark up photo</b>
        <button class="btn primary" id="pm-save">Save</button>
      </div>
      <div class="pm-stage"><canvas id="pm-canvas"></canvas></div>
      <div class="pm-tools">
        <div class="pm-row">${TOOLS.map(([id, label, ic]) => `<button class="mk-tool ${id === tool ? 'is-on' : ''}" data-t="${id}">${icon(ic)}<span>${label}</span></button>`).join('')}</div>
        <div class="pm-row">
          <span class="mk-colors">${COLORS.map((c) => `<button class="mk-color ${c === color ? 'is-on' : ''}" data-c="${c}" style="--c:${c}" aria-label="Colour"></button>`).join('')}</span>
          <button class="icon-btn" id="pm-undo" aria-label="Undo">${icon('undo')}</button>
          <button class="btn ghost sm danger-text" id="pm-clear">Clear all</button>
        </div>
      </div>`;
    document.body.append(wrap);
    const c = $('#pm-canvas', wrap);
    const stage = $('.pm-stage', wrap);
    const g = c.getContext('2d');
    let k = 1;
    const fit = () => {
      const r = stage.getBoundingClientRect();
      k = Math.min(r.width / W, r.height / H);
      const ratio = window.devicePixelRatio || 1;
      c.style.width = W * k + 'px';
      c.style.height = H * k + 'px';
      c.width = Math.round(W * k * ratio);
      c.height = Math.round(H * k * ratio);
      g.setTransform((c.width / W), 0, 0, (c.height / H), 0, 0);
      draw();
    };
    const draw = () => {
      g.drawImage(bmp, 0, 0, W, H);
      drawMarks(g, draft ? [...marks, draft] : marks, W, H);
    };
    const pt = (e) => {
      const r = c.getBoundingClientRect();
      return [Math.max(0, Math.min(W, ((e.clientX - r.left) / r.width) * W)), Math.max(0, Math.min(H, ((e.clientY - r.top) / r.height) * H))];
    };
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      const p = pt(e);
      if (tool === 'text') return; // placed on lift
      draft = { type: tool, color, pts: [p, p] };
      if (tool === 'pen') draft.pts = [p];
    });
    c.addEventListener('pointermove', (e) => {
      if (!draft) return;
      const p = pt(e);
      if (tool === 'pen') draft.pts.push(p);
      else draft.pts[1] = p;
      draw();
    });
    c.addEventListener('pointerup', async (e) => {
      const p = pt(e);
      if (tool === 'text') {
        const r = await dialog({
          title: 'Text on photo',
          body: '<label class="field"><span>Text</span><textarea name="text" id="pm-text" rows="2" required placeholder="e.g. Gap 6 mm"></textarea></label>',
          buttons: [{ label: 'Cancel', value: false }, { label: 'Add', value: true, kind: 'primary' }],
        });
        if (r.value === true && r.data.text.trim()) marks.push({ type: 'text', color, pts: [p], text: r.data.text.trim() });
        return draw();
      }
      if (!draft) return;
      const d = draft;
      draft = null;
      const [a, b] = [d.pts[0], d.pts[d.pts.length - 1]];
      if (d.type === 'pen' ? d.pts.length > 2 : Math.hypot(b[0] - a[0], b[1] - a[1]) > Math.max(W, H) * 0.01) marks.push(d);
      draw();
    });
    $$('.mk-tool', wrap).forEach((b) => (b.onclick = () => {
      tool = b.dataset.t;
      $$('.mk-tool', wrap).forEach((x) => x.classList.toggle('is-on', x === b));
    }));
    $$('.mk-color', wrap).forEach((b) => (b.onclick = () => {
      color = b.dataset.c;
      $$('.mk-color', wrap).forEach((x) => x.classList.toggle('is-on', x === b));
    }));
    $('#pm-undo', wrap).onclick = () => {
      marks.pop();
      draw();
    };
    $('#pm-clear', wrap).onclick = () => {
      marks.length = 0;
      draw();
    };
    const done = (v) => {
      window.removeEventListener('resize', fit);
      wrap.remove();
      resolve(v);
    };
    $('#pm-cancel', wrap).onclick = () => done(null);
    $('#pm-save', wrap).onclick = async () => {
      if (!marks.length) return done({ marks: [], marked: null, thumb: null });
      // full-size finished image for the app and the reports
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const og = out.getContext('2d');
      og.drawImage(bmp, 0, 0, W, H);
      drawMarks(og, marks, W, H);
      const marked = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.88));
      const thumb = await thumbFromCanvas(out, 320, 0.75);
      done({ marks, marked, thumb });
    };
    window.addEventListener('resize', fit);
    requestAnimationFrame(fit);
  });
}

// Rebuild a thumbnail from the original photo (when markup is cleared)
export async function plainThumb(photo) {
  const bmp = await loadImage(photo.blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return thumbFromCanvas(c, 320, 0.75);
}

export const _esc = esc;
