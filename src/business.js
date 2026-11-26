// Business overview: invoices, payments, customers, work types and costs.
//
// Every figure here is worked out from the owner's own records, nothing else:
//  - the INVOICES AND QUOTES workbook (each quote / invoice tab, the SUMMARY
//    register's status and Paid On Date, and the SERV PD pricing documents),
//  - and the quotes and invoices made in the app.
// The app adds no rates or opinions of its own. Rules used:
//  - Revenue / work invoiced is the invoice Subtotal ex VAT, as on each invoice.
//  - Money owed is the invoice TOTAL inc VAT (what the customer pays).
//  - Due date is the invoice's Due Date box; if blank, invoice date + 30 days
//    (the app's invoice layout: Due Date = date + 30 days, and the invoice terms
//    "Payment is due by the date shown above").
//  - Paid = status P in the SUMMARY register (or marked paid here).
//  - Materials / labour / margin come from the PRICE, LABOUR and WITH MARGIN
//    columns of the job's pricing document (SERV PD), only where one exists.

import { totals, WORK_TYPES, STATUSES, money } from './quotes.js';
import { loadSheetJS, saveFile } from './files.js';
import { capsWorkbook } from './caps.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 864e5);
export const SOURCES = {
  book: 'INVOICES AND QUOTES workbook (FSCF)',
  due: 'Invoice Due Date box; if blank, invoice date + 30 days (FSCF invoice terms: "Payment is due by the date shown above")',
  paid: 'SUMMARY register, Paid and Paid On Date columns (FSCF)',
  cost: 'SERV PD pricing documents: PRICE, LABOUR and WITH MARGIN columns (FSCF)',
};

const keyOf = (kind, quote, inv, part) => `${kind}|${kind === 'INV' ? inv : quote}|${part || ''}`;

// One list of every quote and invoice: workbook tabs plus app documents. A
// document in both (same number) is taken from the app, where it can be edited.
// `marks` holds paid / status changes made on this page to workbook documents.
export function buildLedger(book, appDocs, marks = {}, extra = {}, ownNames = {}) {
  // Customer name: the customer block line that appears on most of that customer's
  // documents (e.g. "HSE Mid West"), not the contact person on the latest one.
  // Contacts: the first line of each document's customer block.
  const blocks = {};
  const addBlock = (id, lines) => { if (id && lines?.length) (blocks[id] ||= []).push(lines.map((l) => String(l).trim()).filter(Boolean)); };
  for (const r of book?.register || []) addBlock(r.cust, r.custLines);
  for (const d of appDocs) addBlock(d.cust?.id, d.cust?.lines);
  for (const c of book?.customers || []) if (!blocks[c.id]) addBlock(c.id, c.lines);
  const names = {};
  const contacts = {};
  for (const [id, list] of Object.entries(blocks)) {
    const score = new Map();
    for (const lines of list) lines.slice(0, 4).forEach((l, i) => { const k = l.toUpperCase(); const x = score.get(k) || { l, n: 0, pos: 0 }; x.n++; x.pos += i; score.set(k, x); });
    const best = [...score.values()].sort((a, b) => b.n - a.n || a.pos / a.n - b.pos / b.n)[0];
    names[id] = best?.l || '';
    contacts[id] = [...new Set(list.map((l) => l[0]).filter((l) => l && l.toUpperCase() !== names[id].toUpperCase()))];
  }
  const out = new Map();
  for (const r of book?.register || []) {
    const m = marks[r.sheet] || {};
    const sub = r.subtotal ?? (r.total != null && r.vatRate != null ? r.total / (1 + r.vatRate) : r.total);
    const e = {
      src: 'wb', id: r.sheet, ref: r.kind === 'INV' ? r.inv : r.quote, kind: r.kind, part: r.part || '', quote: r.quote, inv: r.inv,
      cust: r.cust, site: (r.siteLines?.[0] || r.location || '').trim(), date: r.date || '', due: r.due || '', days: 30,
      subtotal: r2(sub), total: r2(r.total ?? sub), status: m.status || r.status || '', paidOn: m.paidOn || r.paidOn || '', workType: r.workType || '',
      pd: '', cost: null,
    };
    out.set('wb|' + r.sheet, e); // each workbook tab once, even if two share a number
  }
  const wbKey = new Map([...out.entries()].map(([k, e]) => [keyOf(e.kind, e.quote, e.inv, e.part), k]));
  for (const d of appDocs) {
    const t = totals(d);
    const e = {
      src: 'app', id: d.id, ref: d.kind === 'INV' ? d.inv : d.quote, kind: d.kind === 'INV' ? 'INV' : 'Q', part: d.part || '', quote: d.quote, inv: d.inv,
      cust: d.cust?.id || '', site: (d.site?.lines?.[0] || '').trim(), date: d.date || '', due: '', days: Number(d.days) || 30,
      subtotal: r2(t.subtotal + t.preLims + t.fuel), total: t.total, status: d.status || '', paidOn: d.paidOn || '', workType: d.workType || '',
      pd: d.pd || '', projectId: d.projectId || null, fromQuoteId: d.fromQuoteId || null,
      cost: d.matCost != null || d.labCost != null ? { materials: r2(d.matCost), labour: r2((d.labCost || 0) + (d.preLimsCost || 0)), from: d.pd || 'app quote' } : (extra[d.id] || null),
    };
    const k = keyOf(e.kind, e.quote, e.inv, e.part);
    if (wbKey.has(k)) out.delete(wbKey.get(k)); // the app copy replaces the workbook tab
    out.set('app|' + d.id, e);
  }
  const all = [...out.values()];
  for (const e of all) {
    for (const k of ['date', 'due', 'paidOn']) if (e[k] && e[k] < '2000') e[k] = '';
    e.custName = ownNames[e.cust] || names[e.cust] || '';
    e.contacts = contacts[e.cust] || [];
    if (!e.due && e.date) e.due = addDays(e.date, e.days);
  }
  linkCosts(all, book?.pds || []);
  return all;
}

