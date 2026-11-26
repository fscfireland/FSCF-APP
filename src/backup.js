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

async function collectBackup(projects, { library = false } = {}) {
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
  if (library) data.quotes = await db.all('quotes'); // quotes & invoices made in the app
  data.settings = await db.all('settings');
  return { data, videosLeftOut };
}

export async function backupProjects(projects, { library = false } = {}) {
  const { data, videosLeftOut } = await collectBackup(projects, { library });
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const name = projects.length === 1 ? safeName(projects[0].site || projects[0].client) : 'all-projects';
  const result = await saveFile(`FSCF_backup_${name}_${new Date().toISOString().slice(0, 10)}.json`, blob);
  return { result, videosLeftOut };
}

// Split one backup into files small enough to send (each part is a complete,
// restorable backup file; restoring all the parts puts everything back).
function splitBackup(data, limit) {
  const parts = [];
  const blank = () => ({ format: data.format, version: data.version, exportedAt: data.exportedAt, projects: [], plans: [], doors: [], photos: [], files: [], size: 0 });
  let cur = blank();
  cur.settings = data.settings;
  cur.quotes = data.quotes;
  cur.size = JSON.stringify(data.settings || []).length + JSON.stringify(data.quotes || []).length;
  for (const store of ['projects', 'plans', 'doors', 'photos', 'files']) {
    for (const r of data[store]) {
      const n = JSON.stringify(r).length;
      if (cur.size + n > limit && cur.size > 0) {
        parts.push(cur);
        cur = blank();
      }
      cur[store].push(r);
      cur.size += n;
    }
  }
  parts.push(cur);
  return parts.map((p, i) => {
    const { size, ...rest } = p;
    return { ...rest, part: i + 1, parts: parts.length };
  });
}

// Back up straight into the viewer's Google Drive through their Google Drive
// connector (only inside the Claude app / claude.ai). Returns null when that
// route isn't available here, so the caller can save a file instead.
const DRIVE = 'Google Drive';
const FOLDER = '16 FSCF IRELAND APP BACKUPS';
// the folder in FSCF Ireland's Google Drive that every device backs up to
const DRIVE_FOLDER_ID = '1NOIIZ0iNsIFQB8zUYQeGTtOCWubN2w7H';
// Can this view reach Google Drive? { mcp } when it can, else { reason }
export async function driveStatus() {
  if (!window.claude?.use) return { reason: 'outside' };
  let mcp = null;
  try {
    mcp = await window.claude.use('mcp');
  } catch {
    /* not served */
  }
  if (!mcp) return { reason: 'noview' };
  let lt;
  try {
    lt = await mcp.listTools();
  } catch (e) {
    return { reason: e?.code || 'error' };
  }
  if (!lt?.servers?.some((x) => x.server === DRIVE && (x.tools?.length || x.authStatus === 'unknown'))) return { reason: 'notconnected' };
  if (!lt.fileArgs) return { reason: 'nofiles' };
  return { mcp };
}
export const DRIVE_REASONS = {
  outside: 'This copy of the app is open outside Claude, so it cannot reach your Google Drive.',
  noview: 'Google Drive cannot be reached from the app in this browser or Claude app. Open the app in the Claude app (or claude.ai in Chrome), signed in to your account.',
  notconnected: 'Google Drive is not connected to your Claude account on this device. Connect it in Claude: Settings › Connectors › Google Drive, then reopen the app.',
  nofiles: 'This version of the Claude app cannot send files to Drive yet. Update the Claude app from the Play Store, or open the app at claude.ai in Chrome.',
  error: 'Google Drive did not answer. Check you have signal and try again.',
};
export async function driveAvailable() {
  return (await driveStatus()).mcp || null;
}

export async function backupToDrive(projects, { library = false, folderId = '', onProgress = () => {} } = {}) {
  const st = await driveStatus();
  if (!st.mcp) return { unavailable: st.reason };
  const mcp = st.mcp;
  onProgress('Gathering your sites, drawings, photos and files…');
  const { data, videosLeftOut } = await collectBackup(projects, { library });
  const parts = splitBackup(data, 12 * 1048576);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const name = projects.length === 1 ? safeName(projects[0].site || projects[0].client) : 'all-sites';
  const newFolder = async () => {
    const r = await mcp.callTool(DRIVE, 'create_file', { title: FOLDER, contentMimeType: 'application/vnd.google-apps.folder' });
    const id = r?.payload?.id;
    if (!id) throw new Error('Could not make the backup folder in Google Drive.');
    return id;
  };
  // every phone and tablet backs up to the same Drive folder; a new one is
  // made only if that folder has been deleted
  let folder = DRIVE_FOLDER_ID || folderId || (await newFolder());
  let first = null;
  for (const [i, part] of parts.entries()) {
    const title = `FSCF_backup_${name}_${stamp}${parts.length > 1 ? `_part${i + 1}of${parts.length}` : ''}.json`;
    onProgress(parts.length > 1 ? `Sending part ${i + 1} of ${parts.length} to Google Drive…` : 'Sending to Google Drive…');
    const blob = new Blob([JSON.stringify(part)], { type: 'application/json' });
    const send = (parentId) => mcp.callTool(DRIVE, 'create_file', {
      title,
      parentId,
      contentMimeType: 'application/json',
      disableConversionToGoogleType: true,
      base64Content: { $file: { data: blob, name: title, type: 'application/json' } },
    });
    let r;
    try {
      r = await send(folder);
    } catch (e) {
      // the folder was deleted or moved: make a new one and try once more
      if (i === 0 && e?.code === 'tool_error') {
        folder = await newFolder();
        r = await send(folder);
      } else throw e;
    }
    first ||= r?.payload;
  }
  return { parts: parts.length, videosLeftOut, folderId: folder, folderUrl: `https://drive.google.com/drive/folders/${folder}` };
}

// Plain-language message for a Drive backup that failed
export function driveError(e) {
  const c = e?.code;
  if (c === 'not_in_manifest' || c === 'approval_required') return 'Google Drive was not allowed for the app. Tap Back up again and choose Allow.';
  if (c === 'server_not_connected' || c === 'needs_reauth' || c === 'selection_required') return 'Connect Google Drive in claude.ai Settings › Connectors, then try again.';
  if (c === 'bad_request') return 'That backup part was too large to send. Use "Save backup file" instead.';
  return 'Google Drive backup failed: ' + (e?.message || 'unknown error');
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
  for (const q of data.quotes || []) if (!(await db.get('quotes', q.id))) await db.putRaw('quotes', q);
  for (const s of data.settings || []) {
    const existing = await db.get('settings', s.id);
    if (!existing) await db.putRaw('settings', s);
  }
  return n;
}
