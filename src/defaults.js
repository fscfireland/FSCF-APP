// Default lists. Door types and defects can be edited in Settings;
// these are only the starting point.

export const STATUSES = [
  { id: 'not_inspected', label: 'Not inspected', short: 'To do', color: 'var(--st-todo)' },
  { id: 'pass', label: 'Pass', short: 'Pass', color: 'var(--st-pass)' },
  { id: 'fail', label: 'Fail', short: 'Fail', color: 'var(--st-fail)' },
  { id: 'no_access', label: 'No access', short: 'No access', color: 'var(--st-noaccess)' },
  { id: 'repaired', label: 'Repaired', short: 'Repaired', color: 'var(--st-repaired)' },
];

export const statusById = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

export const ACTIONS = [
  '',
  'No action required',
  'Repair / upgrade on site',
  'Replace door leaf',
  'Replace complete door set',
  'Further investigation required',
];

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
  { label: 'Fire door signage missing', remedial: 'Fit "Fire Door Keep Shut" sign (I.S. 3217 / ISO 7010) both faces' },
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
