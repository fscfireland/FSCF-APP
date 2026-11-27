// Ladder checks (owner, 27 Nov 2026): one record per ladder, one per check, and a PDF of each check
// in the layout of the owner's own ladder check (Drive: "Ladder Check WK2207B-3J 2026-11-17.pdf").
//
// Sources (rule 1) – every item and section carries its reference in the app and in the PDF; SOURCES below
// names each document and where it is in the owner's Google Drive. Checked against the documents 27 Nov 2026.
// Note: Reg 119(2)–(3) (report within 24 hours, kept on site) apply only to working platforms used for construction
// work from which a person could fall 2 m or more (Reg 119(1)(c)); the owner's earlier form notes said it generally.
//
// Storage: settings records, so they merge across devices record by record (newer updatedAt wins):
//   { id: 'ladder-<uid>', kind: 'ladder', ref, type, make, material, duty, kept, interval, retired }
//   { id: 'lcheck-<uid>', kind: 'ladderCheck', ladderId, at, ... answers, signature }

import { loadJsPdf } from './report.js';
import { capsPdf } from './caps.js';

export const FORM_REF = 'FSCF Form 129 rev 000; HSA GA3; S.I. No. 299 of 2007 (Gen App Regs), Regs 30, 114, 118, 119 and Schedule 5';
// the documents every reference below points to (names as in the owner's Google Drive)
export const SOURCES = [
  ['Gen App Regs 2007', 'Safety, Health and Welfare at Work (General Application) Regulations 2007, S.I. No. 299 of 2007: Reg 30 (inspection of work equipment), Reg 114 (ladders), Reg 118 (meaning of inspection), Reg 119 (inspection of work equipment for work at height), Schedule 5 (particulars of a report of inspection). Drive: GENERAL_APPLICATION_REGULATIONS_2007_SI_2007_UNOFFICIAL_COPY.PDF'],
  ['Form 129', 'FSCF Form 129 rev 000, Ladder inspection (aluminium and wooden ladders; stepladders). Drive: INSPECTION LADDER.DOC'],
  ['HSA GA3', 'Health and Safety Authority GA3, Report of Results of Inspections of Work Equipment for Work at a Height. Drive: GA3 FORMS.PDF'],
  ['Ladders TBT 2.3.1', 'Ladders Toolbox Talk 2.3.1 (use of ladders; step ladder pre-use checks). Drive: 2.3.1 USE OF LADDERS TOOL BOX TALK.PDF'],
  ['Peninsula TBT', 'Peninsula Tool Box Talk v2.1, Ladders and Stepladders. Drive: TBT - LADDERS AND STEP-LADDERS.DOCX'],
];
export const LADDER_TYPES = ['Stepladder', 'Single ladder', 'Extension ladder', 'Platform / podium', 'Other'];
export const MATERIALS = ['Aluminium', 'Fibreglass', 'Timber', 'Steel', 'Other'];
export const METHODS = ['Visual', 'Functional', 'Both', 'Other'];
export const INTERVAL_REF = 'Gen App Regs 2007, Reg 119(1)(b)(i): inspected "at suitable intervals"; every 7 days is FSCF practice (the owner\'s weekly checks since 02/03/2026). Ladders TBT 2.3.1: a visual check before every use';
export const INTERVAL_DAYS = 7; // FSCF practice (owner's own checks: weekly since 02/03/2026); Reg 119(1)(b)(i) "suitable intervals"

