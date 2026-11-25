// Import a list of doors from Excel (.xlsx / .xls) or CSV.
// Column headings are matched loosely, so most existing door schedules work
// as they are: "Door ref" / "Door No." / "ID", "Location" / "Room",
// "Floor" / "Level", "Door type" / "Rating", "Leaf", "Zone" / "FA zone no.",
// "Zone name", "Risk", "Notes" / "Comments".

import { loadSheetJS, saveFile } from './files.js';

const FIELDS = [
  { key: 'ref', label: 'Door ref', re: /^(door\s*)?(ref(erence)?|no\.?|number|id|tag|code)\b|^door$/i },
  { key: 'zoneName', label: 'Fire alarm zone name', re: /zone\s*(name|desc|description|location)/i },
  { key: 'zoneNo', label: 'Fire alarm zone no.', re: /(^|\b)(f\.?a\.?\s*)?zone(\s*(no\.?|number|#|ref))?$|fire\s*alarm\s*zone/i },
  { key: 'floor', label: 'Floor / level', re: /^(floor|level|storey|building\s*level)/i },
  { key: 'location', label: 'Location / room', re: /location|room|area|space|description/i },
  { key: 'risk', label: 'Risk rating', re: /risk/i },
  { key: 'doorType', label: 'Door type', re: /type|rating|fire\s*resistance|^fd/i },
  { key: 'leaf', label: 'Leaf configuration', re: /leaf|config|single|double/i },
  { key: 'notes', label: 'Notes', re: /note|comment|remark/i },
];

const TEMPLATE_HEADERS = ['Door ref', 'Location / room', 'Floor / level', 'Door type', 'Leaf configuration', 'Fire alarm zone no.', 'Fire alarm zone name', 'Risk rating', 'Notes'];

export async function downloadTemplate() {
  const XLSX = await loadSheetJS();
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    ['GF-001', 'Bedroom 1', 'Ground floor', 'FD30S', 'Single leaf', '1', 'East wing ground floor', '', ''],
    ['GF-002', 'Corridor to stairs', 'Ground floor', 'FD60S', 'Double leaf', '2', 'Stair core', 'Medium', 'Hold-open device fitted'],
  ]);
  ws['!cols'] = [12, 24, 16, 14, 16, 12, 26, 12, 30].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Doors');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return saveFile('FSCF_door_import_template.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

function matchHeader(text, taken) {
  const h = String(text || '').trim();
  if (!h) return null;
  for (const f of FIELDS) if (!taken.has(f.key) && f.re.test(h)) return f.key;
  return null;
}

// Finds the heading row (within the first 15 rows) and reads the doors
export async function parseDoorFile(file) {
  const XLSX = await loadSheetJS();
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  let headIdx = -1;
  let cols = {};
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const taken = new Set();
    const map = {};
    rows[i].forEach((cell, c) => {
      const k = matchHeader(cell, taken);
      if (k) {
        taken.add(k);
        map[k] = c;
      }
    });
    if (Object.keys(map).length >= 2 && (map.ref != null || map.location != null)) {
      headIdx = i;
      cols = map;
      break;
    }
  }
  if (headIdx < 0) throw new Error('No heading row found. Use headings such as "Door ref" and "Location" (download the template to see the layout).');
  const doors = [];
  for (const r of rows.slice(headIdx + 1)) {
    const get = (k) => (cols[k] != null ? String(r[cols[k]] ?? '').trim() : '');
    const d = Object.fromEntries(FIELDS.map((f) => [f.key, get(f.key)]));
    if (!d.ref && !d.location) continue; // blank or note rows
    doors.push(d);
  }
  return {
    doors,
    columns: FIELDS.filter((f) => cols[f.key] != null).map((f) => `${f.label} ← "${rows[headIdx][cols[f.key]]}"`),
    sheet: wb.SheetNames[0],
  };
}

// Match a value like "FD30" or "fd 60s" to the closest entry in the door types list
export function matchListValue(value, list) {
  const v = String(value || '').trim();
  if (!v) return '';
  const norm = (s) => s.toLowerCase().replace(/[\s\-–()]/g, '');
  const exact = list.find((x) => norm(x) === norm(v));
  if (exact) return exact;
  // "FD30" → "FD30 (EI 30)" rather than "FD30S (EI 30-Sa)"; "Single" → "Single leaf"
  const starts = list.filter((x) => norm(x).startsWith(norm(v))).sort((a, b) => norm(a).length - norm(b).length);
  return starts[0] || v;
}
