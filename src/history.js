// Door history:
//  • an activity log of every change (who, when, what), like Fieldwire's
//    task history, kept on the door record as `log`
//  • inspection records: when a door's inspection date changes, the earlier
//    inspection (status, checklist, defects, actions, notes …) is kept in
//    `history`, and that visit's photos stay tagged with its date.

import * as db from './db.js';
import { statusById, doorActions } from './defaults.js';
import { fmtDate } from './ui.js';

const MAX_LOG = 300;
const COLLAPSE_MS = 3 * 60 * 1000; // repeated typing in one field = one entry
let actor = '';
export const setActor = (name) => (actor = name || '');

// Fields that belong to one inspection visit
const SNAP_FIELDS = ['status', 'checks', 'defects', 'actions', 'materials', 'signs', 'notes', 'doorType', 'leaf', 'zoneNo', 'zoneName', 'risk', 'category', 'remedials', 'gps', 'ref', 'location', 'inspectedOn', 'inspectedBy'];

export function snapshotOf(d) {
  const snap = { id: db.uid(), savedAt: new Date().toISOString() };
  for (const k of SNAP_FIELDS) snap[k] = structuredCloneSafe(k === 'actions' ? doorActions(d) : d[k]);
  return snap;
}

function structuredCloneSafe(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

const TEXT_FIELDS = {
  ref: 'Pin ref',
  location: 'Location',
  doorType: 'Door type',
  leaf: 'Leaf / swing',
  zoneNo: 'Fire alarm zone no.',
  zoneName: 'Fire alarm zone name',
  risk: 'Risk rating',
  category: 'Category',
  inspectedBy: 'Inspected by',
  nextDue: 'Next inspection due',
};

const short = (s, n = 48) => {
  const v = String(s ?? '');
  return v.length > n ? v.slice(0, n - 1) + '…' : v;
};
const show = (v) => (v === '' || v == null ? '(blank)' : short(v));

// Work out human-readable log entries between two versions of a door
export function diffDoor(prev, next) {
  const out = [];
  const add = (key, text, from, to) => out.push({ key, text, from, to });
  const st = (id) => statusById[id || 'not_inspected']?.label || id;

  // A new inspection resets status and checklist; log it as one entry
  if ((prev.history || []).length < (next.history || []).length) {
    const snap = next.history[0];
    const d = snap?.inspectedOn ? fmtDate(snap.inspectedOn) : '(no date)';
    add('', `New inspection ${next.inspectedOn ? fmtDate(next.inspectedOn) : '(no date)'}: details carried forward from ${d}, which is saved to history`);
    return out;
  }

  if ((prev.status || 'not_inspected') !== (next.status || 'not_inspected')) {
    add('status', `Status: ${st(prev.status)} → ${st(next.status)}`);
  }
  for (const [k, label] of Object.entries(TEXT_FIELDS)) {
    if ((prev[k] || '') !== (next[k] || '')) add(k, `${label}: ${show(prev[k])} → ${show(next[k])}`, prev[k] || '', next[k] || '');
  }
  if ((prev.inspectedOn || '') !== (next.inspectedOn || '')) {
    add('inspectedOn', `Inspection date: ${prev.inspectedOn ? fmtDate(prev.inspectedOn) : '(blank)'} → ${next.inspectedOn ? fmtDate(next.inspectedOn) : '(blank)'}`);
  }
  if ((prev.notes || '') !== (next.notes || '')) add('notes', 'Notes edited');
  if (!prev.planId && next.planId) add('', 'Placed on drawing');
  else if (prev.x !== next.x || prev.y !== next.y) add('pin', 'Pin moved');

  const labels = (list) => (list || []).map((x) => x.label);
  const added = (a, b) => b.filter((x) => !a.includes(x));
  for (const l of added(labels(prev.defects), labels(next.defects))) add('', `Added defect: ${short(l)}`);
  for (const l of added(labels(next.defects), labels(prev.defects))) add('', `Removed defect: ${short(l)}`);

  // remedial works ticked or unticked
  const pr = prev.remedials || {};
  const nr = next.remedials || {};
  for (const k of new Set([...Object.keys(pr), ...Object.keys(nr)])) {
    if (!!pr[k]?.done !== !!nr[k]?.done) add('', `Remedial ${nr[k]?.done ? 'done' : 'not done'}: ${short(k.slice(2), 60)}`);
    else if (!!pr[k]?.verified !== !!nr[k]?.verified) add('', nr[k]?.verified ? `Remedial verified by ${nr[k].vby || 'unknown'}: ${short(k.slice(2), 60)}` : `Verification removed: ${short(k.slice(2), 60)}`);
  }

  const pa = doorActions(prev);
  const na = doorActions(next);
  for (const a of added(pa, na)) add('', `Added action: ${short(a)}`);
  for (const a of added(na, pa)) add('', `Removed action: ${short(a)}`);

  const pc = prev.checks || {};
  const nc = next.checks || {};
  const ans = (x) => (x ? x.toUpperCase().replace('NA', 'N/A') : '(blank)');
  const changed = [...new Set([...Object.keys(pc), ...Object.keys(nc)])].filter((id) => (pc[id]?.answer || '') !== (nc[id]?.answer || ''));
  if (changed.length > 3) {
    // e.g. "Mark rest Pass": one line, not one per question
    const tally = {};
    for (const id of changed) tally[ans(nc[id]?.answer)] = (tally[ans(nc[id]?.answer)] || 0) + 1;
    add('', `Checklist: ${changed.length} answers set (${Object.entries(tally).map(([k, n]) => `${n} ${k}`).join(', ')})`);
  } else {
    for (const id of changed) {
      const txt = short(nc[id]?.text || pc[id]?.text || 'Check', 40);
      add('check:' + id, `${txt}: ${ans(pc[id]?.answer)} → ${ans(nc[id]?.answer)}`);
    }
  }

  const mats = (list) => (list || []).map((m) => (m.spec ? `${m.name} – ${m.spec}` : m.name));
  for (const m of added(mats(prev.materials), mats(next.materials))) add('', `Added material: ${short(m)}`);
  for (const m of added(mats(next.materials), mats(prev.materials))) add('', `Removed material: ${short(m)}`);
  const sig = (list) => JSON.stringify((list || []).map((m) => [m.name, m.spec, m.qty, m.cost]));
  if (!out.some((e) => e.text.includes('material')) && sig(prev.materials) !== sig(next.materials)) add('materials', 'Material quantities, sizes or prices changed');

  if ((prev.history || []).length > (next.history || []).length) add('', 'Inspection record deleted');
  return out;
}

function mergeLog(log, entries) {
  const at = new Date().toISOString();
  const out = [...(log || [])];
  for (const e of entries) {
    const last = out[out.length - 1];
    // Typing in a text field produces many saves; keep one entry per burst
    if (e.key && last && last.key === e.key && last.by === actor && Date.now() - Date.parse(last.at) < COLLAPSE_MS) {
      if (e.from !== undefined && last.from !== undefined) {
        const label = TEXT_FIELDS[e.key];
        e.text = `${label}: ${show(last.from)} → ${show(e.to)}`;
        e.from = last.from;
      }
      if (e.key === 'status' && last.text) {
        const first = last.text.split(' → ')[0];
        e.text = `${first} → ${e.text.split(' → ')[1]}`;
      }
      out[out.length - 1] = { ...e, at, by: actor };
    } else out.push({ ...e, at, by: actor });
  }
  return out.slice(-MAX_LOG);
}

// Save a door, recording what changed. Always merges onto the stored log so
// events logged elsewhere (photos added, pin moved) are never lost.
// A date n months on (31 Jan + 1 month = 28/29 Feb)
export function addMonths(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  const t = new Date(Date.UTC(y, m - 1 + Number(n), 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
export const FREQUENCIES = [[1, 'Every month'], [2, 'Every 2 months'], [3, 'Every 3 months'], [6, 'Every 6 months'], [12, 'Every year']];
export const freqText = (n) => (FREQUENCIES.find(([k]) => k === Number(n)) || [0, ''])[1];

export async function saveDoor(next, extra = []) {
  const prev = await db.get('doors', next.id);
  // next inspection due follows from the inspection date and the site's visit
  // frequency, unless the due date was typed in this same change
  const f = next.projectId ? Number((await db.get('projects', next.projectId))?.frequency) || 0 : 0;
  if (f && next.inspectedOn && (next.nextDue || '') === (prev?.nextDue || '') && (next.inspectedOn !== prev?.inspectedOn || !next.nextDue)) {
    next = { ...next, nextDue: addMonths(next.inspectedOn, f) };
  }
  const entries = prev ? diffDoor(prev, next) : [{ text: 'Door added to plan' }];
  for (const t of extra) entries.push({ text: t });
  const log = entries.length ? mergeLog(prev?.log, entries) : prev?.log || [];
  return db.put('doors', { ...next, log });
}

export async function logEvent(doorId, text) {
  const d = await db.get('doors', doorId);
  if (!d) return;
  await db.put('doors', { ...d, log: mergeLog(d.log, [{ text }]) });
}

// ---- Photos belong to an inspection visit ----
// A photo's `inspection` is the inspection date it was taken under; untagged
// photos belong to the current inspection.
export function photoInView(photo, view) {
  if (photo.stage === 'repair') return false; // repair photos belong to the repairs, not an inspection
  const tag = photo.inspection || '';
  if (view._current) return tag === '' || tag === (view.inspectedOn || '');
  return tag !== '' && tag === view.inspectedOn;
}

// When an inspection moves into history, its untagged photos take its date
export async function tagPhotosForSnapshot(doorId, date) {
  if (!date) return;
  for (const p of await db.doorPhotos(doorId)) {
    if (!p.inspection && p.stage !== 'repair') await db.put('photos', { ...p, inspection: date });
  }
}