// [component, what to check, applies(ladder) – when false the item starts as N/A, reference]
export const ITEMS = [
  ['Rivets & fastenings', 'All in place and secure; no corrosion, cracking or movement', null, 'Form 129: "Are all the rivets and fastenings in place and secure?"; Peninsula TBT: secure fastenings'],
  ['Stiles', 'Free from distortion, damage, sharp edges, flaws, cracks and defects', null, 'Form 129: stiles free from distortion and damage; free from sharp edges; free from flaws, cracks and defects. Ladders TBT 2.3.1: do not use if stiles are bent or split'],
  ['Rungs / steps', 'All in place and secure; free from distortion, damage and sharp edges', null, 'Form 129: rungs in place and secure; free from distortion and damage; free from sharp edges. Ladders TBT 2.3.1: check the rungs / steps'],
  ['Corrosion', 'Ladder free from corrosion', null, 'Form 129: "Is the ladder free from corrosion?"; Peninsula TBT: no rust'],
  ['Anti-slip feet', 'Top and bottom feet in place, secure and free from damage', null, 'Form 129: anti-slip feet in place, secure and free from damage; Gen App Regs 2007, Reg 114(e)(ii); Ladders TBT 2.3.1: check the feet'],
  ['Timber ladders only', 'Clear varnish only, not paint which can hide defects', (l) => l.material === 'Timber', 'Form 129: wooden ladders covered in clear varnish, not paint which can hide defects; Ladders TBT 2.3.1 and Peninsula TBT: no painted ladders'],
  ['SWL marking', 'Marked with a Safe Working Load', null, 'Form 129: "Is the ladder marked with a SWL (Safe Working Load)?"'],
  ['Suitable for work use', 'Class 1 or EN 131 only', null, 'Form 129: "Suitable for work use? (Class 1 or EN131 only)"; Ladders TBT 2.3.1: only industrial class ladders, EN131 or BS2037 rated'],
  ['Stability (stepladders)', 'Stable when positioned on level ground', (l) => /step|platform|podium/i.test(l.type || ''), 'Form 129 (stepladders): stable when positioned on level ground; Gen App Regs 2007, Reg 114(b) and 114(c)'],
  ['Hinges (stepladders)', 'In place, secure and free from damage', (l) => /step/i.test(l.type || ''), 'Form 129 (stepladders): "Are hinges in place, secure and free from damage?"'],
  ['Brackets / spreaders (stepladders)', 'Free from distortion and damage; lock fully', (l) => /step/i.test(l.type || ''), 'Form 129 (stepladders): brackets / spreaders free from distortion and damage; Ladders TBT 2.3.1: check the locking bars; Peninsula TBT: locking device fully engaged'],
  ['Platform / top step / handrail', 'Where fitted, secure and undamaged', null, 'Ladders TBT 2.3.1: check the stepladder platform (not split or buckled). Handrail: FSCF practice, source to be confirmed'],
];
export const itemApplies = (i, ladder) => !ITEMS[i][2] || ITEMS[i][2](ladder || {});
export const itemRef = (i) => ITEMS[i][3] || '';

export const NOTES = [
  'Gen App Regs 2007, Reg 118(1): "inspection" means such visual or more rigorous inspection by a competent person as is appropriate for safety purposes, and includes any testing appropriate for those purposes.',
  'Reg 119(1)(b): work equipment exposed to conditions causing deterioration which is liable to result in dangerous situations is inspected (i) at suitable intervals, and (ii) as soon as practicable after exceptional circumstances liable to jeopardise its safety. Reg 30(b): periodic inspections, special inspections after exceptional circumstances, and deterioration detected and remedied in good time.',
  'Reg 119(4): (a) no work equipment is used in another place of work unless it is accompanied by evidence that the last inspection required by this Regulation has been carried out, and (b) the result of an inspection is recorded and kept available for inspection by an inspector for 5 years from the date of inspection. Also Reg 30(d) and 30(e).',
  'Schedule 5 (Reg 119), particulars of a report of inspection: 1 name and address of the person for whom it was carried out; 2 location of the equipment; 3 description of the equipment; 4 date and time; 5 details of any matter that could give rise to a risk to safety or health; 6 action taken; 7 further action considered necessary; 8 name and position of the person making the report. Reg 119(2)–(3) (report within 24 hours, kept on site) apply to working platforms used for construction work from which a person could fall 2 m or more (Reg 119(1)(c)).',
  'HSA GA3 may be used to assist compliance with Reg 119; it is not an approved or statutory form, and reports of inspection may be produced in other formats.',
  'FSCF Form 129 rev 000: if the ladder has failed on any item, TAKE THE LADDER OUT OF SERVICE NOW. If it cannot be repaired, ARRANGE FOR THE LADDER TO BE DESTROYED. Record the actions required.',
]

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
const FOOT = 'Based on FSCF Form 129 rev 000 and HSA GA3 – Report of Results of Inspections: Work Equipment for Work at a Height (S.I. No. 299 of 2007, Reg 119 and Schedule 5). Not an approved statutory form.';
const fmt = (iso, time) => { if (!iso) return ''; const d = new Date(iso); return time ? d.toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString('en-IE', { dateStyle: 'medium' }); };

