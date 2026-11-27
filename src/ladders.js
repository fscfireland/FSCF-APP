// Ladder checks (owner, 27 Nov 2026): one record per ladder, one per check, and a PDF of each check
// in the layout of the owner's own ladder check (Drive: "Ladder Check WK2207B-3J 2026-11-17.pdf").
//
// Sources (rule 1):
// - Checklist items 1–12, sections 1–8 and the notes: FSCF Form 129 (rev 000), as used in the owner's
//   ladder check of 17/11/2026, based on the HSA's GA3 "Report of Results of Inspections of Work
//   Equipment for Work at a Height".
// - Safety, Health and Welfare at Work (General Application) Regulations 2007, Reg 119 and Schedule 5:
//   inspection at suitable intervals, report within 24 hours, evidence of the last inspection travels
//   with the equipment, records kept 5 years (Reg 119(4)).
// - Re-inspection every 7 days: FSCF practice, as the owner's form (17/11 → re-inspect 23/11/2026);
//   Reg 119(1) itself says "suitable intervals". Changeable per ladder.
//
// Storage: settings records, so they merge across devices record by record (newer updatedAt wins):
//   { id: 'ladder-<uid>', kind: 'ladder', ref, type, make, material, duty, kept, interval, retired }
//   { id: 'lcheck-<uid>', kind: 'ladderCheck', ladderId, at, ... answers, signature }

import { loadJsPdf } from './report.js';
import { capsPdf } from './caps.js';

export const FORM_REF = 'FSCF Form 129 / HSA GA3; SHWW (General Application) Regs 2007, Reg 119';
export const LADDER_TYPES = ['Stepladder', 'Single ladder', 'Extension ladder', 'Platform / podium', 'Other'];
export const MATERIALS = ['Aluminium', 'Fibreglass', 'Timber', 'Steel', 'Other'];
export const METHODS = ['Visual', 'Functional', 'Both', 'Other'];
export const INTERVAL_DAYS = 7; // FSCF practice (owner's Form 129 re-inspection date); Reg 119(1) "suitable intervals"

// [component, what to check, applies(ladder) – when false the item starts as N/A]
export const ITEMS = [
  ['Rivets & fastenings', 'All in place and secure; no corrosion, cracking or movement'],
  ['Stiles', 'Free from distortion, damage, sharp edges, flaws, cracks and defects'],
  ['Rungs / steps', 'All in place and secure; free from distortion, damage and sharp edges'],
  ['Corrosion', 'Ladder free from corrosion'],
  ['Anti-slip feet', 'Top and bottom feet in place, secure and free from damage'],
  ['Timber ladders only', 'Clear varnish only, not paint which can hide defects', (l) => l.material === 'Timber'],
  ['SWL marking', 'Marked with a Safe Working Load'],
  ['Suitable for work use', 'Class 1 or EN 131 only'],
  ['Stability (stepladders)', 'Stable when positioned on level ground', (l) => /step|platform|podium/i.test(l.type || '')],
  ['Hinges (stepladders)', 'In place, secure and free from damage', (l) => /step/i.test(l.type || '')],
  ['Brackets / spreaders (stepladders)', 'Free from distortion and damage; lock fully', (l) => /step/i.test(l.type || '')],
  ['Platform / top step / handrail', 'Where fitted, secure and undamaged'],
];
export const itemApplies = (i, ladder) => !ITEMS[i][2] || ITEMS[i][2](ladder || {});

export const NOTES = [
  'GA3 – Report of Results of Inspections of Work Equipment for Work at a Height (Health and Safety Authority). This form may be used to assist in compliance with the Safety, Health and Welfare at Work (General Application) Regulations 2007, Regulation 119 – inspection of work equipment, including scaffolds, guard-rails, working platforms, fall-arrest and personal fall protection systems, and ladders. It is not an approved or statutory form; reports of inspection may be produced in other formats. The result must specify details of any matters identified that could give rise to a risk to the safety or health of any employee.',
  'Reg. 119(1): work equipment exposed to conditions causing deterioration that is liable to result in dangerous situations must be inspected at suitable intervals, and as soon as practicable after exceptional circumstances that could jeopardise its safety. Where safety depends on how equipment is installed or assembled, it must be inspected in that position before use.',
  'Reg. 119(2)–(3): a report containing the particulars in Schedule 5 must be prepared promptly and provided, or a copy, within 24 hours of completing the inspection to the person on whose behalf it was carried out, who must keep it (at the site until the work is complete, and thereafter at an office of the employer).',
  'Reg. 119(4): work equipment must not be used in another place of work unless accompanied by evidence that the last required inspection has been carried out, and the result of each inspection must be recorded and kept available for inspection by an inspector for 5 years from the date of inspection.',
  'FSCF Form 129 (rev 000) – Ladder inspection: the checklist in section 4 follows Form 129 for aluminium and wooden ladders and stepladders. If the ladder fails any item, TAKE THE LADDER OUT OF SERVICE NOW. If it cannot be repaired, ARRANGE FOR THE LADDER TO BE DESTROYED. Record the actions required and a re-inspection date.',
];

