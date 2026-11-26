// Quotes and invoices, matching Mark's "INVOICES AND QUOTES" Excel workbook.
//
// The workbook is the master record. It holds one tab per document, named
//   (343) CHES-001 A-229 Q          a quote: tab no., customer ID, job no.
//   (333) HSEMW-001 A-219 INV-114   an invoice for job A-219
//   CHES-001 SERV PD-031            a pricing document (door-by-door build-up)
// plus SERV PD MASTER (the rate list: cost + labour per item / Fieldwire tag),
// SUMMARY (the register) and the sample tabs for works, inspection and invoices.
//
// Importing it here gives the app the next numbers, every customer with their
// address blocks, sites, PO numbers and VAT precedent, the rate list, past quote
// lines and the exact terms text. Quotes made here carry on the same sequence
// and are exported as a PDF (to send) and a tab laid out like the samples (to
// add to the workbook), with the SUMMARY register row ready to paste.

import { loadSheetJS, saveFile, safeName } from './files.js';

export const WORK_TYPES = { FDREM: 'Remedial works', FDINST: 'Installation', FDINSP: 'Inspection', CALLO: 'Call-out', FS: 'Fire stopping' };
export const STATUSES = { PROC: 'Processing', WIP: 'Work in progress', UP: 'Unpaid', P: 'Paid', NP: 'Not proceeding' };
export const VAT_RATES = [0.23, 0.135, 0];

const DOC_RE = /^\((\d+)\)\s*([A-Z0-9]+-\d{3})\s+(.*)$/i;
const num = (v) => (typeof v === 'number' ? v : v != null && v !== '' && !isNaN(+v) ? +v : null);
const str = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
export const pad3 = (n) => String(n).padStart(3, '0');
export const money = (n) => '€' + (Number(n) || 0).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// "(343) CHES-001 A-229 Q" → { tab: 343, cust: 'CHES-001', quote: 'A-229', inv: '', kind: 'Q' }
export function parseTabName(name) {
  const m = DOC_RE.exec(name || '');
  if (!m) return null;
  const rest = m[3];
  const a = /\bA-0*(\d+)/i.exec(rest);
  const inv = /INV-0*(\d+)/i.exec(rest);
  return {
    tab: +m[1], cust: m[2].toUpperCase(), quote: a ? 'A-' + pad3(+a[1]) : '', quoteNo: a ? +a[1] : 0,
    inv: inv ? 'INV-' + pad3(+inv[1]) : '', invNo: inv ? +inv[1] : 0, kind: inv ? 'INV' : 'Q',
    part: /\bDEP\b/i.test(rest) ? 'DEP' : /\bBAL\b/i.test(rest) ? 'BAL' : '',
  };
}

export function tabName(doc) {
  const part = doc.part ? doc.part + ' ' : '';
  return doc.kind === 'INV' ? `(${doc.tab}) ${doc.cust.id} ${doc.quote} ${part}${doc.inv}` : `(${doc.tab}) ${doc.cust.id} ${doc.quote} Q`;
}

const excelDate = (v) => {
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const d = new Date(v);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
};

