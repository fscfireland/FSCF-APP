// Put quotes and invoices made in the app into the owner's INVOICES AND QUOTES
// workbook, without disturbing anything else in it.
//
// The workbook is edited as the .xlsx package it is (a zip of XML parts), not
// re-written by a spreadsheet library, so its formatting, logos, formulas,
// tables, named ranges and every other tab stay exactly as they are. For each
// document:
//  - its tab is a copy of the owner's latest tab of the same kind (quote or
//    invoice; inspection or works) that has no shared or array formulas, so it
//    keeps his layout, styles and logo; the header boxes, customer and delivery
//    blocks, lines, notes, Pre Lims, fuel and VAT rate are filled in (cells found
//    by their labels), with live formulas as on his tabs and their values stored;
//  - a row is added to the SUMMARY register (table "DocumentRegister"), copied
//    from its last row, with the date / subtotal / total formulas pointing at
//    the new tab, and the table range extended;
//  - Excel is told to recalculate everything when the file is next opened.
// The result is saved as the next revision; the owner's file is never changed.

import { loadScript } from './files.js';
import { tabName, totals, isInspection, RCT_TEXT } from './quotes.js';

const NOF = { createFolders: false }; // no folder entries in the package
const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
async function loadZip() { await loadScript(JSZIP); return window.JSZip; }