const DAY = 864e5;
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
export const nextDueOf = (ladder, last) => (last ? last.reinspect || isoDay(Date.parse(last.at) + (ladder.interval || INTERVAL_DAYS) * DAY) : '');

// where a ladder stands: ok / due / overdue / out / retired / new
export function ladderStatus(ladder, checks, today = isoDay(Date.now())) {
  const mine = checks.filter((c) => c.ladderId === ladder.id).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const last = mine[0] || null;
  const next = nextDueOf(ladder, last);
  let st = 'ok';
  if (ladder.retired) st = 'retired';
  else if (!last) st = 'new';
  else if (last.result === 'fail') st = 'out';
  else if (next < today) st = 'overdue';
  else if (next <= isoDay(Date.parse(today) + DAY)) st = 'due';
  return { st, last, next, checks: mine };
}
export const STATUS_LABEL = { ok: 'OK to use', due: 'Check due', overdue: 'Overdue', out: 'Out of service', retired: 'Destroyed / retired', new: 'Not checked yet' };

// ---------- PDF in the layout of the owner's ladder check ----------
const ORANGE = [222, 110, 32];
const PEACH = [246, 228, 210];
const DARK = [45, 45, 45];
const INK = [30, 30, 30];
const GREY = [90, 90, 90];
const RES = { pass: [198, 239, 206], fail: [255, 199, 206], na: [235, 235, 235] };
const ADDR = 'Independent Fire Door Inspection, Remedial & Fire-Stopping · Copponagh, Bailieborough, Co. Cavan, A82 YK46 · f.s.c.f.ireland@gmail.com';
const FOOT = 'Based on GA3 and FSCF Form 129 – Report of Results of Inspections: Work Equipment for Work at a Height (SHWW General Application Regs 2007, Reg. 119). Not an approved statutory form.';
const fmt = (iso, time) => { if (!iso) return ''; const d = new Date(iso); return time ? d.toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString('en-IE', { dateStyle: 'medium' }); };

