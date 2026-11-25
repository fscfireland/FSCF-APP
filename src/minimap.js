// Small location map for a door: a close-up of its drawing with the door's
// pin highlighted, other pins faint and markups shown. Used on the door
// record and the Repairs tab.

import { drawOnCanvas } from './markup.js';

const bitmaps = new Map(); // plan id + version → decoded drawing
const urls = new Map(); // door position + drawing version → image URL

async function bitmapFor(plan) {
  const key = plan.id + plan.updatedAt;
  if (!bitmaps.has(key)) bitmaps.set(key, createImageBitmap(plan.blob));
  return bitmaps.get(key);
}

export async function doorMapURL(plan, door, others = [], color = '#cc2a1f', { w = 560, h = 360, span = 0.4 } = {}) {
  const key = [door.id, door.x, door.y, door.status, plan.id, plan.updatedAt, w].join('|');
  if (urls.has(key)) return urls.get(key);
  const bmp = await bitmapFor(plan);
  // crop a window around the pin, kept inside the drawing
  const cw = Math.min(plan.width, Math.round(Math.max(plan.width, plan.height) * span));
  const ch = Math.min(plan.height, Math.round((cw * h) / w));
  const cx = Math.min(Math.max(0, door.x * plan.width - cw / 2), Math.max(0, plan.width - cw));
  const cy = Math.min(Math.max(0, door.y * plan.height - ch / 2), Math.max(0, plan.height - ch));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const k = w / cw;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(bmp, cx, cy, cw, ch, 0, 0, w, h);
  g.save();
  g.translate(-cx * k, -cy * k);
  drawOnCanvas(g, plan, plan.markups, k);
  g.restore();
  // other doors as small faint dots, this door as a large pin
  for (const o of others) {
    if (o.id === door.id || o.x == null) continue;
    g.beginPath();
    g.arc((o.x * plan.width - cx) * k, (o.y * plan.height - cy) * k, 7, 0, Math.PI * 2);
    g.fillStyle = 'rgba(90,107,122,0.55)';
    g.fill();
  }
  const px = (door.x * plan.width - cx) * k;
  const py = (door.y * plan.height - cy) * k;
  g.beginPath();
  g.arc(px, py, 30, 0, Math.PI * 2);
  g.fillStyle = 'rgba(204,42,31,0.18)';
  g.fill();
  g.beginPath();
  g.arc(px, py, 17, 0, Math.PI * 2);
  g.fillStyle = '#fff';
  g.fill();
  g.beginPath();
  g.arc(px, py, 14, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.fillStyle = '#fff';
  g.font = `700 ${String(door.pinNo).length > 2 ? 11 : 14}px Helvetica, Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(door.pinNo ?? ''), px, py + 1);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  return url;
}
