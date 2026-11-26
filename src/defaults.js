// Default lists. Door types and defects can be edited in Settings;
// these are only the starting point.

// ---- Status schemes ----
// Each project picks a scheme. Status ids are the same in every scheme
// (so data, sync and Claude queries stay simple); only the wording and the
// set offered change.
//   pass = the good outcome (green), fail = the bad outcome (red),
//   na = not applicable (grey), no_access (orange), repaired (blue),
//   not_inspected = still to do (hollow white pin).
const COLORS = {
  not_inspected: 'var(--st-todo)',
  pass: 'var(--st-pass)',
  fail: 'var(--st-fail)',
  na: 'var(--st-na)',
  no_access: 'var(--st-noaccess)',
  repaired: 'var(--st-repaired)',
};

export const SCHEMES = {
  passfail: {
    id: 'passfail',
    name: 'Pass / Fail',
    hint: 'Pass, Fail, Not applicable, No access, Repaired',
    order: ['not_inspected', 'pass', 'fail', 'na', 'no_access', 'repaired'],
    labels: { not_inspected: 'Not inspected', pass: 'Pass', fail: 'Fail', na: 'Not applicable', no_access: 'No access', repaired: 'Repaired' },
    short: { not_inspected: 'To do', pass: 'Pass', fail: 'Fail', na: 'N/A', no_access: 'No access', repaired: 'Repaired' },
    answers: { pass: 'Pass', fail: 'Fail', na: 'N/A' },
    rateLabel: 'fail rate',
    checkChart: 'Failure rate by inspection check',
    checkChartSub: 'Share of doors failing each check (N/A answers excluded)',
    summary: (n, of, p) => `${n} of ${of} doors inspected (${p}%) did not meet the required standard and need remedial work.`,
  },
  action: {
    id: 'action',
    name: 'Action required',
    hint: 'No action required, Action required, Not applicable, No access',
    order: ['not_inspected', 'pass', 'fail', 'na', 'no_access'],
    labels: { not_inspected: 'Not inspected', pass: 'No action required', fail: 'Action required', na: 'Not applicable', no_access: 'No access', repaired: 'Repaired' },
    short: { not_inspected: 'To do', pass: 'No action', fail: 'Action', na: 'N/A', no_access: 'No access', repaired: 'Repaired' },
    answers: { pass: 'No action', fail: 'Action', na: 'N/A' },
    rateLabel: 'need action',
    checkChart: 'Action required by inspection check',
    checkChartSub: 'Share of doors needing action on each check (N/A answers excluded)',
    summary: (n, of, p) => `${n} of ${of} doors inspected (${p}%) require action.`,
  },
};
export const DEFAULT_SCHEME = 'passfail';

// ---- Custom schemes (made in Settings) ----
// Stored as { id, name, labels: {pass, fail, na, no_access, repaired},
// include: {na, no_access, repaired}, answers: {pass, fail, na} }.
// Colours stay tied to each role so plans and reports read the same.
export const OPTIONAL_STATUSES = ['na', 'no_access', 'repaired'];
const CUSTOM = {};

export function buildCustomScheme(c) {
  const base = SCHEMES.passfail;
  const clean = (v, d) => (String(v ?? '').trim() || d);
  const labels = { not_inspected: 'Not inspected' };
  for (const k of ['pass', 'fail', ...OPTIONAL_STATUSES]) labels[k] = clean(c.labels?.[k], base.labels[k]);
  const answers = { pass: clean(c.answers?.pass, labels.pass), fail: clean(c.answers?.fail, labels.fail), na: clean(c.answers?.na, 'N/A') };
  const order = ['not_inspected', 'pass', 'fail', ...OPTIONAL_STATUSES.filter((k) => c.include?.[k] !== false)];
  return {
    id: c.id,
    custom: true,
    name: clean(c.name, 'Custom scheme'),
    hint: order.slice(1).map((k) => labels[k]).join(', '),
    order,
    labels,
    short: { ...labels, not_inspected: 'To do' },
    answers,
    rateLabel: labels.fail.toLowerCase(),
    checkChart: `"${answers.fail}" answers by inspection check`,
    checkChartSub: `Share of doors answered "${answers.fail}" on each check ("${answers.na}" answers excluded)`,
    summary: (n, of, p) => `${n} of ${of} doors inspected (${p}%) were recorded as ${labels.fail}.`,
  };
}

export function setCustomSchemes(list) {
  for (const k of Object.keys(CUSTOM)) delete CUSTOM[k];
  for (const c of list || []) CUSTOM[c.id] = buildCustomScheme(c);
}

export const allSchemes = () => [...Object.values(SCHEMES), ...Object.values(CUSTOM)];
export const schemeById = (id) => SCHEMES[id] || CUSTOM[id] || null;

const ALL_IDS = ['not_inspected', 'pass', 'fail', 'na', 'no_access', 'repaired'];

// The active scheme. These are live bindings: every module that imports
// STATUSES / statusById / ANSWERS sees the current project's wording.
export let SCHEME = SCHEMES[DEFAULT_SCHEME];
export let STATUSES = [];
export let statusById = {};
export let ANSWERS = [];

// The scheme's statuses, plus any status a door still has that the scheme
// doesn't offer (e.g. "Repaired" after switching scheme), so totals add up.
export function statusesInUse(doors) {
  const extra = [...new Set(doors.map((d) => d.status || 'not_inspected'))]
    .filter((id) => !STATUSES.some((s) => s.id === id) && statusById[id]);
  return [...STATUSES, ...extra.map((id) => statusById[id])];
}

export function useScheme(projectOrId) {
  const id = typeof projectOrId === 'string' ? projectOrId : projectOrId?.scheme;
  SCHEME = SCHEMES[id] || CUSTOM[id] || SCHEMES[DEFAULT_SCHEME];
  const make = (sid) => ({ id: sid, label: SCHEME.labels[sid], short: SCHEME.short[sid], color: COLORS[sid] });
  statusById = Object.fromEntries(ALL_IDS.map((sid) => [sid, make(sid)]));
  STATUSES = SCHEME.order.map((sid) => statusById[sid]);
  ANSWERS = ['pass', 'fail', 'na'].map((aid) => ({ id: aid, label: SCHEME.answers[aid] }));
  return SCHEME;
}
useScheme(DEFAULT_SCHEME);

// Doors that count towards the fail / action rate
export const isInspected = (d) => !['not_inspected', 'no_access', 'na'].includes(d.status || 'not_inspected');

// Recommended actions — a door can have several. Edit the list in Settings.
export const DEFAULT_ACTIONS = [
  'No action required',
  'Repair / upgrade on site',
  'Replace door leaf',
  'Replace complete door set',
  'Replace ironmongery',
  'Fit new intumescent / smoke seals',
  'Adjust or replace door closer',
  'Fire stop around frame',
  'Fit signage',
  'Further investigation required',
  'Refer to client – no access',
];

// Inspection questions asked of every door (Pass / Fail / N/A).
// Each has a fixed id so answers survive if the wording is edited.
// The old 8-point fire door check was deleted at the owner's request (26 Nov 2026:
// its source was unknown, so it broke standing rule 1). Doors that answered it
// keep their answers (questionsFor shows removed questions that were answered).
export const DEFAULT_QUESTIONS = [];
export const OLD_8_POINT_IDS = ['q-close', 'q-gaps', 'q-seals', 'q-hinges', 'q-iron', 'q-glazing', 'q-leaf', 'q-sign'];

// Materials catalogue. Prices are left at 0 for you to enter your own
// (ex VAT) in Settings; they then pre-fill each door.
export const MAT_CATEGORIES = ['Seals', 'Closers', 'Hinges', 'Ironmongery', 'Hold-open', 'Signs', 'Glazing', 'Fire stopping', 'Timber & repairs', 'Dampers', 'Fire alarm', 'Emergency lighting', 'Extinguishers', 'Labour', 'Other'];

