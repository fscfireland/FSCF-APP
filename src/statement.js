// Statement of account for one customer, laid out like the owner's SOA tabs
// in the INVOICES AND QUOTES workbook (e.g. "ADV-001 OCT 2026 SOA"):
// header, CUSTOMER block, STATEMENT DETAILS (customer ID, period, status as
// at), then DATE | INVOICE NO. | QUOTE NO. | STATUS | INVOICE TOTAL |
// OUTSTANDING, and TOTALS.
// Which invoices: every sent invoice still unpaid (whatever its date), plus
// every invoice dated in the period (paid ones show 0 outstanding) – as the
// owner's October statement for ADV-001 does. Invoices not sent yet (WIP /
// PROC) are left off.

import { capsPdf } from './caps.js';
import { money } from './quotes.js';
import { isDraftInv, isPaid } from './business.js';

const NAVY = [31, 56, 100];
const INK = [20, 24, 30];
const ie = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-IE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const monthName = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-IE', { month: 'long', year: 'numeric' });

export function statementRows(ledger, custId, from, to) {
  const rows = ledger.filter((e) => e.kind === 'INV' && e.cust === custId && e.status !== 'NP' && !isDraftInv(e))
    .filter((e) => !isPaid(e) || ((e.date || '') >= from && (e.date || '') <= to))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.ref || '').localeCompare(b.ref || ''))
    .map((e) => ({ e, date: e.date, inv: `${e.ref}${e.part ? ' ' + e.part : ''}`, quote: e.quote || '', status: isPaid(e) ? 'Paid' : 'Unpaid', total: e.total, out: isPaid(e) ? 0 : e.total, overdue: !isPaid(e) && e.due && e.due < to }));
  const total = rows.reduce((a, r) => a + r.total, 0);
  const out = rows.reduce((a, r) => a + r.out, 0);
  const overdue = rows.filter((r) => r.overdue).reduce((a, r) => a + r.out, 0);
  return { rows, total, out, overdue };
}

export async function statementPdf({ jsPDF, lists, book, cust, custLines, from, to, asAt, st }) {
  const pdf = capsPdf(new jsPDF({ unit: 'mm', format: 'a4' }));
  const W = 210;
  const M = 14;
  const set = (style, size, color = INK) => { pdf.setFont('helvetica', style); pdf.setFontSize(size); pdf.setTextColor(...color); };
  const bar = (x, y, w, label) => { pdf.setFillColor(...NAVY); pdf.rect(x, y, w, 6, 'F'); set('bold', 8.5, [255, 255, 255]); pdf.text(label, x + 2, y + 4.2); };
  const lg = lists.logoBanner || lists.logoRound;
  let y = 14;
  if (lg) { const k = Math.min(62 / lg.w, 16 / lg.h); pdf.addImage(lg.data, 'PNG', M, 10, lg.w * k, lg.h * k, undefined, 'FAST'); y = 30; }
  set('bold', 12); pdf.text('FSCF Ireland', M, y);
  set('normal', 8.5);
  const co = book?.company?.lines?.length ? book.company.lines.filter((l) => !/^FSCF Ireland$/i.test(l)) : ['Copponagh', 'Bailieborough', 'Co. Cavan', 'A82YK46'];
  const addr = co.filter((l) => !/prepared by|phone|v\.?a\.?t/i.test(l)).slice(0, 4).join(', ');
  pdf.text(pdf.splitTextToSize(addr, 100), M, y + 5);
  set('bold', 18, NAVY); pdf.text('STATEMENT OF ACCOUNT', W - M, 22, { align: 'right' });
  set('normal', 10); pdf.text(monthName(to), W - M, 29, { align: 'right' });

  y = Math.max(y + 16, 44);
  bar(M, y, 98, 'CUSTOMER');
  bar(W - M - 70, y, 70, 'STATEMENT DETAILS');
  set('normal', 8.5);
  let cy = y + 11;
  for (const l of custLines.slice(0, 7)) { pdf.text(pdf.splitTextToSize(l, 96)[0], M, cy); cy += 4.4; }
  let dy = y + 11;
  for (const [k, v] of [['Customer ID', cust], ['Period', `${ie(from)} - ${ie(to)}`], ['Status as at', ie(asAt)]]) {
    set('normal', 8.5); pdf.text(k, W - M - 68, dy); set('bold', 8.5); pdf.text(v, W - M - 1, dy, { align: 'right' }); dy += 5;
  }
  y = Math.max(cy, dy) + 6;

  pdf.autoTable({
    startY: y, margin: { left: M, right: M },
    head: [['DATE', 'INVOICE NO.', 'QUOTE NO.', 'STATUS', 'INVOICE TOTAL', 'OUTSTANDING']],
    body: st.rows.map((r) => [ie(r.date), r.inv, r.quote, r.overdue ? 'Unpaid (overdue)' : r.status, money(r.total), money(r.out)]),
    foot: [[{ content: 'TOTALS', colSpan: 4, styles: { halign: 'left' } }, money(st.total), money(st.out)]],
    theme: 'plain', styles: { fontSize: 8.5, cellPadding: 2, textColor: INK, lineColor: [205, 210, 218], lineWidth: 0.1 },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' }, footStyles: { fillColor: [220, 230, 242], textColor: INK, fontStyle: 'bold' },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' } }, alternateRowStyles: { fillColor: [244, 246, 249] },
  });
  y = pdf.lastAutoTable.finalY + 8;
  set('bold', 10);
  pdf.text(`Balance outstanding: ${money(st.out)}`, M, y);
  if (st.overdue) { set('normal', 9, [160, 30, 30]); pdf.text(`of which overdue: ${money(st.overdue)}`, M, y + 5); y += 5; }
  y += 9;
  set('normal', 8.5);
  const iban = book?.company?.iban;
  const lines = [
    'Please quote the invoice number with all payments.',
    iban ? `Bank details: IBAN ${iban}${book.company.bic ? ` · BIC ${book.company.bic}` : ''}` : '',
    book?.company?.contact ? `If you have any questions about this statement, please contact ${book.company.contact.replace(/^\[|\]$/g, '')}` : '',
  ].filter(Boolean);
  for (const l of lines) { const w = pdf.splitTextToSize(l, W - 2 * M); pdf.text(w, M, y); y += 4.6 * w.length; }
  y += 4;
  set('bold', 10, NAVY); pdf.text('Thank You For Your Business!', M, y);
  return pdf.output('blob');
}