// ---------- Reading the workbook ----------
function readDocSheet(XLSX, ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true }).slice(0, 140);
  const A = (r) => str(rows[r]?.[0]);
  const C = (r) => str(rows[r]?.[2]);
  const D = (r) => rows[r]?.[3];
  const head = {};
  for (let r = 0; r < 12; r++) {
    const k = C(r).toLowerCase().replace(/[:#.]/g, '').replace(/\s+/g, ' ').trim();
    if (k) head[k] = D(r);
  }
  const iCust = rows.findIndex((x) => /^customer$/i.test(str(x?.[0])));
  const iDesc = rows.findIndex((x) => /^description$/i.test(str(x?.[0])));
  const iSub = rows.findIndex((x, i) => i > iDesc && /^subtotal$/i.test(str(x?.[2])));
  const custLines = [];
  const siteLines = [];
  if (iCust >= 0) {
    for (let r = iCust + 1; r < (iDesc > 0 ? iDesc : iCust + 12); r++) {
      if (A(r)) custLines.push(A(r));
      const c = str(rows[r]?.[2]) || str(rows[r]?.[3]);
      if (c) siteLines.push(c);
    }
  }
  const items = [];
  const notes = [];
  if (iDesc >= 0) {
    const end = iSub > 0 ? iSub : iDesc + 20;
    for (let r = iDesc + 1; r < end; r++) {
      const desc = A(r);
      const qty = num(rows[r]?.[1]);
      const unit = num(rows[r]?.[2]);
      if (desc && qty != null && unit != null) items.push({ desc, qty, unit });
      else if (desc && !/terms and conditions/i.test(desc)) notes.push(desc);
    }
  }
  const sum = {};
  for (let r = Math.max(0, iSub); r < Math.min(rows.length, (iSub > 0 ? iSub : 30) + 12); r++) {
    const k = C(r).toLowerCase();
    if (/^subtotal/.test(k)) sum.subtotal = num(D(r));
    else if (/^pre ?lims/.test(k)) sum.preLims = num(D(r));
    else if (/^(fuel|other)/.test(k)) sum.fuel = num(D(r));
    else if (/^vat (rate|treatment)/.test(k)) sum.vatRate = num(D(r));
    else if (/^vat due/.test(k)) sum.vatDue = num(D(r));
    else if (/^total/.test(k)) sum.total = num(D(r));
  }
  // terms: page 1 text under TERMS AND CONDITIONS, page 2 numbered clauses
  const iTerms = rows.findIndex((x) => /^terms and conditions$/i.test(str(x?.[0])));
  const p1 = [];
  if (iTerms >= 0) for (let r = iTerms + 1; r < iTerms + 8; r++) { const t = A(r); if (/banking details|^iban|^if you have/i.test(t)) break; if (t) p1.push(t); }
  const iT2 = rows.findIndex((x) => /TERMS & CONDITIONS/.test(str(x?.[0])));
  const clauses = [];
  if (iT2 >= 0) for (let r = iT2 + 1; r < rows.length; r++) { const t = A(r); if (/^\d+\.\s/.test(t)) clauses.push(t); if (/^customer acceptance/i.test(t)) break; }
  return {
    date: excelDate(head.date ?? head['date']),
    quote: str(head['quote'] ?? head['quote no']),
    custId: str(head['customer id'] ?? head['customer id']),
    po: str(head['po no'] ?? ''),
    custLines, siteLines, items, notes, sum, p1, clauses, termsTitle: iT2 >= 0 ? A(iT2) : '',
  };
}

export async function readWorkbook(file, onProgress = () => {}) {
  const XLSX = await loadSheetJS();
  onProgress('Opening the workbook…');
  const data = new Uint8Array(await file.arrayBuffer());
  const names = XLSX.read(data, { type: 'array', bookSheets: true }).SheetNames;
  const docs = names.map((n) => ({ name: n, ...parseTabName(n) })).filter((d) => d.tab);
  if (!docs.length) throw new Error('No quote or invoice tabs like "(343) CHES-001 A-229 Q" were found in this workbook.');
  const extra = ['SERV PD MASTER', 'SUMMARY', 'FD WORKS QUOTE SAMPLE', 'FD INSP QUOTE SAMPLE', 'INV EXAMPLE'].filter((n) => names.includes(n));
  onProgress(`Reading ${docs.length} quotes and invoices…`);
  const wb = XLSX.read(data, { type: 'array', sheets: [...docs.map((d) => d.name), ...extra], cellStyles: false, cellHTML: false });

  // sequence
  const pdNos = names.map((n) => /PD[- ]0*(\d+)/i.exec(n)).filter(Boolean).map((m) => +m[1]);
  const seq = {
    tab: Math.max(...docs.map((d) => d.tab)),
    quote: Math.max(0, ...docs.map((d) => d.quoteNo)),
    inv: Math.max(0, ...docs.map((d) => d.invNo)),
    pd: Math.max(0, ...pdNos),
  };

  // register: work type, location and status from SUMMARY
  const reg = {};
  if (wb.Sheets.SUMMARY) {
    for (const r of XLSX.utils.sheet_to_json(wb.Sheets.SUMMARY, { header: 1, raw: true, defval: null }).slice(1)) {
      const name = str(r[1]);
      if (name) reg[name] = { workType: str(r[6]).toUpperCase(), location: str(r[5]), status: str(r[8]).toUpperCase(), paidOn: excelDate(r[12]) };
    }
  }

  onProgress('Reading customers, sites and past prices…');
  const customers = {};
  const pastLines = new Map();
  const register = [];
  for (const d of docs.sort((a, b) => a.tab - b.tab)) {
    const ws = wb.Sheets[d.name];
    if (!ws) continue;
    let x;
    try { x = readDocSheet(XLSX, ws); } catch { continue; }
    const rg = reg[d.name] || reg[d.name.replace(/\s+/g, ' ')] || {};
    const workType = rg.workType || '';
    register.push({ sheet: d.name, tab: d.tab, kind: d.kind, part: d.part, cust: d.cust, quote: d.quote, inv: d.inv, date: x.date, subtotal: x.sum.subtotal ?? null, total: x.sum.total ?? null, status: rg.status || '', workType, location: rg.location || x.siteLines[0] || '', po: x.po, items: x.items, notes: x.notes, vatRate: x.sum.vatRate ?? null, siteLines: x.siteLines });
    const c = (customers[d.cust] ||= { id: d.cust, lines: [], sites: {}, vatRate: null, last: '' });
    if (x.custLines.length && (x.date || '') >= (c.last || '')) { c.lines = x.custLines; c.last = x.date || c.last; }
    if (x.sum.vatRate != null && (x.date || '') >= (c.vatDate || '')) { c.vatRate = x.sum.vatRate; c.vatDate = x.date; }
    if (x.siteLines.length) {
      const key = x.siteLines[0].toUpperCase();
      const s = (c.sites[key] ||= { lines: x.siteLines, po: '', vatRate: null, workType: '', last: '' });
      if ((x.date || '') >= (s.last || '')) { s.lines = x.siteLines; s.last = x.date; if (workType) s.workType = workType; }
      if (x.po) s.po = x.po;
      if (x.sum.vatRate != null) s.vatRate = x.sum.vatRate;
    }
    for (const it of x.items) {
      const key = it.desc.toUpperCase() + '|' + it.unit;
      pastLines.set(key, { desc: it.desc, unit: it.unit, qty: it.qty, cust: d.cust, ref: d.inv || d.quote, date: x.date, workType });
    }
  }
  for (const c of Object.values(customers)) c.sites = Object.values(c.sites).sort((a, b) => (b.last || '').localeCompare(a.last || ''));

  // rate list from SERV PD MASTER: cost + labour per item / tag
  const rates = [];
  if (wb.Sheets['SERV PD MASTER']) {
    for (const r of XLSX.utils.sheet_to_json(wb.Sheets['SERV PD MASTER'], { header: 1, raw: true, defval: null }).slice(4)) {
      const cost = num(r[3]);
      const labour = num(r[4]);
      if (cost == null && labour == null) continue;
      rates.push({ type: str(r[0]), item: str(r[1]), tag: str(r[2]), cost: cost || 0, labour: labour || 0 });
    }
  }

  // terms and company details from the samples
  const sample = (n) => (wb.Sheets[n] ? readDocSheet(XLSX, wb.Sheets[n]) : null);
  const works = sample('FD WORKS QUOTE SAMPLE');
  const insp = sample('FD INSP QUOTE SAMPLE');
  const terms = {
    works: works ? { title: works.termsTitle, p1: works.p1.join(' '), clauses: works.clauses } : null,
    insp: insp ? { title: insp.termsTitle, p1: insp.p1.join(' '), clauses: insp.clauses } : null,
  };
  const rowsOf = (n) => (wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) : []);
  const sRows = rowsOf('FD INSP QUOTE SAMPLE');
  const company = {
    lines: sRows.slice(1, 9).map((r) => str(r?.[0])).filter(Boolean),
    iban: (sRows.map((r) => str(r?.[0])).find((t) => /^IBAN/i.test(t)) || '').replace(/^IBAN:?\s*/i, ''),
    bic: (sRows.map((r) => str(r?.[0])).find((t) => /^BIC/i.test(t)) || '').replace(/^BIC:?\s*/i, ''),
    contact: sRows.map((r) => str(r?.[0])).find((t) => /^\[.*@/.test(t)) || '',
    footer: sRows.map((r) => str(r?.[0])).find((t) => /^FSCF Ireland ·/.test(t)) || '',
  };

  return {
    sourceName: file.name, importedAt: new Date().toISOString(), seq,
    customers: Object.values(customers).sort((a, b) => a.id.localeCompare(b.id)),
    register, pastLines: [...pastLines.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 4000),
    rates, terms, company,
  };
}

// ---------- Numbers and money ----------
// Next numbers: whichever is higher, the workbook or documents made in the app
export function nextNumbers(book, appDocs) {
  const s = book?.seq || { tab: 0, quote: 0, inv: 0 };
  const tab = Math.max(s.tab, ...appDocs.map((d) => d.tab || 0)) + 1;
  const quote = Math.max(s.quote, ...appDocs.filter((d) => d.kind === 'Q').map((d) => +(/\d+/.exec(d.quote || '') || [0])[0])) + 1;
  const inv = Math.max(s.inv, ...appDocs.filter((d) => d.kind === 'INV').map((d) => +(/\d+/.exec(d.inv || '') || [0])[0])) + 1;
  return { tab, quote: 'A-' + pad3(quote), inv: 'INV-' + pad3(inv) };
}

// Selling price from cost + labour. Mark's pricing docs use a ×1.4 multiplier
// (40% markup); SERV PD MASTER shows a 40% margin (÷0.6). Set in Settings.
export function sellPrice(cost, labour, rule = 'x1.4') {
  const base = (Number(cost) || 0) + (Number(labour) || 0);
  return r2(rule === 'margin40' ? base / 0.6 : base * 1.4);
}

export function totals(doc) {
  const subtotal = r2((doc.items || []).reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.unit) || 0), 0));
  const preLims = Number(doc.preLims) || 0;
  const fuel = Number(doc.fuel) || 0;
  const vatRate = Number(doc.vatRate) || 0;
  const vatDue = doc.vatMode === 'rct' ? 0 : r2(subtotal * vatRate);
  return { subtotal, preLims, fuel, vatRate, vatDue, total: r2(subtotal + preLims + fuel + vatDue) };
}