// One price list for everything: each product has a category, so a defect
// can offer only the products that fix it (e.g. Closers → Arrone or Dorma).
export const DEFAULT_MATERIALS = [
  { id: 'm-int10', cat: 'Seals', name: 'Intumescent strip 10 × 4 mm (2.1 m)', unit: 'length', cost: 4.5 },
  { id: 'm-int15', cat: 'Seals', name: 'Intumescent strip 15 × 4 mm (2.1 m)', unit: 'length', cost: 5.5 },
  { id: 'm-int20', cat: 'Seals', name: 'Intumescent strip 20 × 4 mm (2.1 m)', unit: 'length', cost: 6.5 },
  { id: 'm-int25', cat: 'Seals', name: 'Intumescent strip 25 × 4 mm (2.1 m)', unit: 'length', cost: 7.5 },
  { id: 'm-int10s', cat: 'Seals', name: 'Intumescent + smoke seal 10 × 4 mm (2.1 m)', unit: 'length', cost: 6.0 },
  { id: 'm-int15s', cat: 'Seals', name: 'Intumescent + smoke seal 15 × 4 mm (2.1 m)', unit: 'length', cost: 7.0 },
  { id: 'm-int20s', cat: 'Seals', name: 'Intumescent + smoke seal 20 × 4 mm (2.1 m)', unit: 'length', cost: 8.5 },
  { id: 'm-smoke', cat: 'Seals', name: 'Smoke seal only, brush or fin (2.1 m)', unit: 'length', cost: 5.0 },
  { id: 'm-drop', cat: 'Seals', name: 'Automatic drop-down seal', unit: 'each', cost: 65.0 },
  { id: 'm-thresh', cat: 'Seals', name: 'Threshold strip / seal', unit: 'each', cost: 18.0 },
  { id: 'm-closer', cat: 'Closers', name: 'Overhead door closer EN 1154 (standard)', unit: 'each', cost: 75.0 },
  { id: 'm-cl-arrone', cat: 'Closers', name: 'Arrone overhead closer EN 1154', unit: 'each', cost: 85.0 },
  { id: 'm-cl-dorma', cat: 'Closers', name: 'Dorma TS83 overhead closer EN 1154', unit: 'each', cost: 140.0 },
  { id: 'm-cl-conc', cat: 'Closers', name: 'Concealed jamb closer (Perko type)', unit: 'each', cost: 95.0 },
  { id: 'm-cl-free', cat: 'Closers', name: 'Free-swing closer linked to fire alarm', unit: 'each', cost: 320.0 },
  { id: 'm-hinge', cat: 'Hinges', name: 'Fire-rated hinge EN 1935 (Grade 13)', unit: 'each', cost: 12.0 },
  { id: 'm-hpad', cat: 'Hinges', name: 'Intumescent hinge pads', unit: 'pack', cost: 6.0 },
  { id: 'm-hscrew', cat: 'Hinges', name: 'Hinge screws (set, correct size)', unit: 'set', cost: 5.0 },
  { id: 'm-latch', cat: 'Ironmongery', name: 'Fire-rated latch / lock', unit: 'each', cost: 35.0 },
  { id: 'm-handle', cat: 'Ironmongery', name: 'Fire-rated lever handle set', unit: 'set', cost: 35.0 },
  { id: 'm-pull', cat: 'Ironmongery', name: 'Pull handle', unit: 'each', cost: 15.0 },
  { id: 'm-esc', cat: 'Ironmongery', name: 'Escutcheon plate', unit: 'each', cost: 5.0 },
  { id: 'm-thumb35', cat: 'Ironmongery', name: 'Euro thumbturn 35/35T', unit: 'each', cost: 40.0 },
  { id: 'm-thumb45', cat: 'Ironmongery', name: 'Euro thumbturn 45/45T (60 min)', unit: 'each', cost: 40.0 },
  { id: 'm-cyl', cat: 'Ironmongery', name: 'Euro cylinder (master keyed)', unit: 'each', cost: 35.0 },
  { id: 'm-din', cat: 'Ironmongery', name: 'DIN sashlock / lockset (fire-rated)', unit: 'each', cost: 35.0 },
  { id: 'm-zoo', cat: 'Ironmongery', name: 'Zoo lock / latch (fire-rated)', unit: 'each', cost: 25.0 },
  { id: 'm-digi', cat: 'Ironmongery', name: 'Digital code lock (fire-rated)', unit: 'each', cost: 130.0 },
  { id: 'm-keeper', cat: 'Ironmongery', name: 'Keeper / strike plate', unit: 'each', cost: 15.0 },
  { id: 'm-lockwrap', cat: 'Ironmongery', name: 'Intumescent lock wrap', unit: 'each', cost: 5.0 },
  { id: 'm-flush', cat: 'Ironmongery', name: 'Flush bolt (fire-rated)', unit: 'each', cost: 12.0 },
  { id: 'm-select', cat: 'Ironmongery', name: 'Door selector (pairs)', unit: 'each', cost: 15.0 },
  { id: 'm-push', cat: 'Ironmongery', name: 'Push plate', unit: 'each', cost: 3.0 },
  { id: 'm-kick', cat: 'Ironmongery', name: 'Kick plate', unit: 'each', cost: 12.0 },
  { id: 'm-dstop', cat: 'Ironmongery', name: 'Door stop', unit: 'each', cost: 10.0 },
  { id: 'm-viewer', cat: 'Ironmongery', name: 'Fire-rated door viewer', unit: 'each', cost: 25.0 },
  { id: 'm-panic', cat: 'Ironmongery', name: 'Panic / push bar system (EN 1125)', unit: 'each', cost: 200.0 },
  { id: 'm-pellet', cat: 'Timber & repairs', name: 'Hardwood pellets / infill for screw holes', unit: 'pack', cost: 5.0 },
  { id: 'm-holdopen', cat: 'Hold-open', name: 'Hold-open device EN 1155', unit: 'each', cost: 180.0 },
  { id: 'm-glaze', cat: 'Glazing', name: 'Intumescent glazing tape / seal', unit: 'roll', cost: 15.0 },
  { id: 'm-mastic', cat: 'Fire stopping', name: 'Intumescent sealant 310 ml', unit: 'tube', cost: 14.0 },
  { id: 'm-lip', cat: 'Timber & repairs', name: 'Hardwood lipping', unit: 'length', cost: 22.0 },
  { id: 'm-sign', cat: 'Signs', name: 'Fire door keep shut', unit: 'each', cost: 3.5 },
  { id: 'm-sg-auto', cat: 'Signs', name: 'Automatic fire door keep shut', unit: 'each', cost: 3.5 },
  { id: 'm-sg-lock', cat: 'Signs', name: 'Fire door keep locked', unit: 'each', cost: 3.5 },
  { id: 'm-sg-exit', cat: 'Signs', name: 'Fire exit keep clear', unit: 'each', cost: 4.0 },
  { id: 'm-sg-push', cat: 'Signs', name: 'Push bar to open', unit: 'each', cost: 4.0 },
  { id: 'm-sg-right', cat: 'Signs', name: 'Turn to the right', unit: 'each', cost: 3.5 },
  { id: 'm-sg-left', cat: 'Signs', name: 'Turn to the left', unit: 'each', cost: 3.5 },
  { id: 'm-dp-link', cat: 'Dampers', name: 'Fusible link 72 °C', unit: 'each', cost: 8 },
  { id: 'm-dp-panel', cat: 'Dampers', name: 'Damper access panel', unit: 'each', cost: 45 },
  { id: 'm-dp-act', cat: 'Dampers', name: 'Damper actuator 230 V', unit: 'each', cost: 180 },
  { id: 'm-dp-dmp', cat: 'Dampers', name: 'Fire damper EN 15650 (up to 300 × 300)', unit: 'each', cost: 160 },
  { id: 'm-dp-label', cat: 'Dampers', name: 'Damper ID label', unit: 'each', cost: 3 },
  { id: 'm-fa-opt', cat: 'Fire alarm', name: 'Optical smoke detector', unit: 'each', cost: 35 },
  { id: 'm-fa-heat', cat: 'Fire alarm', name: 'Heat detector', unit: 'each', cost: 30 },
  { id: 'm-fa-mcp', cat: 'Fire alarm', name: 'Manual call point', unit: 'each', cost: 28 },
  { id: 'm-fa-snd', cat: 'Fire alarm', name: 'Sounder / beacon', unit: 'each', cost: 45 },
  { id: 'm-fa-bat', cat: 'Fire alarm', name: 'Standby battery 12 V 7 Ah', unit: 'each', cost: 22 },
  { id: 'm-fa-log', cat: 'Fire alarm', name: 'Zone chart and logbook', unit: 'each', cost: 25 },
  { id: 'm-el-bulk', cat: 'Emergency lighting', name: 'LED emergency bulkhead 3 h non-maintained', unit: 'each', cost: 45 },
  { id: 'm-el-exit', cat: 'Emergency lighting', name: 'LED exit sign with legend', unit: 'each', cost: 60 },
  { id: 'm-el-bat', cat: 'Emergency lighting', name: 'Replacement battery pack', unit: 'each', cost: 25 },
  { id: 'm-el-key', cat: 'Emergency lighting', name: 'Test key switch', unit: 'each', cost: 18 },
  { id: 'm-el-log', cat: 'Emergency lighting', name: 'Emergency lighting logbook', unit: 'each', cost: 15 },
  { id: 'm-ex-pow', cat: 'Extinguishers', name: '6 kg ABC powder extinguisher', unit: 'each', cost: 45 },
  { id: 'm-ex-co2', cat: 'Extinguishers', name: '2 kg CO2 extinguisher', unit: 'each', cost: 55 },
  { id: 'm-ex-foam', cat: 'Extinguishers', name: '6 L foam extinguisher', unit: 'each', cost: 45 },
  { id: 'm-ex-refill', cat: 'Extinguishers', name: 'Recharge / refill', unit: 'each', cost: 25 },
  { id: 'm-ex-pin', cat: 'Extinguishers', name: 'Safety pin and tamper seal', unit: 'each', cost: 3 },
  { id: 'm-ex-hose', cat: 'Extinguishers', name: 'Replacement hose / horn', unit: 'each', cost: 15 },
  { id: 'm-ex-ext', cat: 'Extinguishers', name: 'Extended service / discharge test', unit: 'each', cost: 35 },
  { id: 'm-ex-brk', cat: 'Extinguishers', name: 'Wall bracket', unit: 'each', cost: 6 },
  { id: 'm-ex-sign', cat: 'Extinguishers', name: 'Extinguisher ID sign', unit: 'each', cost: 4 },
];

// Category of a price-list item (older lists had none: work it out from the name)
export function matCat(m) {
  if (m.cat) return m.cat;
  const n = (m.name || '').toLowerCase();
  if (/damper|fusible/.test(n)) return 'Dampers';
  if (/detector|call point|sounder|beacon/.test(n)) return 'Fire alarm';
  if (/emergency|exit sign|luminaire/.test(n)) return 'Emergency lighting';
  if (/extinguisher|refill|recharge/.test(n)) return 'Extinguishers';
  if (/sign/.test(n)) return 'Signs';
  if (/closer/.test(n)) return 'Closers';
  if (/hinge/.test(n)) return 'Hinges';
  if (/hold.?open|free.?swing|mag/.test(n)) return 'Hold-open';
  if (/seal|intumescent strip|threshold|drop/.test(n)) return 'Seals';
  if (/latch|lock|handle|ironmongery|bar|escutcheon|thumbturn|cylinder|keeper|strike|flush bolt|selector|push plate|kick plate|door stop|viewer/.test(n)) return 'Ironmongery';
  if (/glaz|bead/.test(n)) return 'Glazing';
  if (/mastic|sealant|fire.?stop|batt/.test(n)) return 'Fire stopping';
  if (/lip|timber|leaf|frame/.test(n)) return 'Timber & repairs';
  return 'Other';
}

// Which part of the price list fixes a defect
export function defectCat(d) {
  if (d.cat) return d.cat;
  const n = ((d.label || '') + ' ' + (d.remedial || '')).toLowerCase();
  if (/damper|fusible/.test(n)) return 'Dampers';
  if (/detector|call point|sounder|beacon|alarm panel|standby batter|zone chart|door release|device missing|device obstructed/.test(n)) return 'Fire alarm';
  if (/luminaire|emergency light|exit sign|test key|charge indicator|coverage/.test(n)) return 'Emergency lighting';
  if (/extinguisher|tamper seal|discharge test|hose or horn/.test(n)) return 'Extinguishers';
  if (/panic|exit device|exit hardware|keyed lock|needs a key/.test(n)) return 'Ironmongery';
  if (/sign/.test(n)) return 'Signs';
  if (/closer/.test(n)) return 'Closers';
  if (/hinge/.test(n)) return 'Hinges';
  if (/hold.?open|wedged/.test(n)) return 'Hold-open';
  if (/threshold|seal|intumescent strip/.test(n)) return 'Seals';
  if (/lock|latch|ironmongery|handle|escutcheon|thumbturn|cylinder|keeper|flush bolt|selector/.test(n)) return 'Ironmongery';
  if (/glaz|bead/.test(n)) return 'Glazing';
  if (/fire stop|wall not/.test(n)) return 'Fire stopping';
  if (/leaf|frame|holes|gaps/.test(n)) return 'Timber & repairs';
  return '';
}



// Older records stored one action as a string; newer ones store a list.
export function doorActions(d) {
  if (Array.isArray(d.actions)) return d.actions;
  return d.action ? [d.action] : [];
}

// Risk ratings offered on each door (editable in Settings). A door with no
// rating shows "No risk assessment".
export const DEFAULT_RISKS = ['Low', 'Medium', 'High'];

// Types of work a project can be (editable in Settings). Used to group and
// filter projects and as the report title.
export const DEFAULT_WORK_TYPES = [
  'Fire door inspection',
  'Fire damper check',
  'Fire alarm check',
  'Fire stopping survey',
  'Compartmentation survey',
  'Emergency lighting check',
  'Fire extinguisher service',
  'Remedial works',
];

// Categories: another way to group doors (like Fieldwire categories), used to
// filter pins on a drawing, the door list and reports. Editable in Settings.
export const DEFAULT_CATEGORIES = ['Escape route', 'Stair core', 'Corridor', 'Bedroom', 'Communal room', 'Kitchen', 'Store / plant', 'Riser / service cupboard', 'Final exit'];
export const NO_RISK = 'No risk assessment';
export const riskText = (d) => d.risk || NO_RISK;

