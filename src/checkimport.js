import { capsWorkbook } from './caps.js';
// Import and export checklist templates.
// Import reads: a Fieldwire (or similar) report PDF, finding the questions in
// its "Checklist" sections; an Excel / CSV list (one question per row, an
// optional second column for the defect raised when it fails); a plain text
// file (one per line); or a checklist file downloaded from this app.

import { loadSheetJS, pdfLines, saveFile, safeName } from './files.js';

const FORMAT = 'fscf-checklist';
const clean = (s) => String(s || '')
  .replace(/\s*\(@[^)]*\)\s*$/, '') // Fieldwire "(@MCR - 30-10-2026)"
  .replace(/\\([_#*])/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();
const looksLikeCheck = (s) => s.length > 8 && s.length < 260 && (/\?$/.test(s) || /^\d+(\.\d+)?[).]?\s+\S/.test(s));
const STOP = /^(below are listed|recommendation|task messages|#\d|created with|priority|photos?|tags:|plan:)/i;

function fromLines(lines) {
  const out = [];
  let inList = false;
  const hasMarker = lines.some((l) => /^checklist\b/i.test(l.trim()));
  for (const raw of lines) {
    const l = clean(raw);
    if (!l) continue;
    if (/^checklist\b/i.test(l)) { inList = true; continue; }
    if (hasMarker && !inList) continue;
    if (STOP.test(l)) { inList = false; continue; }
    if (/^section \d+\s*:/i.test(l)) continue;
    if (looksLikeCheck(l) && !out.some((q) => q.text.toLowerCase() === l.toLowerCase())) out.push({ text: l, defect: '' });
  }
  return out;
}

function guessName(fileName, lines) {
  const hit = lines.map(clean).find((l) => /\b\d+\s*point\b/i.test(l));
  if (hit) { const m = /(\d+)\s*point/i.exec(hit); return `${m[1]} point check`; }
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

export async function readChecklistFile(file) {
  const name = file.name || 'checklist';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'json') {
    const d = JSON.parse(await file.text());
    if (d.format !== FORMAT) throw new Error('This file is not a checklist from this app.');
    return { name: d.name, base: d.base, item: d.item, report: d.report, questions: d.questions || [], defects: d.defects, doorTypes: d.doorTypes };
  }
  if (ext === 'pdf' || file.type === 'application/pdf') {
    const lines = await pdfLines(file, 40);
    const questions = fromLines(lines);
    return { name: guessName(name, lines), questions };
  }
  if (['xlsx', 'xls', 'csv', 'ods'].includes(ext)) {
    const XLSX = await loadSheetJS();
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' });
    let start = 0;
    let qCol = 0;
    let dCol = -1;
    const head = (rows[0] || []).map((c) => String(c).toLowerCase());
    const qi = head.findIndex((h) => /question|check|item/.test(h));
    if (qi >= 0) { qCol = qi; start = 1; dCol = head.findIndex((h) => /defect|fail/.test(h)); }
    else qCol = Math.max(0, (rows.find((r) => r.some((c) => String(c).trim())) || []).findIndex((c) => String(c).trim().length > 8));
    const questions = [];
    for (const r of rows.slice(start)) {
      const t = clean(r[qCol]);
      if (t && !questions.some((q) => q.text === t)) questions.push({ text: t, defect: dCol >= 0 ? clean(r[dCol]) : '' });
    }
    return { name: guessName(name, []), questions };
  }
  // plain text: one question per line
  const lines = (await file.text()).split(/\r?\n/);
  const fl = fromLines(lines);
  return { name: guessName(name, lines), questions: fl.length ? fl : lines.map(clean).filter(Boolean).map((text) => ({ text, defect: '' })) };
}

// Suggest the defect a failed question raises, from words they share
const SKIP = new Set(['the', 'and', 'are', 'any', 'have', 'been', 'does', 'door', 'doors', 'fire', 'with', 'from', 'that', 'this', 'both', 'sides', 'side', 'correct', 'properly', 'fitted', 'present', 'between', 'within', 'their', 'there', 'is', 'of', 'on', 'to', 'in', 'or', 'a']);
const words = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length > 2 && !SKIP.has(w)).map((w) => w.replace(/s$/, '')));
export function guessDefect(text, defects) {
  const q = words(text);
  let best = null;
  let score = 0;
  for (const d of defects || []) {
    const n = [...words(d.label)].filter((w) => q.has(w)).length;
    if (n > score) { score = n; best = d.label; }
  }
  return score ? best : '';
}

export async function downloadChecklist(kit) {
  const XLSX = await loadSheetJS();
  const rows = [['Question', 'Defect if it fails'], ...(kit.questions || []).filter((q) => q.text?.trim()).map((q) => [q.text, q.defect || ''])];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 80 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Checklist');
  const info = XLSX.utils.aoa_to_sheet([['Checklist', kit.name], ['Inspection type', kit.baseName || ''], ['Each item is a', kit.item || ''], ['Report title', kit.report || ''], [], ['Edit the Checklist sheet and import it again in Settings › Import checklist.']]);
  info['!cols'] = [{ wch: 18 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, info, 'About');
  const out = XLSX.write(capsWorkbook(wb), { bookType: 'xlsx', type: 'array' });
  return saveFile(`Checklist_${safeName(kit.name)}.xlsx`, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
