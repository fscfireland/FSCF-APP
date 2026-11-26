// The long (banner) logo with rounded corners and a little breathing room, for
// every PDF the app makes (owner, 26 Nov 2026). The picture is drawn a little
// smaller inside a rounded frame filled with the logo's own background colour
// (taken from its edge), so the artwork doesn't run into the corners. Made once
// from the logo in Settings and kept for the session; the saved logo itself is
// not changed.
const cache = new Map();
export async function roundLogo(lg, { radiusShare = 0.16, inset = 0.09 } = {}) {
  if (!lg?.data) return lg;
  const key = lg.data.length + ':' + lg.data.slice(-64) + ':' + radiusShare + ':' + inset;
  if (cache.has(key)) return cache.get(key);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = lg.data; });
    const w = img.naturalWidth || lg.w;
    const h = img.naturalHeight || lg.h;
    // the logo's background colour: the average of its outer edge pixels
    const probe = document.createElement('canvas');
    probe.width = w; probe.height = h;
    const pg = probe.getContext('2d', { willReadFrequently: true });
    pg.drawImage(img, 0, 0, w, h);
    const px = pg.getImageData(0, 0, w, h).data;
    let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;
    const take = (x, y) => { const i = (y * w + x) * 4; if (px[i + 3] > 200) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; } a++; };
    for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 60))) { take(x, Math.floor(h * 0.04)); take(x, h - 1 - Math.floor(h * 0.04)); }
    for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 20))) { take(Math.floor(w * 0.02), y); take(w - 1 - Math.floor(w * 0.02), y); }
    const fill = n > a * 0.5 ? `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})` : null; // a see-through logo gets no fill

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const rad = Math.max(2, Math.round(Math.min(w, h) * radiusShare));
    ctx.beginPath();
    ctx.moveTo(rad, 0); ctx.arcTo(w, 0, w, h, rad); ctx.arcTo(w, h, 0, h, rad); ctx.arcTo(0, h, 0, 0, rad); ctx.arcTo(0, 0, w, 0, rad);
    ctx.closePath();
    ctx.clip();
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, w, h); }
    // the same margin on every side, measured on the short side
    const m = Math.round(Math.min(w, h) * inset);
    const k = Math.min((w - 2 * m) / w, (h - 2 * m) / h);
    const dw = w * k; const dh = h * k;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    const out = { ...lg, data: c.toDataURL('image/png') };
    cache.set(key, out);
    return out;
  } catch {
    return lg; // if the picture cannot be read, use it as it is
  }
}