// A project's fire alarm zone list: [{ no, name }]. Lines like "4, East wing".
export function parseZones(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([^,\t–-]+?)\s*[,\t–-]\s*(.+)$/);
    return m ? { no: m[1].trim().replace(/^zone\s*/i, ''), name: m[2].trim() } : { no: l.replace(/^zone\s*/i, ''), name: '' };
  });
}
export const zonesToText = (zones) => (zones || []).map((z) => (z.name ? `${z.no}, ${z.name}` : z.no)).join('\n');

// A material as it appears in lists and reports, with its size / type
export const matLabel = (m) => (m.spec ? `${m.name} – ${m.spec}` : m.name || '');
export const MATERIALS_VERSION = 6;

// A door's fire alarm zone as one line, e.g. "Zone 4 – East wing"
export const zoneText = (d) => [d.zoneNo ? `Zone ${d.zoneNo}` : '', d.zoneName || ''].filter(Boolean).join(' – ');

// Labour on a door's products (per unit, times quantity)
export function labourTotal(d) {
  return (d.materials || []).reduce((t, m) => t + (Number(m.qty) || 0) * (Number(m.labour) || 0), 0);
}
export function materialsTotal(d) {
  const mats = (d.materials || []).reduce((t, m) => t + (Number(m.qty) || 0) * (Number(m.cost) || 0), 0);
  // signs still needed are costed from their price-list price
  const signs = (d.signs || []).filter((x) => x.state !== 'fitted').reduce((t, x) => t + (Number(x.qty) || 0) * (Number(x.cost) || 0), 0);
  return mats + signs;
}

const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
export const euro = (n) => eur.format(Number(n) || 0);

// The questions to show for a door: the current list, plus any the door
// answered that have since been removed from Settings.
export function questionsFor(d, questions) {
  const hidden = new Set(questions.filter((q) => q.hidden).map((q) => q.id));
  questions = questions.filter((q) => q.text?.trim() && !q.hidden);
  const ids = new Set(questions.map((q) => q.id));
  const extra = Object.entries(d.checks || {})
    .filter(([id, v]) => !ids.has(id) && v?.answer)
    .map(([id, v]) => ({ id, text: v.text, removed: true, hidden: hidden.has(id) }));
  return [...questions, ...extra];
}

// FD terms are what most clients still use; EI ratings are the
// I.S. EN 13501-2 classifications (tested to I.S. EN 1634-1).
// "S" / Sa = smoke control (I.S. EN 1634-3).
// European classification first, the British FD rating in brackets
export const DEFAULT_DOOR_TYPES = [
  'E30 (FD30)',
  'E30Sa (FD30S)',
  'E30Sa4 (FD30S)',
  'E60 (FD60)',
  'E60Sa (FD60S)',
  'E60Sa4 (FD60S)',
  'E90 (FD90)',
  'E120 (FD120)',
  'Notional fire door',
  'Nominal fire door',
  'Non-rated',
  'Final exit – emergency',
  'Final exit – panic',
  'Unknown – no evidence of rating',
];

// Doors without test evidence (BS 8214:2026 uses these terms), and unknown
export const DOOR_TYPE_NOTES = [
  [/notional/i, 'Notional (BS 8214:2026, clause 15): an existing fire door that, at the time of installation, met the requirements for a fire door but might not meet today\'s standards. Only relevant within a fire safety risk assessment (term from the Home Office guide Fire safety in purpose-built blocks of flats).'],
  [/nominal/i, 'Nominal (BS 8214:2026, clause 15): a door without fire resistance documentary test evidence that does not meet the definition of notional. It can only be considered to provide a level of fire resistance after an appropriate risk assessment (means of escape, occupancy profile and the building\'s full safety measures).'],
  [/unknown/i, 'Unknown: no evidence of a fire rating could be found (not a BS 8214 category). Treat as unconfirmed until evidence is provided, or assess as notional or nominal.'],
  [/sa4/i, 'Sa4 (BS 8214:2026, 8.4): smoke control classified to BS EN 13501-2, tested to BS EN 1634-3 with a threshold sealing system, so the bottom of the door is sealed too (e.g. a drop seal). The classification is only valid with its formal BS EN 13501-2 classification report.'],
];
// Group the door types for the picker
export function doorTypeGroup(t) {
  if (/^E\s?I?\s?\d|^FD\s?\d/i.test(t)) return 'Fire rated (European, FD in brackets)';
  if (/notional|nominal/i.test(t)) return 'No test evidence';
  if (/unknown/i.test(t)) return 'Unknown';
  if (/non.?rated|final exit/i.test(t)) return 'Not a fire door';
  return 'Other';
}

// Door types as written before (FD first) → the European-first names
export const OLD_DOOR_TYPES = {
  'FD30 (EI 30)': 'E30 (FD30)', 'FD30S (EI 30-Sa)': 'E30Sa (FD30S)', 'FD60 (EI 60)': 'E60 (FD60)',
  'FD60S (EI 60-Sa)': 'E60Sa (FD60S)', 'FD90 (EI 90)': 'E90 (FD90)', 'FD120 (EI 120)': 'E120 (FD120)',
  'E30Sa Final exit – emergency (FD30S)': 'Final exit – emergency', 'E30Sa Final exit – panic (FD30S)': 'Final exit – panic',
};
export const DOOR_TYPES_VERSION = 5;

export const LEAF_CONFIGS = ['', 'SASD RH', 'SASD LH', 'DADD', 'SADD BLRH', 'SADD BLLH', 'SADD Equal pair', 'Single leaf', 'Double leaf', 'Leaf and a half', 'Single with fanlight', 'Double with fanlight'];

// Each defect has a suggested remedial action that pre-fills the door record
// and the pricing sheet. Edit these in Settings to match your own wording.
export const DEFAULT_DEFECTS = [
  { label: 'Leaf-to-frame gaps outside 2–4 mm', remedial: 'Rehang / adjust leaf to achieve 2–4 mm gaps; lip or replace leaf if not achievable' },
  { label: 'Threshold gap excessive (over 10 mm / over 3 mm for smoke doors)', remedial: 'Fit drop seal or threshold strip to reduce gap' },
  { label: 'Intumescent strips missing or damaged', remedial: 'Supply and fit intumescent strips to frame/leaf' },
  { label: 'Smoke seals missing or damaged', remedial: 'Supply and fit combined intumescent and smoke seals' },
  { label: 'Self-closer missing', remedial: 'Supply and fit CE-marked overhead door closer (EN 1154)' },
  { label: 'Self-closer defective / not adjusted', remedial: 'Adjust or replace closer so door closes fully and latches from any angle' },
  { label: 'Door fails to close and latch', remedial: 'Adjust closer, latch and keep so door closes and latches' },
  { label: 'Door wedged or held open', remedial: 'Remove wedge; fit hold-open device linked to fire alarm if door must be held open' },
  { label: 'Hold-open device not linked to fire alarm', remedial: 'Connect hold-open / free-swing device to fire alarm (EN 1155)' },
  { label: 'Hinges: fewer than 3, missing screws or worn', remedial: 'Supply and fit CE-marked hinges (EN 1935) with full complement of screws' },
  { label: 'Ironmongery not fire-rated / not CE marked', remedial: 'Replace with CE-marked ironmongery compatible with the door set' },
  { label: 'Lock or latch defective', remedial: 'Replace lock/latch with CE-marked fire-rated unit' },
  { label: 'Handle loose, damaged or missing', remedial: 'Tighten and refit handle, or supply and fit fire-rated lever handle set' },
  { label: 'Escutcheon missing', remedial: 'Supply and fit escutcheon plates' },
  { label: 'Euro cylinder not blanked / thumbturn missing', remedial: 'Fit thumbturn and escutcheons, or correctly blank the euro cylinder' },
  { label: 'Keeper not fitted correctly', remedial: 'Refit keeper and repair frame around keeper so the door latches' },
  { label: 'Flush bolt or selector not working', remedial: 'Repair or replace flush bolt / door selector so pairs close in order' },
  { label: 'Lock not wrapped in intumescent', remedial: 'Remove lock and fit intumescent lock wrap' },
  { label: 'Glazing not fire-rated or beads defective', remedial: 'Replace glazing and beading with tested fire-rated system' },
  { label: 'Door leaf damaged', remedial: 'Repair leaf with tested repair method or replace leaf' },
  { label: 'Frame damaged or loose', remedial: 'Repair or refix frame; replace door set if beyond repair' },
  { label: 'Gap between frame and wall not fire stopped', remedial: 'Fire stop frame-to-wall gap with tested intumescent sealant / system' },
  { label: 'Unauthorised holes or modifications', remedial: 'Fill holes with tested repair; remove non-compliant fittings' },
  { label: 'Air transfer grille / letter plate not rated', remedial: 'Replace with fire-rated (and smoke-rated where needed) intumescent unit' },
  { label: 'Fire door signage missing', remedial: 'Supply and fit fire safety signage (I.S. 3217 / ISO 7010)' },
  { label: 'No certification label or plug', remedial: 'Record as unverified; recommend replacement or evidence from manufacturer' },
];

// Example floor plan used by "Load demo project", drawn on a canvas so the
// app opens in a working state without needing a real drawing.
export function drawDemoPlan() {
  const W = 2400;
  const H = 1600;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#1b2733';
  g.lineWidth = 10;
  g.strokeRect(100, 100, W - 200, H - 200);
  // corridor
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(100, 700); g.lineTo(W - 100, 700);
  g.moveTo(100, 900); g.lineTo(W - 100, 900);
  // rooms above corridor
  for (const x of [600, 1100, 1600, 1900]) { g.moveTo(x, 100); g.lineTo(x, 700); }
  // rooms below
  for (const x of [700, 1300, 1800]) { g.moveTo(x, 900); g.lineTo(x, H - 100); }
  // stair core
  g.moveTo(W - 400, 900); g.lineTo(W - 400, H - 100);
  g.stroke();
  // door swings
  g.lineWidth = 3;
  g.strokeStyle = '#5a6b7a';
  const swing = (x, y, r, a0, a1) => { g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, a0, a1); g.closePath(); g.stroke(); };
  swing(350, 700, 90, -Math.PI / 2, 0);
  swing(850, 700, 90, -Math.PI / 2, 0);
  swing(1350, 700, 90, -Math.PI / 2, 0);
  swing(1750, 700, 90, -Math.PI / 2, 0);
  swing(450, 900, 90, 0, Math.PI / 2);
  swing(1000, 900, 90, 0, Math.PI / 2);
  swing(1550, 900, 90, 0, Math.PI / 2);
  swing(W - 300, 900, 90, 0, Math.PI / 2);
  swing(1200, 1500, 90, Math.PI, 1.5 * Math.PI);
  // labels
  g.fillStyle = '#1b2733';
  g.font = '600 44px sans-serif';
  const label = (t, x, y) => g.fillText(t, x, y);
  label('Bedroom 1', 230, 420); label('Bedroom 2', 740, 420); label('Day room', 1240, 420);
  label('Store', 1680, 420); label('Office', 2000, 420);
  label('Corridor', 1100, 815);
  label('Kitchen', 300, 1250); label('Dining', 900, 1250); label('Laundry', 1450, 1250);
  label('Stair', W - 300, 1250);
  g.font = '500 34px sans-serif';
  g.fillStyle = '#5a6b7a';
  label('DEMO — Ground floor (example drawing)', 120, 70);
  return c;
}

