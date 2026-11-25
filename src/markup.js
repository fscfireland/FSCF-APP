// Plan markups, like Fieldwire's: lines, arrows, freehand pen, text bubbles,
// shaded boxes and areas, and measurements.
//
// Markups are stored on the plan (`plan.markups`), with points as fractions
// of the drawing's width and height (0–1) like pins. Measuring works from a
// guide: the first measure line you draw is given its real length, which sets
// `plan.scale` (metres per drawing pixel); every later line and shaded area is
// then measured automatically.

import { esc } from './ui.js';

export const MK_COLORS = ['#d32f2f', '#f57c00', '#fbc02d', '#2e7d32', '#1565c0', '#6a1b9a', '#1b2733'];
export const TOOLS = [
  { id: 'select', label: 'Select' },
  { id: 'line', label: 'Line' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'pen', label: 'Pen' },
  { id: 'text', label: 'Text' },
  { id: 'rect', label: 'Box' },
  { id: 'area', label: 'Area' },
  { id: 'measure', label: 'Measure' },
];
export const TEXT_SIZES = { S: 0.014, M: 0.02, L: 0.03 };

// ---------- measuring ----------
const pxLen = (plan, a, b) => Math.hypot((b[0] - a[0]) * plan.width, (b[1] - a[1]) * plan.height);

function pxArea(plan, pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * plan.width * y2 * plan.height - x2 * plan.width * y1 * plan.height;
  }
  return Math.abs(s) / 2;
}

export function fmtLength(m) {
  if (!Number.isFinite(m)) return '';
  if (m < 1) return `${Math.round(m * 1000)} mm`;
  return `${m.toFixed(m < 10 ? 2 : 1)} m`;
}
const fmtArea = (m2) => `${m2 < 10 ? m2.toFixed(2) : m2.toFixed(1)} m²`;

export function measureText(plan, mk) {
  if (!plan.scale) return mk.type === 'measure' ? 'Set scale' : '';
  if (mk.type === 'measure') return fmtLength(pxLen(plan, mk.pts[0], mk.pts[1]) * plan.scale) + (mk.guide ? ' (guide)' : '');
  if (mk.type === 'area' || mk.type === 'rect') {
    const pts = mk.type === 'rect' ? rectPts(mk) : mk.pts;
    return mk.showArea === false ? '' : fmtArea(pxArea(plan, pts) * plan.scale * plan.scale);
  }
  return '';
}

export const lineLengthPx = pxLen;

function rectPts(mk) {
  const [[x1, y1], [x2, y2]] = mk.pts;
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}

function centroid(pts) {
  const x = pts.reduce((t, p) => t + p[0], 0) / pts.length;
  const y = pts.reduce((t, p) => t + p[1], 0) / pts.length;
  return [x, y];
}

// ---------- shared geometry (used by both the screen and the PDF) ----------
function shapes(plan, mk) {
  const W = plan.width;
  const H = plan.height;
  const P = (p) => [p[0] * W, p[1] * H];
  const big = Math.max(W, H);
  const out = { lines: [], polys: [], labels: [], arrows: [], paths: [], boxes: [] };
  const label = (text, at, size = big * 0.016) => text && out.labels.push({ text, x: at[0], y: at[1], size });
  switch (mk.type) {
    case 'line':
    case 'arrow': {
      const [a, b] = mk.pts.map(P);
      out.lines.push([a, b]);
      if (mk.type === 'arrow') {
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const L = big * 0.014;
        out.arrows.push([b, [b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45)], [b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45)]]);
      }
      break;
    }
    case 'pen':
      out.paths.push(mk.pts.map(P));
      break;
    case 'rect':
    case 'area': {
      const pts = (mk.type === 'rect' ? rectPts(mk) : mk.pts).map(P);
      out.polys.push(pts);
      label(measureText(plan, mk), P(centroid(mk.type === 'rect' ? rectPts(mk) : mk.pts)));
      break;
    }
    case 'measure': {
      const [a, b] = mk.pts.map(P);
      out.lines.push([a, b]);
      // end ticks, square to the line
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2;
      const T = big * 0.006;
      for (const e of [a, b]) out.lines.push([[e[0] - T * Math.cos(ang), e[1] - T * Math.sin(ang)], [e[0] + T * Math.cos(ang), e[1] + T * Math.sin(ang)]]);
      label(measureText(plan, mk), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      break;
    }
    case 'text': {
      const size = big * (TEXT_SIZES[mk.size] || TEXT_SIZES.M);
      const lines = String(mk.text || '').split('\n');
      const at = P(mk.pts[mk.pts.length - 1]);
      const w = Math.max(...lines.map((l) => l.length)) * size * 0.56 + size;
      const h = lines.length * size * 1.25 + size * 0.5;
      if (mk.pts.length > 1) out.lines.push([P(mk.pts[0]), at]); // leader to the item
      out.boxes.push({ x: at[0] - w / 2, y: at[1] - h / 2, w, h, r: size * 0.35, lines, size });
      break;
    }
  }
  return out;
}

