// Fields: your own extra details on a door, like Fieldwire attributes.
// Each field is a number (with a unit), a list you write, text, or yes/no.
// Fields sit in sections; a section shows always, or only when the door is
// marked for replacement. The Replacement details section comes ready with
// the attributes from FSCF's Fieldwire replacement surveys.

export const REPLACEMENTS = [
  ['', 'No replacement'],
  ['df', 'Replacement – door and frame'],
  ['d', 'Replacement – door only'],
  ['f', 'Replacement – frame only'],
];
export const SUPPLY = { df: 'Door + frame', d: 'Door only', f: 'Frame only' };

export const FIELD_TYPES = [
  ['number', 'Number'],
  ['list', 'List (drop-down)'],
  ['text', 'Text'],
  ['yesno', 'Yes / no'],
];

export const DEFAULT_FIELD_SECTIONS = [
  {
    id: 'rep', name: 'Replacement details', when: 'replacement', base: 'fd',
    fields: [
      { id: 'h', label: 'Height', type: 'number', unit: 'mm', need: true, fw: 'Height' },
      { id: 'w', label: 'Width', type: 'number', unit: 'mm', need: true, fw: 'Width' },
      { id: 't', label: 'Wall / substrate thickness', type: 'number', unit: 'mm', need: true, fw: 'Wall/Substrate Thickness' },
      { id: 'uc', label: 'Undercut', type: 'list', own: true, need: true, fw: 'Undercut', options: ['Cert compliant undercut', '10 mm', '12 mm', '14 mm'] },
      { id: 'fin', label: 'Door finish', type: 'list', own: true, need: true, fw: 'Door finish', options: ['Primed white door and frame', 'Formica door, exposed lippings, colour TBC', 'Cherry veneer', 'Oak veneer', 'Paint grade'] },
      { id: 'seal', label: 'Seal type required', type: 'list', own: true, need: true, fw: 'Seal Type Required', options: ['Separate heat / smoke seals', 'Combined heat / smoke seals', 'Seals in frame'] },
      { id: 'drop', label: 'Drop seal', type: 'list', need: true, fw: 'Drop Seals', options: ['Drop seal required', 'Not required'] },
      { id: 'glz', label: 'Glazing', type: 'list', own: true, need: true, fw: 'Glazing Requirement', options: ['No glazing element', '30/30', '60/60'] },
      { id: 'vp', label: 'Glazing / screen info', type: 'list', own: true, fw: 'Additional Glazing/Screen Information', options: ['Vision panel Part M compliant', 'Small vision panel, sizes TBC'] },
      { id: 'lock', label: 'Lock type', type: 'list', own: true, need: true, fw: 'Lock Type', options: ['Standard sash lock, euro cylinder', 'DIN lock, euro cylinder', 'Bathroom lock', 'No lock required'] },
      { id: 'ark', label: 'Architraves', type: 'text', placeholder: 'e.g. 80mm small pencil round' },
      { id: 'qty', label: 'Qty', type: 'number' },
      { id: 'code', label: 'FSCF door type code', type: 'number', fw: 'FSCF Ireland Door Type' },
      { id: 'info', label: 'Other relevant info', type: 'text', long: true, fw: 'Other Relavant Info' },
    ],
  },
];

// Sections that show on this door (kit: the door's checklist kit, kitId its id)
export function sectionsFor(sections, door, kit, kitId) {
  return (sections || []).filter((s) => {
    if (s.base && !(kit?.base === s.base || kitId === s.base)) return false;
    return s.when === 'replacement' ? !!door.replacement : true;
  });
}

export function fieldText(f, v) {
  if (v == null || v === '') return '';
  if (f.type === 'yesno') return v === true || v === 'yes' ? 'Yes' : v === false || v === 'no' ? 'No' : String(v);
  if (f.type === 'number') return f.unit ? `${v} ${f.unit}` : String(v);
  return String(v);
}

// Rating and swing come from the door's own door type and leaf / swing
export const ratingOf = (door) => (door.doorType || '').split(' (')[0];
export const swingOf = (door) => door.leaf || '';

// Fields a replacement still needs before it can go to the joinery
export function missingFor(door, sections) {
  if (!door.replacement) return [];
  const a = door.attrs || {};
  const out = [];
  if (!ratingOf(door)) out.push('door rating');
  if (!swingOf(door) && door.replacement !== 'f') out.push('swing / handing');
  for (const s of sections || []) if (s.when === 'replacement') for (const f of s.fields) if (f.need && (a[f.id] == null || a[f.id] === '')) out.push(f.label.toLowerCase());
  return out;
}

// One line for reports: "Door + frame · 2100 × 880 × 130 mm · undercut 12 mm"
export function replacementLine(door) {
  if (!door.replacement) return '';
  const a = door.attrs || {};
  const size = a.h || a.w ? `${a.h || '?'} × ${a.w || '?'}${a.t ? ` × ${a.t}` : ''} mm` : '';
  return [SUPPLY[door.replacement], size, a.uc ? `undercut ${String(a.uc).toLowerCase()}` : ''].filter(Boolean).join(' · ');
}

// --- reading Fieldwire attributes from a report's task text
const OTHER_LABELS = ['DOOR SWING', 'DOOR TYPE', 'Door Rating', 'Door Handing', 'Door Swing Type', 'Remedial Repair Code for Costs', 'Risk Item No.', 'FA ZONE NO', 'FA ZONE NAME', 'RFID TAG NO', 'DOOR COUNT', 'Plan', 'Tags', 'Created', 'Priority'];
const norm = (s) => String(s || '').toLowerCase().replace(/seperate/g, 'separate').replace(/[^a-z0-9]/g, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

export function matchOption(f, raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  if (f.type === 'number') {
    const n = parseFloat(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : v;
  }
  if (f.type === 'list') {
    const n = norm(v);
    const hit = (f.options || []).find((o) => norm(o) === n) || (f.options || []).find((o) => norm(o).startsWith(n) || n.startsWith(norm(o)));
    if (hit) return hit;
    if (/^\d+(\.\d+)?\s*mm$/i.test(v)) return v.replace(/\s*mm$/i, ' mm');
    return v.replace(/Seperate/g, 'Separate');
  }
  return v;
}

export function readFwAttrs(text, sections) {
  const fields = (sections || []).flatMap((s) => s.fields).filter((f) => f.fw);
  const labels = [...fields.map((f) => f.fw), ...OTHER_LABELS];
  const hits = [];
  for (const l of labels) {
    const re = new RegExp(`(?:^|\\s)${esc(l)}:\\s*`, 'g');
    let m;
    while ((m = re.exec(text))) hits.push({ l, at: m.index, end: m.index + m[0].length });
  }
  hits.sort((a, b) => a.at - b.at);
  const attrs = {};
  const raw = {};
  for (const [i, h] of hits.entries()) raw[h.l] = text.slice(h.end, i + 1 < hits.length ? hits[i + 1].at : text.length).trim();
  for (const f of fields) if (raw[f.fw]) attrs[f.id] = matchOption(f, raw[f.fw]);
  const swing = raw['DOOR SWING'] || raw['Door Swing Type'] || '';
  const handing = raw['Door Handing'] || '';
  return { attrs, swing, handing };
}