// ---------- Fire safety signs on each door ----------
// door.signs = [{ type, qty, face, state: 'needed' | 'fitted' }]
export const DEFAULT_SIGNS = [
  'Automatic fire door keep shut',
  'Fire door keep shut',
  'Fire door keep locked',
  'Fire exit keep clear',
  'Push bar to open',
  'Turn to the right',
  'Turn to the left',
];
export const SIGN_FACES = ['Both faces', 'Push side', 'Pull side', 'One face'];
export const signsNeeded = (d) => (d.signs || []).filter((x) => x.state !== 'fitted' && Number(x.qty) > 0);
export const signText = (x) => `${Number(x.qty) || 0} × ${x.type}${x.face ? ' (' + x.face.toLowerCase() + ')' : ''}`;

// The defect a failed checklist question stands for (so a fail always leads to
// a repair line and its materials). Custom questions can set q.defect.
export const QUESTION_DEFECT = {
  'q-close': 'Self-closer defective / not adjusted',
  'q-gaps': 'Leaf-to-frame gaps outside 2–4 mm',
  'q-seals': 'Smoke seals missing or damaged',
  'q-hinges': 'Hinges: fewer than 3, missing screws or worn',
  'q-iron': 'Lock or latch defective',
  'q-glazing': 'Glazing not fire-rated or beads defective',
  'q-leaf': 'Door leaf damaged',
  'q-sign': 'Fire door signage missing',
  'dmp-1': 'Damper access panel missing or blocked', 'dmp-2': 'Damper failed to close fully', 'dmp-3': 'Fusible link missing or damaged',
  'dmp-4': 'Damper did not reset / left closed', 'dmp-5': 'Damper corroded or damaged', 'dmp-6': 'Fire stopping around damper incomplete',
  'dmp-8': 'Damper not linked to fire alarm', 'dmp-9': 'Damper identification label missing',
  'fa-1': 'Device missing', 'fa-2': 'Detector failed test', 'fa-3': 'Device obstructed or covered', 'fa-5': 'Sounder or beacon not operating',
  'fa-6': 'Fire alarm panel fault', 'fa-7': 'Zone chart or logbook missing', 'fa-8': 'Door release not operating on alarm',
  'em-1': 'Luminaire damaged', 'em-2': 'Charge indicator off', 'em-3': 'Luminaire failed functional test / not lit', 'em-4': 'Luminaire failed duration test',
  'em-5': 'Exit sign incorrect or missing', 'em-6': 'Inadequate coverage', 'em-7': 'Test key switch missing', 'em-8': 'Emergency lighting logbook missing',
  'ex-1': 'Extinguisher missing', 'ex-2': 'Extinguisher not mounted', 'ex-3': 'Extinguisher discharged or low pressure', 'ex-4': 'Safety pin or tamper seal missing',
  'ex-5': 'Hose or horn damaged', 'ex-7': 'Wrong extinguisher type for the risk', 'ex-8': 'Extinguisher ID sign missing', 'ex-9': 'Extended service / discharge test overdue',
};

// The usual product (and quantity) for a defect; the inspector can change it.
const DEFAULT_PRODUCT = [
  [/lipping damaged|lipping/i, 'm-lip', 1, ''],
  [/leaf out of alignment|thickness not consistent|material not consistent/i, '', 0, ''], // adjust / report: no part by default
  [/panic bar|not a panic|wrong exit device/i, 'm-panic', 1, ''],
  [/needs a key|exit hardware/i, '', 0, ''], // the right part depends on the door: chosen on site
  [/keep clear/i, 'm-sg-exit', 1, 'outside face'],
  [/exit signage/i, '', 0, ''], // which exit sign depends on what's missing
  [/manifestation|safety glass|see-through|sliding \/ revolving|power-operated/i, '', 0, ''], // priced on site
  [/access panel/i, 'm-dp-panel', 1, ''],
  [/fusible link/i, 'm-dp-link', 1, ''],
  [/actuator/i, 'm-dp-act', 1, ''],
  [/damper corroded|damper failed/i, 'm-dp-dmp', 1, ''],
  [/damper identification/i, 'm-dp-label', 1, ''],
  [/detector failed|device missing/i, 'm-fa-opt', 1, ''],
  [/call point/i, 'm-fa-mcp', 1, ''],
  [/sounder|beacon/i, 'm-fa-snd', 1, ''],
  [/standby batter/i, 'm-fa-bat', 2, ''],
  [/zone chart/i, 'm-fa-log', 1, ''],
  [/duration test|charge indicator/i, 'm-el-bat', 1, ''],
  [/functional test|luminaire damaged|inadequate coverage/i, 'm-el-bulk', 1, ''],
  [/exit sign/i, 'm-el-exit', 1, ''],
  [/test key/i, 'm-el-key', 1, ''],
  [/emergency lighting logbook/i, 'm-el-log', 1, ''],
  [/extinguisher missing|wrong extinguisher/i, 'm-ex-pow', 1, ''],
  [/discharged or low/i, 'm-ex-refill', 1, ''],
  [/pin or tamper/i, 'm-ex-pin', 1, ''],
  [/hose or horn/i, 'm-ex-hose', 1, ''],
  [/extended service/i, 'm-ex-ext', 1, ''],
  [/not mounted/i, 'm-ex-brk', 1, ''],
  [/extinguisher id sign/i, 'm-ex-sign', 1, ''],
  [/smoke seal/i, 'm-int15s', 3, ''],
  [/intumescent strip/i, 'm-int15', 3, ''],
  [/threshold/i, 'm-drop', 1, ''],
  [/closer/i, 'm-closer', 1, ''],
  [/handle/i, 'm-handle', 1, ''],
  [/escutcheon/i, 'm-esc', 2, 'both faces'],
  [/thumbturn|euro cylinder/i, 'm-thumb45', 1, ''],
  [/keeper/i, 'm-keeper', 1, ''],
  [/flush bolt|selector/i, 'm-flush', 1, ''],
  [/lock wrap|wrapped in intumescent/i, 'm-lockwrap', 1, ''],
  [/hinge/i, 'm-hinge', 3, ''],
  [/sign/i, 'm-sign', 2, 'both faces'],
  [/hold-open|wedged/i, 'm-holdopen', 1, ''],
  [/lock|latch|ironmongery/i, 'm-latch', 1, ''],
  [/glazing|bead/i, 'm-glaze', 1, ''],
  [/fire stop|wall not/i, 'm-mastic', 1, ''],
  [/gaps|leaf damaged/i, 'm-lip', 1, ''],
];
// The owner's cost for each fail item (Settings › Defects, owner PIN): the
// products it needs with quantities, and the labour to put it right. Set by
// the owner from their own price list, so every cost comes from an FSCF document
// (the price list / SERV PD MASTER), never from the app.
let DEFECT_COSTS = new Map();
export function setDefectCosts(defectLists) {
  DEFECT_COSTS = new Map();
  for (const list of defectLists) for (const d of list || []) if (d?.costSet && d.label && !DEFECT_COSTS.has(d.label)) DEFECT_COSTS.set(d.label, d);
}
export const defectCostOf = (label) => DEFECT_COSTS.get(label) || null;
// Products + labour line for a defect from the owner's settings (null when not set)
function ownCostLines(defect, materials, uid) {
  const t = DEFECT_COSTS.get(defect.label);
  if (!t) return null;
  const out = [];
  for (const p of t.products || []) {
    const m = materials.find((x) => x.id === p.mid) || materials.find((x) => (x.name || '').trim().toLowerCase() === (p.name || '').trim().toLowerCase());
    if (!m || !(Number(p.qty) > 0)) continue;
    out.push({ id: uid(), name: m.name, unit: m.unit || 'each', cost: Number(m.cost) || 0, labour: Number(m.labour) || 0, qty: Number(p.qty), cat: matCat(m), forKey: 'd:' + defect.label, spec: '' });
  }
  if (Number(t.labour) > 0) out.push({ id: uid(), custom: true, labourLine: true, name: `LABOUR: ${defect.label}`, unit: 'job', cost: 0, labour: Number(t.labour), qty: 1, cat: 'Labour', forKey: 'd:' + defect.label, spec: '' });
  return out;
}
// What a fail item costs: { materials, labour, lines, own } (own = set by the owner)
export function defectCostSummary(defect, materials) {
  const lines = defaultProductsFor(defect, materials, () => '');
  const mat = lines.reduce((a, m) => a + (Number(m.qty) || 0) * (Number(m.cost) || 0), 0);
  const lab = lines.reduce((a, m) => a + (Number(m.qty) || 0) * (Number(m.labour) || 0), 0);
  return { materials: mat, labour: lab, total: mat + lab, lines, own: DEFECT_COSTS.has(defect.label) };
}
export function defaultProductsFor(defect, materials, uid) {
  const own = ownCostLines(defect, materials, uid);
  if (own) return own;
  const text = (defect.label || '') + ' ' + (defect.remedial || '');
  if (!/supply|fit|replace|lip|fill/i.test(defect.remedial || '')) return []; // adjust-only work: labour, no parts
  const cat = defectCat(defect);
  const rule = DEFAULT_PRODUCT.find(([re]) => re.test(defect.label || '')) || DEFAULT_PRODUCT.find(([re]) => re.test(text));
  if (rule && !rule[1]) return [];
  let m = rule && materials.find((x) => x.id === rule[1] && x.name?.trim());
  if (!m && cat) m = materials.find((x) => x.name?.trim() && matCat(x) === cat);
  if (!m) return [];
  return [{ id: uid(), name: m.name, unit: m.unit || 'each', cost: Number(m.cost) || 0, labour: Number(m.labour) || 0, qty: rule && m.id === rule[1] ? rule[2] : 1, cat: matCat(m), forKey: 'd:' + defect.label, spec: rule && m.id === rule[1] ? rule[3] : '' }];
}

// Give every defect without products its usual product. Returns the new list
// of materials (unchanged if nothing was missing).
export function fillDefectProducts(d, materials, uid) {
  const mats = [...(d.materials || [])];
  let added = 0;
  for (const x of d.defects || []) {
    if (mats.some((m) => m.forKey === 'd:' + x.label)) continue;
    const add = defaultProductsFor(x, materials, uid);
    mats.push(...add);
    added += add.length;
  }
  return { materials: mats, added };
}

// Everything a door has failed on that isn't costed yet:
//  - failed checklist questions with no defect recorded, and
//  - defects with no products.
export function uncostedFails(d, questions, materials) {
  const labels = new Set((d.defects || []).map((x) => x.label));
  const qs = (questions || []).filter((q) => (d.checks || {})[q.id]?.answer === 'fail' && (q.defect || QUESTION_DEFECT[q.id]) && !labels.has(q.defect || QUESTION_DEFECT[q.id]));
  const defs = (d.defects || []).filter((x) => !(d.materials || []).some((m) => m.forKey === 'd:' + x.label) && defaultProductsFor(x, materials, () => '').length);
  return { qs, defs, count: qs.length + defs.length };
}

