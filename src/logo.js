// The long (banner) logo with rounded corners, for every PDF the app makes
// (owner, 26 Nov 2026). Made once from the logo in Settings and kept for the
// session; the saved logo itself is not changed.
const cache = new Map();
export async function roundLogo(lg, radiusShare = 0.14) {
  if (!lg?.data) return lg;
  const key = lg.data.length + ':' + lg.data.slice(-64) + ':' + radiusShare;
  if (cache.has(key)) return cache.get(key);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = lg.data; });
    const w = img.naturalWidth || lg.w;
    const h = img.naturalHeight || lg.h;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const r = Math.max(2, Math.round(Math.min(w, h) * radiusShare));
    g.beginPath();
    g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r);
    g.closePath();
    g.clip();
    g.drawImage(img, 0, 0, w, h);
    const out = { ...lg, data: c.toDataURL('image/png') };
    cache.set(key, out);
    return out;
  } catch {
    return lg; // if the picture cannot be read, use it as it is
  }
}
