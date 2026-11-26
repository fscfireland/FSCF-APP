// Excel export, laid out to feed the pricing workbook.
// Sheets: Summary · Doors · Checklist · Defects (pricing) · Materials ·
//         Material totals · Defect totals

import * as db from './db.js';
import { STATUSES, statusById, doorActions, materialsTotal, ANSWERS, useScheme, statusesInUse, matLabel, riskText, signText } from './defaults.js';
import { loadSheetJS, saveFile, safeName } from './files.js';
import { photoInView } from './history.js';
import { doorViews } from './filters.js';
import { fmtDate } from './ui.js';
import { remedialItems } from './remedial.js';
import { SUPPLY, fieldText, ratingOf, swingOf, missingFor } from './fields.js';

const EURO = '"€"#,##0.00';

export async function exportProjectXlsx(project, questions = [], opts = {}) {
  const XLSX = await loadSheetJS();
  const scheme = useScheme(project);
  const answerLabel = Object.fromEntries(ANSWERS.map((a) => [a.id, a.label]));
  // filtered doors (each as at the inspection being reported) or all, as now
  let doors = opts.doors || (await db.projectDoors(project.id)).map((d) => ({ ...d, _current: true }));
  if (opts.hideCosts) {
    // the app is locked: leave our prices out of the workbook
    doors = doors.map((d) => ({ ...d, materials: (d.materials || []).map((m) => ({ ...m, cost: 0 })), signs: (d.signs || []).map((x) => ({ ...x, cost: 0 })) }));
  }
  const byId = Object.fromEntries(doors.map((d) => [d.id, d]));
  const plans = await db.projectPlans(project.id);
  const planName = Object.fromEntries(plans.map((p) => [p.id, p.name]));
  const photos = await db.byIndex('photos', 'projectId', project.id);
  const photoCount = {};
  const videoCount = {};
  const videoLinks = {};
  for (const p of photos) {
    if (!byId[p.doorId] || !photoInView(p, byId[p.doorId])) continue;
    if (p.kind === 'video') {
      videoCount[p.doorId] = (videoCount[p.doorId] || 0) + 1;
      if (p.link) (videoLinks[p.doorId] ||= []).push(p.link);
    } else photoCount[p.doorId] = (photoCount[p.doorId] || 0) + 1;
  }
  const statusLabel = (d) => statusById[d.status || 'not_inspected']?.label || '';
  const enc = XLSX.utils.encode_cell;

  // Adds a "TOTAL" row under a money column and sets € formats on it
  const moneyCols = (ws, cols, firstRow, lastRow) => {
    for (let r = firstRow; r <= lastRow; r++) for (const c of cols) if (ws[`${c}${r}`]) ws[`${c}${r}`].z = EURO;
  };

  const wb = XLSX.utils.book_new();

  // --- Summary
  const counts = Object.fromEntries(STATUSES.map((s) => [s.id, 0]));
  for (const d of doors) counts[d.status || 'not_inspected'] = (counts[d.status || 'not_inspected'] || 0) + 1;
  const defectRows = doors.flatMap((d) => d.defects || []);
  const matTotal = doors.reduce((t, d) => t + materialsTotal(d), 0);
  const summary = [
    ['FSCF Ireland – ' + (project.workType || 'Inspection')],
    [],
    ['Client', project.client || ''],
    ['Site', project.site || ''],
    ['Address', project.address || ''],
    ['Inspection date', project.date || ''],
    ['Status scheme', scheme.name],
    ...(opts.filterText ? [['Report filter', opts.filterText]] : []),
    ['Exported', new Date().toLocaleString('en-IE')],
    [],
    ['Doors recorded', doors.length],
    ...statusesInUse(doors).map((s) => [s.label, counts[s.id] || 0, doors.length ? `${Math.round(((counts[s.id] || 0) / doors.length) * 100)}%` : '0%']),
    [],
    ['Defects recorded', defectRows.length],
    opts.hideCosts ? ['Materials total', 'Prices left out (app locked)'] : ['Materials total (€ ex VAT)', matTotal],
  ];
  const ws0 = XLSX.utils.aoa_to_sheet(summary);
  ws0[`B${summary.length}`].z = EURO;
  ws0['!cols'] = [{ wch: 26 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, ws0, 'Summary');

  // --- Doors (one row per door)
  const doorHeader = [
    'Pin', 'Pin ref', 'Plan / level', 'Location / room', 'Door type', 'Leaf config', 'Status',
    'Recommended actions', `Questions: ${ANSWERS[1].label}`, 'No. of defects', 'Defects', 'Remedial work', 'Materials (€)', 'Photos', 'Videos', 'Video links', 'Notes', 'Inspected on', 'Inspected by', 'Fire alarm zone no.', 'Fire alarm zone name', 'Risk rating', 'On a drawing', 'Category', 'Next inspection due', 'GPS latitude', 'GPS longitude', 'GPS accuracy (m)', 'GPS recorded',
  ];
  const extraFields = (opts.fieldSections || []).flatMap((s) => s.fields);
  doorHeader.push('Replacement', ...extraFields.map((f) => f.label + (f.unit ? ` (${f.unit})` : '')));
  const doorRows = doors.map((d) => [
    d.pinNo ?? '',
    d.ref || '',
    planName[d.planId] || '',
    d.location || '',
    d.doorType || '',
    d.leaf || '',
    statusLabel(d),
    doorActions(d).join('; '),
    Object.values(d.checks || {}).filter((c) => c?.answer === 'fail').length,
    (d.defects || []).length,
    (d.defects || []).map((x) => x.label).join('; '),
    (d.defects || []).map((x) => x.remedial).filter(Boolean).join('; '),
    materialsTotal(d),
    photoCount[d.id] || 0,
    videoCount[d.id] || 0,
    (videoLinks[d.id] || []).join(' '),
    d.notes || '',
    d.inspectedOn || '',
    d.inspectedBy || '',
    d.zoneNo || '',
    d.zoneName || '',
    riskText(d),
    d.planId ? 'Yes' : 'No',
    d.category || '',
    d.nextDue || '',
    d.gps?.lat ?? '',
    d.gps?.lng ?? '',
    d.gps?.acc ?? '',
    d.gps?.at ? new Date(d.gps.at).toLocaleString('en-IE') : '',
    SUPPLY[d.replacement] || '',
    ...extraFields.map((f) => d.attrs?.[f.id] ?? ''),
  ]);
  const ws1 = XLSX.utils.aoa_to_sheet([doorHeader, ...doorRows]);
  moneyCols(ws1, ['M'], 2, doorRows.length + 1);
  ws1['!cols'] = [6, 12, 18, 22, 18, 14, 13, 40, 9, 8, 50, 50, 12, 7, 7, 30, 30, 12, 14, 10, 26, 18, 10, 18, 14, 11, 11, 9, 18].map((wch) => ({ wch }));
  ws1['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, doorRows.length), c: doorHeader.length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, ws1, 'Doors');

  // --- Checklist: one row per door, one column per question
  const qCols = [...questions];
  const seen = new Set(qCols.map((q) => q.id));
  for (const d of doors) {
    for (const [id, c] of Object.entries(d.checks || {})) {
      if (!seen.has(id) && c?.answer) {
        seen.add(id);
        qCols.push({ id, text: c.text });
      }
    }
  }
  const cHeader = ['Pin', 'Pin ref', 'Location / room', 'Status', ...qCols.map((q, i) => `Q${i + 1}. ${q.text}`), ...ANSWERS.map((a) => a.label), 'Checklist notes'];
  const cRows = doors.map((d) => {
    const ans = qCols.map((q) => answerLabel[d.checks?.[q.id]?.answer] || '');
    return [d.pinNo ?? '', d.ref || '', d.location || '', statusLabel(d), ...ans,
      ...['pass', 'fail', 'na'].map((id) => qCols.filter((q) => d.checks?.[q.id]?.answer === id).length),
      qCols.map((q, i) => (d.checks?.[q.id]?.note ? `Q${i + 1}: ${d.checks[q.id].note}` : '')).filter(Boolean).join('; ')];
  });
  const ws2 = XLSX.utils.aoa_to_sheet([cHeader, ...cRows]);
  ws2['!cols'] = [6, 12, 22, 13, ...qCols.map(() => 18), 6, 6, 6].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws2, 'Checklist');

  // --- Defects (pricing): one row per defect, with Qty × Rate formula
  const pHeader = ['Pin', 'Pin ref', 'Plan / level', 'Location / room', 'Door type', 'Status', 'Defect', 'Remedial work', 'Qty', 'Unit rate (€)', 'Line total (€)', 'Door notes'];
  const pRows = [];
  for (const d of doors) {
    for (const x of d.defects || []) {
      pRows.push([
        d.pinNo ?? '', d.ref || '', planName[d.planId] || '', d.location || '', d.doorType || '',
        statusLabel(d), x.label || '', x.remedial || '', Number(x.qty) || 1, null, null, d.notes || '',
      ]);
    }
  }
  const ws3 = XLSX.utils.aoa_to_sheet([pHeader, ...pRows]);
  let last = pRows.length + 1;
  for (let r = 2; r <= last; r++) {
    ws3[`J${r}`] = { t: 'n', v: 0, z: EURO };
    ws3[`K${r}`] = { t: 'n', f: `I${r}*J${r}`, z: EURO };
  }
  let totalRow = last + 2;
  XLSX.utils.sheet_add_aoa(ws3, [['', '', '', '', '', '', '', 'TOTAL (ex VAT)']], { origin: `A${totalRow}` });
  ws3[`K${totalRow}`] = { t: 'n', f: pRows.length ? `SUM(K2:K${last})` : '0', z: EURO };
  ws3['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow - 1, c: pHeader.length - 1 } });
  ws3['!cols'] = [6, 12, 18, 22, 18, 13, 40, 50, 6, 12, 13, 30].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws3, 'Defects (pricing)');

  // --- Materials: one row per material per door, Qty × Unit cost formula
  const mHeader = ['Pin', 'Pin ref', 'Location / room', 'Material', 'Unit', 'Qty', 'Unit cost (€)', 'Line total (€)'];
  const mRows = [];
  for (const d of doors) {
    for (const m of d.materials || []) {
      mRows.push([d.pinNo ?? '', d.ref || '', d.location || '', matLabel(m), m.unit || '', Number(m.qty) || 0, Number(m.cost) || 0, null]);
    }
  }
  const ws4 = XLSX.utils.aoa_to_sheet([mHeader, ...mRows]);
  last = mRows.length + 1;
  for (let r = 2; r <= last; r++) {
    ws4[`G${r}`].z = EURO;
    ws4[`H${r}`] = { t: 'n', f: `F${r}*G${r}`, v: (ws4[`F${r}`].v || 0) * (ws4[`G${r}`].v || 0), z: EURO };
  }
  totalRow = last + 2;
  XLSX.utils.sheet_add_aoa(ws4, [['', '', '', '', '', '', 'TOTAL (ex VAT)']], { origin: `A${totalRow}` });
  ws4[enc({ r: totalRow - 1, c: 7 })] = { t: 'n', f: mRows.length ? `SUM(H2:H${last})` : '0', v: matTotal, z: EURO };
  ws4['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow - 1, c: mHeader.length - 1 } });
  ws4['!cols'] = [6, 12, 22, 45, 9, 7, 13, 13].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws4, 'Materials');

  // --- Signs: every sign on every door, then the order list for signs still needed
  const sRows = [];
  for (const d of doors) {
    for (const x of d.signs || []) {
      sRows.push([d.pinNo ?? '', d.ref || '', d.location || '', x.type, x.face || '', Number(x.qty) || 0, x.state === 'fitted' ? 'Fitted' : 'Needed']);
    }
  }
  if (sRows.length) {
    const wsS = XLSX.utils.aoa_to_sheet([['Pin', 'Pin ref', 'Location / room', 'Sign', 'Face', 'Qty', 'Status'], ...sRows]);
    wsS['!cols'] = [6, 12, 22, 34, 12, 6, 9].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, wsS, 'Signs');
    const st = new Map();
    for (const d of doors) {
      for (const x of d.signs || []) {
        const r = st.get(x.type) || { needed: 0, fitted: 0, doors: new Set() };
        r[x.state === 'fitted' ? 'fitted' : 'needed'] += Number(x.qty) || 0;
        r.doors.add(d.id);
        st.set(x.type, r);
      }
    }
    const wsST = XLSX.utils.aoa_to_sheet([['Sign', 'Doors', 'Needed (to order)', 'Already fitted'],
      ...[...st.entries()].sort((a, b) => b[1].needed - a[1].needed).map(([k, r]) => [k, r.doors.size, r.needed, r.fitted])]);
    wsST['!cols'] = [34, 7, 16, 14].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, wsST, 'Sign totals');
  }

  // --- Material totals: the order list for the whole site
  const mt = new Map();
  for (const d of doors) {
    for (const m of d.materials || []) {
      // each size / type is its own line on the order list
      const key = `${matLabel(m)}|${m.unit}|${Number(m.cost) || 0}`;
      const row = mt.get(key) || { name: matLabel(m), unit: m.unit, cost: Number(m.cost) || 0, qty: 0, doors: 0 };
      row.qty += Number(m.qty) || 0;
      row.doors++;
      mt.set(key, row);
    }
  }
  const tmRows = [...mt.values()].sort((a, b) => a.name.localeCompare(b.name)).map((m) => [m.name, m.unit, m.doors, m.qty, m.cost, null]);
  const ws5 = XLSX.utils.aoa_to_sheet([['Material', 'Unit', 'Doors', 'Total qty', 'Unit cost (€)', 'Total (€)'], ...tmRows]);
  last = tmRows.length + 1;
  for (let r = 2; r <= last; r++) {
    ws5[`E${r}`].z = EURO;
    ws5[`F${r}`] = { t: 'n', f: `D${r}*E${r}`, v: ws5[`D${r}`].v * ws5[`E${r}`].v, z: EURO };
  }
  totalRow = last + 2;
  XLSX.utils.sheet_add_aoa(ws5, [['', '', '', '', 'TOTAL (ex VAT)']], { origin: `A${totalRow}` });
  ws5[`F${totalRow}`] = { t: 'n', f: tmRows.length ? `SUM(F2:F${last})` : '0', v: matTotal, z: EURO };
  ws5['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow - 1, c: 5 } });
  ws5['!cols'] = [45, 9, 7, 10, 13, 13].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws5, 'Material totals');

  // --- Defect totals: how many of each defect across the site
  const totals = {};
  for (const x of defectRows) {
    const k = x.label || '(blank)';
    totals[k] = totals[k] || { count: 0, qty: 0, remedial: x.remedial || '' };
    totals[k].count++;
    totals[k].qty += Number(x.qty) || 1;
  }
  const tRows = Object.entries(totals).sort((a, b) => b[1].count - a[1].count).map(([k, v]) => [k, v.count, v.qty, v.remedial]);
  const ws6 = XLSX.utils.aoa_to_sheet([['Defect', 'Doors affected', 'Total qty', 'Typical remedial work'], ...tRows]);
  ws6['!cols'] = [{ wch: 45 }, { wch: 14 }, { wch: 10 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws6, 'Defect totals');

  // --- Inspection history: every inspection of every door in the report
  const hRows = [];
  for (const d of doors) {
    const all = await db.get('doors', d.id);
    for (const v of doorViews(all || d)) {
      hRows.push([
        d.pinNo ?? '', v.ref || '', v.location || '', v.doorType || '', v.inspectedOn || '', statusLabel(v),
        (v.defects || []).length, (v.defects || []).map((x) => x.label).join('; '), doorActions(v).join('; '),
        v.inspectedBy || '', v._current ? 'Current' : 'History',
      ]);
    }
  }
  const ws7 = XLSX.utils.aoa_to_sheet([['Pin', 'Pin ref', 'Location / room', 'Door type', 'Inspection date', 'Status', 'No. of defects', 'Defects', 'Recommended actions', 'Inspected by', 'Record'], ...hRows]);
  ws7['!cols'] = [6, 12, 22, 18, 14, 16, 8, 50, 40, 14, 10].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws7, 'Inspection history');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const filename = `FSCF_${safeName(project.site || project.client)}_${(project.date || new Date().toISOString().slice(0, 10))}${opts.filterText ? '_filtered' : ''}.xlsx`;
  if (opts.returnBlob) return { blob, filename };
  return saveFile(filename, blob);
}