// ---------- screen (SVG) ----------
export function renderSvg(svg, plan, markups, selectedId, draft) {
  const big = Math.max(plan.width, plan.height);
  const parts = [];
  const all = draft ? [...markups, { ...draft, id: '__draft' }] : markups;
  for (const mk of all) {
    const sh = shapes(plan, mk);
    const c = mk.color || MK_COLORS[0];
    const sel = mk.id === selectedId;
    const g = [];
    for (const pts of sh.polys) {
      const d = pts.map((p) => p.join(',')).join(' ');
      g.push(`<polygon points="${d}" fill="${c}" fill-opacity="0.22" stroke="${c}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`);
    }
    if (mk.id === '__draft' && mk.type === 'area' && mk.pts.length) {
      // the open shape while tapping corners, with a dot on the first corner
      const p0 = [mk.pts[0][0] * plan.width, mk.pts[0][1] * plan.height];
      g.push(`<circle cx="${p0[0]}" cy="${p0[1]}" r="${big * 0.006}" fill="${c}"/>`);
    }
    for (const [a, b] of sh.lines) {
      g.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="transparent" stroke-width="22" vector-effect="non-scaling-stroke" class="mk-hit"/>`);
      g.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${c}" stroke-width="3" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`);
    }
    for (const pts of sh.paths) {
      const d = 'M' + pts.map((p) => p.join(',')).join(' L');
      g.push(`<path d="${d}" fill="none" stroke="transparent" stroke-width="22" vector-effect="non-scaling-stroke" class="mk-hit"/>`);
      g.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`);
    }
    for (const tri of sh.arrows) g.push(`<polygon points="${tri.map((p) => p.join(',')).join(' ')}" fill="${c}"/>`);
    for (const bx of sh.boxes) {
      g.push(`<rect x="${bx.x}" y="${bx.y}" width="${bx.w}" height="${bx.h}" rx="${bx.r}" fill="#fff" stroke="${c}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`);
      bx.lines.forEach((ln, i) => g.push(`<text x="${bx.x + bx.w / 2}" y="${bx.y + bx.size * 0.25 + (i + 1) * bx.size * 1.2}" font-size="${bx.size}" text-anchor="middle" fill="#15212c" font-family="Helvetica, Arial, sans-serif" font-weight="600">${esc(ln)}</text>`));
    }
    for (const lb of sh.labels) {
      const w = lb.text.length * lb.size * 0.56 + lb.size * 0.6;
      g.push(`<rect x="${lb.x - w / 2}" y="${lb.y - lb.size * 0.75}" width="${w}" height="${lb.size * 1.4}" rx="${lb.size * 0.3}" fill="#fff" fill-opacity="0.92" stroke="${c}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`);
      g.push(`<text x="${lb.x}" y="${lb.y + lb.size * 0.35}" font-size="${lb.size}" text-anchor="middle" fill="#15212c" font-family="Helvetica, Arial, sans-serif" font-weight="700">${esc(lb.text)}</text>`);
    }
    parts.push(`<g data-mk="${esc(mk.id)}" class="mk${sel ? ' is-sel' : ''}">${g.join('')}</g>`);
  }
  svg.innerHTML = parts.join('');
}

// ---------- PDF (canvas) ----------
export function drawOnCanvas(g, plan, markups, k) {
  // k = canvas pixels per drawing pixel
  const big = Math.max(plan.width, plan.height);
  const lw = Math.max(2, big * 0.0018 * k);
  for (const mk of markups || []) {
    const sh = shapes(plan, mk);
    const c = mk.color || MK_COLORS[0];
    const S = (p) => [p[0] * k, p[1] * k];
    g.lineWidth = lw;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = c;
    for (const pts of sh.polys) {
      g.beginPath();
      pts.map(S).forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p)));
      g.closePath();
      g.globalAlpha = 0.22;
      g.fillStyle = c;
      g.fill();
      g.globalAlpha = 1;
      g.stroke();
    }
    for (const [a, b] of sh.lines) {
      g.beginPath();
      g.moveTo(...S(a));
      g.lineTo(...S(b));
      g.stroke();
    }
    for (const pts of sh.paths) {
      g.beginPath();
      pts.map(S).forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p)));
      g.stroke();
    }
    for (const tri of sh.arrows) {
      g.beginPath();
      tri.map(S).forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p)));
      g.closePath();
      g.fillStyle = c;
      g.fill();
    }
    for (const bx of sh.boxes) {
      g.fillStyle = '#fff';
      g.beginPath();
      g.roundRect ? g.roundRect(bx.x * k, bx.y * k, bx.w * k, bx.h * k, bx.r * k) : g.rect(bx.x * k, bx.y * k, bx.w * k, bx.h * k);
      g.fill();
      g.stroke();
      g.fillStyle = '#15212c';
      g.font = `600 ${bx.size * k}px Helvetica, Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      bx.lines.forEach((ln, i) => g.fillText(ln, (bx.x + bx.w / 2) * k, (bx.y + bx.size * 0.25 + (i + 1) * bx.size * 1.2) * k));
    }
    for (const lb of sh.labels) {
      const size = lb.size * k;
      g.font = `700 ${size}px Helvetica, Arial, sans-serif`;
      const w = g.measureText(lb.text).width + size * 0.6;
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.beginPath();
      g.rect(lb.x * k - w / 2, lb.y * k - size * 0.75, w, size * 1.4);
      g.fill();
      g.lineWidth = Math.max(1, lw / 2);
      g.stroke();
      g.lineWidth = lw;
      g.fillStyle = '#15212c';
      g.textAlign = 'center';
      g.fillText(lb.text, lb.x * k, lb.y * k + size * 0.35);
    }
  }
}
