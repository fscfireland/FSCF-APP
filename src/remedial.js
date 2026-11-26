// Remedial works list for the person carrying out repairs.
// Built from the inspection: each defect's remedial work and each
// recommended action becomes a tick item. Ticks are stored on the door as
// `remedials: { [key]: { done, by, at } }`, so they sync, show in the change
// log and carry forward with a new inspection.

import { doorActions, signsNeeded, matLabel } from './defaults.js';

export const DEFAULT_REMEDIAL_TEXT = `All remedial works are to be carried out by a competent person with demonstrable training and experience in the installation and maintenance of fire door sets (for example, an operative of a third-party certified installer).

Repairs must maintain the tested fire resistance and smoke control of each door set (I.S. EN 1634-1 / I.S. EN 13501-2) and follow the door and component manufacturers' instructions. Use only CE-marked components compatible with the door set: intumescent and smoke seals, hinges (EN 1935), closers (EN 1154) and hold-open devices (EN 1155).

Tick each item when it is complete. Photograph every door after repair and report anything that cannot be repaired to FSCF Ireland before proceeding.`;

// Ironmongery maintenance: standard on every inspected fire door / exit door
// (switch off per door). Wording from FSCF's remedial reports, recommendation (10).
export const IRON_MAINT = {
  label: 'IRONMONGERY: maintenance required',
  remedial: 'Clean the hinges of oil and filings and monitor them for signs of wear; lightly oil the keeper plate so the door latches as required (BM TRADA Q-Mark Fire Door Maintenance, ART 10 Operational maintenance; GAI Specifier\'s Guide, Ironmongery for Fire and Escape Doors, section 8 Maintenance of ironmongery)',
};
const NON_DOOR = ['dampers', 'alarm', 'emlight', 'ext'];
export function ironMaintOn(d) {
  if (d.ironMaint === false || NON_DOOR.includes(d.kind)) return false;
  if (['not_inspected', 'no_access', 'na'].includes(d.status || 'not_inspected')) return false;
  return d.ironMaint === true || !!d.kind || !!d.doorType;
}

// Actions that aren't repair work, so they don't become tick items
const NOT_WORK = /^(no action required|refer to client|further investigation)/i;

export function remedialItems(d) {
  const items = [];
  for (const x of d.defects || []) {
    const prods = (d.materials || []).filter((m) => m.forKey === 'd:' + x.label && m.name && Number(m.qty) > 0);
    if (prods.length) {
      // one line per product, so each size / make is priced and ticked on its own
      for (const m of prods) {
        items.push({ key: 'd:' + x.label + '|' + matLabel(m), text: (x.remedial || x.label) + ' – ' + matLabel(m), sub: x.label, qty: Number(m.qty) || 1, part: matLabel(m) });
      }
    } else {
      items.push({ key: 'd:' + x.label, text: x.remedial || x.label, sub: x.remedial ? x.label : '', qty: Number(x.qty) > 1 ? Number(x.qty) : 0 });
    }
  }
  if (ironMaintOn(d)) items.push({ key: 'm:iron', text: IRON_MAINT.remedial, sub: IRON_MAINT.label, qty: 1 });
  for (const a of doorActions(d)) {
    if (NOT_WORK.test(a)) continue;
    items.push({ key: 'a:' + a, text: a, sub: 'Recommended action', qty: 0 });
  }
  for (const x of signsNeeded(d)) {
    items.push({ key: 's:' + x.type + '|' + (x.face || ''), text: 'Supply and fit sign: ' + x.type, sub: x.face || 'Signage', qty: Number(x.qty) || 1, sign: true, part: x.type });
  }
  return items;
}

export function remedialProgress(d) {
  const items = remedialItems(d);
  const done = items.filter((i) => d.remedials?.[i.key]?.done).length;
  const verified = items.filter((i) => d.remedials?.[i.key]?.done && d.remedials?.[i.key]?.verified).length;
  return {
    items, done, verified, total: items.length,
    complete: items.length > 0 && done === items.length,
    allVerified: items.length > 0 && verified === items.length,
    awaiting: done - verified, // done but not yet checked by someone else
  };
}

export function projectProgress(doors) {
  let items = 0;
  let done = 0;
  let doorsWith = 0;
  let doorsDone = 0;
  let verified = 0;
  let doorsVerified = 0;
  for (const d of doors) {
    const p = remedialProgress(d);
    if (!p.total) continue;
    doorsWith++;
    items += p.total;
    done += p.done;
    verified += p.verified;
    if (p.complete) doorsDone++;
    if (p.allVerified) doorsVerified++;
  }
  return { items, done, doorsWith, doorsDone, verified, doorsVerified };
}