// Cost every fail on a door: add the defect for each failed checklist
// question, then the usual product for every defect that has none.
export function costAllFails(d, questions, defectList, materials, uid) {
  const { qs } = uncostedFails(d, questions, materials);
  const defects = [...(d.defects || [])];
  for (const q of qs) {
    const label = q.defect || QUESTION_DEFECT[q.id];
    const tmpl = (defectList || []).find((x) => x.label === label) || { label, remedial: '' };
    defects.push({ label, remedial: tmpl.remedial || '', qty: 1, fromQ: q.id });
  }
  const r = fillDefectProducts({ ...d, defects }, materials, uid);
  return { defects, materials: r.materials, addedDefects: qs.length, addedProducts: r.added };
}

// ---------- Inspection types ----------
// Each drawing has an inspection type; every pin on it uses that type's
// checklist, defects and item types. Fire doors use the main lists
// (lists.questions / defects / doorTypes); the others live in lists.kits and
// start from these defaults. All are editable in Settings.
const kq = (prefix, texts) => texts.map((text, i) => ({ id: `${prefix}-${i + 1}`, text }));
const kd = (rows) => rows.map(([label, remedial]) => ({ label, remedial }));
export const DEFAULT_KITS = {
  dampers: {
    name: 'Fire dampers', item: 'Damper', report: 'Fire Damper Inspection Report', standard: 'I.S. EN 15650 / I.S. EN 1366-2',
    doorTypes: ['Fire damper – curtain (fusible link)', 'Fire damper – motorised', 'Fire and smoke damper', 'Smoke control damper', 'Intumescent air transfer damper'],
    questions: kq('dmp', [
      'Access panel present, labelled and accessible',
      'Damper closes fully when released (drop test)',
      'Fusible link or actuator present and correctly fitted',
      'Damper resets and re-opens fully',
      'Blades, springs and frame free of damage and corrosion',
      'Fire stopping around the damper / duct penetration intact',
      'Installed to manufacturer instructions (fixings, breakaway joints)',
      'Motorised damper operates on fire alarm signal',
      'Damper identification label present',
    ]),
    defects: kd([
      ['Damper access panel missing or blocked', 'Supply and fit / clear access panel to the damper'],
      ['Damper failed to close fully', 'Free off and repair damper; replace damper (EN 15650) if it cannot be made to close'],
      ['Fusible link missing or damaged', 'Supply and fit replacement fusible link (72 °C)'],
      ['Damper actuator faulty', 'Supply and fit replacement damper actuator'],
      ['Damper did not reset / left closed', 'Reset damper and confirm it re-opens fully'],
      ['Damper corroded or damaged', 'Supply and fit replacement fire damper (EN 15650)'],
      ['Fire stopping around damper incomplete', 'Fire stop around damper and duct with a tested system'],
      ['Damper not linked to fire alarm', 'Connect damper to the fire alarm interface'],
      ['Damper identification label missing', 'Fit damper identification label'],
    ]),
  },
  alarm: {
    name: 'Fire alarm', item: 'Device', report: 'Fire Alarm Service Report', standard: 'I.S. 3218',
    doorTypes: ['Optical smoke detector', 'Heat detector', 'Multi-sensor detector', 'Manual call point', 'Sounder / beacon', 'Control panel', 'Interface / input-output unit', 'Beam detector', 'Door release (mag lock)'],
    questions: kq('fa', [
      'Device present, secure and undamaged',
      'Device tested and signalled correctly at the panel',
      'Device unobstructed (no covers, 500 mm clear)',
      'Correct zone / address shown at the panel',
      'Sounders and beacons operate and are audible / visible',
      'Panel free of faults; standby batteries tested',
      'Zone chart and logbook present and up to date',
      'Cause and effect operates (door releases, plant shutdown)',
    ]),
    defects: kd([
      ['Detector failed test', 'Supply and fit replacement detector'],
      ['Device missing', 'Supply and fit device and commission at the panel'],
      ['Device obstructed or covered', 'Remove obstruction / cover or relocate device'],
      ['Manual call point damaged', 'Supply and fit replacement call point / element'],
      ['Sounder or beacon not operating', 'Supply and fit replacement sounder / beacon'],
      ['Fire alarm panel fault', 'Investigate and clear the panel fault'],
      ['Standby batteries failed', 'Supply and fit replacement standby batteries'],
      ['Zone chart or logbook missing', 'Provide zone chart and fire alarm logbook'],
      ['Door release not operating on alarm', 'Repair or replace door release / interface'],
    ]),
  },
  emlight: {
    name: 'Emergency lighting', item: 'Luminaire', report: 'Emergency Lighting Inspection Report', standard: 'I.S. 3217',
    doorTypes: ['Non-maintained bulkhead', 'Maintained bulkhead', 'Exit sign (illuminated)', 'Twin spot', 'Recessed emergency downlight', 'Central battery unit'],
    questions: kq('em', [
      'Luminaire present, clean and undamaged',
      'Charge indicator (LED) lit',
      'Operates on simulated mains failure (functional test)',
      'Full-duration test passed (3 hours)',
      'Exit sign legend / pictogram correct and visible',
      'Covers escape route, exits and fire equipment as required',
      'Test key switch present and labelled',
      'Logbook present and up to date',
    ]),
    defects: kd([
      ['Luminaire failed duration test', 'Supply and fit replacement battery pack or luminaire'],
      ['Luminaire failed functional test / not lit', 'Supply and fit replacement lamp or luminaire'],
      ['Luminaire damaged', 'Supply and fit replacement luminaire'],
      ['Exit sign incorrect or missing', 'Supply and fit correct exit sign (ISO 7010)'],
      ['Charge indicator off', 'Check supply; replace battery or luminaire'],
      ['Inadequate coverage', 'Supply and install additional emergency luminaire'],
      ['Test key switch missing', 'Supply and fit test key switch'],
      ['Emergency lighting logbook missing', 'Provide emergency lighting logbook'],
    ]),
  },
  ext: {
    name: 'Fire extinguishers', item: 'Extinguisher', report: 'Fire Extinguisher Service Report', standard: 'I.S. 291',
    doorTypes: ['6 kg ABC powder', '9 kg ABC powder', '2 kg CO2', '5 kg CO2', '6 L foam', '9 L foam', '9 L water', 'Wet chemical', 'Fire blanket'],
    questions: kq('ex', [
      'Extinguisher present at its location',
      'Mounted on bracket or stand and accessible',
      'Pressure gauge in the green / weight correct',
      'Safety pin and tamper seal intact',
      'Hose, horn and nozzle in good condition',
      'Service label in date',
      'Correct type for the risk',
      'ID sign present',
      'Not due an extended service / discharge test',
    ]),
    defects: kd([
      ['Extinguisher missing', 'Supply and install extinguisher'],
      ['Extinguisher discharged or low pressure', 'Recharge or replace extinguisher'],
      ['Safety pin or tamper seal missing', 'Supply and fit pin and tamper seal'],
      ['Hose or horn damaged', 'Supply and fit replacement hose / horn'],
      ['Extended service / discharge test overdue', 'Carry out extended service and discharge test'],
      ['Extinguisher not mounted', 'Supply and fit wall bracket or stand'],
      ['Extinguisher ID sign missing', 'Supply and fit extinguisher ID sign'],
      ['Wrong extinguisher type for the risk', 'Replace with the correct type of extinguisher'],
    ]),
  },
};
export const KIND_IDS = ['fd', 'dampers', 'alarm', 'emlight', 'ext'];
// Which kind a project's type of work suggests for new drawings
export function kindForWork(workType) {
  const w = (workType || '').toLowerCase();
  if (/damper/.test(w)) return 'dampers';
  if (/alarm/.test(w)) return 'alarm';
  if (/emergency|lighting/.test(w)) return 'emlight';
  if (/extinguisher/.test(w)) return 'ext';
  return 'fd';
}

