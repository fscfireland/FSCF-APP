// Files in and out: turning PDFs and photos into compressed images,
// loading third-party libraries on demand, and saving exported files.

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

const loaded = {};
export function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => {
        delete loaded[src];
        reject(new Error('Could not load ' + src.split('/').pop() + '. Connect to the internet once so the app can save it for offline use.'));
      };
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

export async function loadSheetJS() {
  await loadScript(SHEETJS);
  return window.XLSX;
}

async function loadPdfJs() {
  await loadScript(PDFJS);
  const lib = window.pdfjsLib;
  if (!lib.GlobalWorkerOptions.workerPort && !lib.GlobalWorkerOptions.workerSrc) {
    // Run the PDF worker from a same-origin blob so it works everywhere.
    try {
      const blob = new Blob([`importScripts(${JSON.stringify(PDFJS_WORKER)});`], { type: 'text/javascript' });
      lib.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(blob));
    } catch {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    }
  }
  return lib;
}

// Phones (especially iPhones) refuse canvases over ~16.7 million pixels.
const MAX_SIDE = 4096;
const MAX_PIXELS = 16_000_000;

function fitSize(w, h, maxSide, maxPixels = Infinity) {
  let scale = Math.min(1, maxSide / Math.max(w, h));
  if (w * h * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (w * h));
  return { w: Math.round(w * scale), h: Math.round(h * scale), scale };
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create image'))), type, quality)
  );
}

export async function thumbFromCanvas(src, maxSide = 480, quality = 0.8) {
  const sw = src.width;
  const sh = src.height;
  const { w, h } = fitSize(sw, sh, maxSide);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(src, 0, 0, w, h);
  return canvasToBlob(c, 'image/jpeg', quality);
}

async function decodeImage(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// Resize an image file into a JPEG no bigger than maxSide.
export async function compressImage(file, maxSide, quality) {
  const img = await decodeImage(file);
  const iw = img.width || img.naturalWidth;
  const ih = img.height || img.naturalHeight;
  const { w, h } = fitSize(iw, ih, maxSide, MAX_PIXELS);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  img.close?.();
  const blob = await canvasToBlob(c, 'image/jpeg', quality);
  const thumb = await thumbFromCanvas(c, 320, 0.75);
  return { blob, thumb, width: w, height: h };
}

// The text of a PDF as lines (top to bottom), for reading checklists out of
// reports. Reads at most `maxPages` pages.
export async function pdfLines(file, maxPages = 40) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines = [];
  try {
    for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const rows = new Map();
      for (const it of tc.items) {
        if (!it.str) continue;
        const y = Math.round(it.transform[5] / 2) * 2;
        (rows.get(y) || rows.set(y, []).get(y)).push(it);
      }
      for (const y of [...rows.keys()].sort((a, b) => b - a)) {
        lines.push(rows.get(y).sort((a, b) => a.transform[4] - b.transform[4]).map((x) => x.str).join(' ').replace(/\s+/g, ' ').trim());
      }
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  // join wrapped question lines: a line that doesn't end a sentence continues on the next
  const out = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev && !/[?.:)]$/.test(prev) && /^[a-z(]/.test(l)) out[out.length - 1] = prev + ' ' + l;
    else out.push(l);
  }
  return out;
}

// Small picture of a PDF's first page, for the Files list.
export async function pdfThumb(file) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const page = await pdf.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 320 / Math.max(vp1.width, vp1.height) });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    return { thumb: await canvasToBlob(c, 'image/jpeg', 0.75), pages: pdf.numPages };
  } finally {
    await pdf.destroy();
  }
}

// Turn an uploaded drawing (PDF or image) into one or more plan images.
// Returns [{ name, blob, thumb, width, height }]
export async function importDrawing(file, onProgress = () => {}) {
  const base = file.name.replace(/\.[^.]+$/, '');
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    onProgress('Processing image…');
    const r = await compressImage(file, MAX_SIDE, 0.9);
    return [{ name: base, ...r }];
  }
  onProgress('Opening PDF…');
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress(`Rendering page ${i} of ${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    // Render each page at the largest size phones can handle, for crisp zooming
    const s = Math.min(MAX_SIDE / Math.max(vp1.width, vp1.height), Math.sqrt(MAX_PIXELS / (vp1.width * vp1.height)));
    const vp = page.getViewport({ scale: s });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    const blob = await canvasToBlob(c, 'image/jpeg', 0.9);
    const thumb = await thumbFromCanvas(c);
    out.push({ name: pdf.numPages > 1 ? `${base} – p${i}` : base, blob, thumb, width: c.width, height: c.height });
    c.width = c.height = 0; // free memory on phones
    page.cleanup();
  }
  await pdf.destroy();
  return out;
}

// Save a generated file. Inside the Claude app the page asks the viewer to
// confirm the download; as an installed web app it downloads normally.
export async function saveFile(filename, blob) {
  if (window.claude?.use) {
    const downloads = await window.claude.use('downloads');
    if (downloads) {
      try {
        await downloads.save({ filename, data: blob });
        return 'saved';
      } catch (e) {
        if (e?.code === 'declined') return 'declined';
        throw new Error(e?.message || 'The file could not be saved here.');
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'saved';
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function base64ToBlob(b64, type = 'image/jpeg') {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function safeName(s) {
  return String(s || 'export').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'export';
}
