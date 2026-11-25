// Remedial works list for the person carrying out repairs.
// Built from the inspection: each defect's remedial work and each
// recommended action becomes a tick item. Ticks are stored on the door as
// `remedials: { [key]: { done, by, at } }`, so they sync, show in the change
// log and carry forward with a new inspection.

import { doorActions } from './defaults.js';

export const DEFAULT_REMEDIAL_TEXT = `All remedial works are to be carried out by a competent person with demonstrable training and experience in the installation and maintenance of fire door sets (for example, an operative of a third-party certified installer).

Repairs must maintain the tested fire resistance and smoke control of each door set (I.S. EN 1634-1 / I.S. EN 13501-2) and follow the door and component manufacturers' instructions. Use only CE-marked components compatible with the door set: intumescent and smoke seals, hinges (EN 1935), closers (EN 1154) and hold-open devices (EN 1155).

Tick each item when it is complete. Photograph every door after repair and report anything that cannot be repaired to FSCF Ireland before proceeding.`;

// Actions that aren't repair work, so they don't become tick items
const NOT_WORK = /^(no action required|refer to client|further investigation)/i;

export function remedialItems(d) {
  const items = [];
  for (const x of d.defects || []) {
    items.push({ key: 'd:' + x.label, text: x.remedial || x.label, sub: x.remedial ? x.label : '', qty: Number(x.qty) > 1 ? Number(x.qty) : 0 });
  }
  for (const a of doorActions(d)) {
    if (NOT_WORK.test(a)) continue;
    items.push({ key: 'a:' + a, text: a, sub: 'Recommended action', qty: 0 });
  }
  return items;
}

export function remedialProgress(d) {
  const items = remedialItems(d);
  const done = items.filter((i) => d.remedials?.[i.key]?.done).length;
  return { items, done, total: items.length, complete: items.length > 0 && done === items.length };
}

export function projectProgress(doors) {
  let items = 0;
  let done = 0;
  let doorsWith = 0;
  let doorsDone = 0;
  for (const d of doors) {
    const p = remedialProgress(d);
    if (!p.total) continue;
    doorsWith++;
    items += p.total;
    done += p.done;
    if (p.complete) doorsDone++;
  }
  return { items, done, doorsWith, doorsDone };
}