// Costs for workbook jobs: the customer's pricing document whose WITH MARGIN
// total matches the quote's subtotal (within 1%). Invoices take their quote's
// costs in proportion to the invoice subtotal (covers deposit / balance).
function linkCosts(all, pds) {
  const used = new Set();
  const quotes = all.filter((e) => e.kind === 'Q');
  for (const q of quotes) {
    if (q.cost) continue;
    const pd = pds.find((p) => !used.has(p.sheet) && p.cust === q.cust && (q.pd ? p.pd === q.pd : Math.abs(p.sell - q.subtotal) <= Math.max(1, q.subtotal * 0.01)));
    if (pd) { used.add(pd.sheet); q.cost = { materials: pd.materials, labour: pd.labour, sell: pd.sell, from: pd.sheet }; }
  }
  const byQuote = Object.fromEntries(quotes.filter((q) => q.cost).map((q) => [q.quote, q]));
  const byId = Object.fromEntries(all.map((e) => [e.id, e]));
  for (const inv of all.filter((e) => e.kind === 'INV' && !e.cost)) {
    const q = byQuote[inv.quote] || byId[inv.fromQuoteId];
    if (!q?.cost || !(q.subtotal > 0)) continue;
    const k = inv.subtotal / q.subtotal;
    inv.cost = { materials: r2(q.cost.materials * k), labour: r2(q.cost.labour * k), from: q.cost.from };
  }
}

export const isPaid = (e) => e.status === 'P';
const isLiveInv = (e) => e.kind === 'INV' && e.status !== 'NP';