const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colNum = (c) => [...c].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
const serial = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / 864e5) + 25569;
const attr = (tag, name) => (new RegExp(`\\s${name}="([^"]*)"`).exec(tag) || [])[1];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ---------- one worksheet's cells, edited in place ----------
class Sheet {
  constructor(xml, shared) {
    this.shared = shared;
    const m = /<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/.exec(xml);
    this.head = xml.slice(0, m.index);
    this.tail = xml.slice(m.index + m[0].length);
    this.rows = new Map();
    for (const rm of (m[1] || '').matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = +attr(rm[0], 'r');
      const cells = new Map();
      for (const cm of (rm[2] || '').matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) cells.set(/r="([A-Z]+)\d+"/.exec(cm[0])[1], cm[0]);
      this.rows.set(r, { attrs: rm[1].replace(/\sr="\d+"/, '').replace(/\sspans="[^"]*"/, ''), cells });
    }
  }
  text(ref) {
    const [, col, r] = /([A-Z]+)(\d+)/.exec(ref);
    const c = this.rows.get(+r)?.cells.get(col);
    if (!c) return '';
    const t = attr(c, 't');
    if (t === 's') return unesc((this.shared[+(/<v>(\d+)<\/v>/.exec(c) || [])[1]] || ''));
    if (t === 'inlineStr') return unesc([...c.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
    return unesc((/<v>([\s\S]*?)<\/v>/.exec(c) || [])[1] || '');
  }
  formula(ref) { const [, col, r] = /([A-Z]+)(\d+)/.exec(ref); return unesc((/<f[^>]*>([\s\S]*?)<\/f>/.exec(this.rows.get(+r)?.cells.get(col) || '') || [])[1] || ''); }
  // the row whose column `col` reads `re`
  find(col, re, from = 1, to = 400) {
    for (const [r] of [...this.rows].sort((a, b) => a[0] - b[0])) if (r >= from && r <= to && re.test(this.text(col + r).trim())) return r;
    return 0;
  }
  style(ref) { const [, col, r] = /([A-Z]+)(\d+)/.exec(ref); return attr(this.rows.get(+r)?.cells.get(col) || '', 's'); }
  put(ref, { v = null, f = null, s } = {}) {
    const [, col, rs] = /([A-Z]+)(\d+)/.exec(ref);
    const r = +rs;
    if (!this.rows.has(r)) this.rows.set(r, { attrs: '', cells: new Map() });
    const row = this.rows.get(r);
    const st = s ?? attr(row.cells.get(col) || '', 's');
    const sA = st ? ` s="${st}"` : '';
    let x;
    if (f != null) {
      const isStr = typeof v === 'string';
      x = `<c r="${ref}"${sA}${isStr ? ' t="str"' : ''}><f>${xmlEsc(f)}</f>${v == null ? '' : `<v>${xmlEsc(v)}</v>`}</c>`;
    } else if (v == null || v === '') x = `<c r="${ref}"${sA}/>`;
    else if (typeof v === 'number') x = `<c r="${ref}"${sA}><v>${v}</v></c>`;
    else x = `<c r="${ref}"${sA} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    row.cells.set(col, x);
  }
  clear(ref) { this.put(ref, {}); }
  lastRow() { return Math.max(0, ...this.rows.keys()); }
  xml() {
    const rows = [...this.rows].sort((a, b) => a[0] - b[0]).map(([r, row]) => {
      const cells = [...row.cells].sort((a, b) => colNum(a[0]) - colNum(b[0])).map(([, c]) => c).join('');
      return cells ? `<row r="${r}"${row.attrs}>${cells}</row>` : `<row r="${r}"${row.attrs}/>`;
    }).join('');
    return `${this.head}<sheetData>${rows}</sheetData>${this.tail}`;
  }
}

// ---------- the package ----------
function relsMap(xml) {
  const out = [];
  for (const m of xml.matchAll(/<Relationship\b[^>]*\/?>/g)) out.push({ tag: m[0], id: attr(m[0], 'Id'), type: attr(m[0], 'Type'), target: attr(m[0], 'Target') });
  return out;
}
const join = (base, target) => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/'); parts.pop();
  for (const t of target.split('/')) { if (t === '..') parts.pop(); else if (t !== '.') parts.push(t); }
  return parts.join('/');
};
const relsOf = (part) => part.replace(/([^/]+)$/, '_rels/$1.rels');

export async function writeIntoWorkbook(file, docs, book, onProgress = () => {}) {
  const JSZip = await loadZip();
  onProgress('Opening the workbook…');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const read = (p) => zip.file(p)?.async('string');
  let wb = await read('xl/workbook.xml');
  let wbRels = await read('xl/_rels/workbook.xml.rels');
  let ct = await read('[Content_Types].xml');
  const sstXml = (await read('xl/sharedStrings.xml')) || '';
  const shared = [...sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
  if (!wb || !wbRels || !ct) throw new Error('This file is not an Excel workbook.');

  const sheetsOf = () => [...wb.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => ({ tag: m[0], name: unesc(attr(m[0], 'name')), id: +attr(m[0], 'sheetId'), rid: attr(m[0], 'r:id') }));
  const partOf = (rid) => join('xl/workbook.xml', relsMap(wbRels).find((r) => r.id === rid).target);
  const docTab = (name) => /^\((\d+)\)/.exec(name);
  let sheets = sheetsOf();
  const names = new Set(sheets.map((s) => s.name));

  // SUMMARY register: its sheet, table and last row
  const summary = sheets.find((s) => s.name === 'SUMMARY');
  if (!summary) throw new Error('No SUMMARY tab in this workbook.');
  const sumPart = partOf(summary.rid);
  const sumRels = relsMap((await read(relsOf(sumPart))) || '');
  const tablePart = sumRels.filter((r) => /table$/.test(r.type)).map((r) => join(sumPart, r.target))[0];
  let tableXml = tablePart && (await read(tablePart));
  const sum = new Sheet(await read(sumPart), shared);
  const tableEnd = tableXml ? +(/ref="A1:[A-Z]+(\d+)"/.exec(tableXml) || [])[1] : sum.find('B', /\S/, 2, 100000) && Math.max(...[...sum.rows.keys()].filter((r) => sum.text('B' + r)));
  let sumRow = tableEnd;

  // templates: the latest same-kind tab with no shared / array formulas
  const tplCache = new Map();
  const pickTemplate = async (doc) => {
    const want = (n) => (doc.kind === 'INV' ? /INV-\d+/.test(n) : / Q$/.test(n));
    const insp = isInspection(doc);
    const reg = new Map((book?.register || []).map((r) => [r.sheet, r]));
    const cands = sheets.filter((s) => docTab(s.name) && want(s.name)).sort((a, b) => +docTab(b.name)[1] - +docTab(a.name)[1]);
    const sameType = cands.filter((s) => !reg.get(s.name)?.workType || (reg.get(s.name).workType === 'FDINSP') === insp);
    for (const s of [...sameType, ...cands].slice(0, 40)) {
      const key = s.name;
      if (!tplCache.has(key)) {
        const p = partOf(s.rid);
        const x = await read(p);
        tplCache.set(key, x && !/t="shared"|t="array"/.test(x) ? { sheet: s, part: p, xml: x } : null);
      }
      const t = tplCache.get(key);
      if (t) return t;
    }
    throw new Error(`No ${doc.kind === 'INV' ? 'invoice' : 'quote'} tab in the workbook can be copied safely.`);
  };

  let nextSheetId = Math.max(...sheets.map((s) => s.id)) + 1;
  let nextRid = Math.max(...relsMap(wbRels).map((r) => +(r.id.replace(/\D/g, '')) || 0)) + 1;
  const used = new Set(Object.keys(zip.files));
  const freshName = (pattern) => { let i = 1; while (used.has(pattern.replace('#', i))) i++; const n = pattern.replace('#', i); used.add(n); return n; };
  const added = [];

  for (const doc of docs) {
    const name = tabName(doc).slice(0, 31);
    if (names.has(name)) { added.push({ doc, name, skipped: 'already in the workbook' }); continue; }
    onProgress(`Adding ${name}…`);
    const tpl = await pickTemplate(doc);
    const sh = new Sheet(tpl.xml, shared);
    const isInv = doc.kind === 'INV';
    const t = totals(doc);

    // header boxes: label in column C, value in column D
    const box = (re) => sh.find('C', re, 1, 12);
    const rDate = box(/^date:?$/i);
    const rQuote = box(/^quote( no:?| #)$/i);
    const rCust = box(/^customer i\.?d\.?$/i);
    const rDue = box(/^(due date:?|valid until)$/i);
    const rPo = box(/^po(\/wo)? no:?$/i);
    const rInv = box(/^invoice no:?$/i);
    if (!rDate || !rQuote || !rCust) throw new Error(`The template tab ${tpl.sheet.name} does not have the usual header boxes.`);
    const [y, m, d] = doc.date.split('-').map(Number);
    sh.put('D' + rDate, { f: `DATE(${y},${m},${d})`, v: serial(doc.date) });
    sh.put('D' + rQuote, { v: doc.quote });
    sh.put('D' + rCust, { v: doc.cust.id });
    if (rDue) sh.put('D' + rDue, { f: `D${rDate}+${doc.days || 30}`, v: serial(doc.date) + (doc.days || 30) });
    if (rPo) sh.put('D' + rPo, { v: doc.po || '' });
    if (rInv) sh.put('D' + rInv, { v: doc.inv || '' });

    // customer and delivery blocks
    const rC = sh.find('A', /^customer$/i, 8, 20);
    const rDesc = sh.find('A', /^description$/i, rC + 1, 40);
    if (!rC || !rDesc) throw new Error(`The template tab ${tpl.sheet.name} does not have the usual CUSTOMER / DESCRIPTION rows.`);
    for (let r = rC + 1; r < rDesc; r++) { sh.clear('A' + r); sh.clear('C' + r); }
    (doc.cust.lines || []).slice(0, rDesc - rC - 1).forEach((l, i) => sh.put('A' + (rC + 1 + i), { v: l }));
    (doc.site?.lines || []).slice(0, rDesc - rC - 1).forEach((l, i) => sh.put('C' + (rC + 1 + i), { v: l }));

    // lines: the item band runs from DESCRIPTION to the row the Subtotal sums up to
    const rSub = sh.find('C', /^subtotal$/i, rDesc + 1, 120);
    const band = /SUM\(D(\d+):D(\d+)\)/i.exec(sh.formula('D' + rSub)) || [];
    const first = +band[1] || rDesc + 1;
    const last = +band[2] || rSub - 3;
    const lines = [...(doc.items || []).map((it) => ({ it })), ...(doc.notes || []).filter((n) => n.trim()).map((n) => ({ note: n })), ...(doc.vatMode === 'rct' ? [{ note: RCT_TEXT }] : [])];
    if (lines.length > last - first + 1) throw new Error(`${name} has ${lines.length} lines and notes; the tab has room for ${last - first + 1}. Shorten it, or add it to the workbook by hand.`);
    const sA = sh.style('A' + first); const sB = sh.style('B' + first); const sC = sh.style('C' + first); const sD = sh.style('D' + first);
    for (let r = first; r <= last; r++) for (const c of 'ABCD') sh.clear(c + r);
    lines.forEach((ln, i) => {
      const r = first + i;
      if (ln.it) {
        const q = Number(ln.it.qty) || 0; const u = Number(ln.it.unit) || 0;
        sh.put('A' + r, { v: ln.it.desc, s: sA }); sh.put('B' + r, { v: q, s: sB }); sh.put('C' + r, { v: u, s: sC });
        sh.put('D' + r, { f: `B${r}*C${r}`, v: r2(q * u), s: sD });
      } else sh.put('A' + r, { v: ln.note, s: sA });
    });

    // summary block, found by its labels
    const lab = (re) => sh.find('C', re, rSub, rSub + 10);
    const rPre = lab(/^pre ?lims$/i); const rFuel = lab(/^(fuel|other)/i); const rRate = lab(/^vat (rate|treatment)$/i); const rVat = lab(/^vat due$/i); const rTot = lab(/^total$/i);
    sh.put('D' + rSub, { f: `SUM(D${first}:D${last})`, v: t.subtotal });
    if (rPre) sh.put('D' + rPre, { v: t.preLims });
    if (rFuel) sh.put('D' + rFuel, { v: t.fuel });
    if (rRate) sh.put('D' + rRate, { v: t.vatRate });
    if (rVat) sh.put('D' + rVat, { f: doc.vatMode === 'rct' ? '0' : `SUM(D${rSub}:D${rFuel || rSub})*D${rRate}`, v: t.vatDue });
    if (rTot) sh.put('D' + rTot, { f: `SUM(D${rSub}:D${rFuel || rSub})+D${rVat}`, v: t.total });
    // terms text under TERMS AND CONDITIONS
    // first-page terms: the document's own, else the app's standard wording (as on its PDF), never the copied tab's
    const p1 = doc.p1Terms || (isInv ? 'Payment is due by the date shown above. The terms and conditions on page 2 remain applicable to the quoted and invoiced scope.' : 'Please read the terms and conditions on page 2 carefully before accepting this quotation. Acceptance of this quote or issue of a purchase order confirms agreement to these terms.');
    { const rT = sh.find('A', /^terms and conditions$/i, rSub - 2, rSub + 2); if (rT) sh.put('A' + (rT + 1), { v: p1 }); }
    // the reference line keeps its formula; store its value too
    const rRef = sh.find('A', /^(invoice|quote) reference:/i, rSub, 400);
    if (rRef && sh.formula('A' + rRef)) sh.put('A' + rRef, { f: sh.formula('A' + rRef), v: isInv ? `Invoice reference: ${doc.inv}   |   Quote: ${doc.quote}   |   Customer: ${doc.cust.id}${/Site:/.test(sh.text('A' + rRef)) ? `   |   Site: ${(doc.site?.lines || [])[0] || ''}` : ''}` : `Quote reference: ${doc.quote}   |   Customer: ${doc.cust.id}   |   Site: ${(doc.site?.lines || [])[0] || ''}` });

    // new parts: the sheet, its drawing (logo) and any other related parts
    const newPart = freshName('xl/worksheets/sheet#.xml');
    let sheetXml = sh.xml().replace(/<sheetView\b([^>]*?)\stabSelected="1"/, '<sheetView$1');
    const tRelsXml = await read(relsOf(tpl.part));
    if (tRelsXml) {
      let newRels = tRelsXml;
      for (const r of relsMap(tRelsXml)) {
        if (/hyperlink/.test(r.type) || /TargetMode="External"/.test(r.tag)) continue;
        const src = join(tpl.part, r.target);
        const ext = src.split('.').pop();
        const dir = src.slice(0, src.lastIndexOf('/') + 1);
        const base = src.slice(src.lastIndexOf('/') + 1).replace(/\d*\.\w+$/, '');
        const dst = freshName(`${dir}${base}#.${ext}`);
        zip.file(dst, await zip.file(src).async('uint8array'), NOF);
        const srcRels = relsOf(src);
        if (zip.file(srcRels)) zip.file(relsOf(dst), await zip.file(srcRels).async('string'), NOF);
        const ctOver = new RegExp(`<Override PartName="/${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" ContentType="([^"]+)"/>`).exec(ct);
        if (ctOver) ct = ct.replace('</Types>', `<Override PartName="/${dst}" ContentType="${ctOver[1]}"/></Types>`);
        newRels = newRels.replace(r.tag, r.tag.replace(`Target="${r.target}"`, `Target="${r.target.replace(/[^/]+$/, dst.split('/').pop())}"`));
      }
      zip.file(relsOf(newPart), newRels, NOF);
    }
    zip.file(newPart, sheetXml, NOF);
    ct = ct.replace('</Types>', `<Override PartName="/${newPart}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
    const rid = `rId${nextRid++}`;
    wbRels = wbRels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${newPart.replace(/^xl\//, '')}"/></Relationships>`);

    // place the tab after the last document tab with a lower number
    sheets = sheetsOf();
    const no = doc.tab;
    let pos = 0;
    sheets.forEach((s, i) => { const m2 = docTab(s.name); if (m2 && +m2[1] < no) pos = i + 1; });
    if (!pos) pos = sheets.length;
    const newTag = `<sheet name="${xmlEsc(name)}" sheetId="${nextSheetId++}" r:id="${rid}"/>`;
    wb = pos < sheets.length ? wb.replace(sheets[pos].tag, newTag + sheets[pos].tag) : wb.replace(sheets[sheets.length - 1].tag, sheets[sheets.length - 1].tag + newTag);
    // named ranges and window settings that count tabs by position move up by one
    wb = wb.replace(/localSheetId="(\d+)"/g, (all, n) => (+n >= pos ? `localSheetId="${+n + 1}"` : all));
    wb = wb.replace(/(activeTab|firstSheet)="(\d+)"/g, (all, k, n) => (+n >= pos ? `${k}="${+n + 1}"` : all));
    // print area as on the template tab
    const tIdx = sheetsOf().findIndex((s) => s.name === tpl.sheet.name);
    const pa = new RegExp(`<definedName name="_xlnm.Print_Area" localSheetId="${tIdx}">[^<]*!([^<]+)</definedName>`).exec(wb);
    if (pa) wb = wb.replace('</definedNames>', `<definedName name="_xlnm.Print_Area" localSheetId="${pos}">'${xmlEsc(name.replace(/'/g, "''"))}'!${pa[1]}</definedName></definedNames>`);
    names.add(name);

    // SUMMARY register row, copied from the last row of the table
    sumRow += 1;
    const tmplRow = sumRow - 1;
    const st = (c) => sum.style(c + tmplRow);
    const q = `'${name.replace(/'/g, "''")}'!`;
    sum.put('A' + sumRow, { v: doc.tab, s: st('A') });
    sum.put('B' + sumRow, { v: name, s: st('B') });
    sum.put('C' + sumRow, { v: isInv ? 'Invoice' : 'Quote', s: st('C') });
    sum.put('D' + sumRow, { v: doc.cust.id, s: st('D') });
    sum.put('E' + sumRow, { v: doc.quote, s: st('E') });
    sum.put('F' + sumRow, { v: ((doc.site?.lines || [])[0] || '').toUpperCase(), s: st('F') });
    sum.put('G' + sumRow, { v: doc.workType || '', s: st('G') });
    sum.put('H' + sumRow, { v: doc.inv || '', s: st('H') });
    sum.put('I' + sumRow, { v: doc.status || '', s: st('I') });
    sum.put('J' + sumRow, { f: `${q}D${rDate}`, v: serial(doc.date), s: st('J') });
    sum.put('K' + sumRow, { f: `${q}D${rSub}`, v: t.subtotal, s: st('K') });
    sum.put('L' + sumRow, { f: `${q}D${rTot}`, v: t.total, s: st('L') });
    sum.put('M' + sumRow, doc.paidOn ? { v: serial(doc.paidOn), s: st('M') } : { s: st('M') });
    added.push({ doc, name, row: sumRow });
  }

  if (added.some((a) => a.row)) {
    // grow the register table and the sheet's used range to the new last row
    let sumXml = sum.xml();
    sumXml = sumXml.replace(/<dimension ref="([A-Z]+\d+):([A-Z]+)(\d+)"\/>/, (all, a, c, r) => `<dimension ref="${a}:${c}${Math.max(+r, sumRow)}"/>`);
    zip.file(sumPart, sumXml, NOF);
    if (tableXml) {
      tableXml = tableXml.replace(/(<table\b[^>]*\sref="A1:[A-Z]+)\d+"/, `$1${sumRow}"`).replace(/(<autoFilter\s+ref="A1:[A-Z]+)\d+"/, `$1${sumRow}"`);
      zip.file(tablePart, tableXml, NOF);
    }
    // Excel rebuilds the calculation chain and recalculates on opening
    if (zip.file('xl/calcChain.xml')) {
      zip.remove('xl/calcChain.xml');
      ct = ct.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
      wbRels = wbRels.replace(/<Relationship\b[^>]*calcChain[^>]*\/>/, '');
    }
    wb = /<calcPr\b[^>]*fullCalcOnLoad/.test(wb) ? wb : wb.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"');
    zip.file('xl/workbook.xml', wb, NOF);
    zip.file('xl/_rels/workbook.xml.rels', wbRels, NOF);
    zip.file('[Content_Types].xml', ct, NOF);
  }
  onProgress('Saving the new revision…');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return { blob, added, name: nextRevName(file.name) };
}

// "INVOICES AND QUOTES REV 30 (34) (1).xlsx" → "INVOICES AND QUOTES REV 30 (35).xlsx"
export function nextRevName(fileName) {
  const stem = String(fileName || 'INVOICES AND QUOTES.xlsx').replace(/\.xlsx?m?$/i, '');
  const nums = [...stem.matchAll(/\((\d+)\)/g)].map((m) => +m[1]);
  const base = stem.replace(/(\s*\(\d+\))+\s*$/, '').trim();
  return `${base} (${(nums.length ? Math.max(...nums) : 0) + 1}).xlsx`;
}