export async function ladderPdf(ladder, c) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  capsPdf(doc);
  const W = 210; const M = 16; const CW = W - 2 * M; const BOTTOM = 276;
  let y = 22;
  const font = (s, z, col = INK) => { doc.setFont('helvetica', s); doc.setFontSize(z); doc.setTextColor(...col); };
  const need = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = 20; } };
  const head = (t) => { need(20); y += 2; font('bold', 11.5, ORANGE); doc.text(t, M, y); y += 5; };
  const ref = (t) => { font('italic', 7.6, GREY); for (const ln of doc.splitTextToSize(`Ref: ${t}`, CW)) { doc.text(ln, M, y); y += 3.4; } y += 1; };
  const table = (opts) => { doc.autoTable({ margin: { left: M, right: M, bottom: 22 }, theme: 'grid', rowPageBreak: 'avoid', styles: { fontSize: 8.6, cellPadding: 1.8, textColor: INK, lineColor: [60, 60, 60], lineWidth: 0.15, valign: 'top' }, headStyles: { fillColor: DARK, textColor: 255, fontStyle: 'bold' }, ...opts, startY: y }); y = doc.lastAutoTable.finalY + 5; };
  const label = { 0: { cellWidth: 62, fontStyle: 'bold', fillColor: PEACH } };
  const yn = (v, opts) => opts.map((o) => `${o === v ? '[X]' : '[  ]'} ${o}`).join('   ');

  font('bold', 22, ORANGE); doc.text('FSCF IRELAND', M, y); y += 6;
  font('normal', 8.4, GREY); for (const ln of doc.splitTextToSize(ADDR, CW)) { doc.text(ln, M, y); y += 4; } y += 4;
  font('bold', 14, INK); doc.text('LADDER INSPECTION CHECK', M, y); y += 6;
  font('normal', 9.4, INK); for (const ln of doc.splitTextToSize('Report of Results of Inspection – Work Equipment for Work at a Height (Ladders)', CW)) { doc.text(ln, M, y); y += 4.6; } y += 3;

  head('1. Inspection details'); ref('Gen App Regs 2007, Schedule 5, items 1, 2, 4 and 8; HSA GA3; Form 129');
  table({ body: [
    ['Location of inspection', c.where === 'FSCF Ireland' ? 'FSCF Ireland' : `Other: ${c.whereOther || ''}`],
    ['Inspection carried out for (person / company)', c.forWho || 'FSCF Ireland'],
    ['Address where inspection was carried out', c.address || ''],
    ['Client / site contact', c.contact || ''],
    ['Date & time of inspection', fmt(c.at, !c.dateOnly)],
    ['Inspector name / position', [c.inspector, c.position].filter(Boolean).join(' — ')],
    ['Ladder no. reference', ladder.ref || ''],
    ['Re-inspection date (Reg 119(1)(b)(i); 7 days FSCF practice)', c.result === 'fail' ? 'Out of service — re-inspect after repair before use' : fmt(c.reinspect)],
  ], columnStyles: label });
  head('2. Ladder details'); ref('Gen App Regs 2007, Schedule 5, item 3; Form 129 (ladder reference, description, type, material)');
  table({ body: [
    ['Type of work equipment inspected', ladder.type === 'Other' ? `Other: ${ladder.typeOther || ''}` : ladder.type || ''],
    ['Identification marks / number', ladder.ref || ''],
    ['Make / model', ladder.make || ''],
    ['Material', ladder.material || ''],
    ['Duty rating / load class', ladder.duty || ''],
  ], columnStyles: label });
  head('3. Inspection method used'); ref('Gen App Regs 2007, Reg 118(1): visual or more rigorous inspection, including any testing appropriate');
  table({ body: [['Method', c.method === 'Other' ? `Other: ${c.methodOther || ''}` : c.method || 'Visual']], columnStyles: label });
  head('4. Condition checklist'); ref('Each item\'s source is under it. Form 129 = FSCF Form 129 rev 000; TBT = toolbox talks (see Sources)');
  table({
    head: [['#', 'Component & what to check', 'Result', 'Comments / location of defect']],
    body: ITEMS.map(([h, t, , src], i) => [String(i + 1), `${h}\n${t}\nRef: ${src}`, ({ pass: 'Pass', fail: 'Fail', na: 'N/A' })[c.items?.[i]?.r] || '', c.items?.[i]?.note || 'No comment']),
    columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 78 }, 2: { cellWidth: 18, fontStyle: 'bold', halign: 'center' } },
    didParseCell: (d) => { if (d.section === 'body' && d.column.index === 2) d.cell.styles.fillColor = RES[c.items?.[d.row.index]?.r] || [255, 255, 255]; },
  });
  head('5. Visible damage or wear to the equipment'); ref('Gen App Regs 2007, Schedule 5, item 5; HSA GA3');
  table({ body: [[c.damage || 'None']] });
  head('6. Fitness for use'); ref('Form 129 (fit for use); Gen App Regs 2007, Reg 30(b)(iii): deterioration detected and remedied in good time');
  table({ body: [
    ['Is the equipment fit for continued use?', yn(c.fit, ['Yes', 'No', 'Requires further assessment'])],
    ['Was the equipment used in accordance with safety guidelines?', yn(c.used, ['Yes', 'No', 'Not applicable'])],
    ['Additional details regarding the equipment inspected', c.details || 'None'],
  ], columnStyles: label });
  head('7. Results of inspection, including defects & locations'); ref('Gen App Regs 2007, Schedule 5, items 5–7; Form 129: if failed, take out of service now; if it cannot be repaired, destroy it');
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
  head('8. Sign-off'); ref('Gen App Regs 2007, Schedule 5, item 8; Reg 118(1): by a competent person; Reg 119(4)(b): kept 5 years');
  table({
    body: [['Name & position of person making inspection', [c.inspector, c.position].filter(Boolean).join(', ')], ['Date', fmt(c.at)], ['Signature of person who made inspection', c.imported ? `Signed on the original: ${c.imported}` : '']],
    columnStyles: label,
    didParseCell: (d) => { if (d.section === 'body' && d.row.index === 2) d.cell.styles.minCellHeight = 18; },
    didDrawCell: (d) => {
      if (d.section === 'body' && d.row.index === 2 && d.column.index === 1 && c.sig?.data) {
        const k = Math.min(60 / c.sig.w, 14 / c.sig.h);
        try { doc.addImage(c.sig.data, 'PNG', d.cell.x + 2, d.cell.y + 2, c.sig.w * k, c.sig.h * k); } catch { /* unreadable signature */ }
      }
    },
  });
  head('Notes – from the regulations, GA3 and Form 129');
  font('normal', 8.4, INK);
  for (const p of NOTES) { for (const ln of doc.splitTextToSize(p, CW)) { need(4.4); doc.text(ln, M, y); y += 4; } y += 2; }
  head('Sources');
  table({ head: [['Short name', 'Document (and where it is kept)']], body: SOURCES, styles: { fontSize: 7.8, cellPadding: 1.5, textColor: INK, lineColor: [60, 60, 60], lineWidth: 0.15, valign: 'top' }, columnStyles: { 0: { cellWidth: 34, fontStyle: 'bold', fillColor: PEACH } } });

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
