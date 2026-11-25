// Videos: kept as recorded (phones can't re-compress video quickly in a
// browser), with a still frame grabbed for thumbnails and the PDF report.

import { thumbFromCanvas } from './files.js';

export const isVideo = (rec) => rec?.kind === 'video';

export function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtSize(bytes) {
  if (!bytes) return '';
  return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

// Grab a frame ~1 s in (or the middle of a short clip). If the browser
// can't decode the format, fall back to a plain "video" tile.
export async function videoInfo(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await withTimeout(once(v, 'loadedmetadata'), 8000);
    const duration = v.duration;
    v.currentTime = Math.min(1, (duration || 2) / 2);
    await withTimeout(once(v, 'seeked'), 8000);
    const c = document.createElement('canvas');
    c.width = v.videoWidth || 640;
    c.height = v.videoHeight || 360;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const thumb = await thumbFromCanvas(c, 640, 0.8);
    return { thumb, duration, width: v.videoWidth, height: v.videoHeight };
  } catch {
    return { thumb: await placeholderThumb(), duration: Number.isFinite(v.duration) ? v.duration : 0, width: 0, height: 0 };
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

function once(el, ev) {
  return new Promise((resolve, reject) => {
    el.addEventListener(ev, resolve, { once: true });
    el.addEventListener('error', () => reject(new Error('Video could not be read')), { once: true });
  });
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

async function placeholderThumb() {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  const g = c.getContext('2d');
  g.fillStyle = '#2b3640';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.font = '600 34px sans-serif';
  g.textAlign = 'center';
  g.fillText('Video', 320, 300);
  return thumbFromCanvas(c, 640, 0.8);
}

// A valid web link to the video, used to make the PDF thumbnail clickable
export function cleanLink(s) {
  const v = String(s || '').trim();
  if (!v) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : 'https://' + v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
}