// ---------- Checklist templates ----------
// Extra named checklists for an inspection type (e.g. a 6-point fire door
// check). They share the item types, defects and products of their base type
// unless edited. More can be made in Settings ("New checklist from this one").
const tq = (prefix, rows) => rows.map(([text, defect], i) => ({ id: `${prefix}-${i + 1}`, text, ...(defect ? { defect } : {}) }));
export const DEFAULT_TEMPLATES = {
  // Built from BS 8214:2016 (clause numbers in brackets)
  fd2016: {
    base: 'fd', name: 'Fire doors – BS 8214:2016 inspection', item: 'Door', report: 'BS 8214:2016 Fire Door Inspection Report',
    questions: tq('bs16', [
      ['Door marked with its declared fire resistance period (label, plug or certificate) (5)', 'No certification label or plug'],
      ['Fire-resisting glass permanently marked: manufacturer, product, impact class (5)', 'Glazing not fire-rated or beads defective'],
      ['Leaf free from superficial or structural damage, bowing or deformation (13.1)', 'Door leaf damaged'],
      ['Frame free from damage or deformation and securely fixed (9.2, 13.1)', 'Frame damaged or loose'],
      ['No apertures cut on site outside the test evidence (7.5)', 'Unauthorised holes or modifications'],
      ['Double doors: the two leaves are a matching pair (13.2.2)', 'Double door leaves not a matching pair'],
      ['Equal gap across the head, down both jambs and at meeting edges (9.5.2)', 'Gaps not equal around the leaf'],
      ['Operating gaps within 2–4 mm (9.5.2)', 'Leaf-to-frame gaps outside 2–4 mm'],
      ['Threshold gap as per the manufacturer\'s instructions; door opens freely without catching (9.5.3)', 'Threshold gap excessive (over 10 mm / over 3 mm for smoke doors)'],
      ['Intumescent fire seals fitted (all fire doors, including 20 min) (9.5.2)', 'Intumescent strips missing or damaged'],
      ['Seals complete and undamaged over their full length (13.2.3)', 'Intumescent strips missing or damaged'],
      ['Smoke doors (FD30S / E30Sa): smoke seals fitted and working (12.3)', 'Smoke seals missing or damaged'],
      ['Smoke doors: threshold sealed (flexible or drop seal), or gap no more than 3 mm (12.3)', 'Threshold gap excessive (over 10 mm / over 3 mm for smoke doors)'],
      ['Seals not interrupted at hardware unless supported by test evidence (11.2, 12.1)', 'Seals interrupted at hardware'],
      ['Smoke seals not painted; intumescent seals max 5 coats or 0.5 mm (14)', 'Seals painted over'],
      ['Self-closing device fitted (except doors kept locked shut and signed) (11.4)', 'Self-closer missing'],
      ['Closer closes the leaf reliably from any angle and overcomes the latch and seals (11.4)', 'Self-closer defective / not adjusted'],
      ['Door not wedged or held open; fully closed when released (11.4)', 'Door wedged or held open'],
      ['Hinges / pivots secure and fire-rated, letting the closer close the door from any angle (11.5)', 'Hinges: fewer than 3, missing screws or worn'],
      ['Hardware fitted without gaps at mortices, with any tested intumescent protection present (11.1, 11.2)', 'Lock not wrapped in intumescent'],
      ['Essential hardware as per the door manufacturer\'s information; exit devices to BS EN 179 / 1125 (11.1, 13.3)', 'Ironmongery not fire-rated / not CE marked'],
      ['Letter plate tested in a fire door and fitted with an intumescent liner (11.3)', 'Air transfer grille / letter plate not rated'],
      ['Air transfer grille tested and suited to the door: fire only (FD30) or fire and cold smoke (FD30S) (11.6)', 'Air transfer grille / letter plate not rated'],
      ['Glazing system as specified by the door manufacturer; beads and fixings secure (10, 13.4)', 'Glazing not fire-rated or beads defective'],
      ['Frame-to-wall gap sealed as per Tables 2 to 5 (approved mastic or materials) (9.4)', 'Gap between frame and wall not fire stopped'],
      ['Doors kept locked shut have the appropriate signage (11.4)', 'Fire door signage missing'],
    ]),
    extraDefects: [
      ['Double door leaves not a matching pair', 'Replace both leaves with a new matching pair (BS 8214:2016, 13.2.2)'],
      ['Gaps not equal around the leaf', 'Adjust or repair so the gaps are equal at the head, jambs and meeting edges (BS 8214:2016, 9.5.2)'],
      ['Seals interrupted at hardware', 'Reinstate continuous seals or fit tested intumescent protection at the hardware (BS 8214:2016, 11.2)'],
      ['Seals painted over', 'Replace painted seals full length with the same formulation, size and configuration (BS 8214:2016, 13.2.3)'],
    ],
  },
  // Built from BS 8214:2026 (clause numbers in brackets). Gaps and hardware are
  // checked against the door's own specification and supporting evidence, as
  // the 2026 edition asks, rather than fixed figures.
  fd2026: {
    base: 'fd', name: 'Fire doors – BS 8214:2026 inspection', item: 'Door', report: 'BS 8214:2026 Fire Door Inspection Report',
    questions: tq('bs26', [
      ['Evidence: door identified as a fire door (label, plug, certificate or records) and its rating known (11, B.3)', 'No certification label or plug'],
      ['Evidence: fire door specification / supporting evidence available for this door (6, 15.1)', 'Supporting evidence not available'],
      ['Leaf: free from damage, excessive bow, cup or twist (15.1, 15.2)', 'Door leaf damaged'],
      ['Frame: secure, free from damage or deformation (15.1, 15.2)', 'Frame damaged or loose'],
      ['No unauthorised holes, apertures, add-ons or modifications in the leaf or frame (7.2, 10.8)', 'Unauthorised holes or modifications'],
      ['Gaps around the leaf, and between leaves, as per the fire door specification (15.2.2)', 'Gaps not as per the fire door specification'],
      ['Double doors: leaves aligned and close in the right order (selector, flush bolts) (15.2.2)', 'Flush bolt or selector not working'],
      ['Intumescent seals present, full length and undamaged (8.2, 15.2.3)', 'Intumescent strips missing or damaged'],
      ['Smoke seals present, undamaged and not painted (8.4, 16)', 'Smoke seals missing or damaged'],
      ['Smoke door: threshold sealed, e.g. a drop seal, so all four sides are sealed (Sa4) (8.4)', 'Smoke door threshold not sealed (Sa4)'],
      ['Threshold gap as per the fire door specification (7.3)', 'Threshold gap excessive (over 10 mm / over 3 mm for smoke doors)'],
      ['Seals not painted over (intumescent: max 5 coats or 0.5 mm) (16)', 'Seals painted over'],
      ['Hinges: correct number, secure, all screws fitted, no wear (10.3)', 'Hinges: fewer than 3, missing screws or worn'],
      ['Closer (EN 1154) fitted, closes the door fully from any angle and engages the latch (10.5)', 'Self-closer defective / not adjusted'],
      ['Lock / latch works and holds the door closed (10.4)', 'Lock or latch defective'],
      ['Essential hardware is fire-rated, CE / UKCA marked and as per the specification (15.3, Annex D)', 'Ironmongery not fire-rated / not CE marked'],
      ['Hold-open / free-swing device releases on the fire alarm (if fitted) (10.5)', 'Hold-open device not linked to fire alarm'],
      ['Letter plate / air transfer grille fire-rated and covered by the evidence (10.6, 10.7)', 'Air transfer grille / letter plate not rated'],
      ['Glazing: fire-resistant glass, permanently marked, beads secure and undamaged (9, 15.4)', 'Glazing not fire-rated or beads defective'],
      ['Gap between frame and wall sealed with evidence-backed materials (13.4)', 'Gap between frame and wall not fire stopped'],
      ['Door not wedged or held open', 'Door wedged or held open'],
      ['Opens and closes easily, without excessive force', 'Opening force too high'],
      ['Correct fire door signs fitted; doors kept locked shut are signed and kept locked (10.5)', 'Fire door signage missing'],
    ]),
    extraDefects: [
      ['Supporting evidence not available', 'Obtain the fire door specification / supporting evidence from the manufacturer, or evaluate the door for replacement (BS 8214:2026, 15.1)'],
      ['Gaps not as per the fire door specification', 'Adjust or repair so the gaps meet the fire door specification and supporting evidence'],
      ['Smoke door threshold not sealed (Sa4)', 'Supply and fit a threshold sealing system (e.g. automatic drop seal) to the fire door specification (BS 8214:2026, 8.4)'],
      ['Seals painted over', 'Replace painted seals full length with the same brand, size and type (BS 8214:2026, 15.2.3)'],
      ['Opening force too high', 'Adjust closer and hardware to reduce the opening force'],
      ['Flush bolt or selector not working', 'Repair or replace flush bolt / door selector so pairs close in order'],
    ],
  },
  fd29: {
    base: 'fd', name: 'Fire doors – 29 point check (FSBO)', item: 'Door', report: '29 Point Fire Door Inspection Report',
    questions: tq('fd29', [
      ['Door leaf: sits against the door stop and is free from distortion', 'Door leaf damaged'],
      ['Door leaf: veneer / lipping glue still holding firmly', 'Door leaf damaged'],
      ['Door leaf: free from damage, including dents and holes', 'Door leaf damaged'],
      ['Door frame: firmly attached to the wall', 'Frame damaged or loose'],
      ['Door frame: planted door stop (if present) firmly attached', 'Frame damaged or loose'],
      ['Door frame: frame-to-leaf gap consistently 3 mm (± 1 mm)', 'Leaf-to-frame gaps outside 2–4 mm'],
      ['Closer: opened to 5° or 75 mm, the door closes and engages the latch', 'Self-closer defective / not adjusted'],
      ['Closer: correctly attached to the door and frame', 'Self-closer defective / not adjusted'],
      ['Closer: free from damage and not leaking', 'Self-closer defective / not adjusted'],
      ['Closer: if unlatched, holds the door in line with the frame and intumescent seal', 'Self-closer defective / not adjusted'],
      ['Closer: pairs close in line when both are opened and released together', 'Self-closer defective / not adjusted'],
      ['Hold-open device (electronically powered only) releases the door when required', 'Hold-open device not linked to fire alarm'],
      ['Lock and latch: latch holds the door firmly in place without rattling', 'Lock or latch defective'],
      ['Glazing: intumescent seal continuous and attached to the glass and bead', 'Glazing not fire-rated or beads defective'],
      ['Glazing: beads well attached to the frame and free from damage', 'Glazing not fire-rated or beads defective'],
      ['Glazing: glass free from damage and cracking', 'Glazing not fire-rated or beads defective'],
      ['Glazing: replaced glass is fire rated', 'Glazing not fire-rated or beads defective'],
      ['Glazing: glass below 1500 mm from the bottom of the door is safety glass', 'Glazing not fire-rated or beads defective'],
      ['Threshold: consistent gap, the door swings without touching the floor covering', 'Threshold gap excessive (over 10 mm / over 3 mm for smoke doors)'],
      ['Threshold: door-to-floor-covering gap 10 mm or less when closed', 'Threshold gap excessive (over 10 mm / over 3 mm for smoke doors)'],
      ['Seals: intumescent seals in place', 'Intumescent strips missing or damaged'],
      ['Seals: well attached inside the groove in the frame or leaf', 'Intumescent strips missing or damaged'],
      ['Seals: continuous around the frame', 'Intumescent strips missing or damaged'],
      ['Seals: free from damage', 'Intumescent strips missing or damaged'],
      ['Seals: brush or fin smoke seal (if fitted) free from damage', 'Smoke seals missing or damaged'],
      ['Hinges: minimum of 3 hinges with all screws fitted', 'Hinges: fewer than 3, missing screws or worn'],
      ['Hinges: all screws the correct size', 'Hinges: fewer than 3, missing screws or worn'],
      ['Hinges: free from metal fragments and oil leakage (signs of wear)', 'Hinges: fewer than 3, missing screws or worn'],
      ['Hinges: free from packing', 'Hinges: fewer than 3, missing screws or worn'],
    ]),
  },
  fd6: {
    base: 'fd', name: 'Fire doors – 6 point check', item: 'Door', report: '6 Point Fire Door Inspection Report',
    questions: tq('fd6', [
      ['Have any noted faults in the fire register been addressed?', ''],
      ['Does the fire door close properly and the receiver engage?', 'Door fails to close and latch'],
      ['Are the door gaps within 2–4 mm between door and frame or meeting leaves?', 'Leaf-to-frame gaps outside 2–4 mm'],
      ['Is the combined intumescent / cold smoke seal intact?', 'Smoke seals missing or damaged'],
      ['Is the correct signage fitted on both sides of the door?', 'Fire door signage missing'],
      ['Is the correct ironmongery fitted on the door set?', 'Ironmongery not fire-rated / not CE marked'],
    ]),
  },
  fdexit: {
    base: 'fd', name: 'Final exit / escape doors', item: 'Exit door', report: 'Final Exit Door Inspection Report',
    questions: tq('fx', [
      ['1.1 Internal escape route to the door is free of equipment, waste and furniture', 'Escape route to exit obstructed'],
      ['1.2 Door opens onto a clear, safe external discharge point', 'External discharge point obstructed'],
      ['1.3 External area free of parked vehicles, pallets or skips that could impede evacuation', 'External discharge point obstructed'],
      ['1.4 Floor surface on both sides level and free of trip or slip hazards', 'Trip or slip hazard at exit'],
      ['2.1 Door opens from inside by a single manual action, without a key or code', 'Exit door needs a key or code to open'],
      ['2.2 Lever or push pad releases all latches instantly', 'Panic / emergency exit hardware faulty'],
      ['2.3 Door leaf opens outwards in the direction of escape', ''],
      ['2.4 Opening force is light enough for a person with limited strength', 'Opening force too high'],
      ['2.5 Hinges secure, lubricated and free of wear or metal fragments', 'Hinges: fewer than 3, missing screws or worn'],
      ['2.6 Release force under 70 N for lever handles (150 N for push pads)', 'Opening force too high'],
      ['2.7 Inward-opening door correctly signed "Pull to open" where allowed', 'Exit signage missing or incorrect'],
      ['2.8 Device CE / UKCA marked with the manufacturer\'s identification (EN 179 / EN 1125)', 'Panic / emergency exit hardware not certified'],
      ['3.1 Maglock releases immediately when the fire alarm operates', 'Maglock does not release on fire alarm'],
      ['3.2 Working green break-glass unit within 1.5 m of the door', 'Green break-glass unit missing or faulty'],
      ['3.3 Door unlocks automatically on total loss of mains power', 'Maglock does not fail safe on power loss'],
      ['4.1 "Emergency exit" (running man) sign clearly visible from the approach', 'Exit signage missing or incorrect'],
      ['4.2 Emergency light above the door works when local power is cut', 'Emergency light at exit failed'],
      ['4.3 Instruction signs ("Push bar to open", "Fire exit keep clear") legible and correctly mounted', 'Exit signage missing or incorrect'],
      ['4.4 Glass doors have visible manifestation at eye level', 'Glazing manifestation missing'],
    ]),
    extraDefects: [
      ['Escape route to exit obstructed', 'Remove obstructions from the escape route and keep it clear'],
      ['External discharge point obstructed', 'Clear the external discharge area; advise client to keep it clear'],
      ['Trip or slip hazard at exit', 'Make good floor surface at the exit'],
      ['Exit door needs a key or code to open', 'Fit EN 179 / EN 1125 hardware so the door opens with a single action'],
      ['Panic / emergency exit hardware faulty', 'Repair or replace panic / emergency exit hardware (EN 1125 / EN 179)'],
      ['Panic / emergency exit hardware not certified', 'Replace with CE-marked EN 1125 / EN 179 hardware'],
      ['Opening force too high', 'Adjust closer and hardware to reduce the opening force'],
      ['Maglock does not release on fire alarm', 'Repair maglock interface so it releases on fire alarm'],
      ['Maglock does not fail safe on power loss', 'Repair maglock so it unlocks on loss of power'],
      ['Green break-glass unit missing or faulty', 'Supply and fit green break-glass unit within 1.5 m of the door'],
      ['Exit signage missing or incorrect', 'Supply and fit correct exit signage (I.S. 3217 / ISO 7010)'],
      ['Emergency light at exit failed', 'Repair or replace the emergency light above the exit'],
      ['Glazing manifestation missing', 'Apply manifestation to the glass at eye level'],
    ],
  },
  // BM TRADA Q-Mark Fire Door Maintenance scheme: Fire Door Condition Survey,
  // DCS 058 Iss 2 (in SUIN 058 Survey & Maintenance Process, Iss 1, 05/01/2026).
  // 23 survey points; repairs use the scheme's Accepted Repair Techniques (ART index Iss 10, ARTs ART index Iss 10, issued 01/01/2026).
  qmark: {
    base: 'fd', name: 'Fire doors – BM TRADA Q-Mark condition survey (DCS 058)', item: 'Door', report: 'Fire Door Condition Survey – BM TRADA Q-Mark Fire Door Maintenance Scheme (DCS 058)',
    questions: tq('qm', [
      ['DOOR LEAF: overall condition acceptable (BM TRADA DCS 058 Iss 2)', 'Door leaf damaged'],
      ['DOOR LEAF: edge condition (lippings) acceptable (BM TRADA DCS 058 Iss 2)', 'Lipping damaged or split'],
      ['DOOR LEAF: leaf alignment acceptable (BM TRADA DCS 058 Iss 2)', 'Door leaf out of alignment'],
      ['DOOR LEAF: leaf thickness consistent with the declared rating (BM TRADA DCS 058 Iss 2)', 'Leaf thickness not consistent with rating'],
      ['DOOR LEAF: door gaps within tolerance (BM TRADA DCS 058 Iss 2)', 'Leaf-to-frame gaps outside 2–4 mm'],
      ['DOOR FRAME: overall condition acceptable (BM TRADA DCS 058 Iss 2)', 'Frame damaged or loose'],
      ['DOOR FRAME: frame material consistent with the declared rating (BM TRADA DCS 058 Iss 2)', 'Frame material not consistent with rating'],
      ['DOOR FRAME: architrave condition acceptable (BM TRADA DCS 058 Iss 2)', 'Architrave damaged or not sealed'],
      ['DOOR FRAME: frame / architrave overlap acceptable (BM TRADA DCS 058 Iss 2)', 'Architrave does not overlap frame joint'],
      ['SEALS: overall condition acceptable (BM TRADA DCS 058 Iss 2)', 'Intumescent strips missing or damaged'],
      ['SEALS: size correct for the declared rating (BM TRADA DCS 058 Iss 2)', 'Intumescent seal size not correct'],
      ['SEALS: smoke seal condition acceptable (BM TRADA DCS 058 Iss 2)', 'Smoke seals missing or damaged'],
      ['HARDWARE: hinge condition acceptable (BM TRADA DCS 058 Iss 2)', 'Hinges: fewer than 3, missing screws or worn'],
      ['HARDWARE: hinge operation acceptable (BM TRADA DCS 058 Iss 2)', 'Hinges dropped or binding'],
      ['HARDWARE: lock / latch operation acceptable (BM TRADA DCS 058 Iss 2)', 'Lock or latch defective'],
      ['HARDWARE: door closer operation acceptable (BM TRADA DCS 058 Iss 2)', 'Self-closer defective / not adjusted'],
      ['HARDWARE: hold open device operation acceptable (BM TRADA DCS 058 Iss 2)', 'Hold-open device not linked to fire alarm'],
      ['HARDWARE: intumescent protection to hardware present (BM TRADA DCS 058 Iss 2)', 'Lock not wrapped in intumescent'],
      ['GLAZING: bead condition acceptable (BM TRADA DCS 058 Iss 2)', 'Glazing not fire-rated or beads defective'],
      ['GLAZING: glass condition acceptable (BM TRADA DCS 058 Iss 2)', 'Glass damaged'],
      ['GLAZING: glass type consistent with the declared rating (BM TRADA DCS 058 Iss 2)', 'Glazing not fire-rated or beads defective'],
      ['GLAZING: fixing detail acceptable (BM TRADA DCS 058 Iss 2)', 'Glazing not fire-rated or beads defective'],
      ['OTHER: signage acceptable (BM TRADA DCS 058 Iss 2)', 'Fire door signage missing'],
    ]),
    extraDefects: [
      ['Lipping damaged or split', 'Repair lipping with a hardwood butt-jointed section (BM TRADA ART 01 Lipping repair, rev 12, ART index Iss 10, issued 01/01/2026)'],
      ['Door leaf out of alignment', 'Realign the leaf (BM TRADA ART 06 Door leaf out of alignment, rev 11, ART index Iss 10, issued 01/01/2026)'],
      ['Leaf thickness not consistent with rating', 'Report to the Responsible Person; outside the scheme, call in expertise (BM TRADA ART 23 Calling in expertise, rev 12, ART index Iss 10, issued 01/01/2026)'],
      ['Frame material not consistent with rating', 'Report to the Responsible Person; outside the scheme, call in expertise (BM TRADA ART 23 Calling in expertise, rev 12, ART index Iss 10, issued 01/01/2026)'],
      ['Architrave damaged or not sealed', 'Refit and seal the architrave (BM TRADA ART 16 Replacement or refitting architrave and sealing, rev 12, ART index Iss 10, issued 01/01/2026)'],
      ['Architrave does not overlap frame joint', 'Refit the architrave to overlap the frame / wall joint (BM TRADA ART 16 Replacement or refitting architrave and sealing, rev 12, ART index Iss 10, issued 01/01/2026)'],
      ['Intumescent seal size not correct', 'Replace with seals of the size given in the door manufacturer\'s evidence (BM TRADA ART 11 Damaged perimeter seals, rev 11, ART index Iss 10, issued 01/01/2026)'],
      ['Hinges dropped or binding', 'Re-set or replace hinges (BM TRADA ART 08 Hinges dropped or damaged, rev 12; ART 13 Hinge fixings are loose or missing, rev 11; ART index Iss 10, issued 01/01/2026)'],
      ['Glass damaged', 'Replace glass and glazing system like for like (BM TRADA ART 14 Damaged glazing and glass, rev 11, ART index Iss 10, issued 01/01/2026)'],
    ],
  },
  // Final exits with panic hardware: users may not know the building (EN 1125).
  // Regulations 11 and 12 of the General Application Regulations 2007 (HSA guide),
  // and the DHF Best Practice Guide to BS EN 1125 / BS EN 179.
  fdpanic: {
    base: 'fd', name: 'Final exit – panic (EN 1125)', item: 'Exit door', report: 'Final Exit Inspection Report – Panic Exit Devices (EN 1125)',
    questions: tq('fxp', [
      ['Escape route to the door kept clear and leads as directly as possible to the open air or a safe area (Gen App Regs 2007, Reg 12(a))', 'Escape route to exit obstructed'],
      ['Route, door and outside discharge free from obstruction (no vehicles, bins, pallets or skips) (Gen App Regs 2007, Reg 12(h))', 'External discharge point obstructed'],
      ['Floor markings and signs show the area to be kept clear (HSA guide to Reg 12)', 'Area at exit not marked to keep clear'],
      ['Floor is level and free of trip hazards on both sides; no hidden step outside', 'Trip or slip hazard at exit'],
      ['Door opens outwards, in the direction of escape, freely through its full swing (Gen App Regs 2007, Reg 12(d))', 'Door does not open in the direction of escape'],
      ['Not a sliding or revolving door used as an emergency exit (Gen App Regs 2007, Reg 12(e))', 'Sliding / revolving door used as emergency exit'],
      ['Power-operated door used as an exit: opens by hand, or opens automatically if the power fails; emergency stop easy to find (Gen App Regs 2007, Reg 11(h))', 'Power-operated exit door does not open on power failure'],
      ['Not locked or fastened so it cannot be easily and immediately opened by anyone (Gen App Regs 2007, Reg 12(f))', 'Extra keyed lock, bolt or chain on exit door'],
      ['Device is a horizontal push bar or touch bar (EN 1125), suited to users who do not know the building', 'Not a panic bar (EN 1125) where one is needed'],
      ['One push anywhere along the bar releases all bolts and latches', 'Panic / emergency exit hardware faulty'],
      ['Bar covers at least 60% of the leaf width (DHF)', 'Panic bar shorter than 60% of the leaf width'],
      ['Device marked with the manufacturer, CE mark and certification body number (DHF)', 'Panic / emergency exit hardware not certified'],
      ['Pairs: vertical panic bolt on the inactive leaf, panic latch on the active leaf; bar does not overhang its end supports (DHF)', 'Panic / emergency exit hardware faulty'],
      ['Bolts and keeps engage and release cleanly; floor socket clear of debris', 'Panic / emergency exit hardware faulty'],
      ['Device secure, all fixings tight, no damage or wear', 'Panic / emergency exit hardware faulty'],
      ['Hold-back / dogging not used on a fire door unless tested on that door unlatched (DHF)', 'Hold-back / dogging on fire door not tested'],
      ['Door closes and latches by itself (where a closer is fitted)', 'Door fails to close and latch'],
      ['Swing door is transparent or has a see-through panel (Gen App Regs 2007, Reg 11(b))', 'Swing door has no see-through panel'],
      ['Glass doors marked at a conspicuous level, 1,200–1,500 mm (Gen App Regs 2007, Reg 11(c); TGD M)', 'Glazing manifestation missing'],
      ['Glass in the door is safety glass or protected against breakage (Gen App Regs 2007, Reg 11(d))', 'Glass not safety glass or protected'],
      ['"Push bar to open" sign fitted on the bar side', 'Exit signage missing or incorrect'],
      ['Electric locking (if fitted) releases on the fire alarm and on loss of power', 'Maglock does not release on fire alarm'],
      ['Green break-glass unit beside the door (where electric locking is fitted)', 'Green break-glass unit missing or faulty'],
      ['Fire exit sign at the right points, clear and durable (Gen App Regs 2007, Reg 12(g))', 'Exit signage missing or incorrect'],
      ['Emergency lighting at the exit works if the lighting fails (Gen App Regs 2007, Reg 12(i))', 'Emergency light at exit failed'],
      ['"Fire exit keep clear" sign on the outside face', 'Exit signage missing or incorrect'],
    ]),
    extraDefects: [
      ['Escape route to exit obstructed', 'Remove obstructions from the escape route and keep it clear (Gen App Regs 2007, Reg 12(a), 12(h))'],
      ['External discharge point obstructed', 'Clear the outside discharge area; advise the client to keep it clear (Gen App Regs 2007, Reg 12(h))'],
      ['Area at exit not marked to keep clear', 'Mark the floor and fit signs showing the area to be kept clear (HSA guide to Reg 12)'],
      ['Trip or slip hazard at exit', 'Make good the floor surface or mark the step at the exit'],
      ['Door does not open in the direction of escape', 'Re-hang the door to open outwards (Gen App Regs 2007, Reg 12(d)), or review with the fire safety consultant'],
      ['Sliding / revolving door used as emergency exit', 'Provide an outward-opening swing exit door; a sliding or revolving door must not be used as an emergency exit (Gen App Regs 2007, Reg 12(e))'],
      ['Power-operated exit door does not open on power failure', 'Make the door open automatically on power failure, or able to be opened by hand, with an easily found emergency stop (Gen App Regs 2007, Reg 11(h))'],
      ['Extra keyed lock, bolt or chain on exit door', 'Remove the keyed lock, bolt, chain or padlock so anyone can open the door easily and immediately (Gen App Regs 2007, Reg 12(f))'],
      ['Exit door needs a key or code to open', 'Fit EN 1125 / EN 179 hardware so the door opens with a single action, without a key (Gen App Regs 2007, Reg 12(f))'],
      ['Swing door has no see-through panel', 'Fit a vision panel, or review if the door cannot have one (Gen App Regs 2007, Reg 11(b))'],
      ['Glazing manifestation missing', 'Apply manifestation to the glass at 1,200–1,500 mm (Gen App Regs 2007, Reg 11(c))'],
      ['Glass not safety glass or protected', 'Replace with safety glass or protect the glass against breakage (Gen App Regs 2007, Reg 11(d))'],
      ['Panic / emergency exit hardware faulty', 'Repair or replace the panic / emergency exit hardware (EN 1125 / EN 179)'],
      ['Panic / emergency exit hardware not certified', 'Replace with CE-marked EN 1125 / EN 179 hardware, marked with the manufacturer and certification body'],
      ['Hold-back / dogging on fire door not tested', 'Disable or remove the hold-back; use only hardware tested on the door in the unlatched condition'],
      ['Maglock does not release on fire alarm', 'Repair the maglock interface so it releases on the fire alarm'],
      ['Maglock does not fail safe on power loss', 'Repair the maglock so it unlocks on loss of power'],
      ['Green break-glass unit missing or faulty', 'Supply and fit a green break-glass unit beside the door'],
      ['Exit signage missing or incorrect', 'Supply and fit correct exit signage at the right points (Gen App Regs 2007, Reg 12(g); I.S. 3217 / ISO 7010)'],
      ['Emergency light at exit failed', 'Repair or replace the emergency lighting at the exit (Gen App Regs 2007, Reg 12(i))'],
      ['Panic bar shorter than 60% of the leaf width', 'Replace with an EN 1125 device whose bar covers at least 60% of the leaf width'],
      ['Not a panic bar (EN 1125) where one is needed', 'Supply and fit an EN 1125 panic device (push bar or touch bar)'],
    ],
  },
  // Final exits with emergency hardware: users know the exit (EN 179)
  fdemerg: {
    base: 'fd', name: 'Final exit – emergency (EN 179)', item: 'Exit door', report: 'Final Exit Inspection Report – Emergency Exit Devices (EN 179)',
    questions: tq('fxe', [
      ['Escape route to the door kept clear and leads as directly as possible to the open air or a safe area (Gen App Regs 2007, Reg 12(a))', 'Escape route to exit obstructed'],
      ['Route, door and outside discharge free from obstruction (no vehicles, bins, pallets or skips) (Gen App Regs 2007, Reg 12(h))', 'External discharge point obstructed'],
      ['Floor markings and signs show the area to be kept clear (HSA guide to Reg 12)', 'Area at exit not marked to keep clear'],
      ['Floor is level and free of trip hazards on both sides; no hidden step outside', 'Trip or slip hazard at exit'],
      ['Door opens outwards, in the direction of escape (Gen App Regs 2007, Reg 12(d))', 'Door does not open in the direction of escape'],
      ['Not a sliding or revolving door used as an emergency exit (Gen App Regs 2007, Reg 12(e))', 'Sliding / revolving door used as emergency exit'],
      ['Power-operated door used as an exit: opens by hand, or opens automatically if the power fails; emergency stop easy to find (Gen App Regs 2007, Reg 11(h))', 'Power-operated exit door does not open on power failure'],
      ['Not locked or fastened so it cannot be easily and immediately opened by anyone (Gen App Regs 2007, Reg 12(f))', 'Extra keyed lock, bolt or chain on exit door'],
      ['Device is a lever handle or push pad (EN 179), used only where the people using the exit know it (e.g. staff areas)', 'Wrong exit device for the people using it'],
      ['Opens with one action, without a key or code', 'Exit door needs a key or code to open'],
      ['Device marked with the manufacturer, CE mark and certification body number (DHF)', 'Panic / emergency exit hardware not certified'],
      ['Lever or pad secure, returns properly, no damage or wear', 'Panic / emergency exit hardware faulty'],
      ['Latch and keep engage and release cleanly', 'Panic / emergency exit hardware faulty'],
      ['Hold-back / dogging not used on a fire door unless tested on that door unlatched (DHF)', 'Hold-back / dogging on fire door not tested'],
      ['Door closes and latches by itself (where a closer is fitted)', 'Door fails to close and latch'],
      ['Swing door is transparent or has a see-through panel (Gen App Regs 2007, Reg 11(b))', 'Swing door has no see-through panel'],
      ['Glass doors marked at a conspicuous level, 1,200–1,500 mm (Gen App Regs 2007, Reg 11(c); TGD M)', 'Glazing manifestation missing'],
      ['Glass in the door is safety glass or protected against breakage (Gen App Regs 2007, Reg 11(d))', 'Glass not safety glass or protected'],
      ['Operating sign fitted (e.g. "Push pad to open")', 'Exit signage missing or incorrect'],
      ['Electric locking (if fitted) releases on the fire alarm and on loss of power', 'Maglock does not release on fire alarm'],
      ['Green break-glass unit beside the door (where electric locking is fitted)', 'Green break-glass unit missing or faulty'],
      ['Fire exit sign at the right points, clear and durable (Gen App Regs 2007, Reg 12(g))', 'Exit signage missing or incorrect'],
      ['Emergency lighting at the exit works if the lighting fails (Gen App Regs 2007, Reg 12(i))', 'Emergency light at exit failed'],
      ['"Fire exit keep clear" sign on the outside face', 'Exit signage missing or incorrect'],
    ]),
    extraDefects: [
      ['Escape route to exit obstructed', 'Remove obstructions from the escape route and keep it clear (Gen App Regs 2007, Reg 12(a), 12(h))'],
      ['External discharge point obstructed', 'Clear the outside discharge area; advise the client to keep it clear (Gen App Regs 2007, Reg 12(h))'],
      ['Area at exit not marked to keep clear', 'Mark the floor and fit signs showing the area to be kept clear (HSA guide to Reg 12)'],
      ['Trip or slip hazard at exit', 'Make good the floor surface or mark the step at the exit'],
      ['Door does not open in the direction of escape', 'Re-hang the door to open outwards (Gen App Regs 2007, Reg 12(d)), or review with the fire safety consultant'],
      ['Sliding / revolving door used as emergency exit', 'Provide an outward-opening swing exit door; a sliding or revolving door must not be used as an emergency exit (Gen App Regs 2007, Reg 12(e))'],
      ['Power-operated exit door does not open on power failure', 'Make the door open automatically on power failure, or able to be opened by hand, with an easily found emergency stop (Gen App Regs 2007, Reg 11(h))'],
      ['Extra keyed lock, bolt or chain on exit door', 'Remove the keyed lock, bolt, chain or padlock so anyone can open the door easily and immediately (Gen App Regs 2007, Reg 12(f))'],
      ['Exit door needs a key or code to open', 'Fit EN 1125 / EN 179 hardware so the door opens with a single action, without a key (Gen App Regs 2007, Reg 12(f))'],
      ['Swing door has no see-through panel', 'Fit a vision panel, or review if the door cannot have one (Gen App Regs 2007, Reg 11(b))'],
      ['Glazing manifestation missing', 'Apply manifestation to the glass at 1,200–1,500 mm (Gen App Regs 2007, Reg 11(c))'],
      ['Glass not safety glass or protected', 'Replace with safety glass or protect the glass against breakage (Gen App Regs 2007, Reg 11(d))'],
      ['Panic / emergency exit hardware faulty', 'Repair or replace the panic / emergency exit hardware (EN 1125 / EN 179)'],
      ['Panic / emergency exit hardware not certified', 'Replace with CE-marked EN 1125 / EN 179 hardware, marked with the manufacturer and certification body'],
      ['Hold-back / dogging on fire door not tested', 'Disable or remove the hold-back; use only hardware tested on the door in the unlatched condition'],
      ['Maglock does not release on fire alarm', 'Repair the maglock interface so it releases on the fire alarm'],
      ['Maglock does not fail safe on power loss', 'Repair the maglock so it unlocks on loss of power'],
      ['Green break-glass unit missing or faulty', 'Supply and fit a green break-glass unit beside the door'],
      ['Exit signage missing or incorrect', 'Supply and fit correct exit signage at the right points (Gen App Regs 2007, Reg 12(g); I.S. 3217 / ISO 7010)'],
      ['Emergency light at exit failed', 'Repair or replace the emergency lighting at the exit (Gen App Regs 2007, Reg 12(i))'],
      ['Wrong exit device for the people using it', 'Fit an EN 1125 panic device: the people using this exit may not know it (DHF: if in doubt, use EN 1125)'],
    ],
  },
};