export const isInspection = (doc) => doc.workType === 'FDINSP';
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ieDate = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-IE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

// Wording used on page 1 for VAT the principal contractor accounts for
export const RCT_TEXT = 'VAT on this supply to be accounted for by the principal contractor.';

// ---------- PDF (layout as the quotes in Drive) ----------
const NAVY = [31, 56, 100];
const INK = [20, 24, 30];
const GREY = [110, 118, 128];

export async function quotePdf(doc, ctx) {
  const { jsPDF, lists, book } = ctx;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 14;
  const co = book?.company || {};
  const t = totals(doc);
  const isInv = doc.kind === 'INV';
  const set = (style, size, color = INK) => { pdf.setFont('helvetica', style); pdf.setFontSize(size); pdf.setTextColor(...color); };
  const bar = (x, y, w, label) => { pdf.setFillColor(...NAVY); pdf.rect(x, y, w, 6, 'F'); set('bold', 8.5, [255, 255, 255]); pdf.text(label, x + 2, y + 4.2); };

  // header: banner logo, company block, title and reference box
  const lg = lists.logoBanner || lists.logoRound;
  if (lg) {
    const k = Math.min(62 / lg.w, 16 / lg.h);
    pdf.addImage(lg.data, 'PNG', M, 10, lg.w * k, lg.h * k, undefined, 'FAST');
  }
  set('bold', 22, NAVY);
  pdf.text(isInv ? 'INVOICE' : 'QUOTE', W - M, 24, { align: 'right' });
  set('normal', 8.5);
  const coLines = co.lines?.length ? co.lines : ['Copponagh', 'Bailieborough', 'Co. Cavan', 'A82YK46', 'Phone: 0831007192', 'Prepared by: Mark Crosby', 'V.A.T No. 7345019I'];
  let y = 32;
  for (const l of coLines.filter((l) => isInv ? !/not a vat invoice/i.test(l) : true)) { pdf.text(l, M, y); y += 4.3; }
  const ref = isInv
    ? [['Date:', ieDate(doc.date)], ['Quote No:', doc.quote], ['Customer I.D.', doc.cust.id], ['Due Date:', ieDate(addDays(doc.date, doc.days || 30))], ['PO No:', doc.po || ''], ['Invoice No:', doc.inv]]
    : [['DATE', ieDate(doc.date)], ['QUOTE #', doc.quote], ['CUSTOMER ID', doc.cust.id], ['VALID UNTIL', ieDate(addDays(doc.date, doc.days || 30))]];
  let ry = 37;
  for (const [k, v] of ref) {
    set('normal', 8.5);
    pdf.text(k, W - M - 36, ry, { align: 'right' });
    pdf.setDrawColor(...NAVY);
    pdf.setLineWidth(0.25);
    pdf.rect(W - M - 34, ry - 3.6, 34, 5);
    pdf.text(String(v || ''), W - M - 17, ry, { align: 'center' });
    ry += 5;
  }

  // customer and delivery address blocks
  y = Math.max(y, ry) + 4;
  bar(M, y, 98, 'CUSTOMER');
  bar(W - M - 64, y, 64, 'Delivery Address');
  y += 10;
  set('normal', 8.5);
  const cl = doc.cust.lines || [];
  const sl = doc.site?.lines || [];
  const n = Math.max(cl.length, sl.length);
  for (let i = 0; i < n; i++) {
    if (cl[i]) pdf.text(pdf.splitTextToSize(cl[i], 96)[0], M, y);
    if (sl[i]) pdf.text(pdf.splitTextToSize(sl[i], 62)[0], W - M - 64, y);
    y += 4.3;
  }
  y += 5;

  // items
  const body = (doc.items || []).map((it) => [it.desc, String(it.qty), money(it.unit), money((Number(it.qty) || 0) * (Number(it.unit) || 0))]);
  for (const nline of doc.notes || []) if (nline.trim()) body.push([{ content: nline, colSpan: 4, styles: { fontStyle: 'normal' } }]);
  if (doc.vatMode === 'rct') body.push([{ content: RCT_TEXT, colSpan: 4 }]);
  pdf.autoTable({
    startY: y, margin: { left: M, right: M }, head: [['DESCRIPTION', 'QUANTITY', 'Unit Cost', 'AMOUNT']], body,
    theme: 'plain', styles: { fontSize: 8.3, cellPadding: 1.8, textColor: INK, lineColor: [205, 210, 218], lineWidth: 0.1, valign: 'top' },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', halign: 'center' },
    columnStyles: { 0: { cellWidth: 104 }, 1: { cellWidth: 22, halign: 'center' }, 2: { cellWidth: 28, halign: 'right' }, 3: { cellWidth: 28, halign: 'right' } },
    alternateRowStyles: { fillColor: [244, 246, 249] },
  });
  y = pdf.lastAutoTable.finalY + 6;
  if (y > 225) { pdf.addPage(); y = 20; }

  // terms (page 1) and summary
  bar(M, y, 98, 'TERMS AND CONDITIONS');
  bar(W - M - 64, y, 64, isInv ? 'INVOICE SUMMARY' : 'QUOTE SUMMARY');
  set('normal', 8);
  const p1 = doc.p1Terms || (isInv ? 'Payment is due by the date shown above. The terms and conditions on page 2 remain applicable to the quoted and invoiced scope.' : 'Please read the terms and conditions on page 2 carefully before accepting this quotation. Acceptance of this quote or issue of a purchase order confirms agreement to these terms.');
  const special = doc.specialOrder ? `\nSPECIAL ORDER / NO RETURNS: ${doc.specialOrder} is a special-order item, non-returnable and non-refundable once ordered.` : '';
  pdf.text(pdf.splitTextToSize(p1 + special, 94), M + 2, y + 11);
  const rows = [['Subtotal', money(t.subtotal)], ['Pre Lims', money(t.preLims)], ['Fuel Surcharge', money(t.fuel)], ['VAT rate', (t.vatRate * 100).toFixed(2) + '%'], ['VAT due', money(t.vatDue)]];
  let sy = y + 10;
  for (const [k, v] of rows) { set('normal', 8.3); pdf.text(k, W - M - 62, sy); pdf.text(v, W - M - 1, sy, { align: 'right' }); sy += 5; }
  pdf.setFillColor(220, 230, 242);
  pdf.rect(W - M - 64, sy - 3.8, 64, 5.6, 'F');
  set('bold', 9);
  pdf.text('TOTAL', W - M - 62, sy);
  pdf.text(money(t.total), W - M - 1, sy, { align: 'right' });
  y = Math.max(sy + 10, y + 40);

  // banking and contact
  set('bold', 8.5);
  pdf.text('BANKING DETAILS', W / 2, y, { align: 'center' });
  set('normal', 8.5);
  pdf.text(`IBAN: ${co.iban || 'IE63 AIBK 9320 3502 9132 37'}`, W / 2, y + 4.5, { align: 'center' });
  pdf.text(`BIC: ${co.bic || 'AIBKIE2D'}`, W / 2, y + 9, { align: 'center' });
  pdf.text(`If you have any questions about this ${isInv ? 'invoice' : 'price quote'}, please contact`, W / 2, y + 16, { align: 'center' });
  pdf.text(co.contact || '[Mark Crosby, (083) 1007192, f.s.c.f.ireland@gmail.com]', W / 2, y + 20.5, { align: 'center' });
  set('bolditalic', 10);
  pdf.text('Thank You For Your Business!', W / 2, y + 26, { align: 'center' });

  // page 2: terms and acceptance
  const T = isInspection(doc) ? book?.terms?.insp : book?.terms?.works;
  if (T?.clauses?.length) {
    pdf.addPage();
    set('bold', 11, NAVY);
    pdf.text(T.title || 'TERMS & CONDITIONS', M, 18);
    set('normal', 8, GREY);
    pdf.text(`${isInv ? `Invoice reference: ${doc.inv}   |   Quote: ${doc.quote}` : `Quote reference: ${doc.quote}`}   |   Customer: ${doc.cust.id}   |   Site: ${(doc.site?.lines || [])[0] || ''}`, M, 24);
    let ty = 31;
    set('normal', 7.8);
    const clauses = [...T.clauses];
    if (doc.specialOrder) clauses.push(`${clauses.length + 1}. SPECIAL ORDER / NO RETURNS — ${doc.specialOrder} is a special-order item. It is non-returnable and non-refundable once ordered.`);
    for (const c of clauses) {
      const lines = pdf.splitTextToSize(c, W - 2 * M);
      if (ty + lines.length * 3.4 > 262) { pdf.addPage(); ty = 18; }
      pdf.text(lines, M, ty);
      ty += lines.length * 3.4 + 1.6;
    }
    if (!isInv) {
      ty += 3;
      set('bold', 9, NAVY);
      pdf.text('CUSTOMER ACCEPTANCE', M, ty);
      set('normal', 8.5);
      pdf.text('Name: ______________________________', M, ty + 8);
      pdf.text('Position: __________________________', W / 2, ty + 8);
      pdf.text('Signature: _________________________', M, ty + 16);
      pdf.text('Date: ______________________________', W / 2, ty + 16);
      pdf.text('Purchase order / instruction reference: ____________________', M, ty + 24);
    }
    set('normal', 7.5, GREY);
    pdf.text(co.footer || 'FSCF Ireland · Copponagh · Bailieborough · Co. Cavan · A82 YK46', W / 2, 287, { align: 'center' });
  }
  return pdf.output('blob');
}