export function years(ledger) {
  return [...new Set(ledger.map((e) => (e.date || '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))].sort().reverse();
}

// Everything the page shows for one year ('' = all years)
export function summarise(ledger, year = '', todayIso = new Date().toISOString().slice(0, 10)) {
  const inYear = (e) => !year || (e.date || '').startsWith(year);
  const invs = ledger.filter((e) => isLiveInv(e) && inYear(e));
  const quotes = ledger.filter((e) => e.kind === 'Q' && inYear(e));
  const sum = (l, k) => r2(l.reduce((a, e) => a + (Number(e[k]) || 0), 0));
  // owed and overdue are for every year: a debt is still a debt
  const unpaid = ledger.filter((e) => isLiveInv(e) && !isPaid(e)).map((e) => ({ ...e, late: e.due ? dayDiff(e.due, todayIso) : 0 }));
  const overdue = unpaid.filter((e) => e.late > 0).sort((a, b) => b.late - a.late);
  const notDue = unpaid.filter((e) => e.late <= 0).sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  const paid = invs.filter(isPaid).sort((a, b) => (b.paidOn || b.date).localeCompare(a.paidOn || a.date));
  const ageing = [[0, 30, '1–30 days'], [31, 60, '31–60 days'], [61, 90, '61–90 days'], [91, 1e9, 'Over 90 days']].map(([lo, hi, label]) => {
    const l = overdue.filter((e) => e.late >= lo && e.late <= hi);
    return { label, n: l.length, total: sum(l, 'total') };
  });

  // won quotes: their number is on an invoice
  const invoicedQuotes = new Set(ledger.filter((e) => e.kind === 'INV').map((e) => e.quote).filter(Boolean));
  const won = quotes.filter((q) => invoicedQuotes.has(q.quote));
  const lost = quotes.filter((q) => q.status === 'NP' && !invoicedQuotes.has(q.quote));
  const open = quotes.filter((q) => !invoicedQuotes.has(q.quote) && q.status !== 'NP');

  const months = Array.from({ length: 12 }, (_, i) => ({ m: i, invoiced: 0, paid: 0, n: 0 }));
  if (year) for (const e of invs) { const m = +e.date.slice(5, 7) - 1; if (m >= 0) { months[m].invoiced += e.subtotal; months[m].n++; if (isPaid(e)) months[m].paid += e.subtotal; } }
  months.forEach((m) => { m.invoiced = r2(m.invoiced); m.paid = r2(m.paid); });
  const byYear = year ? [] : years(ledger).reverse().map((y) => { const l = ledger.filter((e) => isLiveInv(e) && e.date.startsWith(y)); return { y, invoiced: sum(l, 'subtotal'), n: l.length }; });

  const group = (keyFn) => {
    const g = new Map();
    for (const e of invs) {
      const k = keyFn(e);
      const x = g.get(k) || { key: k, n: 0, invoiced: 0, paid: 0, owed: 0, sites: new Map(), custName: e.custName, contacts: e.contacts };
      x.n++; x.invoiced += e.subtotal;
      if (isPaid(e)) x.paid += e.total; else x.owed += e.total;
      if (e.site) x.sites.set(e.site.toUpperCase(), r2((x.sites.get(e.site.toUpperCase()) || 0) + e.subtotal));
      g.set(k, x);
    }
    return [...g.values()].map((x) => ({ ...x, invoiced: r2(x.invoiced), paid: r2(x.paid), owed: r2(x.owed), sites: [...x.sites.entries()].sort((a, b) => b[1] - a[1]) })).sort((a, b) => b.invoiced - a.invoiced);
  };
  const customers = group((e) => e.cust || '—');
  const work = group((e) => e.workType || '').map((w) => ({ ...w, label: WORK_TYPES[w.key] || (w.key ? w.key : 'Not set') }));
  const siteRows = group((e) => (e.site || 'Not set').toUpperCase()).slice(0, 15);

  const costed = invs.filter((e) => e.cost);
  const mat = sum(costed.map((e) => e.cost), 'materials');
  const lab = sum(costed.map((e) => e.cost), 'labour');
  const costedSell = sum(costed, 'subtotal');
  const cost = { n: costed.length, of: invs.length, sell: costedSell, materials: mat, labour: lab, margin: r2(costedSell - mat - lab) };

  return {
    year, invs, quotes,
    invoiced: sum(invs, 'subtotal'), invoicedInc: sum(invs, 'total'), received: sum(paid, 'total'),
    owed: sum(unpaid, 'total'), overdue, overdueTotal: sum(overdue, 'total'), notDue, paid, ageing,
    quoted: sum(quotes, 'subtotal'), won, lost, open, openTotal: sum(open, 'subtotal'),
    winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
    months, byYear, customers, work, siteRows, cost,
    avgDaysToPay: (() => { const l = paid.filter((e) => e.paidOn && e.date); return l.length ? Math.round(l.reduce((a, e) => a + dayDiff(e.date, e.paidOn), 0) / l.length) : null; })(),
  };
}

// Excel copy of the page: summary, invoices, customers, work types, quotes
export async function businessXlsx(s, label) {
  const XLSX = await loadSheetJS();
  const wb = XLSX.utils.book_new();
  const add = (name, aoa, cols) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = cols.map((wch) => ({ wch })); XLSX.utils.book_append_sheet(wb, ws, name); };
  add('Summary', [
    [`FSCF IRELAND BUSINESS SUMMARY ${label}`],
    [],
    ['Work invoiced (ex VAT)', s.invoiced], ['Invoiced inc VAT', s.invoicedInc], ['Received (inc VAT)', s.received],
    ['Owed now, all years (inc VAT)', s.owed], ['Overdue now (inc VAT)', s.overdueTotal], ['Overdue invoices', s.overdue.length],
    ['Quotes issued (ex VAT)', s.quoted], ['Quotes won', s.won.length], ['Quotes not proceeding', s.lost.length], ['Quotes open', s.open.length],
    ['Average days to be paid', s.avgDaysToPay ?? ''],
    [],
    ['Costs, from pricing documents', `${s.cost.n} of ${s.cost.of} invoices`], ['Sales on those invoices (ex VAT)', s.cost.sell],
    ['Materials', s.cost.materials], ['Labour', s.cost.labour], ['Margin', s.cost.margin],
    [],
    ['Sources'], ...Object.values(SOURCES).map((v) => [v]),
  ], [38, 18]);
  const invRow = (e) => [e.ref + (e.part ? ' ' + e.part : ''), e.quote, e.cust, e.custName, e.site, WORK_TYPES[e.workType] || e.workType, e.date, e.due, STATUSES[e.status] || e.status, e.paidOn, e.subtotal, e.total, e.late > 0 ? e.late : '', e.cost?.materials ?? '', e.cost?.labour ?? '', e.cost?.from || ''];
  const lateBy = Object.fromEntries(s.overdue.map((e) => [e.id, e.late]));
  add('Invoices', [['Invoice', 'Quote', 'Customer ID', 'Customer', 'Site', 'Work type', 'Date', 'Due', 'Status', 'Paid on', 'Subtotal ex VAT', 'Total inc VAT', 'Days overdue', 'Materials', 'Labour', 'Pricing doc'],
    ...s.invs.sort((a, b) => a.date.localeCompare(b.date)).map((e) => invRow({ ...e, late: lateBy[e.id] || 0 }))], [12, 9, 11, 30, 34, 16, 11, 11, 16, 11, 14, 14, 10, 12, 12, 26]);
  add('Overdue', [['Invoice', 'Customer', 'Site', 'Date', 'Due', 'Days overdue', 'Total inc VAT'], ...s.overdue.map((e) => [e.ref + (e.part ? ' ' + e.part : ''), e.custName || e.cust, e.site, e.date, e.due, e.late, e.total])], [12, 30, 34, 11, 11, 12, 14]);
  add('Customers', [['Customer ID', 'Customer', 'Invoices', 'Invoiced ex VAT', 'Paid inc VAT', 'Owed inc VAT', 'Sites'], ...s.customers.map((c) => [c.key, c.custName, c.n, c.invoiced, c.paid, c.owed, c.sites.map(([k, v]) => `${k} (${money(v)})`).join('; ')])], [11, 30, 9, 15, 14, 14, 60]);
  add('Work types', [['Work type', 'Invoices', 'Invoiced ex VAT', 'Paid inc VAT', 'Owed inc VAT'], ...s.work.map((w) => [w.label, w.n, w.invoiced, w.paid, w.owed])], [22, 9, 15, 14, 14]);
  add('Quotes', [['Quote', 'Customer', 'Site', 'Date', 'Subtotal ex VAT', 'Result'], ...s.quotes.map((q) => [q.ref, q.custName || q.cust, q.site, q.date, q.subtotal, s.won.includes(q) ? 'Won' : s.lost.includes(q) ? 'Not proceeding' : 'Open'])], [10, 30, 34, 11, 14, 14]);
  const out = XLSX.write(capsWorkbook(wb), { bookType: 'xlsx', type: 'array' });
  return saveFile(`FSCF business summary ${label}.xlsx`, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
