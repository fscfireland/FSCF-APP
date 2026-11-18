// Local database (IndexedDB) — the app's offline store.
//
// Everything is saved on the phone first, so the app works with no signal.
// Every record carries `updatedAt` and a `dirty` flag, and deletes are "soft"
// (deleted: true), so a sync step can later push changes up to the cloud
// database (Supabase) and pull other people's changes down.

const DB_NAME = 'fscf-doors';
const DB_VERSION = 1;
const STORES = ['projects', 'plans', 'doors', 'photos', 'settings'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: 'id' });
        if (name === 'plans' || name === 'doors' || name === 'photos') {
          store.createIndex('projectId', 'projectId');
        }
        if (name === 'doors') store.createIndex('planId', 'planId');
        if (name === 'photos') store.createIndex('doorId', 'doorId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode = 'readonly') {
  const db = await open();
  return db.transaction(store, mode).objectStore(store);
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const now = () => new Date().toISOString();

export async function get(store, id) {
  const s = await tx(store);
  const rec = await wrap(s.get(id));
  return rec && !rec.deleted ? rec : null;
}

export async function all(store) {
  const s = await tx(store);
  const rows = await wrap(s.getAll());
  return rows.filter((r) => !r.deleted);
}

export async function byIndex(store, index, value) {
  const s = await tx(store);
  const rows = await wrap(s.index(index).getAll(value));
  return rows.filter((r) => !r.deleted);
}

// Insert or update. Stamps updatedAt and marks the record as needing sync.
export async function put(store, rec) {
  const r = { ...rec, updatedAt: now(), dirty: true };
  if (!r.createdAt) r.createdAt = r.updatedAt;
  const s = await tx(store, 'readwrite');
  await wrap(s.put(r));
  requestPersistence();
  return r;
}

// Soft delete: keeps a tombstone so the deletion can sync later.
// Large blobs are dropped straight away to free space on the phone.
export async function remove(store, id) {
  const s = await tx(store, 'readwrite');
  const rec = await wrap(s.get(id));
  if (!rec) return;
  const tomb = { id, projectId: rec.projectId, deleted: true, updatedAt: now(), dirty: true };
  await wrap(s.put(tomb));
}

// Raw write used by backup/restore (keeps timestamps as given)
export async function putRaw(store, rec) {
  const s = await tx(store, 'readwrite');
  await wrap(s.put(rec));
}

let persistAsked = false;
function requestPersistence() {
  if (persistAsked) return;
  persistAsked = true;
  try {
    navigator.storage?.persist?.();
  } catch (e) {
    /* not supported — fine */
  }
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    return e || null;
  } catch {
    return null;
  }
}

// ---- Higher-level helpers ----

export async function projectDoors(projectId) {
  const doors = await byIndex('doors', 'projectId', projectId);
  return doors.sort((a, b) => (a.pinNo || 0) - (b.pinNo || 0));
}

export async function projectPlans(projectId) {
  const plans = await byIndex('plans', 'projectId', projectId);
  return plans.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt));
}

export async function doorPhotos(doorId) {
  const photos = await byIndex('photos', 'doorId', doorId);
  return photos.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function deleteProject(projectId) {
  for (const store of ['plans', 'doors', 'photos']) {
    const rows = await byIndex(store, 'projectId', projectId);
    for (const r of rows) await remove(store, r.id);
  }
  await remove('projects', projectId);
}

export async function deleteDoor(doorId) {
  const photos = await byIndex('photos', 'doorId', doorId);
  for (const p of photos) await remove('photos', p.id);
  await remove('doors', doorId);
}

export async function deletePlan(planId) {
  const doors = await byIndex('doors', 'planId', planId);
  for (const d of doors) await deleteDoor(d.id);
  await remove('plans', planId);
}

// Allocates the next pin number for a project (1, 2, 3 …)
export async function nextPinNo(projectId) {
  const p = await get('projects', projectId);
  const n = (p.nextPin || 1);
  await put('projects', { ...p, nextPin: n + 1 });
  return n;
}
