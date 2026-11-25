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
export const DEFAULT_QUESTIONS = [
  { id: 'q-close', text: 'Door self-closes fully and latches from any angle' },
  { id: 'q-gaps', text: 'Leaf-to-frame gaps within 2–4 mm (threshold within limits)' },
  { id: 'q-seals', text: 'Intumescent strips and smoke seals present and undamaged' },
  { id: 'q-hinges', text: 'Minimum 3 hinges, secure, CE marked, all screws fitted' },
  { id: 'q-iron', text: 'Ironmongery fire-rated and working (lock, latch, handles)' },
  { id: 'q-glazing', text: 'Glazing and beads fire-rated and intact' },
  { id: 'q-leaf', text: 'Leaf and frame free of damage or unauthorised modifications' },
  { id: 'q-sign', text: 'Fire door signage present on both faces' },
];

// Materials catalogue. Prices are left at 0 for you to enter your own
// (ex VAT) in Settings; they then pre-fill each door.
export const MAT_CATEGORIES = ['Seals', 'Closers', 'Hinges', 'Ironmongery', 'Hold-open', 'Signs', 'Glazing', 'Fire stopping', 'Timber & repairs', 'Labour', 'Other'];

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
  { id: 'm-latch', cat: 'Ironmongery', name: 'Fire-rated latch / lock', unit: 'each', cost: 35.0 },
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
];

// Category of a price-list item (older lists had none: work it out from the name)
export function matCat(m) {
  if (m.cat) return m.cat;
  const n = (m.name || '').toLowerCase();
  if (/sign/.test(n)) return 'Signs';
  if (/closer/.test(n)) return 'Closers';
  if (/hinge/.test(n)) return 'Hinges';
  if (/hold.?open|free.?swing|mag/.test(n)) return 'Hold-open';
  if (/seal|intumescent strip|threshold|drop/.test(n)) return 'Seals';
  if (/latch|lock|handle|ironmongery|bar/.test(n)) return 'Ironmongery';
  if (/glaz|bead/.test(n)) return 'Glazing';
  if (/mastic|sealant|fire.?stop|batt/.test(n)) return 'Fire stopping';
  if (/lip|timber|leaf|frame/.test(n)) return 'Timber & repairs';
  return 'Other';
}

// Which part of the price list fixes a defect
export function defectCat(d) {
  if (d.cat) return d.cat;
  const n = ((d.label || '') + ' ' + (d.remedial || '')).toLowerCase();
  if (/sign/.test(n)) return 'Signs';
  if (/closer/.test(n)) return 'Closers';
  if (/hinge/.test(n)) return 'Hinges';
  if (/hold.?open|wedged/.test(n)) return 'Hold-open';
  if (/threshold|seal|intumescent strip/.test(n)) return 'Seals';
  if (/lock|latch|ironmongery/.test(n)) return 'Ironmongery';
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
export const MATERIALS_VERSION = 4;

// A door's fire alarm zone as one line, e.g. "Zone 4 – East wing"
export const zoneText = (d) => [d.zoneNo ? `Zone ${d.zoneNo}` : '', d.zoneName || ''].filter(Boolean).join(' – ');

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
export const DEFAULT_DOOR_TYPES = [
  'FD30 (EI 30)',
  'FD30S (EI 30-Sa)',
  'FD60 (EI 60)',
  'FD60S (EI 60-Sa)',
  'FD90 (EI 90)',
  'FD120 (EI 120)',
  'Notional fire door',
  'Non-rated',
  'Unknown – no evidence of rating',
];

export const LEAF_CONFIGS = ['', 'Single leaf', 'Double leaf', 'Leaf and a half', 'Single with fanlight', 'Double with fanlight'];

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
};

// The usual product (and quantity) for a defect; the inspector can change it.
const DEFAULT_PRODUCT = [
  [/smoke seal/i, 'm-int15s', 3, ''],
  [/intumescent strip/i, 'm-int15', 3, ''],
  [/threshold/i, 'm-drop', 1, ''],
  [/closer/i, 'm-closer', 1, ''],
  [/hinge/i, 'm-hinge', 3, ''],
  [/sign/i, 'm-sign', 2, 'both faces'],
  [/hold-open|wedged/i, 'm-holdopen', 1, ''],
  [/lock|latch|ironmongery/i, 'm-latch', 1, ''],
  [/glazing|bead/i, 'm-glaze', 1, ''],
  [/fire stop|wall not/i, 'm-mastic', 1, ''],
  [/gaps|leaf damaged/i, 'm-lip', 1, ''],
];
export function defaultProductsFor(defect, materials, uid) {
  const text = (defect.label || '') + ' ' + (defect.remedial || '');
  if (!/supply|fit|replace|lip|fill/i.test(defect.remedial || '')) return []; // adjust-only work: labour, no parts
  const cat = defectCat(defect);
  const rule = DEFAULT_PRODUCT.find(([re]) => re.test(defect.label || '')) || DEFAULT_PRODUCT.find(([re]) => re.test(text));
  let m = rule && materials.find((x) => x.id === rule[1] && x.name?.trim());
  if (!m && cat) m = materials.find((x) => x.name?.trim() && matCat(x) === cat);
  if (!m) return [];
  return [{ id: uid(), name: m.name, unit: m.unit || 'each', cost: Number(m.cost) || 0, qty: rule && m.id === rule[1] ? rule[2] : 1, cat: matCat(m), forKey: 'd:' + defect.label, spec: rule && m.id === rule[1] ? rule[3] : '' }];
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
