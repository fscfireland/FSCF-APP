// Project files: certificates, O&M manuals, quotes, reports and any other
// documents kept with a project. Stored on the phone (IndexedDB) like
// everything else, so they open with no signal, and ready to sync later.

import * as db from './db.js';
import { compressImage, pdfThumb, saveFile } from './files.js';

export const LIB = 'library'; // projectId of the private 'My files' library
export const DEFAULT_LIB_FOLDERS = ['General', 'Technical guidance', 'Certificates', 'Product data', 'Templates', 'RAMS', 'Reports', 'Other'];
export const DEFAULT_FILE_FOLDERS = ['Certificates', 'O&M manuals', 'Reports', 'Drawings', 'Quotes & orders', 'Photos', 'Other'];

export function fileFolders(project, files = []) {
  const list = project.fileFolders?.length ? project.fileFolders : DEFAULT_FILE_FOLDERS;
  const extra = files.map((f) => f.folder).filter((f) => f && !list.includes(f));
  return [...list, ...new Set(extra)];
}

// Sort a new upload into a sensible folder by its name and type.
export function guessFolder(name, type, folders) {
  const n = name.toLowerCase();
  const rules = [
    [/cert|certificate|\bcoc\b|declaration|dop\b|test/, 'Certificates'],
    [/o&m|o ?and ?m|manual|datasheet|data sheet|spec/, 'O&M manuals'],
    [/\brams\b|method statement|risk assessment/, 'RAMS'],
    [/report|inspection|survey|audit/, 'Reports'],
    [/drawing|plan|layout|\bdwg\b|elevation|fire ?cert/, 'Drawings'],
    [/quote|quotation|order|\bpo\b|invoice|price|tender/, 'Quotes & orders'],
  ];
  for (const [re, f] of rules) if (re.test(n) && folders.includes(f)) return f;
  if (type.startsWith('image/') && folders.includes('Photos')) return 'Photos';
  return null;
}

export function fileKind(rec) {
  const t = rec.type || '';
  const n = (rec.name || '').toLowerCase();
  if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (/\.(xlsx?|csv|ods)$/.test(n)) return 'sheet';
  if (/\.(docx?|odt|rtf|txt)$/.test(n)) return 'doc';
  if (/\.(dwg|dxf)$/.test(n)) return 'cad';
  return 'other';
}

export const KIND_LABEL = { pdf: 'PDF', image: 'Image', video: 'Video', sheet: 'Spreadsheet', doc: 'Document', cad: 'CAD', other: 'File' };

export async function projectFiles(projectId) {
  const rows = await db.byIndex('files', 'projectId', projectId);
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Save uploaded files to a project. `folder` null means sort automatically.
export async function addFiles(project, fileList, folder, onProgress = () => {}, extra = {}) {
  const folders = fileFolders(project);
  const out = [];
  let i = 0;
  for (const file of fileList) {
    i++;
    onProgress(`Saving ${i} of ${fileList.length}: ${file.name}`);
    const type = file.type || '';
    const rec = {
      id: db.uid(),
      projectId: project.id,
      name: file.name,
      folder: folder || guessFolder(file.name, type, folders) || 'Other',
      type,
      size: file.size,
      blob: file,
      notes: '',
      ...extra,
    };
    const kind = fileKind(rec);
    try {
      if (kind === 'image') rec.thumb = (await compressImage(file, 320, 0.75)).blob;
      else if (kind === 'pdf') Object.assign(rec, await pdfThumb(file));
    } catch {
      /* no preview — the file is still saved */
    }
    // Store a plain copy so the file survives even if the original is moved
    rec.blob = new Blob([await file.arrayBuffer()], { type });
    out.push(await db.put('files', rec));
  }
  return out;
}

// Open a file to view it. Installed app: new tab (PDFs and pictures show
// straight away). Inside the Claude app: save it to the phone instead.
export async function openFile(rec) {
  if (window.claude?.use) return saveFile(rec.name, rec.blob);
  const url = URL.createObjectURL(rec.blob);
  const w = window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
  if (!w) return saveFile(rec.name, rec.blob);
  return 'opened';
}

export function downloadFile(rec) {
  return saveFile(rec.name, rec.blob);
}

// Save a file the app made itself (closed report, declaration photo).
export async function addBlob(projectId, blob, name, folder, extra = {}) {
  const rec = { id: db.uid(), projectId, name, folder, type: blob.type || '', size: blob.size, blob, notes: '', ...extra };
  try {
    if (rec.type.startsWith('image/')) rec.thumb = (await compressImage(blob, 320, 0.75)).blob;
    else if (rec.type === 'application/pdf') Object.assign(rec, await pdfThumb(blob));
  } catch {
    /* no preview */
  }
  return db.put('files', rec);
}