export async function ladderPdf(ladder, c) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  capsPdf(doc);
  const W = 210; const M = 16; const CW = W - 2 * M; const BOTTOM = 276;
  let y = 22;
  const font = (s, z, col = INK) => { doc.setFont('helvetica', s); doc.setFontSize(z); doc.setTextColor(...col); };
  const need = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = 20; } };
  const head = (t) => { need(16); y += 2; font('bold', 11.5, ORANGE); doc.text(t, M, y); y += 5; };
  const table = (opts) => { doc.autoTable({ margin: { left: M, right: M, bottom: 22 }, theme: 'grid', rowPageBreak: 'avoid', styles: { fontSize: 8.6, cellPadding: 1.8, textColor: INK, lineColor: [60, 60, 60], lineWidth: 0.15, valign: 'top' }, headStyles: { fillColor: DARK, textColor: 255, fontStyle: 'bold' }, ...opts, startY: y }); y = doc.lastAutoTable.finalY + 5; };
  const label = { 0: { cellWidth: 62, fontStyle: 'bold', fillColor: PEACH } };
  const yn = (v, opts) => opts.map((o) => `${o === v ? '[X]' : '[  ]'} ${o}`).join('   ');

  font('bold', 22, ORANGE); doc.text('FSCF IRELAND', M, y); y += 6;
  font('normal', 8.4, GREY); for (const ln of doc.splitTextToSize(ADDR, CW)) { doc.text(ln, M, y); y += 4; } y += 4;
  font('bold', 14, INK); doc.text('LADDER INSPECTION CHECK', M, y); y += 6;
  font('normal', 9.4, INK); for (const ln of doc.splitTextToSize('Report of Results of Inspection – Work Equipment for Work at a Height (Ladders)', CW)) { doc.text(ln, M, y); y += 4.6; } y += 3;

  head('1. Inspection details');
  table({ body: [
    ['Location of inspection', c.where === 'FSCF Ireland' ? 'FSCF Ireland' : `Other: ${c.whereOther || ''}`],
    ['Inspection carried out for (person / company)', c.forWho || 'FSCF Ireland'],
    ['Address where inspection was carried out', c.address || ''],
    ['Client / site contact', c.contact || ''],
    ['Date & time of inspection', fmt(c.at, true)],
    ['Inspector name / position', [c.inspector, c.position].filter(Boolean).join(' — ')],
    ['Ladder no. reference', ladder.ref || ''],
    ['Re-inspection date', c.result === 'fail' ? 'Out of service — re-inspect after repair before use' : fmt(c.reinspect)],
  ], columnStyles: label });
  head('2. Ladder details');
  table({ body: [
    ['Type of work equipment inspected', ladder.type === 'Other' ? `Other: ${ladder.typeOther || ''}` : ladder.type || ''],
    ['Identification marks / number', ladder.ref || ''],
    ['Make / model', ladder.make || ''],
    ['Material', ladder.material || ''],
    ['Duty rating / load class', ladder.duty || ''],
  ], columnStyles: label });
  head('3. Inspection method used');
  table({ body: [['Method', c.method === 'Other' ? `Other: ${c.methodOther || ''}` : c.method || 'Visual']], columnStyles: label });
  head('4. Condition checklist');
  table({
    head: [['#', 'Component & what to check', 'Result', 'Comments / location of defect']],
    body: ITEMS.map(([h, t], i) => [String(i + 1), `${h}\n${t}`, ({ pass: 'Pass', fail: 'Fail', na: 'N/A' })[c.items?.[i]?.r] || '', c.items?.[i]?.note || 'No comment']),
    columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 78 }, 2: { cellWidth: 18, fontStyle: 'bold', halign: 'center' } },
    didParseCell: (d) => { if (d.section === 'body' && d.column.index === 2) d.cell.styles.fillColor = RES[c.items?.[d.row.index]?.r] || [255, 255, 255]; },
  });
  head('5. Visible damage or wear to the equipment');
  table({ body: [[c.damage || 'None']] });
  head('6. Fitness for use');
  table({ body: [
    ['Is the equipment fit for continued use?', yn(c.fit, ['Yes', 'No', 'Requires further assessment'])],
    ['Was the equipment used in accordance with safety guidelines?', yn(c.used, ['Yes', 'No', 'Not applicable'])],
    ['Additional details regarding the equipment inspected', c.details || 'None'],
  ], columnStyles: label });
  head('7. Results of inspection, including defects & locations');
  const failed = c.result === 'fail';
  table({
    body: [
      ['Result', failed ? 'FAILED' : 'PASSED'],
      ['Has the ladder failed on any item?', failed ? 'Yes – TAKE THE LADDER OUT OF SERVICE NOW' : 'No'],
      ['If failed, can it be repaired?', failed ? (c.repairable === 'No' ? 'No – arrange for the ladder to be destroyed' : c.repairable || '') : 'N/A'],
      ['Defects & locations', c.defects || 'None'],
      ['Details of any corrective action taken', c.corrective || 'None'],
      ['Details of any further action necessary', c.further || 'None'],
    ],
    columnStyles: label,
    didParseCell: (d) => { if (d.section === 'body' && d.column.index === 1 && d.row.index === 0) { d.cell.styles.fillColor = failed ? RES.fail : RES.pass; d.cell.styles.fontStyle = 'bold'; } },
  });
  need(50);
  head('8. Sign-off');
  table({
    body: [['Name & position of person making inspection', [c.inspector, c.position].filter(Boolean).join(', ')], ['Date', fmt(c.at)], ['Signature of person who made inspection', '']],
    columnStyles: label,
    didParseCell: (d) => { if (d.section === 'body' && d.row.index === 2) d.cell.styles.minCellHeight = 18; },
    didDrawCell: (d) => {
      if (d.section === 'body' && d.row.index === 2 && d.column.index === 1 && c.sig?.data) {
        const k = Math.min(60 / c.sig.w, 14 / c.sig.h);
        try { doc.addImage(c.sig.data, 'PNG', d.cell.x + 2, d.cell.y + 2, c.sig.w * k, c.sig.h * k); } catch { /* unreadable signature */ }
      }
    },
  });
  head('Notes – GA3 (HSA) and Form 129');
  font('normal', 8.4, INK);
  for (const p of NOTES) { for (const ln of doc.splitTextToSize(p, CW)) { need(4.4); doc.text(ln, M, y); y += 4; } y += 2; }

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    font('normal', 7.6, ORANGE); doc.text(`FSCF Ireland  |  Ladder check ${ladder.ref || ''}  |  ${fmt(c.at)}`, M, 11);
    font('normal', 7, GREY);
    const lines = doc.splitTextToSize(`${FOOT} Page ${i} of ${n}`, CW);
    lines.forEach((ln, k) => doc.text(ln, W / 2, 284 + k * 3.4, { align: 'center' }));
  }
  return doc.output('blob');
}
