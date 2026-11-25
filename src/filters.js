// Report filters (Excel and PDF), similar to Fieldwire's report filters.
// A filter picks, for each door, the inspection to report on (the latest one
// inside the date range, from its current record or its history) and then
// keeps it only if it matches status / door type / plan / defect / check.

import { statusById } from './defaults.js';
import { fmtDate } from './ui.js';

export const emptyFilter = () => ({ dateMode: 'all', from: '', to: '', statuses: [], types: [], zones: [], plans: [], defect: '', check: '' });

export const isFiltered = (f) =>
  !!f && (f.dateMode !== 'all' || f.statuses.length || f.types.length || (f.zones || []).length || f.plans.length || f.defect || f.check);

// Every inspection of a door: the current record first, then history
export function doorViews(d) {
  const base = { ...d, _current: true };
  const past = (d.history || []).map((h) => ({ ...d, ...h, id: d.id, _current: false, _snapId: h.id }));
  return [base, ...past];
}

function pickView(d, f) {
  const views = doorViews(d);
  if (f.dateMode === 'all') return views[0];
  const from = f.from || '0000-00-00';
  const to = f.dateMode === 'on' ? f.from : f.to || '9999-99-99';
  const inRange = views.filter((v) => v.inspectedOn && v.inspectedOn >= from && v.inspectedOn <= to);
  if (!inRange.length) return null;
  // latest inspection in the range; the current record wins a tie
  return inRange.reduce((best, v) => (v.inspectedOn > best.inspectedOn ? v : best));
}

export function applyFilter(doors, f) {
  if (!isFiltered(f)) return doors.map((d) => ({ ...d, _current: true }));
  const out = [];
  for (const d of doors) {
    const v = pickView(d, f);
    if (!v) continue;
    if (f.statuses.length && !f.statuses.includes(v.status || 'not_inspected')) continue;
    if (f.types.length && !f.types.includes(v.doorType || '(no type)')) continue;
    if ((f.zones || []).length && !f.zones.includes(zoneKey(v))) continue;
    if (f.plans.length && !f.plans.includes(v.planId)) continue;
    if (f.defect && !(v.defects || []).some((x) => x.label === f.defect)) continue;
    if (f.check && v.checks?.[f.check]?.answer !== 'fail') continue;
    out.push(v);
  }
  return out;
}

// A door's zone as a filter value: the zone number, or its name if no number
export const zoneKey = (d) => String(d.zoneNo || d.zoneName || '(no zone)');

// Values to offer in the filter controls, from current records and history
export function filterOptions(doors, questions) {
  const types = new Set();
  const defects = new Set();
  const checks = new Map(questions.map((q) => [q.id, q.text]));
  const dates = new Set();
  const zones = new Map();
  for (const d of doors) {
    for (const v of doorViews(d)) {
      types.add(v.doorType || '(no type)');
      const zk = zoneKey(v);
      if (!zones.has(zk) || (!zones.get(zk) && v.zoneName)) zones.set(zk, v.zoneNo ? `Zone ${v.zoneNo}${v.zoneName ? ' – ' + v.zoneName : ''}` : v.zoneName || 'No zone');
      for (const x of v.defects || []) defects.add(x.label);
      for (const [id, c] of Object.entries(v.checks || {})) if (!checks.has(id) && c?.text) checks.set(id, c.text);
      if (v.inspectedOn) dates.add(v.inspectedOn);
    }
  }
  return {
    types: [...types].sort(),
    zones: [...zones.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([key, label]) => ({ key, label })),
    defects: [...defects].sort(),
    checks: [...checks.entries()].map(([id, text]) => ({ id, text })),
    dates: [...dates].sort(),
  };
}

// One line describing the filter, for report covers and file names
export function describeFilter(f, plans, questions) {
  if (!isFiltered(f)) return '';
  const parts = [];
  if (f.dateMode === 'on' && f.from) parts.push(`Inspected on ${fmtDate(f.from)}`);
  if (f.dateMode === 'range') parts.push(`Inspected ${f.from ? fmtDate(f.from) : 'any time'} to ${f.to ? fmtDate(f.to) : 'today'}`);
  if (f.statuses.length) parts.push(f.statuses.map((s) => statusById[s]?.label || s).join(' / '));
  if (f.types.length) parts.push(f.types.join(' / '));
  if ((f.zones || []).length) parts.push(f.zones.map((z) => (z === '(no zone)' ? 'No zone' : /^\d/.test(z) ? `Zone ${z}` : z)).join(' / '));
  if (f.plans.length) parts.push(f.plans.map((id) => plans.find((p) => p.id === id)?.name || 'plan').join(' / '));
  if (f.defect) parts.push(`Defect: ${f.defect}`);
  if (f.check) parts.push(`Failed: ${questions.find((q) => q.id === f.check)?.text || 'check'}`);
  return parts.join(' · ');
}
