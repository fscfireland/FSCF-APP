// Collections: folders of drawings within a project, like Fieldwire's.
// e.g. "November 2026 service", "December 2026 service". A collection can be
// copied to a new one with the same drawings and pins (same numbers, same
// positions), either reset for a fresh inspection or with all details.
//
// A plan's `collection` is the folder name; '' is the default folder.

import * as db from './db.js';

export const DEFAULT_COLLECTION = '';

// Collections can sit in a main folder: "Remedial repairs / November 2026".
// A choice of "F:Remedial repairs" means the whole folder (all its sections).
export const SEP = ' / ';
export function splitColl(c) {
  const v = c || '';
  const i = v.indexOf(SEP);
  return i < 0 ? { folder: '', section: v } : { folder: v.slice(0, i), section: v.slice(i + SEP.length) };
}
export const joinColl = (folder, section) => (folder ? `${folder}${SEP}${section || 'General'}` : section || '');
export const isFolderPick = (c) => typeof c === 'string' && c.startsWith('F:');

export function collLabel(c) {
  if (isFolderPick(c)) return `${c.slice(2)} (all sections)`;
  const { folder, section } = splitColl(c);
  return folder ? `${folder} › ${section}` : section || 'Main drawings';
}
export const sectionLabel = (c) => splitColl(c).section || 'Main drawings';

// does a collection name belong to the current choice?
export function inColl(name, coll) {
  if (coll === '*') return true;
  if (isFolderPick(coll)) return splitColl(name).folder === coll.slice(2);
  return (name || '') === coll;
}

export const listFolders = (colls) => [...new Set(colls.map((c) => splitColl(c).folder).filter(Boolean))].sort();

// Collection names, the one with the newest drawing first
export function listCollections(plans) {
  const newest = {};
  for (const p of plans) {
    const c = p.collection || '';
    if (!(c in newest) || p.createdAt > newest[c]) newest[c] = p.createdAt;
  }
  return Object.keys(newest).sort((a, b) => (newest[b] || '').localeCompare(newest[a] || ''));
}

// Which collection to show: the one picked this session, else the project's
// last-used one, else the newest. '*' means all collections.
export function activeCollection(project, plans, picked) {
  const list = listCollections(plans);
  const folders = listFolders(list);
  const ok = (c) => c != null && (list.includes(c) || (isFolderPick(c) && folders.includes(c.slice(2))));
  if (picked === '*' && list.length > 1) return '*';
  if (ok(picked)) return picked;
  if (ok(project.activeCollection)) return project.activeCollection;
  return list[0] ?? '';
}

export const plansIn = (plans, coll) => (coll === '*' ? plans : plans.filter((p) => inColl(p.collection || '', coll)));

// The next month that doesn't have a collection yet, e.g. "December 2026"
export function suggestName(existing, withService = true) {
  const now = new Date();
  for (let k = 0; k < 36; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
    const name = d.toLocaleDateString('en-IE', { month: 'long', year: 'numeric' }) + (withService ? ' service' : '');
    if (!existing.includes(name)) return name;
  }
  return 'New collection';
}

// Copy every drawing in `from` (with its pins) into a new collection.
// mode 'reset': keep door ref, room, type, leaf; start as Not inspected.
// mode 'all'  : carry status, checklist, defects, actions, materials, notes too.
export async function copyCollection(project, plans, from, name, mode, actor = '') {
  const src = plansIn(plans, from);
  const at = new Date().toISOString();
  let pins = 0;
  for (const [i, plan] of src.entries()) {
    const { id, createdAt, updatedAt, dirty, ...rest } = plan;
    const np = await db.put('plans', { ...rest, id: db.uid(), collection: name, order: i, copiedFrom: plan.id });
    for (const d of mode === 'none' ? [] : await db.byIndex('doors', 'planId', plan.id)) {
      const { id: did, createdAt: c2, updatedAt: u2, dirty: d2, history, log, ...door } = d;
      const fresh = mode === 'reset'
        ? { status: 'not_inspected', checks: {}, defects: [], actions: [], materials: [], notes: '', inspectedOn: '', inspectedBy: '' }
        : { inspectedOn: '', inspectedBy: '' };
      await db.put('doors', {
        ...door,
        ...fresh,
        id: db.uid(),
        planId: np.id,
        sourceDoorId: did,
        history: [],
        log: [{ at, by: actor, text: `Copied from "${collLabel(from)}"${mode === 'reset' ? ' (pin and door details; starts as not inspected)' : ' with all details'}` }],
      });
      pins++;
    }
  }
  // doors imported but not yet placed on a drawing
  for (const d of await db.byIndex('doors', 'projectId', project.id)) {
    if (mode === 'none' || d.planId || (d.collection || '') !== from) continue;
    const { id: did, createdAt: c2, updatedAt: u2, dirty: d2, history, log, ...door } = d;
    const fresh = mode === 'reset'
      ? { status: 'not_inspected', checks: {}, defects: [], actions: [], materials: [], notes: '', inspectedOn: '', inspectedBy: '' }
      : { inspectedOn: '', inspectedBy: '' };
    await db.put('doors', { ...door, ...fresh, id: db.uid(), collection: name, sourceDoorId: did, history: [], log: [{ at, by: actor, text: `Copied from "${collLabel(from)}"` }] });
    pins++;
  }
  return { drawings: src.length, pins };
}

export async function renameCollection(plans, from, to) {
  for (const p of plansIn(plans, from)) await db.put('plans', { ...p, collection: to });
  const projectId = plans[0]?.projectId;
  if (projectId) for (const d of await db.byIndex('doors', 'projectId', projectId)) if (!d.planId && (d.collection || '') === from) await db.put('doors', { ...d, collection: to });
}

export async function deleteCollection(plans, coll) {
  for (const p of plansIn(plans, coll)) await db.deletePlan(p.id);
  const projectId = plans[0]?.projectId;
  if (projectId) for (const d of await db.byIndex('doors', 'projectId', projectId)) if (!d.planId && inColl(d.collection || '', coll)) await db.deleteDoor(d.id);
}

// Rename a main folder: every section in it moves with it
export async function renameFolder(plans, from, to) {
  for (const p of plans) {
    const { folder, section } = splitColl(p.collection);
    if (folder === from) await db.put('plans', { ...p, collection: joinColl(to, section) });
  }
  const projectId = plans[0]?.projectId;
  if (projectId) {
    for (const d of await db.byIndex('doors', 'projectId', projectId)) {
      const { folder, section } = splitColl(d.collection);
      if (!d.planId && folder === from) await db.put('doors', { ...d, collection: joinColl(to, section) });
    }
  }
}
