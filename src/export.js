// Excel export, laid out to feed the pricing workbook.
// Sheets: Summary · Doors · Defects (pricing) · Defect totals

import * as db from './db.js';
import { STATUSES, statusById } from './defaults.js';
import { loadSheetJS, saveFile, safeName } from './files.js';

const EURO = '"€"#,##0.00';

export async function exportProjectXlsx(project) {
  const XLSX = await loadSheetJS();
  const doors = await db.projectDoors(project.id);
  const plans = await db.projectPlans(project.id);
  const planName = Object.fromEntries(plans.map((p) => [p.id, p.name]));
  const photos = await db.byIndex('photos', 'projectId', project.id);
  const photoCount = {};
  for (const p of photos) photoCount[p.doorId] = (photoCount[p.doorId] || 0) + 1;

  const wb = XLSX.utils.book_new();

  // --- Summary
  const counts = Object.fromEntries(STATUSES.map((s) => [s.id, 0]));
  for (const d of doors) counts[d.status || 'not_inspected']++;
  const defectRows = doors.flatMap((d) => d.defects || []);
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
  ];
  const ws0 = XLSX.utils.aoa_to_sheet(summary);
  ws0['!cols'] = [{ wch: 22 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, ws0, 'Summary');

  // --- Doors (one row per door)
  const doorHeader = [
    'Pin', 'Door ref', 'Plan / level', 'Location / room', 'Door type', 'Leaf config', 'Status',
    'Recommended action', 'No. of defects', 'Defects', 'Remedial work', 'Photos', 'Notes', 'Inspected on', 'Inspected by',
  ];
  const doorRows = doors.map((d) => [
    d.pinNo ?? '',
    d.ref || '',
    planName[d.planId] || '',
    d.location || '',
    d.doorType || '',
    d.leaf || '',
    statusById[d.status || 'not_inspected']?.label || '',
    d.action || '',
    (d.defects || []).length,
    (d.defects || []).map((x) => x.label).join('; '),
    (d.defects || []).map((x) => x.remedial).filter(Boolean).join('; '),
    photoCount[d.id] || 0,
    d.notes || '',
    d.inspectedOn || '',
    d.inspectedBy || '',
  ]);
  const ws1 = XLSX.utils.aoa_to_sheet([doorHeader, ...doorRows]);
  ws1['!cols'] = [6, 12, 18, 22, 18, 14, 13, 24, 8, 50, 50, 7, 30, 12, 14].map((wch) => ({ wch }));
  ws1['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, doorRows.length), c: doorHeader.length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, ws1, 'Doors');

  // --- Defects (pricing): one row per defect, with Qty × Rate formula
  const pHeader = ['Pin', 'Door ref', 'Plan / level', 'Location / room', 'Door type', 'Status', 'Defect', 'Remedial work', 'Qty', 'Unit rate (€)', 'Line total (€)', 'Door notes'];
  const pRows = [];
  for (const d of doors) {
    for (const x of d.defects || []) {
      pRows.push([
        d.pinNo ?? '', d.ref || '', planName[d.planId] || '', d.location || '', d.doorType || '',
        statusById[d.status || 'not_inspected']?.label || '', x.label || '', x.remedial || '', Number(x.qty) || 1, null, null, d.notes || '',
      ]);
    }
  }
  const ws2 = XLSX.utils.aoa_to_sheet([pHeader, ...pRows]);
  const last = pRows.length + 1; // last data row (1-based)
  for (let r = 2; r <= last; r++) {
    ws2[`J${r}`] = { t: 'n', v: 0, z: EURO };
    ws2[`K${r}`] = { t: 'n', f: `I${r}*J${r}`, z: EURO };
  }
  const totalRow = last + 2;
  XLSX.utils.sheet_add_aoa(ws2, [['', '', '', '', '', '', '', 'TOTAL (ex VAT)']], { origin: `A${totalRow}` });
  ws2[`K${totalRow}`] = { t: 'n', f: pRows.length ? `SUM(K2:K${last})` : '0', z: EURO };
  ws2['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow - 1, c: pHeader.length - 1 } });
  ws2['!cols'] = [6, 12, 18, 22, 18, 13, 40, 50, 6, 12, 13, 30].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws2, 'Defects (pricing)');

  // --- Defect totals: how many of each defect across the site
  const totals = {};
  for (const x of defectRows) {
    const k = x.label || '(blank)';
    totals[k] = totals[k] || { count: 0, qty: 0, remedial: x.remedial || '' };
    totals[k].count++;
    totals[k].qty += Number(x.qty) || 1;
  }
  const tRows = Object.entries(totals).sort((a, b) => b[1].count - a[1].count).map(([k, v]) => [k, v.count, v.qty, v.remedial]);
  const ws3 = XLSX.utils.aoa_to_sheet([['Defect', 'Doors affected', 'Total qty', 'Typical remedial work'], ...tRows]);
  ws3['!cols'] = [{ wch: 45 }, { wch: 14 }, { wch: 10 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Defect totals');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const filename = `FSCF_${safeName(project.site || project.client)}_${(project.date || new Date().toISOString().slice(0, 10))}.xlsx`;
  return saveFile(filename, blob);
}