// Repairs workbook: Summary · Repair items (one row per item) · By door
export async function exportRemedialXlsx(project, opts = {}) {
  const XLSX = await loadSheetJS();
  useScheme(project);
  const doors = opts.doors || [];
  const planName = Object.fromEntries((opts.plans || []).map((p) => [p.id, p.name]));
  const day = (iso) => (iso ? new Date(iso).toLocaleString('en-IE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''); // date and time
  const rows = [];
  const byDoor = [];
  for (const d of doors) {
    const items = remedialItems(d);
    let nd = 0;
    for (const it of items) {
      const r = d.remedials?.[it.key];
      if (r?.done) nd++;
      rows.push([
        d.pinNo ?? '', d.ref || '', d.location || '', planName[d.planId] || (d.planId ? '' : 'Not on a drawing'), d.doorType || '',
        d.zoneNo || '', d.category || '', it.text, it.sub, it.qty || 1, r?.done ? 'Yes' : 'No', r?.done ? r.by || '' : '', r?.done ? day(r.at) : '',
        statusById[d.status || 'not_inspected']?.label || '',
        r?.done && r.verified ? 'Yes' : 'No', r?.verified ? r.vby || '' : '', r?.verified ? day(r.vat) : '',
      ]);
    }
    byDoor.push([d.pinNo ?? '', d.ref || '', d.location || '', planName[d.planId] || '', items.length, nd, items.length - nd, items.length ? Math.round((nd / items.length) * 100) : 0, items.length && nd === items.length ? 'Complete' : nd ? 'In progress' : 'Not started']);
  }
  const total = rows.length;
  const done = rows.filter((r) => r[10] === 'Yes').length;
  const wb = XLSX.utils.book_new();
  const summary = [
    ['FSCF Ireland – Remedial works'],
    [],
    ['Client', project.client || ''],
    ['Site', project.site || ''],
    ['Address', project.address || ''],
    ['Exported', new Date().toLocaleString('en-IE')],
    ...(opts.filterText ? [['Covers', opts.filterText]] : []),
    [],
    ['Repair items (actions)', total],
    ['Done', done],
    ['Outstanding', total - done],
    ['Actions completed (%)', total ? Math.round((done / total) * 1000) / 10 : 0],
    ['Verified', rows.filter((r) => r[14] === 'Yes').length],
    ['Actions verified (%)', total ? Math.round((rows.filter((r) => r[14] === 'Yes').length / total) * 1000) / 10 : 0],
    ['Doors with repairs', byDoor.length],
    ['Doors complete', byDoor.filter((r) => r[8] === 'Complete').length],
    [],
    ['Repairer confirmation', opts.ack ? `Confirmed by ${opts.ack.by || ''} on ${day(opts.ack.at)}` : 'Not confirmed'],
    ['Instructions', opts.instructions || ''],
  ];
  const ws0 = XLSX.utils.aoa_to_sheet(summary);
  ws0['!cols'] = [{ wch: 24 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, ws0, 'Summary');
  const head = ['Pin', 'Pin ref', 'Location / room', 'Plan / level', 'Door type', 'FA zone', 'Category', 'Work required', 'Defect / reason', 'Qty', 'Done', 'Done by', 'Date done', 'Door status', 'Verified', 'Verified by', 'Date verified'];
  const ws1 = XLSX.utils.aoa_to_sheet([head, ...rows]);
  ws1['!cols'] = [6, 12, 22, 16, 16, 8, 16, 55, 40, 6, 7, 16, 12, 14, 9, 16, 12].map((wch) => ({ wch }));
  ws1['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, rows.length), c: head.length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, ws1, 'Repair items');
  const ws2 = XLSX.utils.aoa_to_sheet([['Pin', 'Pin ref', 'Location / room', 'Plan / level', 'Items', 'Done', 'Outstanding', '% complete', 'Progress'], ...byDoor]);
  ws2['!cols'] = [6, 12, 22, 16, 7, 7, 11, 11, 12].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws2, 'By door');
  const types = new Map();
  for (const r of rows) {
    const k = r[8] === 'Recommended action' ? `Action: ${r[7]}` : r[8] || r[7];
    const x = types.get(k) || { total: 0, done: 0 };
    x.total++;
    if (r[10] === 'Yes') x.done++;
    types.set(k, x);
  }
  const ws3 = XLSX.utils.aoa_to_sheet([['Type of repair', 'Total', 'Done', 'Outstanding', '% complete'],
    ...[...types.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, x]) => [k, x.total, x.done, x.total - x.done, Math.round((x.done / x.total) * 100)])]);
  ws3['!cols'] = [{ wch: 55 }, { wch: 7 }, { wch: 7 }, { wch: 11 }, { wch: 11 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'By repair type');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return saveFile(`FSCF_Remedial_works_${safeName(project.site || project.client)}_${new Date().toISOString().slice(0, 10)}.xlsx`, blob);
}


// Pricing sheet for a subcontractor: every repair item with an empty unit
// rate to fill in; line totals and the grand total are formulas. None of our
// own prices are included.
export async function exportPricingXlsx(project, opts = {}) {
  const XLSX = await loadSheetJS();
  useScheme(project);
  const doors = opts.doors || [];
  const planName = Object.fromEntries((opts.plans || []).map((p) => [p.id, p.name]));
  const wb = XLSX.utils.book_new();
  const readme = [
    ['Pricing schedule – remedial works to fire doors'],
    [],
    ['Issued by', 'FSCF Ireland'],
    ['Client', project.client || ''],
    ['Site', project.site || ''],
    ['Address', project.address || ''],
    ['Issued', new Date().toLocaleDateString('en-IE')],
    ...(opts.filterText ? [['Covers', opts.filterText]] : []),
    [],
    ['How to price', 'Enter your unit rate (€, ex VAT) once for each type of work on the "Rates by type of work" sheet. Every matching line on the Price schedule fills in automatically, with each door\'s total and the overall total. To price one line differently, type over its unit rate on the Price schedule. Add notes, exclusions or alternatives in the Comments column. Rates should include labour, materials, access and making good.'],
    ['Standard of work', opts.instructions || ''],
    [],
    ['Company', ''],
    ['Name', ''],
    ['Date', ''],
  ];
  const ws0 = XLSX.utils.aoa_to_sheet(readme);
  ws0['!cols'] = [{ wch: 20 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, ws0, 'Read me');

  // Price schedule: each door named once (in capitals, with its swing and
  // type), its fail items listed under it. A line's unit rate comes from the
  // "Rates by type of work" sheet when the work text matches, so the
  // contractor prices each type of work once. Rates and totals stay blank
  // until priced, and anything typed that isn't a number doesn't break a total.
  const EUR = '"€"#,##0.00';
  const RATES = "'Rates by type of work'";
  const aoa = [['Item', 'Work required', 'Defect / reason', 'Qty', 'Unit rate (€ ex VAT)', 'Line total (€ ex VAT)', 'Comments']];
  const itemRows = [];
  const doorTotals = [];
  const types = new Map();
  let n = 0;
  for (const d of doors) {
    const items = remedialItems(d);
    if (!items.length) continue;
    const title = [`PIN ${d.pinNo ?? ''}${d.ref ? ' – ' + d.ref : ''}`, d.location, d.leaf, d.doorType, planName[d.planId], d.zoneNo ? 'Zone ' + d.zoneNo : ''].filter(Boolean).join(' · ').toUpperCase();
    aoa.push([title, '', '', '', '', '', '']);
    const first = aoa.length + 1;
    for (const it of items) {
      n++;
      aoa.push([n, it.text, it.sub, it.qty || 1, '', '', '']);
      itemRows.push(aoa.length);
      types.set(it.text, (types.get(it.text) || 0) + Number(it.qty || 1));
    }
    const lastItem = aoa.length;
    aoa.push(['', '', '', '', 'Door total (ex VAT)', '', '']);
    doorTotals.push({ row: aoa.length, first, lastItem, head: first - 1 });
    aoa.push([], []); // two empty rows after each door
  }
  const totalRow = aoa.length + 1;
  aoa.push(['', '', '', '', 'TOTAL (ex VAT)', '', '']);
  const ws1 = XLSX.utils.aoa_to_sheet(aoa);
  const typeList = [...types.entries()].sort((x, y) => y[1] - x[1]);
  const rLast = Math.max(2, typeList.length + 1);
  for (const r of itemRows) {
    const look = `INDEX(${RATES}!$C$2:$C$${rLast},MATCH(B${r},${RATES}!$A$2:$A$${rLast},0))`;
    ws1[`E${r}`] = { t: 's', v: '', z: EUR, f: `IFERROR(IF(${look}="","",${look}),"")` };
    ws1[`F${r}`] = { t: 's', v: '', z: EUR, f: `IFERROR(IF(E${r}="","",D${r}*E${r}),"")` };
  }
  for (const t of doorTotals) ws1[`F${t.row}`] = { t: 'n', v: 0, z: EUR, f: `SUM(F${t.first}:F${t.lastItem})` };
  ws1[`F${totalRow}`] = { t: 'n', v: 0, z: EUR, f: doorTotals.length ? doorTotals.map((t) => `F${t.row}`).join('+').length < 7000 ? doorTotals.map((t) => `F${t.row}`).join('+') : `SUMIF(E2:E${totalRow - 1},"Door total (ex VAT)",F2:F${totalRow - 1})` : '0' };
  ws1['!cols'] = [12, 60, 40, 6, 20, 20, 34].map((wch) => ({ wch }));
  ws1['!merges'] = doorTotals.map((t) => ({ s: { r: t.head - 1, c: 0 }, e: { r: t.head - 1, c: 6 } }));
  ws1['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow - 1, c: 6 } }) };
  XLSX.utils.book_append_sheet(wb, ws1, 'Price schedule');

  // Rates by type of work: price each once; the schedule picks it up
  const ws2 = XLSX.utils.aoa_to_sheet([['Type of work', 'Total qty', 'Unit rate (€ ex VAT)', 'Total (€ ex VAT)'], ...typeList.map(([k]) => [k, null, '', ''])]);
  const lastSched = totalRow - 1;
  typeList.forEach(([, q], i) => {
    const r = i + 2;
    ws2[`B${r}`] = { t: 'n', v: q, f: `SUMIF('Price schedule'!$B$2:$B$${lastSched},A${r},'Price schedule'!$D$2:$D$${lastSched})` };
    ws2[`C${r}`] = { t: 's', v: '', z: EUR };
    ws2[`D${r}`] = { t: 's', v: '', z: EUR, f: `IFERROR(IF(C${r}="","",B${r}*C${r}),"")` };
  });
  const rt = typeList.length + 3;
  XLSX.utils.sheet_add_aoa(ws2, [['', '', 'TOTAL (ex VAT)']], { origin: `A${rt}` });
  ws2[`D${rt}`] = { t: 'n', v: 0, z: EUR, f: typeList.length ? `SUM(D2:D${typeList.length + 1})` : '0' };
  ws2['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rt - 1, c: 3 } });
  ws2['!cols'] = [{ wch: 70 }, { wch: 9 }, { wch: 20 }, { wch: 18 }];
  ws2['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, typeList.length), c: 3 } }) };
  XLSX.utils.book_append_sheet(wb, ws2, 'Rates by type of work');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return saveFile(`FSCF_Pricing_schedule_${safeName(project.site || project.client)}_${new Date().toISOString().slice(0, 10)}.xlsx`, blob);
}


// Production list for the joinery: one row per door marked for replacement,
// with its sizes and choices; open queries list anything still missing.
export async function exportProductionXlsx(project, opts = {}) {
  const XLSX = await loadSheetJS();
  const doors = [...(opts.doors || [])].sort((a, b) => (a.pinNo || 0) - (b.pinNo || 0));
  const planName = Object.fromEntries((opts.plans || []).map((p) => [p.id, p.name]));
  const sections = (opts.sections || []).filter((s) => s.when === 'replacement');
  const fields = sections.flatMap((s) => s.fields);
  const qty = fields.find((f) => f.id === 'qty');
  const cols = fields.filter((f) => f !== qty);
  const head = ['Ref', 'Location', 'Drawing', 'Supply', 'Door rating', 'Swing / handing', ...cols.map((f) => f.label + (f.unit ? ` (${f.unit})` : '')), 'Qty'];
  const rows = doors.map((d) => [
    d.ref || `Pin ${d.pinNo}`, d.location || '', planName[d.planId] || '', SUPPLY[d.replacement] || '', ratingOf(d), swingOf(d),
    ...cols.map((f) => (f.type === 'number' ? d.attrs?.[f.id] ?? '' : fieldText(f, d.attrs?.[f.id]))),
    qty ? d.attrs?.qty ?? 1 : 1,
  ]);
  const total = rows.reduce((t, r) => t + (Number(r[r.length - 1]) || 0), 0);
  const top = [
    ['FSCF IRELAND — FIRE DOOR PRODUCTION LIST'],
    [`Site: ${project.site || ''}${project.address ? ` (${project.address})` : ''} · Client: ${project.client || ''} · ${new Date().toLocaleDateString('en-IE')}${opts.filterText ? ` · ${opts.filterText}` : ''}`],
    [],
    head,
  ];
  const totalRow = Array(head.length).fill('');
  totalRow[head.length - 2] = 'Total units';
  totalRow[head.length - 1] = total;
  const aoa = [...top, ...rows, [], totalRow];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = head.map((h, i) => ({ wch: i === 1 ? 26 : i === 2 ? 18 : /info|finish|glazing|lock|seal|architrave/i.test(h) ? 26 : Math.max(9, Math.min(18, h.length + 2)) }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: top.length - 1, c: 0 }, e: { r: top.length - 1 + Math.max(1, rows.length), c: head.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Production list');
  const queries = doors.map((d) => [d.ref || `Pin ${d.pinNo}`, d.location || '', missingFor(d, sections)]).filter((q) => q[2].length);
  const q = [['Open queries to close before release to production'], [], ['Ref', 'Location', 'Still needed'], ...queries.map(([r, l, m]) => [r, l, m.join(', ')])];
  if (!queries.length) q.push(['', '', 'None: every replacement door has its sizes and choices.']);
  const wq = XLSX.utils.aoa_to_sheet(q);
  wq['!cols'] = [{ wch: 10 }, { wch: 28 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wq, 'Open queries');
  const blob = new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return saveFile(`${safeName(project.site || project.client || 'Project')}_Production_list_${new Date().toISOString().slice(0, 10)}.xlsx`, blob);
}
