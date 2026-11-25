// Backup and restore. Until cloud sync is switched on, data lives only on
// this phone, so a backup file is the safety net. Photos and plans are
// included, so the file can be large.

import * as db from './db.js';
import { blobToBase64, base64ToBlob, saveFile, safeName } from './files.js';

const FORMAT = 'fscf-doors-backup';

async function serialise(rec) {
  const out = { ...rec };
  for (const k of ['blob', 'thumb', 'marked']) {
    if (rec[k] instanceof Blob) out[k] = { $blob: await blobToBase64(rec[k]), type: rec[k].type };
  }
  return out;
}

function deserialise(rec) {
  const out = { ...rec };
  for (const k of ['blob', 'thumb', 'marked']) {
    if (rec[k]?.$blob) out[k] = base64ToBlob(rec[k].$blob, rec[k].type ?? '');
  }
  return out;
}

export async function backupProjects(projects, { library = false } = {}) {
  const data = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), projects: [], plans: [], doors: [], photos: [], files: [] };
  let videosLeftOut = 0;
  for (const p of projects) {
    data.projects.push(p);
    for (const store of ['plans', 'doors', 'photos', 'files']) {
      for (const r of await db.byIndex(store, 'projectId', p.id)) {
        // Videos can be hundreds of MB: too big for a backup file built on a phone
        if ((store === 'photos' && r.kind === 'video') || (store === 'files' && r.size > 50 * 1048576)) {
          videosLeftOut++;
          continue;
        }
        data[store].push(await serialise(r));
      }
    }
  }
  if (library) {
    for (const r of await db.byIndex('files', 'projectId', 'library')) {
      if (r.size > 50 * 1048576) { videosLeftOut++; continue; }
      data.files.push(await serialise(r));
    }
  }
  data.settings = await db.all('settings');
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const name = projects.length === 1 ? safeName(projects[0].site || projects[0].client) : 'all-projects';
  const result = await saveFile(`FSCF_backup_${name}_${new Date().toISOString().slice(0, 10)}.json`, blob);
  return { result, videosLeftOut };
}

export async function restoreBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.format !== FORMAT) throw new Error('This file is not an FSCF Ireland app backup.');
  let n = 0;
  for (const store of ['projects', 'plans', 'doors', 'photos', 'files']) {
    for (const r of data[store] || []) {
      await db.putRaw(store, deserialise(r));
      if (store === 'projects') n++;
    }
  }
  for (const s of data.settings || []) {
    const existing = await db.get('settings', s.id);
    if (!existing) await db.putRaw('settings', s);
  }
  return n;
}