// ---------- Excel tab laid out like the samples ----------
// A sheet in the same cells as FD WORKS / FD INSP QUOTE SAMPLE and INV-114,
// with live formulas, plus the SUMMARY register row ready to paste.
export async function quoteXlsx(doc, book, pd = null) {
  const XLSX = await loadSheetJS();
  const isInv = doc.kind === 'INV';
  const t = totals(doc);
  const aoa = [];
  const set = (r, c, v) => { (aoa[r - 1] ||= [])[c] = v; };
  const co = book?.company?.lines?.length ? book.company.lines : ['Copponagh', 'Bailieborough', 'Co. Cavan', 'A82YK46', 'Phone: 0831007192', 'Prepared by: Mark Crosby', 'V.A.T No. 7345019I', '*This is not a VAT invoice'];
  set(1, 3, isInv ? 'INVOICE' : 'QUOTE');
  co.slice(0, 8).forEach((l, i) => set(2 + i, 0, l));
  const head = isInv ? [['Date:', doc.date], ['Quote No:', doc.quote], ['Customer I.D.', doc.cust.id], ['Due Date:', null], ['PO No:', doc.po || ''], ['Invoice No:', doc.inv]]
    : [['DATE', doc.date], ['QUOTE #', doc.quote], ['CUSTOMER ID', doc.cust.id], ['VALID UNTIL', null]];
  head.forEach(([k, v], i) => { set(3 + i, 2, k); set(3 + i, 3, v); });
  set(11, 0, 'CUSTOMER');
  set(11, 2, 'Delivery Address');
  (doc.cust.lines || []).slice(0, 10).forEach((l, i) => set(12 + i, 0, l));
  (doc.site?.lines || []).slice(0, 10).forEach((l, i) => set(12 + i, 2, l));
  set(23, 0, 'DESCRIPTION'); set(23, 1, 'QUANTITY'); set(23, 2, 'Unit Cost'); set(23, 3, 'AMOUNT');
  const items = doc.items || [];
  const last = Math.max(37, 23 + items.length + (doc.notes || []).length + 1);
  items.forEach((it, i) => { set(24 + i, 0, it.desc); set(24 + i, 1, Number(it.qty) || 0); set(24 + i, 2, Number(it.unit) || 0); });
  let nr = 24 + items.length;
  for (const nline of doc.notes || []) if (nline.trim()) set(nr++, 0, nline);
  if (doc.vatMode === 'rct') set(nr++, 0, RCT_TEXT);
  const s = last + 2; // summary starts two rows below the item band (row 39 on the samples)
  set(s, 0, 'TERMS AND CONDITIONS'); set(s, 2, isInv ? 'INVOICE SUMMARY' : 'QUOTE SUMMARY');
  set(s + 1, 0, doc.p1Terms || ''); set(s + 1, 2, 'Subtotal');
  set(s + 2, 2, 'Pre Lims'); set(s + 2, 3, t.preLims);
  set(s + 3, 2, 'Fuel Surcharge'); set(s + 3, 3, t.fuel);
  set(s + 4, 2, 'VAT rate'); set(s + 4, 3, t.vatRate);
  set(s + 5, 2, 'VAT due');
  set(s + 6, 2, 'TOTAL');
  set(s + 10, 0, 'BANKING DETAILS');
  set(s + 11, 0, 'IBAN: ' + (book?.company?.iban || 'IE63 AIBK 9320 3502 9132 37'));
  set(s + 12, 0, 'BIC: ' + (book?.company?.bic || 'AIBKIE2D'));
  set(s + 14, 0, 'If you have any questions about this price quote, please contact');
  set(s + 15, 0, book?.company?.contact || '[Mark Crosby, (083) 1007192, f.s.c.f.ireland@gmail.com]');
  set(s + 16, 0, 'Thank You For Your Business!');
  const T = isInspection(doc) ? book?.terms?.insp : book?.terms?.works;
  let tr = s + 19;
  if (T) {
    set(tr++, 0, T.title);
    set(tr++, 0, null);
    tr++;
    for (const c of T.clauses) set(tr++, 0, c);
    if (doc.specialOrder) set(tr++, 0, `${T.clauses.length + 1}. SPECIAL ORDER / NO RETURNS — ${doc.specialOrder} is a special-order item. It is non-returnable and non-refundable once ordered.`);
  }
  for (let r = 0; r < aoa.length; r++) aoa[r] ||= [];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // live formulas, as the workbook rules require
  const dateCell = (r) => { ws['D' + r] = { t: 'n', f: `DATE(${doc.date.slice(0, 4)},${+doc.date.slice(5, 7)},${+doc.date.slice(8, 10)})`, z: 'dd/mm/yyyy' }; };
  dateCell(3);
  ws[isInv ? 'D6' : 'D6'] = { t: 'n', f: `D3+${doc.days || 30}`, z: 'dd/mm/yyyy' };
  items.forEach((_, i) => { ws['D' + (24 + i)] = { t: 'n', f: `B${24 + i}*C${24 + i}` }; });
  // lines tied to the pricing document: description and price come from its door summary
  let pdOut = null;
  if (pd && doc.pd) {
    pdOut = pdSheet(XLSX, doc, pd);
    const ref = `'${pdName(doc)}'!`;
    items.forEach((it, i) => {
      const k = pd.doors.findIndex((d) => d.doorId === it.doorId);
      if (k < 0) return;
      ws['A' + (24 + i)] = { t: 's', v: it.desc, f: `${ref}A${pdOut.sumRows[k]}` };
      ws['C' + (24 + i)] = { t: 'n', v: it.unit, f: `${ref}B${pdOut.sumRows[k]}` };
    });
  }
  ws['D' + (s + 1)] = { t: 'n', f: `SUM(D24:D${last})` };
  ws['D' + (s + 5)] = { t: 'n', f: doc.vatMode === 'rct' ? '0' : `D${s + 1}*D${s + 4}` };
  ws['D' + (s + 6)] = { t: 'n', f: `SUM(D${s + 1}:D${s + 3})+D${s + 5}` };
  if (T) ws['A' + (s + 20)] = { t: 's', f: isInv ? `"Invoice reference: "&D8&"   |   Quote: "&D4&"   |   Customer: "&D5` : `"Quote reference: "&D4&"   |   Customer: "&D5&"   |   Site: "&C12` };
  ws['!cols'] = [{ wch: 70 }, { wch: 11 }, { wch: 16 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  const name = tabName(doc).slice(0, 31);
  if (pdOut) XLSX.utils.book_append_sheet(wb, pdOut.ws, pdName(doc).slice(0, 31));
  XLSX.utils.book_append_sheet(wb, ws, name);
  // SUMMARY register row (columns A–M)
  const reg = [['Tab #', 'Sheet Name', 'Document Type', 'Customer ID', 'Quote No', 'LOCATION', 'WORK TYPE', 'Invoice No', 'Paid', 'Date', 'Subtotal (€)', 'Total (€)', 'Paid On Date'],
    [doc.tab, tabName(doc), isInv ? 'Invoice' : 'Quote', doc.cust.id, doc.quote, ((doc.site?.lines || [])[0] || '').toUpperCase(), doc.workType, doc.inv || '', doc.status, doc.date, t.subtotal, t.total, '']];
  const ws2 = XLSX.utils.aoa_to_sheet(reg);
  ws2['!cols'] = [{ wch: 6 }, { wch: 34 }, { wch: 10 }, { wch: 11 }, { wch: 9 }, { wch: 30 }, { wch: 9 }, { wch: 9 }, { wch: 6 }, { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'SUMMARY ROW');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return saveFile(`${safeName(tabName(doc))}.xlsx`, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

// Suggest a customer ID for a new customer: first word, up to 5 letters, -001
export function suggestCustomerId(name, existing) {
  const base = (str(name).toUpperCase().replace(/^(THE|ST\.?)\s+/, 'ST').match(/[A-Z]+/g) || ['CUST']).join('').slice(0, 5) || 'CUST';
  let n = 1;
  while (existing.some((c) => c.id === `${base}-${pad3(n)}`)) n++;
  return `${base}-${pad3(n)}`;
}

// Tags like "3no_10mm_intumescent_combined_seals" → readable text and quantity
export function readableTag(tag) {
  const m = /^(\d+)\s*no_?(.*)$/i.exec(tag || '');
  const q = m ? +m[1] : 1;
  const name = (m ? m[2] : tag || '').replace(/^\d{3}[a-z]_/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return { qty: q, name: name.charAt(0).toUpperCase() + name.slice(1) };
}

// ---------- Pricing document (PD) from a report's failed doors ----------
// Laid out like "CHES-001 SERV PD-031": a block per door with its tags
// (quantity, price, labour, ex margin, with margin), door spec, the report's
// recommendations and notes, a DOOR PRICING SUMMARY, and the ITEM QUANTITIES &
// RATES table every door looks its rates up from. The quote's lines link to
// the summary, so changing a rate in Excel updates every door and the quote.

const keyOf = (s) => String(s || '').toLowerCase().replace(/^\d+\s*no[_\s]+/, '').replace(/[^a-z0-9]+/g, '');
// spelling variants Fieldwire tags come in: plural, "_sign(s)" suffix, "001b" code
function variants(k) {
  const out = new Set();
  const base = k.replace(/^\d{3}[a-z]/, '');
  for (const x of [k, base]) {
    out.add(x); out.add(x.replace(/s$/, '')); out.add(x + 's');
    out.add(x.replace(/signs?$/, '')); out.add(x.replace(/signs?$/, '') + 'sign'); out.add(x.replace(/signs?$/, '') + 'signs');
  }
  return out;
}
export const multiplier = (rule) => (rule === 'margin40' ? 1 / 0.6 : 1.4);

// A door's tags: Fieldwire tags (kept in its notes) and the app's products
function doorTags(d) {
  const out = [];
  const tagLine = /(?:^|\n)Tags:\s*(.+)/.exec(d.notes || '')?.[1] || '';
  for (const raw of tagLine.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*no\s+(.+)$/i.exec(raw);
    const name = (m ? m[2] : raw).trim().replace(/\s+/g, '_');
    out.push({ tag: (m ? `${m[1]}no_` : '') + name, key: name, qty: m ? +m[1] : 1, from: 'tag' });
  }
  for (const m of d.materials || []) {
    out.push({ tag: m.name, key: m.name, qty: Number(m.qty) || 1, from: 'product', appCost: Number(m.cost) || 0 });
  }
  return out;
}

// Price every failed door from the workbook rates (or the app's own price)
export function priceDoors(doors, book, rule = 'x1.4') {
  const mult = multiplier(rule);
  const rateBy = new Map();
  for (const r of book?.rates || []) {
    for (const k of [r.item, r.tag]) if (k && !rateBy.has(keyOf(k))) rateBy.set(keyOf(k), r);
  }
  const failed = doors.filter((d) => d.status === 'fail' || (d.actions || []).length || (d.materials || []).length).sort((a, b) => (a.pinNo || 0) - (b.pinNo || 0));
  const items = new Map();
  const priced = failed.map((d) => {
    const rows = doorTags(d).map((t) => {
      const k = keyOf(t.key);
      let it = items.get(k);
      if (!it) {
        const r = rateBy.get(k) || [...variants(k)].map((v) => rateBy.get(v)).find(Boolean);
        it = r ? { key: t.key, cost: r.cost, labour: r.labour, status: 'Priced', source: 'SERV PD MASTER' }
          : t.from === 'product' && t.appCost ? { key: t.key, cost: t.appCost, labour: 0, status: 'App price', source: 'App price list (labour not set)' }
          : { key: t.key, cost: 0, labour: 0, status: 'MISSING', source: 'Not in SERV PD MASTER' };
        items.set(k, it);
      }
      return { tag: t.tag, qty: t.qty, key: it.key, cost: it.cost, labour: it.labour };
    });
    const exMargin = rows.reduce((a, x) => a + x.qty * (x.cost + x.labour), 0);
    const rating = /Door rating:\s*(.+)/i.exec(d.notes || '')?.[1] || d.doorType || '';
    const notes = (/(?:^|\n)Notes:\s*(.+)/.exec(d.notes || '')?.[1] || '').split(' · ').filter(Boolean);
    return {
      doorId: d.id, label: `ID: ${d.pinNo} - ${(d.location || d.ref || '').toUpperCase()}`.trim(),
      rows, rating, recs: d.actions || [], notes, exMargin: r2(exMargin), price: r2(exMargin * mult),
    };
  });
  const list = [...items.values()];
  return { doors: priced, items: list, mult, missing: list.filter((i) => i.status === 'MISSING').length };
}

export function nextPd(book, appDocs) {
  return Math.max(book?.seq?.pd || 0, ...appDocs.map((d) => +(/\d+/.exec(d.pd || '') || [0])[0])) + 1;
}

export const pdName = (doc) => `${doc.cust.id} SERV ${doc.pd}`;

// Write the PD sheet; returns the sheet and the row of each door's summary line
export function pdSheet(XLSX, doc, pd) {
  const aoa = [];
  const f = {};
  const put = (r, c, v) => { (aoa[r - 1] ||= [])[c] = v; };
  const site = doc.site?.lines || [];
  put(1, 0, [site[0], site[1]].filter(Boolean).join(' ').toUpperCase() || doc.cust.id);
  put(2, 0, 'Margin multiplier'); put(2, 1, Math.round(pd.mult * 10000) / 10000);
  put(2, 3, 'Tag rates come from the ITEM QUANTITIES & RATES table below. Change a rate there and every door and the quote update.');
  let r = 4;
  const blocks = [];
  for (const d of pd.doors) {
    put(r++, 0, d.label);
    ['Tag', 'QUANTITY', 'INFO', 'PRICE', 'LABOUR', 'EX MARGIN', 'WITH MARGIN'].forEach((h, i) => put(r, i, h));
    r++;
    const first = r;
    const tagRows = [];
    for (const t of d.rows) { put(r, 0, t.tag); put(r, 1, t.qty); put(r, 2, t.key); tagRows.push(r); r++; }
    put(r, 0, 'Door spec'); put(r, 1, d.rating ? `Door Rating: ${d.rating}` : 'Door Rating:'); r++;
    const recRows = [];
    d.recs.forEach((t, i) => { put(r, 0, `Recommendation ${i + 1}`); put(r, 1, `Not set: ${t}`); put(r, 5, 0); recRows.push(r); r++; });
    d.notes.forEach((t, i) => { put(r, 0, `Note ${i + 1}`); put(r, 1, t); r++; });
    const totRow = r;
    put(r, 2, 'TOTALS EX VAT');
    r += 2;
    blocks.push({ first, tagRows, recRows, totRow, d });
  }
  put(r++, 0, 'DOOR PRICING SUMMARY');
  put(r, 0, 'Door'); put(r, 1, 'Customer Price Ex VAT'); r++;
  const sumRows = [];
  for (const bl of blocks) { put(r, 0, bl.d.label); sumRows.push(r); r++; }
  const grandRow = r;
  put(r++, 0, 'GRAND TOTAL EX VAT');
  r += 2;
  put(r++, 0, 'ITEM QUANTITIES & RATES');
  ['Item', 'Price', 'Labour', 'Total Quantity', 'Status', 'Source / note'].forEach((h, i) => put(r, i, h));
  r++;
  const rateFirst = r;
  for (const it of pd.items) { put(r, 0, it.key); put(r, 1, it.cost); put(r, 2, it.labour); put(r, 4, it.status); put(r, 5, it.source); r++; }
  const rateLast = Math.max(rateFirst, r - 1);
  const firstDoorRow = blocks[0]?.first || 6;
  const lastDoorRow = blocks.length ? blocks[blocks.length - 1].totRow : 6;
  pd.items.forEach((_, i) => { f[`D${rateFirst + i}`] = `SUMIF($C$${firstDoorRow}:$C$${lastDoorRow},A${rateFirst + i},$B$${firstDoorRow}:$B$${lastDoorRow})`; });
  for (const bl of blocks) {
    for (const tr of bl.tagRows) {
      f[`D${tr}`] = `IFERROR(INDEX($B$${rateFirst}:$B$${rateLast},MATCH(C${tr},$A$${rateFirst}:$A$${rateLast},0)),0)`;
      f[`E${tr}`] = `IFERROR(INDEX($C$${rateFirst}:$C$${rateLast},MATCH(C${tr},$A$${rateFirst}:$A$${rateLast},0)),0)`;
      f[`F${tr}`] = `B${tr}*(D${tr}+E${tr})`;
      f[`G${tr}`] = `F${tr}*$B$2`;
    }
    for (const rr of bl.recRows) f[`G${rr}`] = `IF(F${rr}="","",F${rr}*$B$2)`;
    for (const c of 'DEFG') f[`${c}${bl.totRow}`] = `SUM(${c}${bl.first}:${c}${bl.totRow - 1})`;
  }
  sumRows.forEach((sr, i) => { f[`B${sr}`] = `G${blocks[i].totRow}`; });
  f[`B${grandRow}`] = sumRows.length ? `SUM(B${sumRows[0]}:B${sumRows[sumRows.length - 1]})` : '0';
  for (let i = 0; i < aoa.length; i++) aoa[i] ||= [];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (const [cell, fx] of Object.entries(f)) ws[cell] = { t: 'n', f: fx };
  ws['!cols'] = [{ wch: 46 }, { wch: 40 }, { wch: 34 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 13 }];
  return { ws, sumRows };
}
