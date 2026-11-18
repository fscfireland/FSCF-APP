// Excel export, laid out to feed the pricing workbook.
// Sheets: Summary · Doors · Checklist · Defects (pricing) · Materials ·
//         Material totals · Defect totals

import * as db from './db.js';
import { STATUSES, statusById, doorActions, materialsTotal, ANSWERS } from './defaults.js';
import { loadSheetJS, saveFile, safeName } from './files.js';

const EURO = '"€"#,##0.00';
const answerLabel = Object.fromEntries(ANSWERS.map((a) => [a.id, a.label]));

export async function exportProjectXlsx(project, questions = []) {
  const XLSX = await loadSheetJS();
  const doors = await db.projectDoors(project.id);
  const plans = await db.projectPlans(project.id);
  const planName = Object.fromEntries(plans.map((p) => [p.id, p.name]));
  const photos = await db.byIndex('photos', 'projectId', project.id);
  const photoCount = {};
  for (const p of photos) photoCount[p.doorId] = (photoCount[p.doorId] || 0) + 1;
  const statusLabel = (d) => statusById[d.status || 'not_inspected']?.label || '';
  const enc = XLSX.utils.encode_cell;

  // Adds a "TOTAL" row under a money column and sets € formats on it
  const moneyCols = (ws, cols, firstRow, lastRow) => {
    for (let r = firstRow; r <= lastRow; r++) for (const c of cols) if (ws[`${c}${r}`]) ws[`${c}${r}`].z = EURO;
  };

  const wb = XLSX.utils.book_new();

  // --- Summary
  const counts = Object.fromEntries(STATUSES.map((s) => [s.id, 0]));
  for (const d of doors) counts[d.status || 'not_inspected']++;
  const defectRows = doors.flatMap((d) => d.defects || []);
  const matTotal = doors.reduce((t, d) => t + materialsTotal(d), 0);
  const summary = [
    ['FSCF Ireland – Fire door inspection'],
    [],
    ['Client', project.client || ''],
    ['Site', project.site || ''],
    ['Address', project.address || ''],
    ['Inspection date', project.date || ''],
    ['Exported', new Date().toLocaleString('en-IE')],
    [],
    ['Doors recorded', doors.length],
    ...STATUSES.map((s) => [s.label, counts[s.id]]),
    [],
    ['Defects recorded', defectRows.length],
    ['Materials total (€ ex VAT)', matTotal],
  ];
  const ws0 = XLSX.utils.aoa_to_sheet(summary);
  ws0[`B${summary.length}`].z = EURO;
  ws0['!cols'] = [{ wch: 26 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, ws0, 'Summary');

  // --- Doors (one row per door)
  const doorHeader = [
    'Pin', 'Door ref', 'Plan / level', 'Location / room', 'Door type', 'Leaf config', 'Status',
    'Recommended actions', 'Questions failed', 'No. of defects', 'Defects', 'Remedial work', 'Materials (€)', 'Photos', 'Notes', 'Inspected on', 'Inspected by',
  ];
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
    d.notes || '',
    d.inspectedOn || '',
    d.inspectedBy || '',
  ]);
  const ws1 = XLSX.utils.aoa_to_sheet([doorHeader, ...doorRows]);
  moneyCols(ws1, ['M'], 2, doorRows.length + 1);
  ws1['!cols'] = [6, 12, 18, 22, 18, 14, 13, 40, 9, 8, 50, 50, 12, 7, 30, 12, 14].map((wch) => ({ wch }));
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
  const cHeader = ['Pin', 'Door ref', 'Location / room', 'Status', ...qCols.map((q, i) => `Q${i + 1}. ${q.text}`), 'Pass', 'Fail', 'N/A'];
  const cRows = doors.map((d) => {
    const ans = qCols.map((q) => answerLabel[d.checks?.[q.id]?.answer] || '');
    return [d.pinNo ?? '', d.ref || '', d.location || '', statusLabel(d), ...ans,
      ans.filter((a) => a === 'Pass').length, ans.filter((a) => a === 'Fail').length, ans.filter((a) => a === 'N/A').length];
  });
  const ws2 = XLSX.utils.aoa_to_sheet([cHeader, ...cRows]);
  ws2['!cols'] = [6, 12, 22, 13, ...qCols.map(() => 18), 6, 6, 6].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws2, 'Checklist');

  // --- Defects (pricing): one row per defect, with Qty × Rate formula
  const pHeader = ['Pin', 'Door ref', 'Plan / level', 'Location / room', 'Door type', 'Status', 'Defect', 'Remedial work', 'Qty', 'Unit rate (€)', 'Line total (€)', 'Door notes'];
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
  const mHeader = ['Pin', 'Door ref', 'Location / room', 'Material', 'Unit', 'Qty', 'Unit cost (€)', 'Line total (€)'];
  const mRows = [];
  for (const d of doors) {
    for (const m of d.materials || []) {
      mRows.push([d.pinNo ?? '', d.ref || '', d.location || '', m.name || '', m.unit || '', Number(m.qty) || 0, Number(m.cost) || 0, null]);
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

  // --- Material totals: the order list for the whole site
  const mt = new Map();
  for (const d of doors) {
    for (const m of d.materials || []) {
      const key = `${m.name}|${m.unit}|${Number(m.cost) || 0}`;
      const row = mt.get(key) || { name: m.name, unit: m.unit, cost: Number(m.cost) || 0, qty: 0, doors: 0 };
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

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const filename = `FSCF_${safeName(project.site || project.client)}_${(project.date || new Date().toISOString().slice(0, 10))}.xlsx`;
  return saveFile(filename, blob);
}
