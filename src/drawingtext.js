// Find fire doors in a CAD PDF's own text: ratings (FD30S, E60Sa…) with
// their positions, and the nearest room name. Free, and works offline.
// (Scanned drawings go to the drawing reader in drawingai.js.)

import { loadPdfJs } from './files.js';

const RATING_RE = /^(FD\s?(20|30|60|90|120)\s?S?|E\s?I?\s?(20|30|60|90|120)\s?-?\s?(S\s?a|Sa|S)?|(30|60|90|120)\s?\/\s?(30|60|90|120)\s?(S|FD)?)$/i;
const ROOM_SKIP = /^(\d+([.,]\d+)?\s*(m2|m²|mm|m)?|scale.*|rev.*|dwg.*|drawing.*|notes?|key|legend|north|date|drawn|checked|title|client|project|level|section|elevation|\W+)$/i;

// ---------- 1. Text in the PDF ----------
// For each page: { doors: [{x, y, rating, room, ref}], hasText }
export async function textDoors(file, maxPages = 30) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  try {
    for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => {
        const [vx, vy] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        return { s: it.str.trim(), x: vx / vp.width, y: vy / vp.height };
      });
      const rooms = items.filter((it) => it.s.length >= 3 && /[A-Za-z]{3}/.test(it.s) && !ROOM_SKIP.test(it.s) && !RATING_RE.test(it.s));
      const refs = items.filter((it) => /^(D|DR|FD)[-.\s]?\d{1,4}[A-Z]?$/i.test(it.s) && !RATING_RE.test(it.s.replace(/\s+/g, ' ')) && !/^FD\s?(20|30|60|90|120)S?$/i.test(it.s));
      const near = (list, p, max) => {
        let best = null;
        let bd = max;
        for (const q of list) {
          const d = Math.hypot(q.x - p.x, (q.y - p.y) * (vp.height / vp.width));
          if (d < bd) { bd = d; best = q; }
        }
        return best;
      };
      const doors = items.filter((it) => RATING_RE.test(it.s.replace(/\s+/g, ' '))).map((it) => ({
        x: it.x, y: it.y, rating: it.s.replace(/\s+/g, '').toUpperCase(),
        room: near(rooms, it, 0.15)?.s || '', ref: near(refs, it, 0.02)?.s || '',
      }));
      pages.push({ doors, hasText: items.length > 20 });
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  return pages;
}

