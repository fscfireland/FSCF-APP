// FSCF Ireland — main app: screens, navigation and the door record.

import * as db from './db.js';
import {
  STATUSES, statusById, DEFAULT_DOOR_TYPES, DEFAULT_DEFECTS, LEAF_CONFIGS, DEFAULT_ACTIONS, DEFAULT_QUESTIONS, DEFAULT_MATERIALS,
  ANSWERS, doorActions, materialsTotal, euro, questionsFor, drawDemoPlan, SCHEMES, DEFAULT_SCHEME, useScheme,
  setCustomSchemes, allSchemes, schemeById, OPTIONAL_STATUSES, statusesInUse, matLabel, zoneText, MATERIALS_VERSION,
  DEFAULT_RISKS, NO_RISK, parseZones, zonesToText, DEFAULT_CATEGORIES, DEFAULT_WORK_TYPES, isInspected,
  DEFAULT_SIGNS, SIGN_FACES, signsNeeded, MAT_CATEGORIES, matCat, defectCat, QUESTION_DEFECT, defaultProductsFor, fillDefectProducts,
} from './defaults.js';
import { PlanViewer } from './viewer.js';
import { importDrawing, compressImage, thumbFromCanvas } from './files.js';
import { exportProjectXlsx, exportRemedialXlsx, exportPricingXlsx } from './export.js';
import { exportProjectPdf, exportRemedialPdf } from './report.js';
import { parseDoorFile, downloadTemplate, matchListValue } from './importer.js';
import { doorMapURL } from './minimap.js';
import { getPosition, geoError, gpsText, mapLink } from './geo.js';
import { signaturePad } from './signature.js';
import { markupPhoto, plainThumb } from './photomark.js';
import { DEFAULT_REMEDIAL_TEXT, remedialItems, remedialProgress, projectProgress } from './remedial.js';
import { MK_COLORS, TOOLS, TEXT_SIZES, renderSvg, lineLengthPx, fmtLength } from './markup.js';
import { isVideo, videoInfo, fmtDuration, fmtSize, cleanLink } from './media.js';
import { saveDoor, logEvent, setActor, snapshotOf, tagPhotosForSnapshot, photoInView } from './history.js';
import { emptyFilter, isFiltered, applyFilter, filterOptions, describeFilter } from './filters.js';
import {
  collLabel, listCollections, activeCollection, plansIn, suggestName, copyCollection, renameCollection, deleteCollection,
  splitColl, joinColl, isFolderPick, inColl, listFolders, sectionLabel, renameFolder,
} from './collections.js';
import { backupProjects, restoreBackup } from './backup.js';
import { BRAND_BANNER, BRAND_ROUND } from './brandlogo.js';
import { LIB, DEFAULT_LIB_FOLDERS, fileFolders, guessFolder, fileKind, KIND_LABEL, projectFiles, addFiles, addBlob, openFile, downloadFile } from './projectfiles.js';
import { CLOSE_ANSWERS, closeQuestions, planKey, closeoutOf, serviceOf, isLive, liveKeys, startService, reopenService, sessionsOf, isRunning, elapsedMs, fmtDuration as fmtJobTime, pauseService, resumeService, saveSessions, recordWeather, weatherDays, weatherLine, todayDublin, WEATHER_SOURCE } from './closeout.js';
import { fmtSize as fmtBytes } from './media.js';
import { icon, $, $$, esc, toast, dialog, confirmBox, busy, fmtDate, today, makeSortable } from './ui.js';

const app = document.getElementById('app');
const sheetRoot = document.getElementById('sheet-root');

// ---------- state & navigation ----------
let state = { view: 'projects' };
const stack = [];
let mountedKey = '';
let viewer = null;
let lists = null; // settings: door types, defects, inspector
const urls = new Set(); // object URLs to clean up per screen

function viewKey(s) {
  return [s.view, s.projectId, s.planId, s.tab].join('|');
}

// The phone's back button works through browser history when the app runs
// on its own. Inside the Claude app's viewer we keep navigation in memory.
const useHistory = !window.claude;

function go(next, { replace = false } = {}) {
  if (!replace) {
    stack.push(state);
    if (useHistory) {
      try {
        history.pushState({ d: stack.length }, '');
      } catch {
        /* ignore */
      }
    }
  }
  state = { ...next };
  render();
}

function back() {
  if (!stack.length) return;
  if (useHistory) history.back(); // popstate does the work
  else popState();
}

function popState() {
  if (!stack.length) return;
  state = stack.pop();
  render();
}
window.addEventListener('popstate', popState);

// Redraw the current screen from the database
function refresh() {
  mountedKey = '';
  return render();
}

function objUrl(blob) {
  const u = URL.createObjectURL(blob);
  urls.add(u);
  return u;
}

async function loadLists() {
  const s = await db.get('settings', 'lists');
  lists = {
    id: 'lists', doorTypes: DEFAULT_DOOR_TYPES, defects: DEFAULT_DEFECTS, actions: DEFAULT_ACTIONS,
    questions: DEFAULT_QUESTIONS, materials: DEFAULT_MATERIALS, risks: DEFAULT_RISKS, categories: DEFAULT_CATEGORIES, workTypes: DEFAULT_WORK_TYPES, inspector: '', logoBanner: BRAND_BANNER, logoRound: BRAND_ROUND, ...(s || {}),
  };
  setActor(lists.inspector);
  setCustomSchemes(lists.customSchemes);
  if (s?.materials && (s.matVersion || 1) < MATERIALS_VERSION) {
    const have = new Set(s.materials.map((m) => m.id));
    const sample = Object.fromEntries(DEFAULT_MATERIALS.map((m) => [m.id, m.cost]));
    const merged = [...s.materials, ...DEFAULT_MATERIALS.filter((m) => !have.has(m.id))]
      .map((m) => ({ ...m, cat: matCat(m), cost: Number(m.cost) ? m.cost : sample[m.id] ?? m.cost }));
    await saveLists({ materials: merged, matVersion: MATERIALS_VERSION });
  }
  return lists;
}

async function saveLists(patch) {
  lists = await db.put('settings', { ...lists, ...patch });
  setActor(lists.inspector);
  setCustomSchemes(lists.customSchemes);
}

// ---------- render ----------
async function render() {
  document.body.classList.toggle('prices-locked', !priced());
  const key = viewKey(state);
  if (key !== mountedKey) {
    mountedKey = key;
    viewer?.destroy();
    viewer = null;
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.clear();
    window.scrollTo(0, 0);
    if (state.view === 'projects') await renderProjects();
    else if (state.view === 'project') await renderProject();
    else if (state.view === 'plan') await renderPlan();
    else if (state.view === 'settings') await renderSettings();
    else if (state.view === 'library') await renderLibrary();
  } else if (state.view === 'plan') {
    await refreshPins();
  }
  await renderSheet();
}

// ---------- Projects list ----------
async function renderProjects() {
  const projects = (await db.all('projects')).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updatedAt.localeCompare(a.updatedAt));
  const allDoors = await db.all('doors');
  const allPlans = await db.all('plans');
  const plansBy = {};
  for (const pl of allPlans) (plansBy[pl.projectId] ||= []).push(pl);
  // each card shows the project's current collection
  const byProject = {};
  const collOf = {};
  for (const p of projects) {
    const pls = plansBy[p.id] || [];
    const coll = activeCollection(p, pls);
    const ids = new Set(plansIn(pls, coll).map((x) => x.id));
    byProject[p.id] = allDoors.filter((d) => d.projectId === p.id && (ids.has(d.planId) || (!d.planId && inColl(d.collection || '', coll))));
    collOf[p.id] = listCollections(pls).length > 1 || coll ? collLabel(coll) : '';
  }

  // services that have been started and not yet ended
  const live = [];
  for (const p of projects) {
    for (const k of liveKeys(p)) {
      const plan = (plansBy[p.id] || []).find((x) => planKey(x.id) === k);
      if (!plan) continue; // drawing deleted
      const ds = allDoors.filter((d) => d.planId === plan.id);
      live.push({ p, k, plan, sv: p.services[k], total: ds.length, done: ds.filter(isInspected).length });
    }
  }
  live.sort((a, b) => b.sv.startedAt.localeCompare(a.sv.startedAt));
  const libCount = (await projectFiles(LIB)).length;
  const liveN = {};
  for (const l of live) liveN[l.p.id] = (liveN[l.p.id] || 0) + 1;
  const liveHtml = live.length ? `<section class="live-list">
      <h2 class="h2"><span class="live-dot" aria-hidden="true"></span> Live services <span class="muted">${live.length}</span></h2>
      ${live.map(({ p, plan, sv, total, done }) => `<button class="live-card" data-pid="${p.id}" data-plan="${plan.id}">
        <span class="lc-main"><b>${esc(p.site || 'Untitled site')}</b>
          <small class="lc-plan">${icon('plan')} ${esc(planSvcName(plan))}</small>
          <small>${esc([p.workType, p.client].filter(Boolean).join(' · '))}</small>
          <small>${isRunning(sv) ? '<span class="live-dot" aria-hidden="true"></span> Live' : '⏸ Paused'} · started ${esc(fmtWhen(sv.startedAt))} ${timerChip(p, planKey(plan.id)).replace('<button type="button" class="svc-timer svc-act" data-act="time"', '<span class="svc-timer">· </span><span class="svc-timer"').replace('</button>', '</span>')}</small></span>
        <span class="lc-prog"><b>${total ? Math.round((done / total) * 100) : 0}%</b><small>${done}/${total} doors</small>
          <i style="--p:${total ? (done / total) * 100 : 0}%"></i></span>
      </button>`).join('')}
    </section>` : '';

  // grouping and filtering
  let groupBy = 'group';
  try {
    groupBy = localStorage.getItem('fscf-groupby') || 'group';
  } catch {
    /* storage blocked */
  }
  const types = [...new Set(projects.map((p) => p.workType || '').filter(Boolean))].sort();
  const q = (state.projQ || '').toLowerCase();
  const shown = projects.filter((p) =>
    (!state.projType || (p.workType || '') === state.projType) &&
    (!q || [p.site, p.client, p.address, p.group, p.workType].join(' ').toLowerCase().includes(q)));
  const keyOf = (p) => (groupBy === 'group' ? p.group : groupBy === 'type' ? p.workType : groupBy === 'client' ? p.client : '') || '';
  const emptyName = { group: 'No group', type: 'Type not set', client: 'No client' }[groupBy] || '';
  const sections = new Map();
  for (const p of shown) {
    const k = groupBy === 'none' ? '' : keyOf(p);
    (sections.get(k) || sections.set(k, []).get(k)).push(p);
  }
  const ordered = [...sections.entries()].sort((a, b) => (a[0] === '') - (b[0] === '') || a[0].localeCompare(b[0]));
  const closed = new Set(state.closedGroups || []);
  const groupedHtml = !projects.length ? '' : !shown.length ? '<p class="muted pad">No projects match.</p>' : ordered.map(([k, list]) => groupBy === 'none'
    ? `<div class="project-list">${list.map((p) => projectCard(p, byProject[p.id] || [], collOf[p.id], liveN[p.id] || 0)).join('')}</div>`
    : `<section class="pgroup ${closed.has(groupBy + ':' + k) ? 'is-closed' : ''}" data-k="${esc(groupBy + ':' + k)}">
        <button class="pgroup-head" aria-expanded="${!closed.has(groupBy + ':' + k)}">${icon('down')}<b>${esc(k || emptyName)}</b><span class="muted">${list.length}</span></button>
        <div class="project-list">${list.map((p) => projectCard(p, byProject[p.id] || [], collOf[p.id], liveN[p.id] || 0)).join('')}</div>
      </section>`).join('');

  app.innerHTML = `
    <header class="bar">
      <div class="brand"><span class="brand-mark ${lists.logoRound || lists.logoBanner ? 'has-logo' : ''}">${lists.logoRound || lists.logoBanner ? `<img alt="" src="${(lists.logoRound || lists.logoBanner).data}">` : icon('shield')}</span><div><b>FSCF Ireland</b><small>Fire safety compliance &amp; facilities</small></div></div>
      <span class="bar-btns">
        ${lists.libPin ? `<button class="icon-btn owner-lock ${priced() ? 'is-open' : ''}" id="owner-lock" aria-label="${priced() ? 'Lock prices' : 'Unlock prices'}">${icon('shield')}<span>${priced() ? 'Unlocked' : 'Locked'}</span></button>` : ''}
        <button class="icon-btn" id="settings" aria-label="Settings">${icon('gear')}</button>
      </span>
    </header>
    <main class="page">
      ${(() => {
        if (!projects.length) return `<div class="offline-note">${icon('check')} Saved on this device — works with no signal</div>`;
        const last = lists.lastBackupAt ? Date.parse(lists.lastBackupAt) : 0;
        const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
        if (days !== null && days < 2) return `<div class="offline-note">${icon('check')} Saved on this device · backed up ${days ? 'yesterday' : 'today'}</div>`;
        return `<div class="backup-warn">${icon('shield')}<span><b>${last ? `Last backup ${days} days ago` : 'Not backed up yet'}</b><small>Your projects are stored only on this device and in this browser. Save a backup to Google Drive or email.</small></span><button class="btn sm primary" id="home-backup">Back up now</button></div>`;
      })()}
      ${liveHtml}
      <button class="lib-card" id="my-files">${icon('folder')}<span><b>My files</b><small>${libCount} file${libCount === 1 ? '' : 's'} · private to you${lists.libPin ? ' · PIN locked' : ''}</small></span>${icon(lists.libPin ? 'shield' : 'more')}</button>
      ${projects.length ? `<h1 class="h1">Projects <span class="muted">${projects.length}</span></h1>
      <div class="home-tools">
        <label class="search">${icon('search')}<input id="proj-q" type="search" placeholder="Search site, client or group…" value="${esc(state.projQ || '')}"></label>
        <div class="seg seg4" role="group" aria-label="Group projects by">
          ${[['group', 'Group'], ['type', 'Type of work'], ['client', 'Client'], ['none', 'None']].map(([v, l]) => `<button class="seg-btn ${groupBy === v ? 'is-on' : ''}" data-gb="${v}">${l}</button>`).join('')}
        </div>
        ${types.length > 1 ? `<div class="chips wrap">${['', ...types].map((t) => `<button class="chip type-chip ${(state.projType || '') === t ? 'is-on' : ''}" data-t="${esc(t)}">${esc(t || 'All types')} ${t ? `<b>${projects.filter((p) => (p.workType || '') === t).length}</b>` : ''}</button>`).join('')}</div>` : ''}
      </div>` : ''}
      <div id="project-groups">${groupedHtml}</div>
      ${projects.length ? '' : `
        <section class="empty">
          <div class="empty-ico">${icon('door')}</div>
          <h1 class="h1">No projects yet</h1>
          <p>Create a project for each site, upload the floor plan, then tap the plan to pin each fire door.</p>
          <div class="row-btns">
            <button class="btn primary" id="new-project-2">${icon('plus')} New project</button>
            <button class="btn" id="demo">Load demo project</button>
          </div>
        </section>`}
    </main>
    ${projects.length ? `<button class="fab" id="new-project">${icon('plus')} New project</button>` : ''}
  `;
  $('#my-files').onclick = () => go({ view: 'library' });
  $('#home-backup')?.addEventListener('click', async () => {
    const b = busy('Preparing backup…');
    try {
      const { result, videosLeftOut } = await backupProjects(await db.all('projects'), { library: true });
      b.done();
      if (result === 'saved') {
        await saveLists({ lastBackupAt: new Date().toISOString() });
        toast(videosLeftOut ? `Backup saved (${videosLeftOut} large file(s) left out)` : 'Backup saved');
        refresh();
      }
    } catch (e) {
      b.done();
      toast(e.message, 'error');
    }
  });
  $$('.live-card').forEach((c) => (c.onclick = () => go({ view: 'plan', projectId: c.dataset.pid, planId: c.dataset.plan })));
  $('#settings').onclick = () => go({ view: 'settings' });
  $('#owner-lock')?.addEventListener('click', () => {
    if (priced()) { libUnlocked = false; toast('Locked: prices and time hidden'); refresh(); } else unlockOwner();
  });
  $$('#new-project, #new-project-2').forEach((b) => (b.onclick = () => editProject()));
  const demo = $('#demo');
  if (demo) demo.onclick = loadDemo;
  $$('.project-card').forEach((el) => (el.onclick = () => go({ view: 'project', projectId: el.dataset.id, tab: 'plans' })));
  $$('[data-gb]').forEach((b) => (b.onclick = () => {
    try {
      localStorage.setItem('fscf-groupby', b.dataset.gb);
    } catch {
      /* storage blocked */
    }
    refresh();
  }));
  $$('.type-chip').forEach((c) => (c.onclick = () => { state.projType = c.dataset.t; refresh(); }));
  $$('.pgroup-head').forEach((h) => (h.onclick = () => {
    const k = h.closest('.pgroup').dataset.k;
    const set = new Set(state.closedGroups || []);
    set.has(k) ? set.delete(k) : set.add(k);
    state.closedGroups = [...set];
    h.closest('.pgroup').classList.toggle('is-closed');
    h.setAttribute('aria-expanded', String(!set.has(k)));
  }));
  const pq = $('#proj-q');
  if (pq) pq.oninput = () => {
    state.projQ = pq.value;
    const pos = pq.selectionStart;
    refresh().then(() => {
      const n = $('#proj-q');
      n?.focus();
      n?.setSelectionRange(pos, pos);
    });
  };
}

function statusBar(doors) {
  const total = doors.length || 1;
  const counts = countStatuses(doors);
  return `<div class="sbar" aria-hidden="true">${STATUSES.map((s) => counts[s.id] ? `<i style="--w:${(counts[s.id] / total) * 100}%;--c:${s.color}"></i>` : '').join('')}</div>`;
}

function countStatuses(doors) {
  const c = Object.fromEntries(STATUSES.map((s) => [s.id, 0]));
  for (const d of doors) {
    const k = d.status || 'not_inspected';
    c[k] = (c[k] || 0) + 1;
  }
  return c;
}

function projectCard(p, doors, coll = '', nLive = 0) {
  const scheme = useScheme(p);
  const c = countStatuses(doors);
  const lc = (id) => statusById[id].short.toLowerCase();
  return `
    <button class="project-card ${nLive ? 'is-live' : ''}" data-id="${p.id}">
      <div class="pc-top">
        <div class="pc-title">${esc(p.site || 'Untitled site')}</div>
        <div class="pc-date">${esc(fmtDate(p.date))}</div>
      </div>
      ${nLive ? `<div class="pc-live"><span class="live-dot" aria-hidden="true"></span>${nLive} live drawing${nLive === 1 ? '' : 's'}</div>` : ''}
      <div class="pc-sub">${esc([p.client, p.address].filter(Boolean).join(' · '))}</div>
      ${p.group || p.workType ? `<div class="pc-tags">${p.workType ? `<span class="pc-type">${esc(p.workType)}</span>` : ''}${p.group ? `<span class="pc-group">${icon('list')} ${esc(p.group)}</span>` : ''}</div>` : ''}
      <div class="pc-scheme">${esc([coll, scheme.name].filter(Boolean).join(' · '))}</div>
      ${doors.length ? statusBar(doors) : ''}
      <div class="pc-counts">
        <span><b>${doors.length}</b> doors</span>
        ${c.fail ? `<span class="dot" style="--c:var(--st-fail)">${c.fail} ${lc('fail')}</span>` : ''}
        ${c.pass ? `<span class="dot" style="--c:var(--st-pass)">${c.pass} ${lc('pass')}</span>` : ''}
        ${c.not_inspected ? `<span class="dot is-hollow" style="--c:var(--st-todo)">${c.not_inspected} to do</span>` : ''}
      </div>
    </button>`;
}

async function editProject(existing) {
  const p = existing || { client: '', site: '', address: '', date: today(), scheme: lists.lastScheme || DEFAULT_SCHEME };
  const cur = schemeById(p.scheme) ? p.scheme : DEFAULT_SCHEME;
  const allProjects = await db.all('projects');
  const groupNames = [...new Set(allProjects.map((x) => x.group).filter(Boolean))].sort();
  const clientNames = [...new Set(allProjects.map((x) => x.client).filter(Boolean))].sort();
  const r = await dialog({
    title: existing ? 'Project details' : 'New project',
    body: `
      <label class="field"><span>Site name</span><input name="site" id="pf-site" required value="${esc(p.site)}" placeholder="e.g. Tearmann Ward, Cavan General"></label>
      <label class="field"><span>Client</span><input name="client" id="pf-client" value="${esc(p.client)}" placeholder="e.g. HSE Estates" list="pf-clients"></label>
      <div class="grid2">
        <label class="field"><span>Group</span><input name="group" id="pf-group" value="${esc(p.group || '')}" placeholder="e.g. Cavan / Monaghan, or Block B" list="pf-groups" autocomplete="off"></label>
        <label class="field"><span>Type of work</span><input name="workType" id="pf-type" value="${esc(p.workType ?? (existing ? '' : 'Fire door inspection'))}" placeholder="e.g. Fire damper check" list="pf-types" autocomplete="off"></label>
      </div>
      <datalist id="pf-groups">${groupNames.map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist>
      <datalist id="pf-types">${(lists.workTypes || DEFAULT_WORK_TYPES).map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist>
      <datalist id="pf-clients">${clientNames.map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist>
      <label class="field"><span>Address</span><input name="address" id="pf-address" value="${esc(p.address)}" placeholder="Town, county / Eircode"></label>
      <label class="field"><span>Inspection date</span><input type="date" name="date" id="pf-date" value="${esc(p.date)}"></label>
      <label class="field"><span>Fire alarm zones (one per line: number, name)</span>
        <textarea name="zones" id="pf-zones" rows="4" placeholder="1, Main entrance\n2, East wing ground floor\n3, Stair core">${esc(zonesToText(p.zones))}</textarea>
        <small class="muted">Typing a zone number on a door fills in its name. New zones typed on doors are added here.</small></label>
      <fieldset class="scheme-set">
        <legend>Status scheme</legend>
        ${allSchemes().map((sc) => `
          <label class="scheme-opt">
            <input type="radio" name="scheme" value="${sc.id}" ${sc.id === cur ? 'checked' : ''}>
            <span><b>${esc(sc.name)}</b><small>${esc(sc.hint)}</small></span>
          </label>`).join('')}
        <small class="muted">Make your own wording in Settings → Status schemes.</small>
      </fieldset>`,
    buttons: [{ label: 'Cancel', value: false }, { label: existing ? 'Save' : 'Create project', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return null;
  const { zones: zonesRaw, ...form } = r.data;
  const rec = await db.put('projects', { ...p, ...form, zones: parseZones(zonesRaw), id: p.id || db.uid(), nextPin: p.nextPin || 1 });
  if (r.data.scheme && r.data.scheme !== lists.lastScheme) await saveLists({ lastScheme: r.data.scheme });
  const wt = (r.data.workType || '').trim();
  if (wt && !(lists.workTypes || DEFAULT_WORK_TYPES).includes(wt)) await saveLists({ workTypes: [...(lists.workTypes || DEFAULT_WORK_TYPES), wt] });
  if (!existing) go({ view: 'project', projectId: rec.id, tab: 'plans' });
  else refresh();
  return rec;
}

async function loadDemo() {
  const b = busy('Creating demo project…');
  try {
    const project = await db.put('projects', {
      id: db.uid(), site: 'DEMO – Rosewood Nursing Home', client: 'Example client', address: 'Bailieborough, Co. Cavan', date: today(), nextPin: 1, demo: true, scheme: 'passfail', group: 'Demo – Cavan', workType: 'Fire door inspection',
    });
    const canvas = drawDemoPlan();
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    const thumb = await thumbFromCanvas(canvas);
    const plan = await db.put('plans', { id: db.uid(), projectId: project.id, name: 'Ground floor', blob, thumb, width: canvas.width, height: canvas.height, order: 0 });
    const demoDoors = [
      { x: 0.15, y: 0.44, ref: 'GF-01', location: 'Bedroom 1', status: 'pass', doorType: 'FD30S (EI 30-Sa)' },
      { x: 0.36, y: 0.44, ref: 'GF-02', location: 'Bedroom 2', status: 'fail', doorType: 'FD30S (EI 30-Sa)', defects: [0, 4] },
      { x: 0.57, y: 0.44, ref: 'GF-03', location: 'Day room', status: 'fail', doorType: 'FD30S (EI 30-Sa)', defects: [3, 7, 18] },
      { x: 0.73, y: 0.44, ref: 'GF-04', location: 'Store', status: 'no_access', doorType: 'FD30 (EI 30)' },
      { x: 0.19, y: 0.56, ref: 'GF-05', location: 'Kitchen', status: 'repaired', doorType: 'FD60S (EI 60-Sa)' },
      { x: 0.42, y: 0.56, ref: 'GF-06', location: 'Dining', status: 'not_inspected', doorType: '' },
      { x: 0.835, y: 0.44, ref: 'GF-08', location: 'Office', status: 'na', doorType: 'Non-rated' },
      { x: 0.875, y: 0.56, ref: 'GF-07', location: 'Stair core', status: 'fail', doorType: 'FD60S (EI 60-Sa)', defects: [1, 9] },
    ];
    let n = 1;
    for (const d of demoDoors) {
      await db.put('doors', {
        id: db.uid(), projectId: project.id, planId: plan.id, pinNo: n++, x: d.x, y: d.y, ref: d.ref, location: d.location,
        status: d.status, doorType: d.doorType, leaf: 'Single leaf',
        defects: (d.defects || []).map((i) => ({ ...DEFAULT_DEFECTS[i], qty: 1 })),
        actions: d.defects ? ['Repair / upgrade on site'] : [],
        checks: ['not_inspected', 'no_access', 'na'].includes(d.status) ? {} : Object.fromEntries(DEFAULT_QUESTIONS.map((q, i) => [q.id, { text: q.text, answer: d.defects && i % 3 === 1 ? 'fail' : 'pass' }])),
        materials: d.defects ? [{ id: db.uid(), name: 'Intumescent + smoke seal 15 × 4 mm (2.1 m) — example price', unit: 'length', qty: 3, cost: 6.5 }] : [],
        notes: '', inspectedOn: d.status === 'not_inspected' ? '' : today(), inspectedBy: 'Demo',
      });
    }
    await db.put('projects', { ...project, nextPin: n });
    b.done();
    go({ view: 'project', projectId: project.id, tab: 'plans' });
  } catch (e) {
    b.done();
    toast(e.message, 'error');
  }
}

// ---------- Project screen ----------
async function renderProject() {
  const project = await db.get('projects', state.projectId);
  if (!project) return go({ view: 'projects' }, { replace: true });
  useScheme(project);
  const allPlans = await db.projectPlans(project.id);
  const allDoors = await db.projectDoors(project.id);
  const files = await projectFiles(project.id);
  const tab = state.tab || 'plans';
  const colls = listCollections(allPlans);
  const coll = activeCollection(project, allPlans, state.coll);
  const plans = plansIn(allPlans, coll);
  const planIds = new Set(plans.map((p) => p.id));
  const doors = allDoors.filter((d) => planIds.has(d.planId) || (!d.planId && inColl(d.collection || '', coll)));
  state.curColl = coll;
  state.collText = colls.length > 1 ? (coll === '*' ? 'All collections' : collLabel(coll)) : '';

  app.innerHTML = `
    <header class="bar">
      <button class="icon-btn" id="back" aria-label="Back">${icon('back')}</button>
      <div class="bar-title"><b>${esc(project.site || 'Untitled site')}</b><small>${esc([project.client, fmtDate(project.date)].filter(Boolean).join(' · '))}</small></div>
      <button class="icon-btn" id="proj-edit" aria-label="Project details">${icon('more')}</button>
    </header>
    <nav class="tabs" role="tablist">
      ${[['plans', 'Plans', allPlans.length], ['doors', 'Doors', doors.length], ['repairs', 'Repairs', ''], ['files', 'Files', files.length || ''], ['export', 'Export', '']].map(([id, label, n]) =>
        `<button role="tab" class="tab ${tab === id ? 'is-on' : ''}" data-tab="${id}" aria-selected="${tab === id}">${label}${n !== '' ? ` <span class="tab-n">${n}</span>` : ''}</button>`).join('')}
    </nav>
    <main class="page" id="tab-body"></main>
  `;
  if (liveKeys(project).length) noteWeather(project.id);
  $('#back').onclick = back;
  $('#proj-edit').onclick = () => editProject(project);
  $$('.tab').forEach((t) => (t.onclick = () => go({ ...state, tab: t.dataset.tab }, { replace: true })));
  const body = $('#tab-body');
  if (tab === 'plans') return renderPlansTab(body, project, allPlans, allDoors, coll);
  if (tab === 'files') return renderFilesTab(body, project, files, { plans: allPlans });
  // Doors and Export work on one collection at a time (or all)
  body.innerHTML = '<div id="coll-bar"></div><div id="tab-inner"></div>';
  if (colls.length > 1) {
    $('#coll-bar').innerHTML = `
      <label class="coll-bar">${icon('plan')}<span>Collection</span>
        <select id="coll-sel">
          ${collOptions(colls, coll)}
          <option value="*" ${coll === '*' ? 'selected' : ''}>All collections</option>
        </select>
      </label>`;
    $('#coll-sel').onchange = (e) => pickCollection(project, e.target.value);
  }
  if (tab === 'doors') renderDoorsTab($('#tab-inner'), project, plans, doors);
  else if (tab === 'repairs') renderRepairsTab($('#tab-inner'), project, plans, doors);
  else renderExportTab($('#tab-inner'), project, plans, doors);
}

// ---------- Start / End service bar (project screen) ----------
const fmtWhen = (iso) => new Date(iso).toLocaleString('en-IE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const planSvcName = (plan) => [plan.collection ? collLabel(plan.collection) : '', plan.name].filter(Boolean).join(' › ');

// Status and button for one drawing's service. `full` adds Reopen (Export tab).
// Time on the job, shown only in the app (never in reports or exports).
// Tap it for the dated log of every work session.
function timerChip(project, key) {
  const sv = project.services?.[key];
  if (!sv) return '';
  const closed = sessionsOf(sv).filter((x) => x.end).reduce((t, x) => t + (Date.parse(x.end) - Date.parse(x.start)), 0);
  const open = sessionsOf(sv).find((x) => !x.end)?.start || '';
  return `<button type="button" class="svc-timer svc-act" data-act="time" data-plan="${esc(key.slice(5))}" data-base="${closed}" data-open="${esc(open)}" title="Time on this job (only you see this)">⏱ <b>${fmtJobTime(elapsedMs(sv))}</b></button>`;
}
setInterval(() => {
  for (const el of document.querySelectorAll('.svc-timer[data-base]')) {
    const open = el.dataset.open ? Date.now() - Date.parse(el.dataset.open) : 0;
    const b = el.querySelector('b');
    if (b) b.textContent = fmtJobTime(Number(el.dataset.base) + open);
  }
}, 20000);

// The dated time log for a service; times can be corrected (e.g. forgot to pause)
async function timeLog(project, plan, after) {
  const key = planKey(plan.id);
  const p = await db.get('projects', project.id);
  const sv = p.services?.[key];
  if (!sv) return;
  const ss = sessionsOf(sv);
  const local = (iso) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const byDay = {};
  for (const x of ss) {
    const day = x.start.slice(0, 10);
    byDay[day] = (byDay[day] || 0) + Math.max(0, (x.end ? Date.parse(x.end) : Date.now()) - Date.parse(x.start));
  }
  const r = await dialog({
    title: 'Time on this job',
    body: `
      <p class="lib-note">${icon('shield')}<span>Only you see this. It is never put in reports, exports or the client copy.</span></p>
      <p><b>${esc(planSvcName(plan))}</b> · total <b>${fmtJobTime(elapsedMs(sv))}</b> over ${Object.keys(byDay).length} day${Object.keys(byDay).length === 1 ? '' : 's'}</p>
      <div class="tl-days">${Object.entries(byDay).map(([d, ms]) => `<span>${esc(new Date(d + 'T12:00').toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short' }))} <b>${fmtJobTime(ms)}</b></span>`).join('')}</div>
      <div class="tl-list">${ss.map((x, i) => `
        <div class="tl-row" data-i="${i}">
          <label class="field"><span>Started</span><input type="datetime-local" name="s${i}" value="${local(x.start)}"></label>
          <label class="field"><span>${x.end ? 'Stopped' : 'Running now'}</span><input type="datetime-local" name="e${i}" value="${local(x.end)}" ${x.end ? '' : 'placeholder="still running"'}></label>
          <b class="tl-dur">${fmtJobTime(Math.max(0, (x.end ? Date.parse(x.end) : Date.now()) - Date.parse(x.start)))}</b>
          <button type="button" class="icon-btn sm tl-del" aria-label="Remove this session">${icon('trash')}</button>
        </div>`).join('')}</div>
      <p class="muted small">Correct any time here, e.g. if you forgot to pause at the end of a day.</p>`,
    buttons: [{ label: 'Close', value: false }, { label: 'Save changes', value: true, kind: 'primary' }],
    onOpen: (form) => {
      $$('.tl-del', form).forEach((b) => (b.onclick = () => { b.closest('.tl-row').remove(); }));
    },
  });
  if (r.value !== true) return;
  const rows = [...new Set(Object.keys(r.data).map((k) => k.slice(1)))];
  const next = rows.map((i) => {
    const st = r.data['s' + i];
    const en = r.data['e' + i];
    return st ? { start: new Date(st).toISOString(), end: en ? new Date(en).toISOString() : null } : null;
  }).filter(Boolean).sort((a, b) => a.start.localeCompare(b.start));
  // only the newest session can still be running
  next.forEach((x, i) => { if (!x.end && i < next.length - 1) x.end = next[i + 1].start; });
  await saveSessions(project.id, key, next);
  toast('Time log saved');
  after?.();
}

function svcControls(project, plan, full = false) {
  const key = planKey(plan.id);
  const co = project.closeouts?.[key];
  const sv = project.services?.[key];
  if (co) {
    return `<span class="svc-chip is-closed">${icon('check')} Closed ${esc(fmtDate(co.closedAt.slice(0, 10)))}</span>
      ${co.reportFileId ? `<button class="btn sm svc-act" data-act="report" data-plan="${plan.id}">${icon('report')} Report</button>` : ''}
      ${full ? `<button class="btn ghost sm svc-act" data-act="reopen" data-plan="${plan.id}">Reopen</button>` : ''}`;
  }
  if (sv) {
    const run = isRunning(sv);
    return `<span class="svc-chip ${run ? 'is-live' : 'is-paused'}">${run ? '<span class="live-dot" aria-hidden="true"></span> Live' : '⏸ Paused'}</span>
      ${timerChip(project, key)}
      <button class="btn sm svc-act" data-act="${run ? 'pause' : 'resume'}" data-plan="${plan.id}">${run ? '⏸ Pause' : icon('play') + ' Resume'}</button>
      <button class="btn primary sm svc-act" data-act="end" data-plan="${plan.id}">${icon('check')} End service</button>`;
  }
  return `<button class="btn sm svc-act" data-act="start" data-plan="${plan.id}">${icon('play')} Start service</button>`;
}

function bindSvc(root, project, plans, after = refresh) {
  $$('.svc-act', root).forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    const plan = plans.find((x) => x.id === b.dataset.plan);
    if (!plan) return;
    const key = planKey(plan.id);
    const fresh = await db.get('projects', project.id);
    if (b.dataset.act === 'start') {
      await startService(project.id, key, lists.inspector);
      toast(`Service started: ${plan.name}`);
      await after();
      try {
        const doors = await db.projectDoors(project.id);
        const day = await recordWeather(project.id, doors, phoneFix, { force: true });
        const w = day && weatherDays({ weatherLog: { [todayDublin()]: day } }, [todayDublin()])[0];
        if (w && weatherLine(w)) toast("Today's weather recorded: " + weatherLine(w));
      } catch (err) {
        toast('Weather not recorded yet: ' + (/fetch|network|load failed/i.test(err.message) ? 'no internet' : err.message));
      }
    } else if (b.dataset.act === 'pause') {
      await pauseService(project.id, key);
      toast(`Paused. ${fmtJobTime(elapsedMs((await db.get('projects', project.id)).services[key]))} so far; Resume when you're back`);
      after();
    } else if (b.dataset.act === 'resume') {
      await resumeService(project.id, key);
      toast('Resumed: the timer carries on from where you left off');
      after();
      noteWeather(project.id);
    } else if (b.dataset.act === 'time') {
      if (!priced() && !(await unlockOwner())) return;
      await timeLog(fresh, plan, after);
    } else if (b.dataset.act === 'end') {
      const doors = (await db.byIndex('doors', 'planId', plan.id)).sort((a, c) => (a.pinNo || 0) - (c.pinNo || 0));
      await closeService(fresh, plan, doors);
      after();
    } else if (b.dataset.act === 'report') {
      const f = await db.get('files', fresh.closeouts?.[key]?.reportFileId);
      if (!f) return toast('The report file was deleted from Files', 'error');
      openFile(f).catch((err) => toast(err.message, 'error'));
    } else if (b.dataset.act === 'reopen') {
      if (!(await confirmBox('Reopen this service?', 'Your end-of-service answers are kept so you can end it again. The report already saved in Files stays there.', 'Reopen', false))) return;
      await reopenService(project.id, key);
      toast('Service reopened');
      after();
    }
  }));
}

// ---------- Weather recorded on site ----------
const phoneFix = () => (lists.gps !== false ? getPosition({ timeout: 8000, maxAge: 10 * 60e3 }) : Promise.resolve(null));
// Called when working on a project: quietly records today's weather (every 3 h at most)
function noteWeather(projectId) {
  if (!navigator.onLine) return;
  db.get('projects', projectId).then((p) => (p && liveKeys(p).length ? db.projectDoors(projectId) : Promise.reject())).then((doors) => recordWeather(projectId, doors, phoneFix)).catch(() => {});
}

// ---------- End of service close-out ----------
async function closeService(project, plan, doors) {
  const key = planKey(plan.id);
  const plans = [plan];
  const name = planSvcName(plan);
  const questions = closeQuestions(lists);
  const p0 = await db.get('projects', project.id);
  const draft = { answers: {}, declIds: [], reason: '', weather: null, closedBy: lists.inspector || '', ...(p0.closeDrafts?.[key] || {}) };
  const svc = serviceOf(p0, key);
  const dates = [...new Set([...sessionsOf(svc).map((x) => x.start.slice(0, 10)), ...doors.map((d) => d.inspectedOn).filter(Boolean)])].sort();
  if (!dates.length) dates.push(todayDublin());
  const declFiles = (await Promise.all((draft.declIds || []).map((id) => db.get('files', id)))).filter(Boolean);
  let weather = draft.weather;
  const thumbUrls = [];
  const declHtml = () => declFiles.map((f) => {
    const u = URL.createObjectURL(f.thumb || f.blob);
    thumbUrls.push(u);
    return `<span class="co-decl"><img src="${u}" alt="Declaration sheet"><button type="button" class="co-decl-x" data-id="${f.id}" aria-label="Remove photo">${icon('close')}</button></span>`;
  }).join('');
  const wxRows = () => dates.map((d) => {
    const w = weather?.days?.find((x) => x.date === d);
    return `<label class="co-wx"><span>${esc(new Date(d + 'T12:00').toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short' }))}</span>
      <input name="wx_${d}" value="${esc(w ? weatherLine(w) : '')}" placeholder="e.g. Dry, 8–12 °C, light wind"></label>`;
  }).join('');

  const saveDraft = async (data) => {
    const answers = {};
    questions.forEach((q, i) => {
      if (data['q' + i] || data['n' + i]) answers[q] = { a: data['q' + i] || '', note: (data['n' + i] || '').trim() };
    });
    const p = await db.get('projects', project.id);
    const d = { answers, declIds: declFiles.map((f) => f.id), reason: (data.reason || '').trim(), weather: collectWeather(data), closedBy: (data.closedBy || '').trim() };
    await db.put('projects', { ...p, closeDrafts: { ...(p.closeDrafts || {}), [key]: d } });
    return d;
  };
  const collectWeather = (data) => {
    if (!weather && !dates.some((d) => data['wx_' + d])) return null;
    return {
      ...(weather || {}),
      days: dates.map((d) => {
        const auto = weather?.days?.find((x) => x.date === d);
        const typed = (data['wx_' + d] || '').trim();
        if (auto && typed === weatherLine({ ...auto, manual: '' })) return { ...auto, manual: '' };
        return { ...(auto || { date: d }), manual: typed };
      }),
    };
  };

  const r = await dialog({
    title: 'End of service',
    body: `
      <p><b>${esc(name)}</b> · ${doors.length} door${doors.length === 1 ? '' : 's'} · inspected ${esc(dates.map((d) => fmtDate(d)).join(', '))}. Answer every question to close.</p>
      <div class="co-qs">
        ${questions.map((q, i) => {
          const a = draft.answers[q] || {};
          return `<fieldset class="co-q"><legend><b>${i + 1}.</b> ${esc(q)}</legend>
            <div class="co-ans">${CLOSE_ANSWERS.map((o) => `<label class="co-opt co-${o.id}"><input type="radio" name="q${i}" value="${o.id}" ${a.a === o.id ? 'checked' : ''} required><span>${o.label}</span></label>`).join('')}</div>
            <input class="co-note" name="n${i}" value="${esc(a.note || '')}" placeholder="Note (optional)">
          </fieldset>`;
        }).join('')}
      </div>
      <h3 class="co-h">${icon('camera')} Signed declaration sheet</h3>
      <div class="co-decls" id="co-decls">${declHtml()}</div>
      <div class="row-btns">
        <label class="btn sm">${icon('camera')} Take photo<input type="file" id="co-cam" accept="image/*" capture="environment" hidden></label>
        <label class="btn ghost sm">${icon('image')} From library<input type="file" id="co-lib" accept="image/*" multiple hidden></label>
      </div>
      <input class="co-valid" id="co-decl-ok" tabindex="-1" aria-hidden="true" required value="${declFiles.length || draft.reason ? 'ok' : ''}">
      <details class="co-nodecl" ${draft.reason ? 'open' : ''}><summary>No signed sheet available?</summary>
        <label class="field"><span>Reason (printed on the report)</span><input name="reason" id="co-reason" value="${esc(draft.reason || '')}" placeholder="e.g. Client not on site; sheet to follow by email"></label></details>
      <h3 class="co-h">${icon('cloud')} Weather on the inspection days</h3>
      <p class="muted small" id="co-wx-status">${weather ? 'From Met Éireann, recorded on site. You can type over any line.' : 'Checking the recorded weather…'}</p>
      <div id="co-wx">${wxRows()}</div>
      <button type="button" class="btn ghost sm" id="co-wx-get">${icon('cloud')} Record today's weather now</button>
      <label class="field"><span>Closed by</span><input name="closedBy" value="${esc(draft.closedBy || lists.inspector || '')}" placeholder="Your name"></label>`,
    buttons: [{ label: 'Save for later', value: false }, { label: 'Close service', value: true, kind: 'primary' }],
    onOpen: (form) => {
      const ok = $('#co-decl-ok', form);
      const setValid = () => {
        const v = declFiles.length || $('#co-reason', form).value.trim();
        ok.value = v ? 'ok' : '';
        ok.setCustomValidity(v ? '' : 'Add a photo of the signed declaration sheet, or give the reason there isn\'t one.');
      };
      setValid();
      $('#co-reason', form).oninput = setValid;
      const redrawDecl = () => {
        $('#co-decls', form).innerHTML = declHtml();
        $$('.co-decl-x', form).forEach((b) => (b.onclick = async () => {
          const i = declFiles.findIndex((f) => f.id === b.dataset.id);
          if (i >= 0) { await db.remove('files', declFiles[i].id); declFiles.splice(i, 1); }
          redrawDecl();
          setValid();
        }));
      };
      redrawDecl();
      const addDecl = async (e) => {
        const list = [...e.target.files];
        e.target.value = '';
        for (const file of list) {
          try {
            const img = await compressImage(file, 2400, 0.85);
            const n = declFiles.length + 1;
            const rec = await addBlob(project.id, img.blob, `Client declaration – ${project.site || 'site'} – ${name} – ${today()}${n > 1 ? ' (' + n + ')' : ''}.jpg`, 'Certificates', { notes: 'Signed end-of-service declaration' });
            declFiles.push(rec);
          } catch (err) {
            toast('Could not use that photo: ' + err.message, 'error');
          }
        }
        redrawDecl();
        setValid();
        await saveDraft(Object.fromEntries(new FormData(form).entries()));
      };
      $('#co-cam', form).onchange = addDecl;
      $('#co-lib', form).onchange = addDecl;
      const getWx = async (force) => {
        const st = $('#co-wx-status', form);
        const today = todayDublin();
        if (dates.includes(today) || force) {
          st.textContent = "Recording today's weather from Met Éireann…";
          try {
            await recordWeather(project.id, doors, phoneFix, { force: !!force });
          } catch (err) {
            st.textContent = (/fetch|network|load failed/i.test(err.message) ? 'No internet, so today\'s weather could not be recorded.' : err.message) + ' ';
          }
        }
        const p = await db.get('projects', project.id);
        const days = weatherDays(p, dates);
        const typed = Object.fromEntries(new FormData(form).entries());
        weather = { place: Object.values(p.weatherLog || {}).find((x) => x.place)?.place || '', source: WEATHER_SOURCE, days: days.map((w) => ({ ...w, manual: weatherLine(w) ? '' : (typed['wx_' + w.date] || '').trim() })) };
        $('#co-wx', form).innerHTML = wxRows();
        const missing = days.filter((w) => !weatherLine(w)).length;
        st.textContent = (st.textContent.endsWith(' ') ? st.textContent : '') + (missing
          ? `${missing} day${missing > 1 ? 's have' : ' has'} no weather recorded on site. Type ${missing > 1 ? 'them' : 'it'} in (e.g. from met.ie).`
          : 'Recorded on site from Met Éireann. You can type over any line.');
      };
      $('#co-wx-get', form).onclick = () => getWx(true);
      if (!weather) getWx(false);
    },
  });
  thumbUrls.forEach((u) => URL.revokeObjectURL(u));
  const d = await saveDraft(r.data);
  if (r.value !== true) {
    if (r.value === false) toast('Close-out saved for later');
    return;
  }
  const b = busy('Closing the service…');
  try {
    const p = await db.get('projects', project.id);
    const closedAt = new Date().toISOString();
    const rec = { startedAt: svc?.startedAt || '', closedAt, closedBy: d.closedBy, coll: name, planId: plan.id, questions, answers: d.answers, declIds: d.declIds, declaration: { reason: declFiles.length ? '' : d.reason }, weather: d.weather };
    b.update('Building the final PDF report…');
    const pdf = await exportProjectPdf(p, lists, { photos: true, passDetail: true, costs: false, doors, plans, filterText: '', returnBlob: true, closeout: { ...rec, declarationBlobs: declFiles.map((f) => f.blob) } }, b.update);
    const stamp = closedAt.slice(0, 10);
    const label = [p.site || p.client || 'Project', rec.coll].filter(Boolean).join(' – ');
    const pdfRec = await addBlob(p.id, pdf.blob, `Closed report – ${label} – ${stamp}.pdf`, 'Reports', { notes: `Final report, service closed ${fmtDate(stamp)}${rec.closedBy ? ' by ' + rec.closedBy : ''}` });
    b.update('Building the Excel workbook…');
    let xlsRec = null;
    try {
      const qs = (lists.questions || []).filter((q) => q.text?.trim() && !q.hidden);
      const xl = await exportProjectXlsx(p, qs, { doors, filterText: '', returnBlob: true });
      xlsRec = await addBlob(p.id, xl.blob, `Closed report – ${label} – ${stamp}.xlsx`, 'Reports', { notes: 'Excel for the closed service' });
    } catch (e) {
      console.warn('Excel not saved', e);
    }
    const p2 = await db.get('projects', project.id);
    const drafts = { ...(p2.closeDrafts || {}) };
    delete drafts[key];
    if (p2.services?.[key]) p2.services = { ...p2.services, [key]: { ...p2.services[key], sessions: sessionsOf(p2.services[key]).map((x) => (x.end ? x : { ...x, end: closedAt })) } };
    await db.put('projects', { ...p2, closeDrafts: drafts, closeouts: { ...(p2.closeouts || {}), [key]: { ...rec, reportFileId: pdfRec.id, excelFileId: xlsRec?.id || null } } });
    b.done();
    toast('Service closed. Report saved in Files › Reports');
  } catch (e) {
    b.done();
    console.error(e);
    toast('Could not close: ' + e.message, 'error');
  }
}

// ---------- Files: certificates, manuals, quotes and other documents ----------
// The same list serves a project's Files tab and "My files", the private
// library (files kept under projectId 'library', never in reports or shared).
const KIND_ICON = { pdf: 'report', image: 'image', video: 'video', sheet: 'sheet', doc: 'file', cad: 'plan', other: 'file' };
const libProject = () => ({ id: LIB, fileFolders: lists.libFolders?.length ? lists.libFolders : DEFAULT_LIB_FOLDERS });

// Where in the project a file is attached: a drawing, a collection, or the whole project
function attachText(x, plans) {
  if (x.planId) {
    const pl = plans.find((p) => p.id === x.planId);
    return pl ? planSvcName(pl) : '';
  }
  if (x.attachColl != null) return collLabel(x.attachColl);
  return '';
}
function attachMatches(x, a, plans) {
  if (!a) return true;
  if (a === 'none') return !x.planId && x.attachColl == null;
  if (a.startsWith('p:')) return x.planId === a.slice(2);
  const c = a.slice(2);
  return x.attachColl === c || (!!x.planId && plans.find((p) => p.id === x.planId)?.collection === c);
}
function attachOptions(plans, cur) {
  const colls = listCollections(plans);
  const named = colls.length > 1 || (colls[0] ?? '') !== '';
  return `<option value="none" ${cur === 'none' ? 'selected' : ''}>Whole project</option>
    ${named ? `<optgroup label="Collection">${colls.map((c) => `<option value="c:${esc(c)}" ${cur === 'c:' + c ? 'selected' : ''}>${esc(collLabel(c))}</option>`).join('')}</optgroup>` : ''}
    ${plans.length ? `<optgroup label="Drawing">${plans.map((p) => `<option value="p:${p.id}" ${cur === 'p:' + p.id ? 'selected' : ''}>${esc(planSvcName(p))}</option>`).join('')}</optgroup>` : ''}`;
}
const attachValue = (x) => (x.planId ? 'p:' + x.planId : x.attachColl != null ? 'c:' + x.attachColl : 'none');
const attachFields = (v) => (v.startsWith('p:') ? { planId: v.slice(2), attachColl: undefined } : v.startsWith('c:') ? { planId: null, attachColl: v.slice(2) } : { planId: null, attachColl: undefined });

function fileRowHtml(x, { showFolder = true, plans = [] } = {}) {
  const k = fileKind(x);
  const at = attachText(x, plans);
  return `<button class="file-row" data-id="${x.id}">
    <span class="file-thumb">${x.thumb ? `<img data-thumb="${x.id}" alt="">` : `<span class="file-ico k-${k}">${icon(KIND_ICON[k])}<small>${esc((x.name.split('.').pop() || '').slice(0, 4).toUpperCase())}</small></span>`}</span>
    <span class="dr-main"><b>${esc(x.name)}</b>
      <small>${esc([showFolder ? x.folder : '', KIND_LABEL[k] + (x.pages > 1 ? ` · ${x.pages} pages` : ''), fmtBytes(x.size), fmtDate(x.createdAt.slice(0, 10))].filter(Boolean).join(' · '))}</small>
      ${at ? `<small class="file-attach">${icon('plan')} ${esc(at)}</small>` : ''}
      ${x.notes ? `<small class="file-note">${esc(x.notes)}</small>` : ''}
    </span>
    <span class="file-more" aria-hidden="true">${icon('more')}</span>
  </button>`;
}
function fillThumbs(root, files) {
  for (const x of files) {
    const img = $(`img[data-thumb="${x.id}"]`, root);
    if (img && x.thumb) { const u = URL.createObjectURL(x.thumb); urls.add(u); img.src = u; }
  }
}

// ctx: { lib, plans, rerender }
function renderFilesTab(body, project, files, ctx = {}) {
  const lib = !!ctx.lib;
  const plans = ctx.plans || [];
  const rerender = ctx.rerender || (() => renderProject());
  const folders = fileFolders(project, files);
  const f = state.fileF || '';
  const a = lib ? '' : state.fileA || '';
  const q = (state.fq || '').toLowerCase();
  const shown = files.filter((x) => (!f || x.folder === f) && attachMatches(x, a, plans) && (!q || [x.name, x.folder, x.notes, attachText(x, plans)].join(' ').toLowerCase().includes(q)));
  const count = (name) => files.filter((x) => x.folder === name).length;
  const anyAttached = files.some((x) => x.planId || x.attachColl != null);
  body.innerHTML = `
    ${lib ? `<p class="lib-note">${icon('shield')}<span>Private to you. Files here never go into reports or to clients. Tap a file and choose <b>Send to a project</b> to put it on a drawing or collection.</span></p>` : ''}
    <div class="row-btns import-row">
      <label class="btn primary sm">${icon('upload')} Add files<input type="file" id="file-add" multiple hidden></label>
      <button class="btn ghost sm" id="file-folders">${icon('folder')} Folders</button>
    </div>
    <div class="chips" role="group" aria-label="Folders">
      <button class="chip ${!f ? 'is-on' : ''}" data-ff="">All <b>${files.length}</b></button>
      ${folders.map((n) => `<button class="chip ${f === n ? 'is-on' : ''}" data-ff="${esc(n)}">${esc(n)} <b>${count(n)}</b></button>`).join('')}
    </div>
    ${!lib && (anyAttached || a) && plans.length ? `<label class="coll-bar">${icon('plan')}<span>Attached to</span>
      <select id="file-attach"><option value="">Anything</option>${attachOptions(plans, a)}</select></label>` : ''}
    ${files.length > 4 ? `<label class="search">${icon('search')}<input id="file-q" type="search" placeholder="Search file names and notes…" value="${esc(state.fq || '')}"></label>` : ''}
    ${files.length ? '' : lib
      ? `<div class="empty-files">${icon('folder')}<p><b>Your own files</b><br>Templates, product data sheets, certificates you reuse, anything you want on hand. Send any of them to a project's drawing or collection when you need it there.</p></div>`
      : `<div class="empty-files">${icon('folder')}<p><b>Keep the project's documents here</b><br>Fire door certificates, O&amp;M manuals, fire cert drawings, quotes, previous reports. They're saved on this phone and open with no signal.</p></div>`}
    <div class="file-list">${shown.map((x) => fileRowHtml(x, { showFolder: !f, plans })).join('')}</div>
    ${files.length && !shown.length ? '<p class="muted pad">No files match.</p>' : ''}
  `;
  fillThumbs(body, shown);
  const again = () => renderFilesTab(body, project, files, ctx);
  $$('.chip', body).forEach((c) => (c.onclick = () => { state.fileF = c.dataset.ff; again(); }));
  $('#file-attach')?.addEventListener('change', (e) => { state.fileA = e.target.value; again(); });
  const qi = $('#file-q');
  if (qi) qi.oninput = () => {
    state.fq = qi.value;
    const pos = qi.selectionStart;
    again();
    const n = $('#file-q');
    n.focus();
    n.setSelectionRange(pos, pos);
  };
  $('#file-add').onchange = async (e) => {
    const list = [...e.target.files];
    e.target.value = '';
    if (!list.length) return;
    const b = busy('Saving files…');
    try {
      const extra = a && a !== 'none' ? attachFields(a) : {};
      const added = await addFiles(project, list, f || null, (m) => b.update(m), extra);
      b.done();
      const where = [...new Set(added.map((x) => x.folder))];
      toast(`${added.length} file${added.length > 1 ? 's' : ''} added to ${where.join(', ')}`);
    } catch (err) {
      b.done();
      toast('Could not save: ' + err.message, 'error');
    }
    rerender();
  };
  $('#file-folders').onclick = async () => {
    const r = await dialog({
      title: lib ? 'My file folders' : 'File folders',
      body: `<label class="field"><span>One folder per line</span>
        <textarea name="folders" rows="9">${esc(fileFolders(project).join('\n'))}</textarea>
        <small class="muted">Rename a folder here and its files move with it (keep it on the same line).</small></label>`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, kind: 'primary' }],
    });
    if (r.value !== true) return;
    const old = fileFolders(project);
    const next = [...new Set(r.data.folders.split('\n').map((x) => x.trim()).filter(Boolean))];
    if (!next.length) return;
    // A line that changed in place is a rename: move its files too
    if (next.length === old.length) {
      for (let i = 0; i < old.length; i++) {
        if (old[i] === next[i] || old.includes(next[i])) continue;
        for (const x of files.filter((y) => y.folder === old[i])) await db.put('files', { ...x, folder: next[i] });
        if (state.fileF === old[i]) state.fileF = next[i];
      }
    }
    if (lib) await saveLists({ libFolders: next });
    else await db.put('projects', { ...(await db.get('projects', project.id)), fileFolders: next });
    rerender();
  };
  $$('.file-row', body).forEach((row) => (row.onclick = () => fileDetails(project, files.find((x) => x.id === row.dataset.id), { ...ctx, rerender })));
}

async function fileDetails(project, rec, ctx = {}) {
  const lib = !!ctx.lib;
  const plans = ctx.plans || [];
  const rerender = ctx.rerender || (() => renderProject());
  const folders = fileFolders(project, [rec]);
  const k = fileKind(rec);
  let thumbUrl = '';
  if (rec.thumb) thumbUrl = URL.createObjectURL(rec.thumb);
  let sent = false;
  const r = await dialog({
    title: lib ? 'My file' : 'File',
    body: `
      ${thumbUrl ? `<img class="file-preview" src="${thumbUrl}" alt="">` : ''}
      <button type="button" class="btn wide" id="fd-open">${icon('eye')} Open ${esc(KIND_LABEL[k].toLowerCase())}</button>
      ${lib ? `<button type="button" class="btn primary wide" id="fd-send">${icon('plan')} Send to a project</button>` : ''}
      <label class="field"><span>Name</span><input name="name" value="${esc(rec.name)}" required></label>
      <label class="field"><span>Folder</span><select name="folder">${folders.map((n) => `<option ${n === rec.folder ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      ${!lib && plans.length ? `<label class="field"><span>Attached to</span><select name="attach">${attachOptions(plans, attachValue(rec))}</select>
        <small class="muted">Files on a drawing also show on that drawing's screen.</small></label>` : ''}
      <label class="field"><span>Notes</span><textarea name="notes" rows="2" placeholder="e.g. Valid until Nov 2027 · Door set 3 to 9">${esc(rec.notes || '')}</textarea></label>
      <p class="muted small">${esc([KIND_LABEL[k], rec.pages > 1 ? rec.pages + ' pages' : '', fmtBytes(rec.size), 'added ' + fmtDate(rec.createdAt.slice(0, 10))].filter(Boolean).join(' · '))}</p>
      <div class="row-btns"><button type="button" class="btn ghost sm" id="fd-dl">${icon('download')} Save a copy</button>
      ${!lib ? `<button type="button" class="btn ghost sm" id="fd-tolib">${icon('folder')} Copy to My files</button>` : ''}
      <button type="button" class="btn ghost sm danger-text" id="fd-del">${icon('trash')} Delete</button></div>`,
    buttons: [{ label: 'Close', value: false }, { label: 'Save', value: true, kind: 'primary' }],
    onOpen: (form) => {
      const closeMe = () => { form.parentElement.remove(); if (thumbUrl) URL.revokeObjectURL(thumbUrl); };
      $('#fd-open', form).onclick = () => openFile(rec).catch((e) => toast(e.message, 'error'));
      $('#fd-dl', form).onclick = () => downloadFile(rec).catch((e) => toast(e.message, 'error'));
      $('#fd-send', form)?.addEventListener('click', async () => {
        const fresh = { ...rec, name: $('[name=name]', form).value.trim() || rec.name, notes: $('[name=notes]', form).value.trim() };
        if (await sendToProject(fresh)) { sent = true; closeMe(); rerender(); }
      });
      $('#fd-tolib', form)?.addEventListener('click', async () => {
        const lp = libProject();
        const folder = fileFolders(lp).includes(rec.folder) ? rec.folder : guessFolder(rec.name, rec.type || '', fileFolders(lp)) || fileFolders(lp)[0];
        const { createdAt, updatedAt, ...rest } = rec;
        await db.put('files', { ...rest, id: db.uid(), projectId: LIB, folder, planId: null, attachColl: undefined });
        toast('Copied to My files');
      });
      $('#fd-del', form).onclick = async () => {
        if (!(await confirmBox('Delete file?', `${rec.name} will be removed from ${lib ? 'My files' : 'this project'}.`))) return;
        await db.remove('files', rec.id);
        closeMe();
        toast('File deleted');
        rerender();
      };
    },
  });
  if (thumbUrl) URL.revokeObjectURL(thumbUrl);
  if (sent || r.value !== true) return;
  const name = r.data.name.trim() || rec.name;
  await db.put('files', { ...rec, name, folder: r.data.folder, notes: r.data.notes.trim(), ...(r.data.attach ? attachFields(r.data.attach) : {}) });
  toast('Saved');
  rerender();
}

// Move (or copy) a file from My files to a project's drawing, collection or the whole project
async function sendToProject(rec) {
  const projects = (await db.all('projects')).sort((a, b) => (a.site || '').localeCompare(b.site || ''));
  if (!projects.length) return toast('Make a project first', 'error'), false;
  const plansOf = async (pid) => db.projectPlans(pid);
  let tPlans = await plansOf(state.projectId && projects.some((p) => p.id === state.projectId) ? state.projectId : projects[0].id);
  const r = await dialog({
    title: 'Send to a project',
    body: `
      <p><b>${esc(rec.name)}</b></p>
      <label class="field"><span>Project</span><select name="pid" id="sp-pid">${projects.map((p) => `<option value="${p.id}" ${tPlans[0]?.projectId === p.id ? 'selected' : ''}>${esc(p.site || 'Untitled site')}${p.client ? ' – ' + esc(p.client) : ''}</option>`).join('')}</select></label>
      <label class="field"><span>Put it on</span><select name="target" id="sp-target"></select></label>
      <label class="field"><span>Folder in the project</span><select name="folder" id="sp-folder"></select></label>
      <label class="check-line"><input type="checkbox" name="keep"> Keep a copy in My files</label>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Send', value: true, kind: 'primary' }],
    onOpen: (form) => {
      const fill = async () => {
        const pid = $('#sp-pid', form).value;
        tPlans = await plansOf(pid);
        const proj = projects.find((p) => p.id === pid);
        $('#sp-target', form).innerHTML = attachOptions(tPlans, tPlans.length === 1 ? 'p:' + tPlans[0].id : 'none');
        const fl = fileFolders(proj);
        const pick = fl.includes(rec.folder) ? rec.folder : guessFolder(rec.name, rec.type || '', fl) || 'Other';
        $('#sp-folder', form).innerHTML = fl.map((n) => `<option ${n === pick ? 'selected' : ''}>${esc(n)}</option>`).join('');
      };
      $('#sp-pid', form).onchange = fill;
      fill();
    },
  });
  if (r.value !== true) return false;
  const moved = { ...rec, projectId: r.data.pid, folder: r.data.folder || 'Other', ...attachFields(r.data.target || 'none') };
  if (r.data.keep) {
    const { createdAt, updatedAt, ...rest } = moved;
    await db.put('files', { ...rest, id: db.uid() });
  } else {
    await db.put('files', moved);
  }
  const proj = projects.find((p) => p.id === r.data.pid);
  const pl = tPlans.find((p) => 'p:' + p.id === r.data.target);
  toast(`${r.data.keep ? 'Copied' : 'Moved'} to ${proj.site || 'project'}${pl ? ' › ' + pl.name : r.data.target?.startsWith('c:') ? ' › ' + collLabel(r.data.target.slice(2)) : ''}`);
  return true;
}

// ---------- My files: private library with an optional PIN ----------
let libUnlocked = false;
// Owner lock: with an Owner PIN set, prices, costs, totals and time on the
// job are hidden until the PIN is entered. It locks again when the app is
// closed or put in the background. With no PIN, everything shows.
const priced = () => !lists?.libPin || libUnlocked;
async function unlockOwner() {
  if (!lists.libPin) return true;
  const r = await dialog({
    title: 'Owner PIN',
    body: '<p>Enter your PIN to show prices, costs and time on the job.</p><label class="field"><span>PIN</span><input name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" required></label>',
    buttons: [{ label: 'Cancel', value: false }, { label: 'Unlock', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return false;
  if ((await pinHash(r.data.pin)) !== lists.libPin) { toast('Wrong PIN', 'error'); return false; }
  libUnlocked = true;
  toast('Unlocked: prices showing');
  refresh();
  return true;
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && lists?.libPin) {
    libUnlocked = false;
    refresh();
  }
});
async function pinHash(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fscf-files:' + pin));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function renderLibrary() {
  const locked = lists.libPin && !libUnlocked;
  app.innerHTML = `
    <header class="bar">
      <button class="icon-btn" id="back" aria-label="Back">${icon('back')}</button>
      <div class="bar-title"><b>My files</b><small>Private · only on this phone${lists.libPin ? ' · PIN locked' : ''}</small></div>
      <button class="icon-btn" id="lib-lock" aria-label="PIN lock">${icon('shield')}</button>
    </header>
    <main class="page" id="lib-body"></main>`;
  $('#back').onclick = back;
  $('#lib-lock').onclick = () => libPinMenu();
  const body = $('#lib-body');
  if (locked) {
    body.innerHTML = `
      <form class="lib-lockbox" id="lib-unlock">
        <span class="lib-lock-ico">${icon('shield')}</span>
        <h2 class="h2">My files are locked</h2>
        <label class="field"><span>PIN</span><input id="lib-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" required></label>
        <button class="btn primary" type="submit">Unlock</button>
      </form>`;
    setTimeout(() => $('#lib-pin')?.focus(), 50);
    $('#lib-unlock').onsubmit = async (e) => {
      e.preventDefault();
      if ((await pinHash($('#lib-pin').value)) === lists.libPin) {
        libUnlocked = true;
        renderLibrary();
      } else {
        toast('Wrong PIN', 'error');
        $('#lib-pin').value = '';
      }
    };
    return;
  }
  const files = await projectFiles(LIB);
  renderFilesTab(body, libProject(), files, { lib: true, rerender: renderLibrary });
}

async function libPinMenu(fromSettings = false) {
  const has = !!lists.libPin;
  if (has && !libUnlocked) return toast('Unlock with your PIN first');
  const r = await dialog({
    title: has ? 'Owner PIN' : 'Set an owner PIN',
    body: `
      <p>${has ? 'Your prices, costs, time on the job and My files ask for this PIN each time the app is opened or switched back to.' : 'Hide your prices, costs, time on the job and My files behind a PIN, e.g. if someone else uses this phone or app.'}</p>
      <label class="field"><span>${has ? 'New PIN (to change it)' : 'PIN (4 to 8 digits)'}</span><input name="pin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" pattern="[0-9]{4,8}" ${has ? '' : 'required'}></label>
      <label class="field"><span>Type it again</span><input name="pin2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" ${has ? '' : 'required'}></label>
      <p class="muted small">If you forget it, the files can't be shown. Keep a backup (Settings › Backup).</p>`,
    buttons: has
      ? [{ label: 'Close', value: false }, { label: 'Remove PIN', value: 'remove' }, { label: 'Lock now', value: 'lock' }, { label: 'Change PIN', value: true, kind: 'primary' }]
      : [{ label: 'Cancel', value: false }, { label: 'Set PIN', value: true, kind: 'primary' }],
  });
  if (r.value === 'lock') { libUnlocked = false; return fromSettings ? null : renderLibrary(); }
  if (r.value === 'remove') {
    if (!(await confirmBox('Remove the PIN?', 'My files will open without a PIN.', 'Remove', false))) return;
    await saveLists({ libPin: '' });
    toast('PIN removed');
    return fromSettings ? null : renderLibrary();
  }
  if (r.value !== true) return;
  const { pin, pin2 } = r.data;
  if (!/^\d{4,8}$/.test(pin || '')) return toast('Use 4 to 8 digits', 'error');
  if (pin !== pin2) return toast("The two PINs don't match", 'error');
  await saveLists({ libPin: await pinHash(pin) });
  libUnlocked = true;
  toast('PIN set');
  if (!fromSettings) renderLibrary();
}

// Files attached to one drawing (or its collection), shown on the drawing screen
async function drawingFiles(project, plan) {
  const all = await projectFiles(project.id);
  const mine = all.filter((x) => x.planId === plan.id || (x.attachColl != null && !x.planId && x.attachColl === (plan.collection || '')));
  const plans = await db.projectPlans(project.id);
  let wrapEl = null;
  const r = await dialog({
    title: `Files · ${plan.name}`,
    body: `
      ${mine.length ? `<div class="file-list">${mine.map((x) => fileRowHtml(x, { plans })).join('')}</div>`
        : '<p>No files on this drawing yet. Add them here, or send them from <b>My files</b> or the project\'s Files tab.</p>'}
      <label class="btn sm">${icon('upload')} Add files to this drawing<input type="file" id="df-add" multiple hidden></label>`,
    buttons: [{ label: 'Close', value: false }],
    onOpen: (form) => {
      wrapEl = form.parentElement;
      fillThumbs(form, mine);
      const reopen = () => { wrapEl.remove(); drawingFiles(project, plan); refreshPlanFiles(project, plan); };
      $$('.file-row', form).forEach((row) => (row.onclick = () => {
        wrapEl.remove();
        fileDetails(project, mine.find((x) => x.id === row.dataset.id), { plans, rerender: () => { drawingFiles(project, plan); refreshPlanFiles(project, plan); } });
      }));
      $('#df-add', form).onchange = async (e) => {
        const list = [...e.target.files];
        e.target.value = '';
        if (!list.length) return;
        const b = busy('Saving files…');
        try {
          await addFiles(project, list, null, (m) => b.update(m), { planId: plan.id });
          b.done();
          toast(`${list.length} file${list.length > 1 ? 's' : ''} added to ${plan.name}`);
        } catch (err) {
          b.done();
          toast('Could not save: ' + err.message, 'error');
        }
        reopen();
      };
    },
  });
  return r;
}
async function refreshPlanFiles(project, plan) {
  const el = $('#plan-files-n');
  if (!el) return;
  const all = await projectFiles(project.id);
  const n = all.filter((x) => x.planId === plan.id || (x.attachColl != null && !x.planId && x.attachColl === (plan.collection || ''))).length;
  el.textContent = n || '';
  el.hidden = !n;
}

// ---------- Repairs: remedial works list for the repairer ----------
function renderRepairsTab(body, project, plans, doors) {
  const instructions = project.remedialText ?? lists.remedialText ?? DEFAULT_REMEDIAL_TEXT;
  const ack = project.remedialAck;
  const show = state.repShow || 'outstanding';
  const planName = Object.fromEntries(plans.map((p) => [p.id, p.name]));
  const planById = Object.fromEntries(plans.map((p) => [p.id, p]));
  const prog = projectProgress(doors);
  const withWork = doors.map((d) => ({ d, p: remedialProgress(d) })).filter(({ p }) => p.total);
  const FILTERS = {
    outstanding: ['Outstanding', ({ p }) => !p.complete],
    awaiting: ['Awaiting verification', ({ p }) => p.awaiting > 0],
    verified: ['Verified', ({ p }) => p.allVerified],
    all: ['All', () => true],
  };
  const shown = withWork.filter((FILTERS[show] || FILTERS.outstanding)[1]);
  const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  body.innerHTML = `
    <section class="panel rep-intro">
      <div class="block-head"><h2 class="h2">${icon('shield')} Instructions for the repairer</h2>
        <button class="btn ghost sm" id="rep-reset">Use default wording</button></div>
      <label class="field"><span>Shown at the top of the repair list and the printed sheet. Change it for this project, e.g. the standard to repair to and the competencies required.</span>
        <textarea id="rep-text" rows="7">${esc(instructions)}</textarea></label>
      <div class="rep-ack ${ack ? 'is-done' : ''}">
        <label class="rep-check"><input type="checkbox" id="rep-ack" ${ack ? 'checked' : ''}>
          <span><b>I have read these instructions and have the competencies required to carry out these repairs</b>
          ${ack ? `<small>Confirmed by ${esc(ack.by || 'unknown')} on ${esc(when(ack.at))}</small>` : ''}</span></label>
        ${ack ? (ack.sig
          ? `<div class="sig-show"><img alt="Signature of ${esc(ack.by)}" src="${ack.sig.data}"><span><small>Repairer's signature</small></span><button class="btn ghost sm" id="rep-sign">Sign again</button></div>`
          : '<div class="row-btns"><button class="btn sm" id="rep-sign">' + icon('pencil') + ' Add repairer\'s signature</button></div>') : ''}
        ${ack ? '' : `<label class="field"><span>Repairer's name</span><input id="rep-name" value="${esc(lists.inspector || '')}" placeholder="Name of the person doing the repairs"></label>`}
      </div>
    </section>

    <section class="panel rep-summary">
      <div class="rep-bar"><i style="--w:${prog.items ? (prog.done / prog.items) * 100 : 0}%"></i></div>
      <p><b>${prog.done} of ${prog.items}</b> repair items done · <b>${prog.verified}</b> verified · <b>${prog.doorsDone} of ${prog.doorsWith}</b> doors complete (${prog.doorsVerified} verified)</p>
      <div class="rep-bar verify"><i style="--w:${prog.items ? (prog.verified / prog.items) * 100 : 0}%"></i></div>
      <div class="row-btns">
        <button class="btn primary sm" id="rep-pdf">${icon('download')} Repair sheet for repairer (PDF)</button>
        <button class="btn sm" id="rep-report">${icon('report')} Completion report (PDF)</button>
        <button class="btn sm" id="rep-xlsx">${icon('sheet')} Repairs (Excel)</button>
      </div>
      <div class="row-btns rep-price">
        <span class="rf-label">For a subcontractor to price</span>
        <button class="btn sm" id="price-xlsx">${icon('sheet')} Pricing sheet (Excel)</button>
        <button class="btn ghost sm" id="price-pdf">${icon('download')} Pricing sheet (PDF)</button>
      </div>
      <p class="muted small rep-out-note">These cover the doors shown below (${esc((FILTERS[show] || FILTERS.outstanding)[0].toLowerCase())}). Choose <b>All</b> to include every door with repairs.</p>
    </section>

    <div class="chips" role="group" aria-label="Show">
      ${Object.entries(FILTERS).map(([id, [label, fn]]) =>
        `<button class="chip rep-show ${show === id ? 'is-on' : ''}" data-s="${id}">${label} <b>${withWork.filter(fn).length}</b></button>`).join('')}
    </div>
    ${withWork.length ? '' : '<p class="muted pad">No remedial works yet. Defects and recommended actions recorded on doors appear here as a tick list.</p>'}
    ${shown.map(({ d, p }) => {
      const st = statusById[d.status || 'not_inspected'];
      return `
      <section class="rep-door ${p.complete ? 'is-complete' : ''}" data-id="${d.id}">
        <div class="rep-head">
          <span class="pin-badge ${st.id === 'not_inspected' ? 'is-hollow' : ''}" style="--pin:${st.color}">${d.pinNo ?? ''}</span>
          <span class="rep-title"><b>${esc(d.ref || 'Door ' + d.pinNo)}${d.location ? ` <span class="muted">· ${esc(d.location)}</span>` : ''}</b>
            <small>${esc([d.doorType, d.zoneNo ? 'Zone ' + d.zoneNo : '', planName[d.planId] || (d.planId ? '' : 'Not on a drawing')].filter(Boolean).join(' · '))}</small></span>
          <span class="rep-count">${p.done}/${p.total}${p.verified ? `<small class="rep-vcount">${icon('shield')} ${p.verified}</small>` : ''}</span>
        </div>
        ${d.planId && planById[d.planId] ? `<img class="rep-map" alt="Location of pin ${d.pinNo} on ${esc(planName[d.planId] || 'the drawing')}" data-door="${d.id}">` : ''}
        <ul class="rep-items">
          ${p.items.map((it) => {
            const r = d.remedials?.[it.key];
            return `<li><label class="rep-check ${r?.done ? 'is-done' : ''}"><input type="checkbox" class="rep-tick" data-key="${esc(it.key)}" ${r?.done ? 'checked' : ''}>
              <span><b>${esc(it.text)}${it.qty ? ` (×${it.qty})` : ''}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}${r?.done ? `<small class="rep-by">Done by ${esc(r.by || 'unknown')} · ${esc(when(r.at))}</small>` : ''}${r?.verified ? `<small class="rep-ver">Verified by ${esc(r.vby || 'unknown')} · ${esc(when(r.vat))}</small>` : ''}</span></label>
              ${r?.done ? `<label class="ver-check ${r.verified ? 'is-on' : ''}"><input type="checkbox" class="ver-tick" data-key="${esc(it.key)}" ${r.verified ? 'checked' : ''}>${icon('shield')} Verified</label>` : ''}</li>`;
          }).join('')}
        </ul>
        <div class="row-btns">
          <button class="btn ghost sm rep-open">Open door</button>
          ${p.awaiting ? `<button class="btn sm rep-verify-all">${icon('shield')} Verify all (${p.awaiting})</button>` : ''}
          ${p.complete && d.status !== 'repaired' && STATUSES.some((s) => s.id === 'repaired') ? `<button class="btn sm rep-repaired">${icon('check')} Set status to ${esc(statusById.repaired.label)}</button>` : ''}
        </div>
      </section>`;
    }).join('')}`;

  const saveProject = async (patch) => {
    const cur = await db.get('projects', project.id);
    Object.assign(project, await db.put('projects', { ...cur, ...patch }));
  };
  $('#rep-text').onchange = async (e) => {
    // changing the instructions after they were confirmed asks for confirmation again
    await saveProject({ remedialText: e.target.value, ...(project.remedialAck ? { remedialAck: null } : {}) });
    if (ack) toast('Instructions changed: the repairer needs to confirm them again');
    renderRepairsTab(body, project, plans, doors);
  };
  $('#rep-reset').onclick = async () => {
    await saveProject({ remedialText: lists.remedialText ?? DEFAULT_REMEDIAL_TEXT, remedialAck: null });
    renderRepairsTab(body, project, plans, doors);
  };
  $('#rep-ack').onchange = async (e) => {
    if (e.target.checked) {
      const by = ($('#rep-name')?.value || '').trim();
      if (!by) {
        e.target.checked = false;
        return toast('Enter the repairer\'s name first.', 'error');
      }
      await saveProject({ remedialAck: { by, at: new Date().toISOString() } });
    } else await saveProject({ remedialAck: null });
    renderRepairsTab(body, project, plans, doors);
  };
  $('#rep-sign')?.addEventListener('click', async () => {
    const sig = await signaturePad({ title: "Repairer's signature", name: project.remedialAck?.by || '', askName: false });
    if (!sig) return;
    await saveProject({ remedialAck: { ...project.remedialAck, sig } });
    renderRepairsTab(body, project, plans, doors);
  });
  $$('.rep-show', body).forEach((b) => (b.onclick = () => { state.repShow = b.dataset.s; renderRepairsTab(body, project, plans, doors); }));
  $$('.rep-door', body).forEach((sec) => {
    const id = sec.dataset.id;
    $$('.rep-tick', sec).forEach((cb) => (cb.onchange = async () => {
      const d = await db.get('doors', id);
      const remedials = { ...(d.remedials || {}) };
      remedials[cb.dataset.key] = cb.checked ? { done: true, by: lists.inspector || project.remedialAck?.by || '', at: new Date().toISOString() } : { done: false, verified: false };
      const saved = await saveDoor({ ...d, remedials });
      Object.assign(doors.find((x) => x.id === id), saved);
      renderRepairsTab(body, project, plans, doors);
    }));
    const verify = async (keys, on) => {
      const d = await db.get('doors', id);
      const remedials = { ...(d.remedials || {}) };
      let who = '';
      if (on) {
        who = await askVerifier(keys.map((k) => remedials[k]?.by).filter(Boolean));
        if (!who) return renderRepairsTab(body, project, plans, doors);
      }
      for (const k of keys) {
        if (!remedials[k]?.done) continue;
        remedials[k] = on ? { ...remedials[k], verified: true, vby: who, vat: new Date().toISOString() } : { ...remedials[k], verified: false, vby: '', vat: '' };
      }
      const saved = await saveDoor({ ...d, remedials });
      Object.assign(doors.find((x) => x.id === id), saved);
      renderRepairsTab(body, project, plans, doors);
    };
    $$('.ver-tick', sec).forEach((cb) => (cb.onchange = () => verify([cb.dataset.key], cb.checked)));
    $('.rep-verify-all', sec)?.addEventListener('click', () => {
      const d = doors.find((x) => x.id === id);
      verify(remedialItems(d).map((i) => i.key).filter((k) => d.remedials?.[k]?.done && !d.remedials?.[k]?.verified), true);
    });
    $('.rep-open', sec).onclick = () => go({ ...state, doorId: id });
    $('.rep-repaired', sec)?.addEventListener('click', async () => {
      const d = await db.get('doors', id);
      const saved = await saveDoor({ ...d, status: 'repaired' });
      Object.assign(doors.find((x) => x.id === id), saved);
      toast(`Door set to ${statusById.repaired.label}`);
      renderRepairsTab(body, project, plans, doors);
    });
  });
  // fill in the location maps
  for (const img of $$('.rep-map', body)) {
    const d = doors.find((x) => x.id === img.dataset.door);
    const pl = planById[d?.planId];
    if (d && pl) doorMapURL(pl, d, doors.filter((x) => x.planId === pl.id), '#cc2a1f', { w: 640, h: 300 }).then((u) => (img.src = u)).catch(() => img.remove());
  }
  const repOpts = () => ({
    doors: shown.map(({ d }) => d), plans, instructions, ack: project.remedialAck,
    filterText: [state.collText, show === 'outstanding' ? 'Outstanding repairs' : show === 'done' ? 'Completed doors' : ''].filter(Boolean).join(' · '),
  });
  const run = async (label, fn) => {
    if (!shown.length) return toast('No doors with repairs in this list. Choose All to include every door.', 'error');
    const b = busy(`Building ${label}…`);
    try {
      const r = await fn(b.update);
      b.done();
      if (r === 'saved') toast(`${label[0].toUpperCase() + label.slice(1)} saved`);
    } catch (e) {
      b.done();
      console.error(e);
      toast(`Could not build the ${label}: ${e.message}`, 'error');
    }
  };
  $('#rep-pdf').onclick = () => run('repair sheet', (up) => exportRemedialPdf(project, lists, repOpts(), up));
  $('#rep-report').onclick = () => run('completion report', (up) => exportRemedialPdf(project, lists, { ...repOpts(), mode: 'report' }, up));
  $('#rep-xlsx').onclick = () => run('repairs workbook', () => exportRemedialXlsx(project, repOpts()));
  $('#price-xlsx').onclick = () => run('pricing sheet', () => exportPricingXlsx(project, repOpts()));
  $('#price-pdf').onclick = () => run('pricing sheet', (up) => exportRemedialPdf(project, lists, { ...repOpts(), mode: 'price' }, up));
}

// Who is verifying? Asked once per session; must not be the person who did the work
let verifierName = '';
async function askVerifier(doneBy) {
  const r = await dialog({
    title: 'Verify repairs',
    body: `<p>Verification is a second check by someone other than the person who did the work${doneBy.length ? ` (<b>${esc([...new Set(doneBy)].join(', '))}</b>)` : ''}.</p>
      <label class="field"><span>Verified by</span><input name="who" id="ver-who" required value="${esc(verifierName || lists.inspector || '')}" placeholder="Name of the person checking"></label>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Verify', value: true, kind: 'primary' }],
  });
  const who = (r.data?.who || '').trim();
  if (r.value !== true || !who) return '';
  const same = doneBy.some((b) => b && b.trim().toLowerCase() === who.toLowerCase());
  if (same) {
    toast(`Verification must be by someone other than ${who}, who did the work.`, 'error');
    return '';
  }
  verifierName = who;
  return who;
}

// <option>s for a collection picker: plain collections, then each main
// folder as a group with "All sections" and its sections
function collOptions(colls, selected, { folders: withFolderPick = true } = {}) {
  const plain = colls.filter((c) => !splitColl(c).folder);
  const opt = (v, label) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(label)}</option>`;
  return plain.map((c) => opt(c, collLabel(c))).join('') +
    listFolders(colls).map((f) => `<optgroup label="${esc(f)}">
      ${withFolderPick ? opt('F:' + f, `All of ${f}`) : ''}
      ${colls.filter((c) => splitColl(c).folder === f).map((c) => opt(c, sectionLabel(c))).join('')}
    </optgroup>`).join('');
}

async function pickCollection(project, coll) {
  state.coll = coll;
  if (coll !== '*') await db.put('projects', { ...project, activeCollection: coll });
  state.rf = emptyFilter(); // report filters belong to the collection shown
  refresh();
}

function renderPlansTab(body, project, plans, doors, active) {
  const n = {};
  for (const d of doors) n[d.planId] = (n[d.planId] || 0) + 1;
  const colls = listCollections(plans);
  const named = colls.length > 1 || (colls[0] ?? '') !== '';
  const pinsOn = (pl) => doors.filter((d) => d.planId === pl.id && d.x != null);
  const card = (p) => {
    const wide = (p.width || 4) / (p.height || 3) >= 4 / 3;
    return `
        <div class="plan-card">
          <button class="plan-open" data-id="${p.id}">
            <span class="thumb-inner" style="${wide ? 'width:100%' : 'height:100%'};aspect-ratio:${p.width || 4} / ${p.height || 3}">
              <img alt="" src="${objUrl(p.thumb || p.blob)}">
              ${pinsOn(p).map((d) => { const st = statusById[d.status || 'not_inspected'] || statusById.not_inspected; return `<i class="tpin ${st.id === 'not_inspected' ? 'is-hollow' : ''}" style="left:${(d.x * 100).toFixed(2)}%;top:${(d.y * 100).toFixed(2)}%;--pin:${st.color}">${d.pinNo ?? ''}</i>`; }).join('')}
            </span>
          </button>
          <div class="plan-meta">
            <div><b>${esc(p.name)}</b><small>${n[p.id] || 0} doors pinned</small></div>
            <button class="icon-btn sm plan-menu" data-id="${p.id}" aria-label="Plan options">${icon('more')}</button>
          </div>
          <div class="plan-svc">${svcControls(project, p)}</div>
        </div>`;
  };
  const group = (c) => {
    const ps = plansIn(plans, c);
    const pins = ps.reduce((t, p) => t + (n[p.id] || 0), 0);
    return `
      <section class="coll ${c === active ? 'is-active' : ''}" data-c="${esc(c)}">
        <div class="coll-head">
          <span class="coll-name">${icon('plan')}<span><b>${esc(splitColl(c).folder ? sectionLabel(c) : collLabel(c))}</b><small>${ps.length} drawing${ps.length === 1 ? '' : 's'} · ${pins} pin${pins === 1 ? '' : 's'}${c === active && colls.length > 1 ? ' · <span class="coll-cur">current</span>' : ''}</small></span></span>
          <span class="row-btns">
            <button class="btn sm coll-copy">${icon('plus')} Copy to new collection</button>
            <button class="icon-btn sm coll-menu" aria-label="Collection options">${icon('more')}</button>
          </span>
        </div>
        <div class="plan-grid">${ps.map(card).join('')}</div>
      </section>`;
  };
  body.innerHTML = `
    ${plans.length && !named ? `<p class="muted small coll-tip">Doing a repeat service? Use <b>Copy to new collection</b> to start next month's folder with the same drawings and pins.</p>` : ''}
    ${colls.filter((c) => !splitColl(c).folder).map(group).join('')}
    ${listFolders(colls).map((f) => {
      const inF = colls.filter((c) => splitColl(c).folder === f);
      const nPlans = plansIn(plans, 'F:' + f).length;
      const closedF = (state.closedFolders || []).includes(f);
      return `<section class="cfolder ${closedF ? 'is-closed' : ''}" data-f="${esc(f)}">
        <div class="cfolder-head">
          <button class="cfolder-toggle" aria-expanded="${!closedF}">${icon('down')}<b>${esc(f)}</b><small>${inF.length} section${inF.length === 1 ? '' : 's'} · ${nPlans} drawing${nPlans === 1 ? '' : 's'}</small></button>
          <button class="icon-btn sm folder-menu" aria-label="Folder options">${icon('more')}</button>
        </div>
        <div class="cfolder-body">${inF.map(group).join('')}</div>
      </section>`;
    }).join('')}
    <div class="plan-grid">
      <label class="plan-card upload">
        <input type="file" id="plan-file" accept="application/pdf,image/*" hidden>
        <span class="upload-ico">${icon('upload')}</span>
        <b>Upload drawing</b>
        <small>PDF or photo of a floor plan. Each PDF page becomes a plan.</small>
      </label>
    </div>`;
  bindSvc(body, project, plans);
  $$('.plan-open', body).forEach((b) => (b.onclick = async () => {
    // opening a drawing makes its collection the current one
    const c = plans.find((p) => p.id === b.dataset.id)?.collection || '';
    if (c !== active) {
      state.coll = c;
      await db.put('projects', { ...project, activeCollection: c });
    }
    go({ view: 'plan', projectId: project.id, planId: b.dataset.id });
  }));
  $$('.plan-menu', body).forEach((b) => (b.onclick = () => planMenu(plans.find((p) => p.id === b.dataset.id), colls)));
  $$('.coll', body).forEach((sec) => {
    const c = sec.dataset.c;
    $('.coll-copy', sec).onclick = () => copyCollectionDialog(project, plans, c);
    $('.coll-menu', sec).onclick = () => collectionMenu(project, plans, doors, c);
  });
  $$('.cfolder', body).forEach((fs) => {
    const f = fs.dataset.f;
    $('.cfolder-toggle', fs).onclick = () => {
      const set = new Set(state.closedFolders || []);
      set.has(f) ? set.delete(f) : set.add(f);
      state.closedFolders = [...set];
      fs.classList.toggle('is-closed');
    };
    $('.folder-menu', fs).onclick = () => folderMenu(project, plans, doors, f);
  });
  $('#plan-file').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    // which collection does it go in?
    let target = active === '*' || isFolderPick(active) ? plansIn(plans, active)[0]?.collection || colls[0] || '' : active;
    if (named) {
      const r = await dialog({
        title: 'Add drawing to…',
        body: `
          <label class="field"><span>Collection</span>
            <select name="coll" id="up-coll">${collOptions(colls, target, { folders: false })}<option value="__new">New collection…</option></select></label>
          <div class="grid2">
            <label class="field"><span>If new: main folder (optional)</span><input name="newfolder" id="up-newf" list="up-folders" placeholder="e.g. Remedial repairs"></label>
            <label class="field"><span>If new: name / section</span><input name="newname" id="up-new" placeholder="${esc(suggestName(colls, false))}"></label>
          </div>
          <datalist id="up-folders">${listFolders(colls).map((f) => `<option value="${esc(f)}"></option>`).join('')}</datalist>`,
        buttons: [{ label: 'Cancel', value: false }, { label: 'Add drawing', value: true, kind: 'primary' }],
      });
      if (r.value !== true) return;
      target = r.data.coll === '__new' ? joinColl((r.data.newfolder || '').trim(), (r.data.newname || '').trim() || suggestName(colls, !(r.data.newfolder || '').trim())) : r.data.coll;
    }
    const bz = busy('Reading drawing…');
    try {
      const pages = await importDrawing(file, bz.update);
      let order = plansIn(plans, target).length;
      let first = null;
      for (const pg of pages) {
        const rec = await db.put('plans', { id: db.uid(), projectId: project.id, order: order++, sourceName: file.name, collection: target, ...pg });
        first ||= rec;
      }
      bz.done();
      toast(pages.length > 1 ? `${pages.length} plans added` : 'Plan added');
      if (pages.length === 1) go({ view: 'plan', projectId: project.id, planId: first.id });
      else refresh();
    } catch (err) {
      bz.done();
      console.error(err);
      toast('Could not read that file: ' + err.message, 'error');
    }
  };
}

async function copyCollectionDialog(project, plans, from) {
  const colls = listCollections(plans);
  const ps = plansIn(plans, from);
  const r = await dialog({
    title: `Copy "${collLabel(from)}"`,
    body: `
      <p>Makes a new collection with the same ${ps.length} drawing${ps.length === 1 ? '' : 's'} and every pin in the same place, with the same numbers. "${esc(collLabel(from))}" stays as it is.</p>
      <div class="grid2">
        <label class="field"><span>Main folder (optional)</span><input name="folder" id="cc-folder" value="${esc(splitColl(from).folder)}" list="cc-folders" placeholder="e.g. Remedial repairs"></label>
        <label class="field"><span>Section / name</span><input name="name" id="cc-name" required value="${esc(suggestName(colls.map((c) => splitColl(c).section), !splitColl(from).folder))}"></label>
      </div>
      <datalist id="cc-folders">${listFolders(colls).map((f) => `<option value="${esc(f)}"></option>`).join('')}</datalist>
      <p class="muted small">With a main folder, the new collection becomes a section inside it, e.g. <b>Remedial repairs › December 2026</b>.</p>
      <fieldset class="scheme-set">
        <legend>What to copy for each door</legend>
        <label class="scheme-opt"><input type="radio" name="mode" value="reset" checked>
          <span><b>Pins and door details</b><small>Door ref, room, door type and leaf. Every door starts as Not inspected with a blank checklist. Best for a repeat service.</small></span></label>
        <label class="scheme-opt"><input type="radio" name="mode" value="all">
          <span><b>Everything</b><small>Also status, checklist answers, defects, actions, materials and notes, ready to update.</small></span></label>
      </fieldset>
      <p class="muted small">Photos and videos aren't copied; they stay with "${esc(collLabel(from))}".</p>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Copy', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return;
  const sec = (r.data.name || '').trim();
  if (!sec) return toast('Give the new collection a name.', 'error');
  const name = joinColl((r.data.folder || '').trim(), sec);
  if (colls.includes(name)) return toast(`There's already a collection called "${collLabel(name)}".`, 'error');
  const b = busy('Copying drawings and pins…');
  try {
    const res = await copyCollection(project, plans, from, name, r.data.mode, lists.inspector || '');
    b.done();
    toast(`Copied ${res.drawings} drawing${res.drawings === 1 ? '' : 's'} and ${res.pins} pin${res.pins === 1 ? '' : 's'} to "${collLabel(name)}"`);
    await pickCollection(project, name);
  } catch (e) {
    b.done();
    toast(e.message, 'error');
  }
}

async function collectionMenu(project, plans, doors, c) {
  const ps = plansIn(plans, c);
  const ids = new Set(ps.map((p) => p.id));
  const nd = doors.filter((d) => ids.has(d.planId)).length;
  const colls = listCollections(plans);
  const r = await dialog({
    title: 'Collection',
    body: `<div class="grid2">
        <label class="field"><span>Main folder (optional)</span><input name="folder" id="coll-folder" value="${esc(splitColl(c).folder)}" list="coll-folders" placeholder="e.g. Remedial repairs"></label>
        <label class="field"><span>Name / section</span><input name="name" id="coll-name" value="${esc(splitColl(c).section)}" placeholder="${esc(sectionLabel(c))}"></label>
      </div>
      <datalist id="coll-folders">${listFolders(colls).map((f) => `<option value="${esc(f)}"></option>`).join('')}</datalist>
      <p class="muted small">Put it in a main folder to group it with other sections, e.g. months of a repair programme.</p>`,
    buttons: [{ label: 'Delete collection', value: 'delete', kind: 'ghost danger-text' }, { label: 'Cancel', value: false }, { label: 'Save', value: 'save', kind: 'primary' }],
  });
  if (r.value === 'save') {
    const name = joinColl((r.data.folder || '').trim(), (r.data.name || '').trim());
    if (name === c) return;
    if (colls.includes(name)) return toast(`There's already a collection called "${collLabel(name)}".`, 'error');
    await renameCollection(plans, c, name);
    if ((project.activeCollection ?? '') === c || state.coll === c) await pickCollection(project, name);
    else refresh();
    toast('Collection renamed');
  } else if (r.value === 'delete') {
    if (await confirmBox('Delete collection?', `This deletes "${collLabel(c)}": ${ps.length} drawing(s) and ${nd} door record(s) with their photos and history. Other collections aren't affected. This cannot be undone.`)) {
      await deleteCollection(plans, c);
      state.coll = null;
      refresh();
      toast('Collection deleted');
    }
  }
}

// Main folder menu: rename it (its sections move with it) or delete it all
async function folderMenu(project, plans, doors, f) {
  const ps = plansIn(plans, 'F:' + f);
  const ids = new Set(ps.map((p) => p.id));
  const nd = doors.filter((d) => ids.has(d.planId)).length;
  const r = await dialog({
    title: 'Main folder',
    body: `<label class="field"><span>Folder name</span><input name="name" id="folder-name" value="${esc(f)}"></label>`,
    buttons: [{ label: 'Delete folder', value: 'delete', kind: 'ghost danger-text' }, { label: 'Cancel', value: false }, { label: 'Save', value: 'save', kind: 'primary' }],
  });
  if (r.value === 'save') {
    const name = (r.data.name || '').trim();
    if (!name || name === f) return;
    if (listFolders(listCollections(plans)).includes(name)) return toast(`There's already a folder called "${name}".`, 'error');
    await renameFolder(plans, f, name);
    const cur = state.coll ?? project.activeCollection ?? '';
    const moved = isFolderPick(cur) && cur.slice(2) === f ? 'F:' + name : splitColl(cur).folder === f ? joinColl(name, splitColl(cur).section) : null;
    if (moved != null) await pickCollection(project, moved);
    else refresh();
    toast('Folder renamed');
  } else if (r.value === 'delete') {
    if (await confirmBox('Delete folder?', `This deletes "${f}" and every section in it: ${ps.length} drawing(s) and ${nd} door record(s) with their photos and history. This cannot be undone.`)) {
      await deleteCollection(plans, 'F:' + f);
      state.coll = null;
      refresh();
      toast('Folder deleted');
    }
  }
}

async function planMenu(plan, colls = []) {
  const r = await dialog({
    title: 'Plan',
    body: `<label class="field"><span>Name</span><input name="name" id="plan-name" value="${esc(plan.name)}"></label>
      ${colls.length > 1 || plan.collection ? `<label class="field"><span>Collection</span>
        <select name="coll" id="plan-coll">${collOptions(colls, plan.collection || '', { folders: false })}</select></label>` : ''}`,
    buttons: [{ label: 'Delete plan', value: 'delete', kind: 'ghost danger-text' }, { label: 'Cancel', value: false }, { label: 'Save', value: 'save', kind: 'primary' }],
  });
  if (r.value === 'save') {
    await db.put('plans', { ...plan, name: r.data.name || plan.name, ...(r.data.coll != null ? { collection: r.data.coll } : {}) });
    refresh();
  } else if (r.value === 'delete') {
    const doors = await db.byIndex('doors', 'planId', plan.id);
    if (await confirmBox('Delete plan?', `This deletes "${plan.name}" and the ${doors.length} door record(s) pinned on it, with their photos. This cannot be undone.`)) {
      await db.deletePlan(plan.id);
      refresh();
      toast('Plan deleted');
    }
  }
}

function renderDoorsTab(body, project, plans, doors) {
  const filter = state.filter || 'all';
  const q = (state.q || '').toLowerCase();
  const counts = countStatuses(doors);
  const planName = Object.fromEntries(plans.map((p) => [p.id, p.name]));
  const shown = doors.filter((d) => (filter === 'all' || (d.status || 'not_inspected') === filter) &&
    (!state.catF || (d.category || '') === state.catF.slice(1)) &&
    (!q || [d.ref, d.location, d.doorType, String(d.pinNo), planName[d.planId], d.zoneNo && 'zone ' + d.zoneNo, d.zoneName, d.category].join(' ').toLowerCase().includes(q)));
  body.innerHTML = `
    <div class="row-btns import-row">
      <label class="btn sm">${icon('upload')} Import doors from Excel<input type="file" id="imp-file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" hidden></label>
      <button class="btn ghost sm" id="imp-template">${icon('download')} Template</button>
    </div>
    <div class="chips" role="group" aria-label="Filter by status">
      <button class="chip ${filter === 'all' ? 'is-on' : ''}" data-f="all">All <b>${doors.length}</b></button>
      ${statusesInUse(doors).map((s) => `<button class="chip ${filter === s.id ? 'is-on' : ''}" data-f="${s.id}" style="--c:${s.color}"><i></i>${s.label} <b>${counts[s.id] || 0}</b></button>`).join('')}
    </div>
    ${(() => {
      const used = [...new Set(doors.map((d) => d.category || ''))];
      if (used.length < 2 && !used[0]) return '';
      return `<div class="chips" role="group" aria-label="Filter by category">
        <button class="chip cat-chip ${!state.catF ? 'is-on' : ''}" data-cat="">All categories</button>
        ${used.sort((a, b) => (a === '') - (b === '') || a.localeCompare(b)).map((c) => `<button class="chip cat-chip ${state.catF === '=' + c ? 'is-on' : ''}" data-cat="=${esc(c)}">${esc(c || 'No category')} <b>${doors.filter((d) => (d.category || '') === c).length}</b></button>`).join('')}
      </div>`;
    })()}
    <label class="search">${icon('search')}<input id="door-q" type="search" placeholder="Search door ref, room, type, zone…" value="${esc(state.q || '')}"></label>
    ${doors.length ? '' : `<p class="muted pad">No doors yet. Open a plan and tap <b>Add door</b> to drop a pin.</p>`}
    <div class="door-table" role="table">
      ${shown.map((d) => doorRow(d, planName)).join('')}
    </div>
    ${doors.length && !shown.length ? '<p class="muted pad">No doors match this filter.</p>' : ''}
  `;
  $$('.chip:not(.cat-chip)', body).forEach((c) => (c.onclick = () => { state.filter = c.dataset.f; renderDoorsTab(body, project, plans, doors); }));
  $$('.cat-chip', body).forEach((c) => (c.onclick = () => { state.catF = c.dataset.cat; renderDoorsTab(body, project, plans, doors); }));
  $('#imp-template').onclick = () => downloadTemplate().catch((e) => toast(e.message, 'error'));
  $('#imp-file').onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const pick = state.coll && state.coll !== '*' ? state.coll : project.activeCollection ?? (plans[0]?.collection || '');
    const coll = isFolderPick(pick) ? plans[0]?.collection || '' : pick;
    importDoors(project, f, coll);
  };
  const qi = $('#door-q');
  qi.oninput = () => {
    state.q = qi.value;
    const pos = qi.selectionStart;
    renderDoorsTab(body, project, plans, doors);
    const n = $('#door-q');
    n.focus();
    n.setSelectionRange(pos, pos);
  };
  $$('.door-row', body).forEach((r) => (r.onclick = () => go({ ...state, doorId: r.dataset.id })));
}

function doorRow(d, planName) {
  const s = statusById[d.status || 'not_inspected'];
  const nDef = (d.defects || []).length;
  return `
    <button class="door-row" data-id="${d.id}" role="row">
      <span class="pin-badge ${s.id === 'not_inspected' ? 'is-hollow' : ''}" style="--pin:${s.color}">${d.pinNo ?? ''}</span>
      <span class="dr-main">
        <b>${esc(d.ref || 'No ref')}${d.location ? ` <span class="muted">· ${esc(d.location)}</span>` : ''}</b>
        <small>${esc([d.category, d.doorType, d.zoneNo ? 'Zone ' + d.zoneNo : '', d.risk ? 'Risk: ' + d.risk : '', planName[d.planId]].filter(Boolean).join(' · ') || 'No details yet')}${d.planId ? '' : ' <span class="unplaced">Not on a drawing</span>'}</small>
      </span>
      <span class="dr-side">
        <span class="status-pill" style="--c:${s.color}">${s.short}</span>
        ${nDef ? `<small>${nDef} defect${nDef > 1 ? 's' : ''}</small>` : ''}
        ${signsNeeded(d).length ? `<small>${signsNeeded(d).reduce((a, x) => a + (Number(x.qty) || 0), 0)} sign${signsNeeded(d).reduce((a, x) => a + (Number(x.qty) || 0), 0) === 1 ? '' : 's'} needed</small>` : ''}
        ${priced() && materialsTotal(d) ? `<small class="money">${euro(materialsTotal(d))}</small>` : ''}
      </span>
    </button>`;
}

function renderExportTab(body, project, plans, allDoors) {
  if (state.rfProject !== project.id) {
    state.rfProject = project.id;
    state.rf = emptyFilter();
  }
  const f = state.rf;
  const questions = (lists.questions || []).filter((q) => q.text?.trim() && !q.hidden);
  const opts = filterOptions(allDoors, questions);
  const doors = applyFilter(allDoors, f);
  const filterText = [state.collText, describeFilter(f, plans, opts.checks)].filter(Boolean).join(' · ');
  const nDef = doors.reduce((a, d) => a + (d.defects || []).length, 0);
  const chip = (group, value, label, on, color) =>
    `<button class="chip ${on ? 'is-on' : ''}" data-g="${group}" data-v="${esc(value)}" ${color ? `style="--c:${color}"` : ''}>${color ? '<i></i>' : ''}${esc(label)}</button>`;
  body.innerHTML = `
    <section class="panel svc-panel">
      <h2 class="h2">${icon('check')} Services</h2>
      <p class="muted small">Each drawing is its own service. Start it on site; End service answers the ${closeQuestions(lists).length} end-of-service questions, takes the signed declaration and saves the report into Files › Reports.</p>
      <div class="svc-rows">${plans.map((pl) => `<div class="svc-row"><span class="svc-name"><b>${esc(pl.name)}</b>${pl.collection ? `<small>${esc(collLabel(pl.collection))}</small>` : ''}</span><span class="svc-ctl">${svcControls(project, pl, true)}</span></div>`).join('') || '<p class="muted">No drawings yet.</p>'}</div>
    </section>
    <section class="panel filter-panel">
      <div class="block-head"><h2 class="h2">${icon('search')} Report filters</h2>
        ${isFiltered(f) ? '<button class="btn ghost sm" id="rf-clear">Clear filters</button>' : ''}</div>
      <p class="muted small">Apply to both the Excel and the PDF. Nothing selected means everything.</p>

      <div class="rf-group">
        <span class="rf-label">Inspection date</span>
        <div class="seg" role="group">
          ${[['all', 'Latest'], ['on', 'On a date'], ['range', 'Between dates']].map(([v, l]) => `<button class="seg-btn ${f.dateMode === v ? 'is-on' : ''}" data-mode="${v}">${l}</button>`).join('')}
        </div>
        ${f.dateMode === 'on' ? `<label class="field"><span>Date</span><input type="date" id="rf-from" value="${esc(f.from)}" list="rf-dates"></label>` : ''}
        ${f.dateMode === 'range' ? `<div class="grid2"><label class="field"><span>From</span><input type="date" id="rf-from" value="${esc(f.from)}"></label><label class="field"><span>To</span><input type="date" id="rf-to" value="${esc(f.to)}"></label></div>` : ''}
        ${f.dateMode !== 'all' && opts.dates.length ? `<p class="muted small">Inspection dates on this project: ${opts.dates.map((d) => `<button class="link-btn rf-date" data-d="${d}">${esc(fmtDate(d))}</button>`).join(', ')}</p>` : ''}
        ${f.dateMode !== 'all' ? '<p class="muted small">Each door is reported as it was at its latest inspection in that period, including inspections now in its history.</p>' : ''}
      </div>

      <div class="rf-group"><span class="rf-label">Status</span>
        <div class="chips wrap">${STATUSES.map((st) => chip('statuses', st.id, st.label, f.statuses.includes(st.id), st.color)).join('')}</div></div>
      <div class="rf-group"><span class="rf-label">Door type</span>
        <div class="chips wrap">${opts.types.map((t) => chip('types', t, t, f.types.includes(t))).join('')}</div></div>
      ${opts.zones.length > 1 || (opts.zones[0] && opts.zones[0].key !== '(no zone)') ? `<div class="rf-group"><span class="rf-label">Fire alarm zone</span>
        <div class="chips wrap">${opts.zones.map((z) => chip('zones', z.key, z.label, (f.zones || []).includes(z.key))).join('')}</div></div>` : ''}
      ${opts.cats.length > 1 || (opts.cats[0] ?? '') !== '' ? `<div class="rf-group"><span class="rf-label">Category</span>
        <div class="chips wrap">${opts.cats.map((c) => chip('cats', c, c || 'No category', (f.cats || []).includes(c))).join('')}</div></div>` : ''}
      ${opts.risks.length > 1 || (opts.risks[0] ?? '') !== '' ? `<div class="rf-group"><span class="rf-label">Risk rating</span>
        <div class="chips wrap">${opts.risks.map((r) => chip('risks', r, r || NO_RISK, (f.risks || []).includes(r))).join('')}</div></div>` : ''}
      ${plans.length > 1 ? `<div class="rf-group"><span class="rf-label">Plan / level</span>
        <div class="chips wrap">${plans.map((pl) => chip('plans', pl.id, pl.name, f.plans.includes(pl.id))).join('')}</div></div>` : ''}
      <div class="grid2">
        <label class="field"><span>Has defect</span>
          <select id="rf-defect"><option value="">Any</option>${opts.defects.map((d) => `<option ${d === f.defect ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>
        <label class="field"><span>Failed check (${esc(ANSWERS[1].label)})</span>
          <select id="rf-check"><option value="">Any</option>${opts.checks.map((q) => `<option value="${esc(q.id)}" ${q.id === f.check ? 'selected' : ''}>${esc(q.text)}</option>`).join('')}</select></label>
      </div>
      <p class="rf-count"><b>${doors.length}</b> of ${allDoors.length} doors will be included${filterText ? `<br><span class="muted small">${esc(filterText)}</span>` : ''}</p>
    </section>

    <section class="panel">
      <h2 class="h2">${icon('sheet')} Excel for pricing</h2>
      <p>One workbook with these sheets:</p>
      <ul class="sheet-list">
        <li><b>Summary</b>: counts and the materials total</li>
        <li><b>Doors</b>: one row per door, with all its actions</li>
        <li><b>Checklist</b>: Pass / Fail / N/A for every question</li>
        <li><b>Defects (pricing)</b>: one row per defect with Qty × Unit rate formulas</li>
        <li><b>Materials</b>: one row per material with costs and a total</li>
        <li><b>Material totals</b>: what to order for the whole site</li>
        <li><b>Defect totals</b>: how many of each defect</li>
        <li><b>Inspection history</b>: every inspection of every door, by date</li>
      </ul>
      <p class="muted">${doors.length} doors · ${nDef} defects${priced() ? ` · materials ${euro(doors.reduce((t, d) => t + materialsTotal(d), 0))} ex VAT` : ' · prices hidden (locked)'}</p>
      ${(() => {
        const n = doors.filter((d) => (d.defects || []).some((x) => !(d.materials || []).some((m) => m.forKey === 'd:' + x.label) && defaultProductsFor(x, lists.materials || [], () => '').length)).length;
        return n ? `<p class="fill-note">${icon('sheet')} <span>${n} door${n === 1 ? ' has' : 's have'} defects with no products yet. <button class="link-btn" id="fill-all">Add the usual products</button> so they're costed and on the pricing sheet.</span></p>` : '';
      })()}
      <button class="btn primary" id="xlsx">${icon('download')} Export Excel</button>
    </section>
    <section class="panel">
      <h2 class="h2">${icon('shield')} Backup</h2>
      <p>Until cloud sync is switched on, this project is stored only on this phone. Save a backup file (includes plans and photos; videos are too large and stay on the phone) and keep it in Google Drive or email it to yourself.</p>
      <button class="btn" id="backup">Save backup of this project</button>
    </section>
    <section class="panel">
      <h2 class="h2">${icon('report')} Client PDF report</h2>
      <div class="signoff ${project.signoff ? 'is-signed' : ''}">
        <span class="rf-label">Inspector sign-off (printed on the report cover)</span>
        ${project.signoff
          ? `<div class="sig-show"><img alt="Signature of ${esc(project.signoff.name)}" src="${project.signoff.data}"><span><b>${esc(project.signoff.name)}</b><small>Signed ${esc(fmtDate(project.signoff.at.slice(0, 10)))}</small></span></div>
             <div class="row-btns"><button class="btn sm" id="sign-insp">Sign again</button><button class="btn ghost sm danger-text" id="sign-clear">Remove</button></div>`
          : `<div class="row-btns"><button class="btn sm" id="sign-insp">${icon('pencil')} Sign the report</button></div>`}
      </div>
      <p>A report for the client with these sections:</p>
      <ul class="sheet-list">
        <li>Cover page with the headline figures</li>
        <li>Summary charts: door status pie, failure rate by inspection check, most common defects</li>
        <li>Each plan marked up with numbered, colour-coded pins</li>
        <li>Door schedule</li>
        <li>A page per door with its plan location, checklist, defects, actions and photos</li>
      </ul>
      <div class="opt-list">
        <label class="check-line"><input type="checkbox" id="pdf-photos" checked> Include photos</label>
        <label class="check-line"><input type="checkbox" id="pdf-pass" checked> Include pages for doors marked ${esc(statusById.pass.label)} or ${esc(statusById.na.label)}</label>
        <label class="check-line"><input type="checkbox" id="pdf-costs" ${priced() ? '' : 'disabled'}> Include material costs${priced() ? '' : ' <span class="muted">(unlock with your PIN first)</span>'} <span class="muted">(leave off for the client copy)</span></label>
      </div>
      <button class="btn primary" id="pdf">${icon('download')} Export PDF report</button>
    </section>
    <section class="panel danger-zone">
      <button class="btn ghost danger-text" id="del-proj">${icon('trash')} Delete project</button>
    </section>`;
  // filter controls
  const rerender = () => {
    const y = window.scrollY;
    renderExportTab(body, project, plans, allDoors);
    window.scrollTo(0, y);
  };
  $$('.filter-panel .chip', body).forEach((c) => (c.onclick = () => {
    const list = (f[c.dataset.g] ||= []);
    const i = list.indexOf(c.dataset.v);
    if (i >= 0) list.splice(i, 1);
    else list.push(c.dataset.v);
    rerender();
  }));
  $$('.seg-btn', body).forEach((b) => (b.onclick = () => { f.dateMode = b.dataset.mode; rerender(); }));
  $$('.rf-date', body).forEach((b) => (b.onclick = () => {
    f.from = b.dataset.d;
    if (f.dateMode === 'range') f.to = b.dataset.d;
    rerender();
  }));
  $('#rf-from')?.addEventListener('change', (e) => { f.from = e.target.value; rerender(); });
  $('#rf-to')?.addEventListener('change', (e) => { f.to = e.target.value; rerender(); });
  $('#rf-defect').onchange = (e) => { f.defect = e.target.value; rerender(); };
  $('#rf-check').onchange = (e) => { f.check = e.target.value; rerender(); };
  $('#rf-clear')?.addEventListener('click', () => { state.rf = emptyFilter(); rerender(); });
  const noneMsg = () => toast('No doors match these filters. Change or clear the filters first.', 'error');

  $('#fill-all')?.addEventListener('click', async () => {
    const { added, nDoors } = await fillProjectMaterials(doors);
    toast(`${added} product${added === 1 ? '' : 's'} added on ${nDoors} door${nDoors === 1 ? '' : 's'}. Check the quantities on each door`);
    refresh();
  });
  $('#xlsx').onclick = async () => {
    const b = busy('Building Excel workbook…');
    try {
      if (!doors.length) return b.done(), noneMsg();
      const r = await exportProjectXlsx(project, questions, { doors, filterText, hideCosts: !priced() });
      b.done();
      if (r === 'saved') toast('Excel file saved');
    } catch (e) {
      b.done();
      toast(e.message, 'error');
    }
  };
  $('#sign-insp').onclick = async () => {
    const sig = await signaturePad({ title: 'Inspector signature', name: project.signoff?.name || lists.inspector || '', saved: lists.signature });
    if (!sig) return;
    await db.put('projects', { ...(await db.get('projects', project.id)), signoff: { ...sig, at: new Date().toISOString() } });
    toast('Report signed');
    refresh();
  };
  $('#sign-clear')?.addEventListener('click', async () => {
    await db.put('projects', { ...(await db.get('projects', project.id)), signoff: null });
    refresh();
  });
  $('#pdf').onclick = async () => {
    const b = busy('Building PDF report…');
    try {
      if (!doors.length) return b.done(), noneMsg();
      const opts = { photos: $('#pdf-photos').checked, passDetail: $('#pdf-pass').checked, costs: priced() && $('#pdf-costs').checked, doors, filterText, plans };
      const r = await exportProjectPdf(project, lists, opts, b.update);
      b.done();
      if (r === 'saved') toast('PDF report saved');
    } catch (e) {
      b.done();
      console.error(e);
      toast('Could not build the PDF: ' + e.message, 'error');
    }
  };
  $('#backup').onclick = async () => {
    const b = busy('Preparing backup…');
    try {
      const { result, videosLeftOut } = await backupProjects([project]);
      b.done();
      if (result === 'saved') saveLists({ lastBackupAt: new Date().toISOString() }), toast(videosLeftOut ? `Backup saved (${videosLeftOut} video(s)/large file(s) left out – too large)` : 'Backup saved');
    } catch (e) {
      b.done();
      toast(e.message, 'error');
    }
  };
  bindSvc(body, project, plans);
  $('#del-proj').onclick = async () => {
    if (await confirmBox('Delete project?', `This deletes "${project.site}", its ${plans.length} plan(s), ${doors.length} door record(s) and all photos from this phone. This cannot be undone.`)) {
      await db.deleteProject(project.id);
      toast('Project deleted');
      stack.length = 0;
      go({ view: 'projects' }, { replace: true });
    }
  };
}

// ---------- Plan viewer screen ----------
let mode = null; // null | 'add' | 'move'
// The fire alarm zone last entered on a plan, so neighbouring doors get it too
const lastZone = { planId: '', no: '', name: '' };
const lastCategory = { planId: '', value: '' }; // new pins on a drawing get the last category used there
const restMemo = new Map(); // door id → the questions a "Rest" toggle filled, so it can be undone
let planColl = ''; // collection of the plan on screen
let placingId = null; // an imported door waiting to be placed as a pin
let placingLabel = '';
let selectedPin = null;

async function renderPlan() {
  const plan = await db.get('plans', state.planId);
  noteWeather(state.projectId);
  useScheme(await db.get('projects', state.projectId));
  planColl = plan?.collection || '';
  if (!plan) return go({ view: 'project', projectId: state.projectId, tab: 'plans' }, { replace: true });
  mode = null;
  selectedPin = null;
  app.innerHTML = `
    <div class="plan-screen">
      <header class="bar overlay">
        <button class="icon-btn" id="back" aria-label="Back">${icon('back')}</button>
        <div class="bar-title"><b>${esc(plan.name)}</b><small id="plan-counts"></small></div>
        <span class="bar-btns">
          <button class="icon-btn" id="plan-undo" aria-label="Undo" disabled>${icon('undo')}</button>
          <button class="icon-btn badge-btn" id="plan-files" aria-label="Drawing files">${icon('file')}<span class="ib-badge" id="plan-files-n" hidden></span></button>
          <button class="icon-btn" id="plan-filter" aria-label="Filter pins">${icon('filter')}</button>
          <button class="icon-btn" id="to-list" aria-label="Door list">${icon('list')}</button>
        </span>
      </header>
      <div class="viewer" id="viewer"></div>
      <div class="mode-banner" id="banner" hidden></div>
      <div class="plan-svc-pill" id="plan-svc"></div>
      <div class="zoom-ctl">
        <button class="icon-btn" id="zin" aria-label="Zoom in">${icon('zoomIn')}</button>
        <button class="icon-btn" id="zout" aria-label="Zoom out">${icon('zoomOut')}</button>
        <button class="icon-btn" id="zfit" aria-label="Fit to screen">${icon('fit')}</button>
      </div>
      <div class="plan-toolbar">
        <button class="btn big" id="sel-toggle">${icon('cursor')} Select</button>
        <button class="btn big" id="mk-toggle">${icon('pencil')} Markup</button>
        <button class="btn primary big" id="add-door">${icon('pin')} Add door</button>
        <button class="btn big" id="place-list" hidden>${icon('list')} Place <span id="place-n"></span></button>
      </div>
      <div class="mk-panel" id="mk-panel" hidden></div>
    </div>`;
  $('#back').onclick = back;
  $('#to-list').onclick = () => go({ view: 'project', projectId: state.projectId, tab: 'doors' });
  const drawSvc = async () => {
    const pr = await db.get('projects', state.projectId);
    const el = $('#plan-svc');
    if (!el || !pr) return;
    el.innerHTML = svcControls(pr, plan);
    bindSvc(el, pr, [plan], drawSvc);
  };
  drawSvc();
  db.get('projects', state.projectId).then((pr) => {
    if (!pr) return;
    refreshPlanFiles(pr, plan);
    $('#plan-files').onclick = () => drawingFiles(pr, plan);
  });
  viewer = new PlanViewer($('#viewer'), {
    onTap: onPlanTap,
    onPinTap: (id) => {
      if (mode === 'move') return;
      go({ ...state, doorId: id });
    },
    onPinDrag: async (id, x, y) => {
      const d = await db.get('doors', id);
      pushUndo(`Pin ${d.pinNo} moved`, async () => saveDoor({ ...(await db.get('doors', id)), x: d.x, y: d.y }));
      await saveDoor({ ...d, x, y });
      toast('Pin moved');
      setMode(null);
    },
  });
  await viewer.load(plan.blob, plan.width, plan.height);
  curPlan = plan;
  mk.on = false;
  mk.selected = null;
  mk.draft = null;
  drawMarkups();
  $('#mk-toggle').onclick = () => setMarkup(true);
  $('#sel-toggle').onclick = () => setSelecting(true);
  picked.clear();
  selecting = false;
  undoStack.length = 0;
  updateUndoBtn();
  $('#plan-undo').onclick = doUndo;
  $('#plan-filter').onclick = pickPlanFilter;
  $('#place-list').onclick = pickDoorToPlace;
  updatePlaceButton();
  $('#zin').onclick = () => viewer.zoomBy(1.6);
  $('#zout').onclick = () => viewer.zoomBy(1 / 1.6);
  $('#zfit').onclick = () => viewer.fit();
  $('#add-door').onclick = () => setMode(mode === 'add' ? null : 'add');
  await refreshPins();
  // Show the press-and-hold tip the first few times a plan with pins is opened
  try {
    const seen = Number(localStorage.getItem('fscf-hint-drag') || 0);
    if (seen < 3 && $$('.pin').length) {
      localStorage.setItem('fscf-hint-drag', String(seen + 1));
      setMode('hint');
    }
  } catch {
    /* storage blocked: skip the tip */
  }
  if (state.placeDoor) {
    const d = await db.get('doors', state.placeDoor);
    delete state.placeDoor;
    if (d && !d.planId) startPlacing(d);
  }
  if (state.focusDoor) {
    const d = await db.get('doors', state.focusDoor);
    if (d) viewer.focus(d.x, d.y);
    selectedPin = state.focusDoor;
    delete state.focusDoor;
    await refreshPins();
  }
}

// ---------- Imported doors: placing them as pins ----------
async function unplacedDoors() {
  const all = await db.byIndex('doors', 'projectId', state.projectId);
  return all.filter((d) => !d.planId && inColl(d.collection || '', planColl)).sort((a, b) => a.pinNo - b.pinNo);
}

async function updatePlaceButton() {
  const btn = $('#place-list');
  if (!btn) return;
  const n = (await unplacedDoors()).length;
  btn.hidden = !n;
  $('#place-n').textContent = n ? `(${n})` : '';
}

function startPlacing(d) {
  placingId = d.id;
  placingLabel = `pin ${d.pinNo}${d.ref ? ' (' + d.ref + ')' : ''}`;
  setMode('place');
}

async function pickDoorToPlace() {
  const list = await unplacedDoors();
  if (!list.length) return;
  const r = await dialog({
    title: 'Place a door on this drawing',
    body: `<p>Doors imported from Excel that aren't on a drawing yet. Pick one, then tap where it is.</p>
      <div class="pick-list">${list.map((d) => `
        <label class="pick"><input type="radio" name="door" value="${d.id}">
          <span><b>${esc(d.pinNo + ' · ' + (d.ref || 'No ref'))}</b><small>${esc([d.location, d.doorType, d.zoneNo ? 'Zone ' + d.zoneNo : ''].filter(Boolean).join(' · '))}</small></span></label>`).join('')}</div>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Place', value: true, kind: 'primary' }],
  });
  const d = list.find((x) => x.id === r.data?.door);
  if (r.value === true && d) startPlacing(d);
}

// From a door record: choose the drawing (if more than one) and place it
async function placeDoor(door) {
  const project = await db.get('projects', door.projectId);
  const allPlans = await db.projectPlans(door.projectId);
  const plans = plansIn(allPlans, door.collection || '');
  const choices = plans.length ? plans : allPlans;
  if (!choices.length) return toast('Upload a drawing first, then place the door on it.', 'error');
  let planId = choices[0].id;
  if (choices.length > 1) {
    const r = await dialog({
      title: 'Which drawing?',
      body: `<label class="field"><span>Drawing</span><select name="plan" id="place-plan">${choices.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Open drawing', value: true, kind: 'primary' }],
    });
    if (r.value !== true) return;
    planId = r.data.plan;
  }
  if (project) state.coll = choices.find((p) => p.id === planId)?.collection || '';
  go({ view: 'plan', projectId: door.projectId, planId, placeDoor: door.id }, { replace: true });
}

// ---------- Import doors from Excel ----------
async function importDoors(project, file, coll) {
  const b = busy('Reading spreadsheet…');
  let parsed;
  try {
    parsed = await parseDoorFile(file);
    b.done();
  } catch (e) {
    b.done();
    return toast(e.message, 'error');
  }
  const existing = await db.projectDoors(project.id);
  const have = new Set(existing.filter((d) => (d.planId ? true : (d.collection || '') === coll) && d.ref).map((d) => d.ref.trim().toLowerCase()));
  const fresh = parsed.doors.filter((d) => !d.ref || !have.has(d.ref.trim().toLowerCase()));
  const dupes = parsed.doors.length - fresh.length;
  const r = await dialog({
    title: 'Import doors',
    body: `<p><b>${parsed.doors.length}</b> door${parsed.doors.length === 1 ? '' : 's'} found on sheet "${esc(parsed.sheet)}"${dupes ? `; <b>${dupes}</b> already on this site (same door ref) will be skipped` : ''}.</p>
      <p class="muted small">Columns used:</p>
      <ul class="sheet-list small">${parsed.columns.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      <p class="muted small">Imported doors get pin numbers and appear in the door list as "Not on a drawing". Open a door and tap <b>Place on drawing</b>, or use <b>Place</b> on a drawing, to pin them.</p>`,
    buttons: [{ label: 'Cancel', value: false }, { label: `Import ${fresh.length} door${fresh.length === 1 ? '' : 's'}`, value: true, kind: 'primary' }],
  });
  if (r.value !== true || !fresh.length) return;
  const bz = busy('Importing doors…');
  const zones = [...(project.zones || [])];
  for (const row of fresh) {
    const pinNo = await db.nextPinNo(project.id);
    const location = [row.floor, row.location].filter(Boolean).join(' · ');
    await saveDoor({
      id: db.uid(), projectId: project.id, planId: null, collection: coll, pinNo, x: null, y: null,
      ref: row.ref, location, doorType: matchListValue(row.doorType, lists.doorTypes || []), leaf: matchListValue(row.leaf, LEAF_CONFIGS.filter(Boolean)),
      zoneNo: row.zoneNo.replace(/^zone\s*/i, ''), zoneName: row.zoneName, risk: matchListValue(row.risk, lists.risks || DEFAULT_RISKS), category: matchListValue(row.category, lists.categories || DEFAULT_CATEGORIES),
      status: 'not_inspected', defects: [], actions: [], checks: {}, materials: [], notes: row.notes, inspectedOn: '', inspectedBy: '',
    }, [`Imported from ${file.name}`]);
    const no = row.zoneNo.replace(/^zone\s*/i, '');
    if (no && row.zoneName && !zones.some((z) => String(z.no) === no)) zones.push({ no, name: row.zoneName });
  }
  const p = await db.get('projects', project.id);
  zones.sort((a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
  await db.put('projects', { ...p, zones });
  bz.done();
  toast(`${fresh.length} door${fresh.length === 1 ? '' : 's'} imported`);
  refresh();
}

// ---------- Markup tools ----------
let curPlan = null;
const mk = { on: false, tool: 'line', color: MK_COLORS[0], selected: null, draft: null, size: 'M' };
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const P = (p) => [clamp01(p.x), clamp01(p.y)];

function drawMarkups() {
  if (!viewer || !curPlan) return;
  renderSvg(viewer.markLayer, curPlan, curPlan.markups || [], mk.selected, mk.draft);
}

async function savePlanMarkups(patch, label = 'Markup changed') {
  if (!undoing) {
    const prev = { markups: curPlan.markups || [], scale: curPlan.scale ?? null };
    pushUndo(label, () => savePlanMarkups(prev));
  }
  curPlan = await db.put('plans', { ...curPlan, ...patch });
  drawMarkups();
}

async function addMarkup(m) {
  const name = { line: 'Line', arrow: 'Arrow', pen: 'Pen drawing', text: 'Text bubble', rect: 'Shaded box', area: 'Shaded area', measure: 'Measurement' }[m.type] || 'Markup';
  await savePlanMarkups({ markups: [...(curPlan.markups || []), { id: db.uid(), createdAt: new Date().toISOString(), color: mk.color, ...m }] }, `${name} added`);
}

// ---------- Undo on the drawing ----------
// Steps back through pins added, moved, placed or deleted and markup changes
// made on this drawing (cleared when you leave the drawing).
const undoStack = [];
let undoing = false;

function pushUndo(label, run) {
  if (undoing) return;
  undoStack.push({ label, run });
  if (undoStack.length > 60) undoStack.shift();
  updateUndoBtn();
}

function updateUndoBtn() {
  const b = $('#plan-undo');
  if (!b) return;
  b.disabled = !undoStack.length;
  b.title = undoStack.length ? `Undo: ${undoStack[undoStack.length - 1].label}` : 'Nothing to undo';
}

async function doUndo() {
  const u = undoStack.pop();
  if (!u) return toast('Nothing to undo');
  undoing = true;
  try {
    await u.run();
  } finally {
    undoing = false;
  }
  if (curPlan) curPlan = (await db.get('plans', curPlan.id)) || curPlan;
  mk.selected = null;
  drawMarkups();
  await refreshPins();
  updatePlaceButton();
  if (mk.on) drawMarkupPanel();
  updateUndoBtn();
  toast(`Undone: ${u.label}`);
}

// ---------- Select several pins and change them together ----------
const picked = new Set();
let selecting = false;

function setSelecting(on) {
  selecting = on;
  if (on) {
    setMode(null);
    if (mk.on) setMarkup(false);
  } else picked.clear();
  $('.plan-toolbar').hidden = on;
  viewer.drawHandler = on ? boxHandler : null;
  drawSelectBar();
  refreshPins();
}

async function visiblePins() {
  return (await db.byIndex('doors', 'planId', state.planId)).filter(pinMatches);
}

function drawSelectBar() {
  const banner = $('#banner');
  if (!banner) return;
  if (!selecting) {
    banner.hidden = true;
    $('#sel-panel')?.remove();
    return;
  }
  banner.hidden = false;
  banner.innerHTML = `<span>${picked.size ? `${picked.size} selected` : 'Drag a box over pins, or tap pins'}</span>`;
  let panel = $('#sel-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'sel-panel';
    panel.className = 'sel-panel';
    $('.plan-screen').append(panel);
  }
  panel.innerHTML = `
    <button class="btn" id="sel-all">All${planFilter.cats.length || planFilter.statuses.length ? ' shown' : ''}</button>
    <button class="btn" id="sel-none" ${picked.size ? '' : 'disabled'}>Clear</button>
    <button class="btn primary" id="sel-edit" ${picked.size ? '' : 'disabled'}>${icon('pencil')} Edit ${picked.size || ''}</button>
    <button class="btn ghost" id="sel-done">Done</button>`;
  $('#sel-all').onclick = async () => {
    for (const d of await visiblePins()) picked.add(d.id);
    drawSelectBar();
    refreshPins();
  };
  $('#sel-none').onclick = () => {
    picked.clear();
    drawSelectBar();
    refreshPins();
  };
  $('#sel-done').onclick = () => setSelecting(false);
  $('#sel-edit').onclick = bulkEdit;
}

// drag a box to select the pins inside it; a tap toggles one pin
const boxHandler = {
  start: null,
  down(p, target) {
    this.start = p;
    this.target = target?.closest?.('.pin')?.dataset.id || null;
    this.moved = false;
  },
  move(p) {
    const a = this.start;
    if (!a) return;
    const dx = Math.abs(p.x - a.x) * viewer.w * viewer.s;
    const dy = Math.abs(p.y - a.y) * viewer.h * viewer.s;
    if (dx + dy > 10) this.moved = true;
    if (!this.moved) return;
    const box = viewer.selBox;
    box.hidden = false;
    box.style.left = Math.min(a.x, p.x) * 100 + '%';
    box.style.top = Math.min(a.y, p.y) * 100 + '%';
    box.style.width = Math.abs(p.x - a.x) * 100 + '%';
    box.style.height = Math.abs(p.y - a.y) * 100 + '%';
  },
  async up(p) {
    const a = this.start;
    this.start = null;
    viewer.selBox.hidden = true;
    if (!a) return;
    if (!this.moved) {
      if (this.target) picked.has(this.target) ? picked.delete(this.target) : picked.add(this.target);
    } else {
      const [x1, x2] = [Math.min(a.x, p.x), Math.max(a.x, p.x)];
      const [y1, y2] = [Math.min(a.y, p.y), Math.max(a.y, p.y)];
      for (const d of await visiblePins()) if (d.x >= x1 && d.x <= x2 && d.y >= y1 && d.y <= y2) picked.add(d.id);
    }
    drawSelectBar();
    refreshPins();
  },
  cancel() {
    this.start = null;
    viewer.selBox.hidden = true;
  },
};

const KEEP = '__keep';
async function bulkEdit() {
  const ids = [...picked];
  if (!ids.length) return;
  const keepOpt = `<option value="${KEEP}" selected>— leave unchanged —</option>`;
  const opts = (list, blankLabel) => keepOpt + (blankLabel != null ? `<option value="">${esc(blankLabel)}</option>` : '') + list.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  const r = await dialog({
    title: `Change ${ids.length} door${ids.length === 1 ? '' : 's'}`,
    body: `
      <p class="muted small">Only what you change here is updated. Everything else on each door (defects, photos, checklist, history) stays as it is.</p>
      <div class="grid2">
        <label class="field"><span>Category</span><select name="category" id="b-cat">${opts(lists.categories || DEFAULT_CATEGORIES, 'No category')}</select></label>
        <label class="field"><span>Door type</span><select name="doorType" id="b-type">${opts(lists.doorTypes || [], 'No type')}</select></label>
        <label class="field"><span>Leaf configuration</span><select name="leaf" id="b-leaf">${opts(LEAF_CONFIGS.filter(Boolean), 'Not set')}</select></label>
        <label class="field"><span>Status</span><select name="status" id="b-status">${keepOpt}${STATUSES.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Risk rating</span><select name="risk" id="b-risk">${opts(lists.risks || DEFAULT_RISKS, NO_RISK)}</select></label>
        <label class="field"><span>Inspected by</span><input name="inspectedBy" id="b-by" placeholder="leave unchanged"></label>
        <label class="field"><span>Fire alarm zone no.</span><input name="zoneNo" id="b-zone" placeholder="leave unchanged"></label>
        <label class="field"><span>Fire alarm zone name</span><input name="zoneName" id="b-zname" placeholder="leave unchanged (fills from zone list)"></label>
        <label class="field"><span>Next inspection due</span><input type="date" name="nextDue" id="b-due"></label>
      </div>
      <fieldset class="scheme-set">
        <legend>New inspection</legend>
        <label class="field"><span>Start a new inspection on this date (optional)</span><input type="date" name="newInsp" id="b-new"></label>
        <small class="muted">Each door's current inspection is kept in its history with its photos, and its details carry forward to the new date.</small>
      </fieldset>`,
    buttons: [{ label: 'Cancel', value: false }, { label: `Update ${ids.length} door${ids.length === 1 ? '' : 's'}`, value: true, kind: 'primary' }],
    onOpen: (form) => {
      // a zone number from the project's zone list fills the name
      $('#b-zone', form).addEventListener('change', async (e) => {
        const p = await db.get('projects', state.projectId);
        const z = (p?.zones || []).find((x) => String(x.no) === e.target.value.trim());
        if (z && !$('#b-zname', form).value) $('#b-zname', form).value = z.name;
      });
    },
  });
  if (r.value !== true) return;
  const d = r.data;
  const patch = {};
  for (const k of ['category', 'doorType', 'leaf', 'status', 'risk']) if (d[k] !== KEEP) patch[k] = d[k];
  for (const k of ['inspectedBy', 'zoneNo', 'zoneName', 'nextDue']) if ((d[k] || '').trim()) patch[k] = d[k].trim();
  const newInsp = d.newInsp || '';
  if (!Object.keys(patch).length && !newInsp) return toast('Nothing was changed.');
  const b = busy(`Updating ${ids.length} doors…`);
  const before = [];
  try {
    for (const id of ids) {
      const cur = await db.get('doors', id);
      if (!cur) continue;
      before.push(cur);
      let next = { ...cur, ...patch };
      if (patch.status && patch.status !== 'not_inspected' && !cur.inspectedOn && !newInsp) next.inspectedOn = today();
      if (newInsp) {
        // keep the current inspection in history; carry everything forward
        next = { ...next, history: [snapshotOf(cur), ...(cur.history || [])], inspectedOn: newInsp };
        await tagPhotosForSnapshot(cur.id, cur.inspectedOn || '');
      }
      await saveDoor(next, [`Changed with ${ids.length - 1} other door${ids.length === 2 ? '' : 's'} (bulk edit)`]);
    }
  } finally {
    b.done();
  }
  pushUndo(`Bulk change to ${before.length} doors`, async () => {
    for (const prev of before) await saveDoor(prev, ['Bulk change undone']);
  });
  toast(`${before.length} door${before.length === 1 ? '' : 's'} updated`);
  await refreshPins();
}

// ---------- Filter pins on the drawing ----------
const planFilter = { cats: [], statuses: [] }; // kept while moving between drawings
const pinMatches = (d) =>
  (!planFilter.cats.length || planFilter.cats.includes(d.category || '')) &&
  (!planFilter.statuses.length || planFilter.statuses.includes(d.status || 'not_inspected'));

async function pickPlanFilter() {
  const all = await db.byIndex('doors', 'planId', state.planId);
  const cats = [...new Set([...(lists.categories || []), ...all.map((d) => d.category || '')])].sort((a, b) => (a === '') - (b === '') || 0);
  const count = (fn) => all.filter(fn).length;
  const r = await dialog({
    title: 'Show pins',
    body: `
      <div class="rf-group"><span class="rf-label">Category</span>
        <div class="pick-list compact">${cats.map((c, i) => `<label class="pick"><input type="checkbox" name="c${i}" value="${esc(c)}" ${planFilter.cats.includes(c) ? 'checked' : ''}><span><b>${esc(c || 'No category')}</b><small>${count((d) => (d.category || '') === c)} on this drawing</small></span></label>`).join('')}</div></div>
      <div class="rf-group"><span class="rf-label">Status</span>
        <div class="pick-list compact">${statusesInUse(all).map((st) => `<label class="pick"><input type="checkbox" name="s_${st.id}" value="${st.id}" ${planFilter.statuses.includes(st.id) ? 'checked' : ''}><span><b>${esc(st.label)}</b><small>${count((d) => (d.status || 'not_inspected') === st.id)} on this drawing</small></span></label>`).join('')}</div></div>
      <p class="muted small">Nothing ticked shows every pin. The filter stays on as you move between drawings.</p>`,
    buttons: [{ label: 'Show all', value: 'clear' }, { label: 'Apply', value: true, kind: 'primary' }],
  });
  if (r.value === 'clear') {
    planFilter.cats = [];
    planFilter.statuses = [];
  } else if (r.value === true) {
    planFilter.cats = Object.entries(r.data).filter(([k]) => /^c\d+$/.test(k)).map(([, v]) => v);
    planFilter.statuses = Object.entries(r.data).filter(([k]) => k.startsWith('s_')).map(([, v]) => v);
  } else return;
  await refreshPins();
}

const TOOL_HINT = {
  select: 'Tap a markup to change its colour, edit or delete it',
  line: 'Drag to draw a line',
  arrow: 'Drag from the start to the point of the arrow',
  pen: 'Draw freehand with one finger',
  text: 'Tap to place a text bubble, or drag from the item to where the bubble goes',
  rect: 'Drag to shade a box',
  area: 'Tap each corner of the area, then tap the first corner or Finish',
  measure: 'Drag along something you know the length of',
};

function setMarkup(on) {
  mk.on = on;
  mk.selected = null;
  mk.draft = null;
  if (on) setMode(null);
  $('.plan-toolbar').hidden = on;
  $('#mk-panel').hidden = !on;
  viewer.markLayer.classList.toggle('is-editing', on);
  viewer.drawHandler = on ? markupHandler : null;
  drawMarkups();
  if (on) drawMarkupPanel();
  const banner = $('#banner');
  if (!on && banner) banner.hidden = true;
}

function drawMarkupPanel() {
  const panel = $('#mk-panel');
  const sel = (curPlan.markups || []).find((m) => m.id === mk.selected);
  const icons = { select: 'cursor', line: 'lineTool', arrow: 'arrowTool', pen: 'penTool', text: 'textTool', rect: 'box', area: 'areaTool', measure: 'ruler' };
  let context = '';
  if (sel) {
    context = `<div class="mk-row mk-ctx"><span>Selected ${esc(TOOLS.find((t) => t.id === (sel.type === 'measure' ? 'measure' : sel.type))?.label || '')}</span>
      ${sel.type === 'text' ? '<button class="btn sm" id="mk-edit">Edit text</button>' : ''}
      ${sel.type === 'measure' && sel.guide ? '<button class="btn sm" id="mk-rescale">Change scale</button>' : ''}
      <button class="btn sm danger-text" id="mk-del">${icon('trash')} Delete</button></div>`;
  } else if (mk.tool === 'area' && mk.draft?.pts?.length) {
    context = `<div class="mk-row mk-ctx"><span>${mk.draft.pts.length} corner${mk.draft.pts.length > 1 ? 's' : ''}</span>
      <button class="btn sm" id="mk-area-done" ${mk.draft.pts.length < 3 ? 'disabled' : ''}>Finish area</button></div>`;
  } else if (mk.tool === 'measure') {
    context = `<div class="mk-row mk-ctx"><span>${curPlan.scale ? 'Scale set from your guide line' : 'First line sets the scale: you type its real length'}</span>
      ${curPlan.scale ? '<button class="btn sm" id="mk-rescale">Reset scale</button>' : ''}</div>`;
  } else if (mk.tool === 'text') {
    context = `<div class="mk-row mk-ctx"><span>Text size</span>${Object.keys(TEXT_SIZES).map((k) => `<button class="btn sm mk-size ${mk.size === k ? 'is-on' : ''}" data-s="${k}">${k}</button>`).join('')}</div>`;
  }
  panel.innerHTML = `
    ${context}
    <div class="mk-row mk-tools" role="toolbar" aria-label="Markup tools">
      ${TOOLS.map((t) => `<button class="mk-tool ${mk.tool === t.id ? 'is-on' : ''}" data-t="${t.id}" aria-pressed="${mk.tool === t.id}">${icon(icons[t.id])}<span>${t.label}</span></button>`).join('')}
    </div>
    <div class="mk-row">
      <span class="mk-colors">${MK_COLORS.map((c) => `<button class="mk-color ${mk.color === c ? 'is-on' : ''}" data-c="${c}" style="--c:${c}" aria-label="Colour"></button>`).join('')}</span>
      <button class="icon-btn" id="mk-undo" aria-label="Undo">${icon('undo')}</button>
      <button class="btn primary sm" id="mk-done">Done</button>
    </div>`;
  const banner = $('#banner');
  banner.hidden = false;
  banner.innerHTML = `<span>${esc(TOOL_HINT[mk.tool])}</span>`;
  $$('.mk-tool', panel).forEach((b) => (b.onclick = () => {
    mk.tool = b.dataset.t;
    mk.selected = null;
    mk.draft = null;
    drawMarkups();
    drawMarkupPanel();
  }));
  $$('.mk-color', panel).forEach((b) => (b.onclick = async () => {
    mk.color = b.dataset.c;
    if (sel) await savePlanMarkups({ markups: curPlan.markups.map((m) => (m.id === sel.id ? { ...m, color: mk.color } : m)) }, 'Colour changed');
    drawMarkupPanel();
  }));
  $$('.mk-size', panel).forEach((b) => (b.onclick = () => { mk.size = b.dataset.s; drawMarkupPanel(); }));
  $('#mk-done').onclick = () => setMarkup(false);
  $('#mk-undo').onclick = async () => {
    if (mk.draft?.pts?.length) {
      // still tapping the corners of an area: remove the last corner
      mk.draft.pts.pop();
      if (!mk.draft.pts.length) mk.draft = null;
      drawMarkups();
      return drawMarkupPanel();
    }
    await doUndo();
  };
  $('#mk-del')?.addEventListener('click', async () => {
    await savePlanMarkups({ markups: curPlan.markups.filter((m) => m.id !== sel.id), ...(sel.guide ? { scale: null } : {}) }, 'Markup deleted');
    mk.selected = null;
    drawMarkupPanel();
  });
  $('#mk-edit')?.addEventListener('click', async () => {
    const t = await askText(sel.text, sel.size);
    if (t) await savePlanMarkups({ markups: curPlan.markups.map((m) => (m.id === sel.id ? { ...m, text: t.text, size: t.size } : m)) });
    drawMarkupPanel();
  });
  $('#mk-rescale')?.addEventListener('click', async () => {
    const guide = (curPlan.markups || []).find((m) => m.guide);
    if (guide && sel?.id === guide.id) {
      const scale = await askScale(guide.pts);
      if (scale) await savePlanMarkups({ scale });
    } else {
      await savePlanMarkups({ scale: null, markups: (curPlan.markups || []).map((m) => ({ ...m, guide: false })) });
      toast('Scale cleared. Your next measure line sets it again.');
    }
    drawMarkupPanel();
  });
  $('#mk-area-done')?.addEventListener('click', finishArea);
}

async function finishArea() {
  const pts = mk.draft?.pts || [];
  mk.draft = null;
  if (pts.length >= 3) await addMarkup({ type: 'area', pts });
  drawMarkups();
  drawMarkupPanel();
}

async function askText(text = '', size = mk.size) {
  const r = await dialog({
    title: 'Text bubble',
    body: `<label class="field"><span>Text</span><textarea name="text" id="mk-text" rows="3" required placeholder="e.g. Fire stopping required above door">${esc(text)}</textarea></label>
      <label class="field"><span>Size</span><select name="size" id="mk-tsize">${Object.keys(TEXT_SIZES).map((k) => `<option ${k === size ? 'selected' : ''}>${k}</option>`).join('')}</select></label>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, kind: 'primary' }],
  });
  if (r.value !== true || !r.data.text.trim()) return null;
  mk.size = r.data.size;
  return { text: r.data.text.trim(), size: r.data.size };
}

async function askScale(pts) {
  const px = lineLengthPx(curPlan, pts[0], pts[1]);
  const r = await dialog({
    title: 'Set the scale',
    body: `<p>How long is this line in real life? Every measurement on this drawing is worked out from it.</p>
      <div class="grid2">
        <label class="field"><span>Length</span><input name="len" id="mk-len" type="number" inputmode="decimal" min="0" step="any" required placeholder="e.g. 926"></label>
        <label class="field"><span>Unit</span><select name="unit" id="mk-unit"><option value="mm">mm</option><option value="m">m</option></select></label>
      </div>
      <p class="muted small">Tip: draw along a door opening, a grid line or a printed dimension for an accurate scale.</p>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Set scale', value: true, kind: 'primary' }],
  });
  const len = Number(r.data?.len);
  if (r.value !== true || !(len > 0) || !px) return null;
  const metres = r.data.unit === 'mm' ? len / 1000 : len;
  toast(`Scale set: this line is ${fmtLength(metres)}`);
  return metres / px;
}

// one-finger gestures while Markup is on (two fingers still zoom and pan)
const markupHandler = {
  down(p, target) {
    const pt = P(p);
    if (mk.tool === 'select') {
      const id = target?.closest?.('[data-mk]')?.dataset.mk || null;
      mk.selected = id && id !== '__draft' ? id : null;
      const m = (curPlan.markups || []).find((x) => x.id === mk.selected);
      if (m) mk.color = m.color || mk.color;
      drawMarkups();
      drawMarkupPanel();
      return;
    }
    if (mk.tool === 'area') return; // corners are added on lift
    mk.draft = { type: mk.tool, color: mk.color, pts: mk.tool === 'pen' ? [pt] : [pt, pt] };
    drawMarkups();
  },
  move(p) {
    const pt = P(p);
    const d = mk.draft;
    if (!d || mk.tool === 'select' || mk.tool === 'area') return;
    if (mk.tool === 'pen') {
      const last = d.pts[d.pts.length - 1];
      if (Math.hypot((pt[0] - last[0]) * curPlan.width, (pt[1] - last[1]) * curPlan.height) * viewer.s > 3) d.pts.push(pt);
    } else d.pts[1] = pt;
    // a text bubble being dragged shows its leader line as a preview
    if (mk.tool === 'text') d.type = 'line';
    drawMarkups();
  },
  async up(p) {
    const pt = P(p);
    const d = mk.draft;
    const screenLen = (a, b) => Math.hypot((b[0] - a[0]) * curPlan.width, (b[1] - a[1]) * curPlan.height) * viewer.s;
    if (mk.tool === 'select') return;
    if (mk.tool === 'area') {
      const pts = mk.draft?.pts || [];
      if (pts.length >= 3 && screenLen(pts[0], pt) < 24) return finishArea(); // tapped the first corner
      mk.draft = { type: 'area', color: mk.color, pts: [...pts, pt] };
      drawMarkups();
      return drawMarkupPanel();
    }
    mk.draft = null;
    if (!d) return drawMarkups();
    if (mk.tool === 'text') {
      const moved = screenLen(d.pts[0], pt) > 12;
      const t = await askText('', mk.size);
      if (t) await addMarkup({ type: 'text', pts: moved ? [d.pts[0], pt] : [pt], ...t });
      return drawMarkups();
    }
    if (mk.tool === 'pen') {
      if (d.pts.length > 1) await addMarkup({ type: 'pen', pts: d.pts });
      return drawMarkups();
    }
    d.pts[1] = pt;
    if (screenLen(d.pts[0], d.pts[1]) < 10) return drawMarkups(); // too short: treat as a stray tap
    if (mk.tool === 'measure' && !curPlan.scale) {
      drawMarkups();
      mk.draft = d; // keep it visible while asking
      drawMarkups();
      const scale = await askScale(d.pts);
      mk.draft = null;
      if (scale) {
        await savePlanMarkups({ scale });
        await addMarkup({ type: 'measure', pts: d.pts, guide: true });
      }
      drawMarkupPanel();
      return drawMarkups();
    }
    await addMarkup({ type: mk.tool, pts: d.pts });
  },
  cancel() {
    if (mk.tool !== 'area') mk.draft = null;
    drawMarkups();
  },
};

function setMode(m, doorId = null) {
  mode = m;
  selectedPin = m === 'move' ? doorId : null;
  if (viewer) viewer.dragPinId = m === 'move' ? doorId : null;
  const banner = $('#banner');
  const add = $('#add-door');
  if (!banner) return;
  if (m === 'add') {
    banner.hidden = false;
    banner.innerHTML = `<span>Tap the plan where the door is</span><button class="btn sm" id="cancel-mode">Cancel</button>`;
    add.classList.add('is-on');
    add.innerHTML = `${icon('close')} Cancel`;
  } else if (m === 'move') {
    banner.hidden = false;
    banner.innerHTML = `<span>Drag the pin, or tap its new position</span><button class="btn sm" id="cancel-mode">Done</button>`;
  } else if (m === 'place') {
    banner.hidden = false;
    banner.innerHTML = `<span>Tap where ${esc(placingLabel)} is</span><button class="btn sm" id="cancel-mode">Cancel</button>`;
  } else if (m === 'hint') {
    banner.hidden = false;
    banner.innerHTML = `<span>Tip: press and hold a pin to drag it</span><button class="btn sm" id="cancel-mode">OK</button>`;
  } else {
    banner.hidden = true;
    add.classList.remove('is-on');
    add.innerHTML = `${icon('pin')} Add door`;
  }
  $('#cancel-mode')?.addEventListener('click', () => setMode(null));
  $('.viewer')?.classList.toggle('is-adding', m === 'add' || m === 'move');
  refreshPins();
}

async function onPlanTap(x, y) {
  if (mode === 'hint') return setMode(null);
  if (mode === 'place' && placingId) {
    const d = await db.get('doors', placingId);
    placingId = null;
    setMode(null);
    if (d) {
      await saveDoor({ ...d, planId: state.planId, x, y });
      pushUndo(`Pin ${d.pinNo} placed`, async () => saveDoor({ ...(await db.get('doors', d.id)), planId: null, x: null, y: null }));
      toast(`Pin ${d.pinNo} placed`);
      await refreshPins();
      updatePlaceButton();
    }
    return;
  }
  if (mode === 'add') {
    const pinNo = await db.nextPinNo(state.projectId);
    const door = await saveDoor({
      id: db.uid(), projectId: state.projectId, planId: state.planId, pinNo, x, y,
      ref: '', location: '', doorType: '', leaf: '', status: 'not_inspected', defects: [], actions: [], checks: {}, materials: [], notes: '',
      zoneNo: lastZone.planId === state.planId ? lastZone.no : '', zoneName: lastZone.planId === state.planId ? lastZone.name : '',
      inspectedOn: '', inspectedBy: lists.inspector || '', category: lastCategory.planId === state.planId ? lastCategory.value : '',
    });
    pushUndo(`Pin ${pinNo} added`, () => db.deleteDoor(door.id));
    setMode(null);
    go({ ...state, doorId: door.id, isNew: true });
  } else if (mode === 'move' && selectedPin) {
    const d = await db.get('doors', selectedPin);
    pushUndo(`Pin ${d.pinNo} moved`, async () => saveDoor({ ...(await db.get('doors', d.id)), x: d.x, y: d.y }));
    await saveDoor({ ...d, x, y });
    toast('Pin moved');
    setMode(null);
  }
}

async function refreshPins() {
  if (!viewer) return;
  const all = (await db.byIndex('doors', 'planId', state.planId)).sort((a, b) => a.pinNo - b.pinNo);
  const doors = all.filter(pinMatches);
  const filtered = doors.length !== all.length || planFilter.cats.length || planFilter.statuses.length;
  $('#plan-filter')?.classList.toggle('is-on', !!(planFilter.cats.length || planFilter.statuses.length));
  viewer.setPins(
    doors.map((d) => ({
      id: d.id, x: d.x, y: d.y, label: d.pinNo,
      color: statusById[d.status || 'not_inspected'].color,
      hollow: (d.status || 'not_inspected') === 'not_inspected',
      title: `Pin ${d.pinNo} ${d.ref || ''} ${statusById[d.status || 'not_inspected'].label}`,
    })),
    selectedPin || state.doorId,
    picked
  );
  const c = countStatuses(doors);
  const el = $('#plan-counts');
  if (el) el.textContent = filtered
    ? `Showing ${doors.length} of ${all.length} · ${[...planFilter.cats.map((x) => x || 'No category'), ...planFilter.statuses.map((x) => statusById[x]?.short || x)].join(', ')}`
    : `${planColl ? collLabel(planColl) + ' · ' : ''}${doors.length} doors · ${c.fail || 0} ${statusById.fail.short.toLowerCase()} · ${c.not_inspected || 0} to do`;
}

// ---------- Door record sheet ----------
let sheetDoorId = null;
let afterSave = null; // refreshes the open door's history after each save
let saveTimer = null;
let pending = null;

async function renderSheet() {
  if (!state.doorId) {
    if (sheetDoorId) {
      await flushSave();
      sheetDoorId = null;
      sheetRoot.innerHTML = '';
      document.body.classList.remove('sheet-open');
      if (state.view === 'project') renderProject();
      else refreshPins();
    }
    return;
  }
  if (sheetDoorId === state.doorId) return;
  sheetDoorId = state.doorId;
  const door = await db.get('doors', state.doorId);
  if (!door) {
    sheetDoorId = null;
    return back();
  }
  document.body.classList.add('sheet-open');
  sheetRoot.innerHTML = `<div class="sheet-backdrop" id="sheet-bd"></div><section class="sheet" role="dialog" aria-label="Door record" id="sheet"></section>`;
  $('#sheet-bd').onclick = () => back();
  await drawSheet(door);
  if (state.view === 'plan') refreshPins();
}

async function drawSheet(door) {
  const el = $('#sheet');
  const plan = await db.get('plans', door.planId);
  useScheme(await db.get('projects', door.projectId));
  const s = statusById[door.status || 'not_inspected'];
  const types = [...new Set([...(lists.doorTypes || []), door.doorType].filter(Boolean))];
  // pass / fail comes from the checklist and defects (unless switched off in
  // Settings, or no checklist is set up)
  const autoRes = lists.autoResult !== false && questionsFor(door, lists.questions || []).length > 0;
  // fire alarm zones already used on this project: number → name
  const project = await db.get('projects', door.projectId);
  const zoneMap = new Map((project?.zones || []).filter((z) => z.no).map((z) => [String(z.no), z.name || '']));
  for (const x of await db.byIndex('doors', 'projectId', door.projectId)) {
    if (x.zoneNo && !zoneMap.get(x.zoneNo)) zoneMap.set(x.zoneNo, x.zoneName || '');
  }
  const zones = [...zoneMap.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  el.innerHTML = `
    <div class="sheet-grip" aria-hidden="true"></div>
    <header class="sheet-head">
      <span class="pin-badge lg ${s.id === 'not_inspected' ? 'is-hollow' : ''}" id="sh-badge" style="--pin:${s.color}">${door.pinNo}</span>
      <div class="sheet-title"><b id="sh-title">${esc(door.ref || 'Door ' + door.pinNo)}</b><small>${esc(plan?.name || '')} <span id="saved" class="saved">Saved</span></small></div>
      <button class="icon-btn" id="sh-close" aria-label="Close">${icon('close')}</button>
    </header>
    <div class="sheet-body">
      ${door.planId ? `<button type="button" class="door-map" id="door-map" aria-label="Show on the drawing"><img alt="Where this door is on ${esc(plan?.name || 'the drawing')}" id="door-map-img"><span>${icon('plan')} ${esc(plan?.name || 'Drawing')} · tap to view</span></button>` : ''}
      <fieldset class="status-set" aria-label="Status">
        ${STATUSES.filter((st) => !autoRes || !['pass', 'fail'].includes(st.id)).map((st) => `<label class="status-opt" style="--c:${st.color}"><input type="radio" name="status" value="${st.id}" ${st.id === (door.status || 'not_inspected') ? 'checked' : ''}><span>${st.label}</span></label>`).join('')}
      </fieldset>
      ${autoRes ? '<p class="auto-res" id="auto-res"></p>' : ''}

      <div class="grid2">
        <label class="field"><span>Door ref / ID</span><input id="f-ref" data-k="ref" value="${esc(door.ref)}" placeholder="e.g. GF-012" autocomplete="off"></label>
        <label class="field"><span>Location / room</span><input id="f-location" data-k="location" value="${esc(door.location)}" placeholder="e.g. Bedroom 4" autocomplete="off"></label>
        <label class="field"><span>Door type</span>
          <select id="f-type" data-k="doorType"><option value="">Select…</option>${types.map((t) => `<option ${t === door.doorType ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        </label>
        <label class="field"><span>Leaf configuration</span>
          <select id="f-leaf" data-k="leaf">${LEAF_CONFIGS.map((t) => `<option value="${esc(t)}" ${t === (door.leaf || '') ? 'selected' : ''}>${esc(t || 'Select…')}</option>`).join('')}</select>
        </label>
        <label class="field"><span>Fire alarm zone no.</span><input id="f-zone" data-k="zoneNo" value="${esc(door.zoneNo)}" placeholder="e.g. 4" autocomplete="off" list="zone-nos"></label>
        <label class="field"><span>Fire alarm zone name</span><input id="f-zname" data-k="zoneName" value="${esc(door.zoneName)}" placeholder="e.g. East wing ground floor" autocomplete="off" list="zone-names"></label>
      </div>
      <label class="field"><span class="field-head">Category <button type="button" class="link-btn" id="cat-edit">Edit list</button></span>
        <select id="f-cat" data-k="category">${['', ...new Set([...(lists.categories || DEFAULT_CATEGORIES), door.category].filter(Boolean))].map((c) => `<option value="${esc(c)}" ${c === (door.category || '') ? 'selected' : ''}>${esc(c || 'No category')}</option>`).join('')}<option value="__new">+ Add new category…</option></select>
      </label>
      <label class="field"><span>Risk rating</span>
        <select id="f-risk" data-k="risk">${['', ...new Set([...(lists.risks || DEFAULT_RISKS), door.risk].filter(Boolean))].map((r) => `<option value="${esc(r)}" ${r === (door.risk || '') ? 'selected' : ''}>${esc(r || NO_RISK)}</option>`).join('')}</select>
      </label>
      <datalist id="zone-nos">${zones.map(([n, nm]) => `<option value="${esc(n)}">${esc(nm)}</option>`).join('')}</datalist>
      <datalist id="zone-names">${[...new Set(zones.map(([, nm]) => nm).filter(Boolean))].map((nm) => `<option value="${esc(nm)}"></option>`).join('')}</datalist>

      <section class="block">
        <div class="block-head"><h3>Inspection questions <span class="muted" id="q-n"></span></h3>
          <span class="row-btns">
            <button type="button" class="btn sm q-all q-all-pass" id="q-all-pass" aria-pressed="false" title="Set every question to ${esc(ANSWERS[0].label)}; tap again to undo">${icon('check')} All ${esc(ANSWERS[0].label)}</button>
            <button type="button" class="btn sm q-all q-all-fail" id="q-all-fail" aria-pressed="false" title="Set every question to ${esc(ANSWERS[1].label)}; tap again to undo">${icon('close')} All ${esc(ANSWERS[1].label)}</button>
            <button type="button" class="btn sm q-all q-rest-na" id="q-rest-na" aria-pressed="false" title="Answer only the unanswered questions ${esc(ANSWERS[2].label)}; tap again to undo">Rest ${esc(ANSWERS[2].label)}</button>
            <button type="button" class="btn ghost sm" id="q-arrange" aria-pressed="false">${icon('grip')} Arrange</button>
            <button class="btn ghost sm" id="q-edit">${icon('gear')} Edit questions</button>
          </span>
        </div>
        <div class="q-list" id="questions"></div>
      </section>

      <section class="block">
        <div class="block-head"><h3>Photos &amp; videos <span class="muted" id="ph-n"></span></h3>
          <div class="row-btns">
            <label class="btn sm">${icon('camera')} Photo<input type="file" accept="image/*" capture="environment" id="ph-cam" hidden></label>
            <label class="btn sm">${icon('video')} Video<input type="file" accept="video/*" capture="environment" id="ph-vid" hidden></label>
            <label class="btn sm">${icon('image')} Gallery<input type="file" accept="image/*,video/*" multiple id="ph-lib" hidden></label>
          </div>
        </div>
        <div class="photo-strip" id="photos"></div>
      </section>

      <section class="block">
        <div class="block-head"><h3>Defects &amp; remedial work <span class="muted" id="def-n"></span></h3>
          <button class="btn sm" id="add-defect">${icon('plus')} Add defect</button>
        </div>
        <div id="defects"></div>
      </section>

      <section class="block">
        <div class="block-head"><h3>Recommended actions <span class="muted" id="act-n"></span></h3>
          <button class="btn sm" id="add-action">${icon('plus')} Add action</button>
        </div>
        <div id="actions"></div>
      </section>

      <section class="block" ${(door.signs || []).length ? '' : 'hidden'}>
        <div class="block-head"><h3>Signs <span class="muted" id="sign-n"></span></h3></div>
        <div class="sign-add" id="sign-add"></div>
        <div id="signs"></div>
      </section>

      <section class="block">
        <div class="block-head"><h3>Materials</h3>
          <span class="row-btns"><button class="btn ghost sm" id="fill-mats" hidden>${icon('check')} From defects</button>
          <button class="btn sm" id="add-material">${icon('plus')} Add material</button></span>
        </div>
        <div id="materials"></div>
      </section>

      <label class="field"><span>Notes</span><textarea id="f-notes" data-k="notes" rows="3" placeholder="Anything else about this door">${esc(door.notes)}</textarea></label>
      <div class="grid2">
        <label class="field"><span>Inspected on</span><input type="date" id="f-on" data-k="inspectedOn" value="${esc(door.inspectedOn)}"></label>
        <label class="field"><span>Inspected by</span><input id="f-by" data-k="inspectedBy" value="${esc(door.inspectedBy)}" placeholder="Name"></label>
        <label class="field"><span>Next inspection due</span><input type="date" id="f-due" data-k="nextDue" value="${esc(door.nextDue || '')}"></label>
      </div>
      ${lists.gps !== false ? '<p class="gps-line" id="gps-line"></p>' : ''}

      <section class="block">
        <div class="block-head"><h3>History</h3>
          <button class="btn sm" id="new-insp">${icon('plus')} New inspection</button>
        </div>
        <div id="history"></div>
      </section>

      <div class="sheet-actions">
        ${!door.planId ? `<button class="btn primary" id="sh-place">${icon('pin')} Place on drawing</button>`
          : state.view === 'plan' ? `<button class="btn" id="sh-move">${icon('move')} Move pin</button>` : `<button class="btn" id="sh-show">${icon('plan')} Show on plan</button>`}
        <button class="btn" id="sh-dup">${icon('plus')} Duplicate door</button>
        <button class="btn ghost danger-text" id="sh-del">${icon('trash')} Delete door</button>
      </div>
    </div>`;

  let current = door;
  let redrawDefects = null;
  // A failed checklist question adds its defect (and that defect's usual
  // product); answering it again as pass / N/A takes them back off.
  const syncChecks = (patch) => {
    const checks = patch.checks;
    const qs = lists.questions || [];
    let defects = [...(patch.defects || current.defects || [])];
    let mats = [...(patch.materials || current.materials || [])];
    let changed = false;
    for (const q of qs) {
      const label = q.defect || QUESTION_DEFECT[q.id];
      if (!label) continue;
      const failed = checks[q.id]?.answer === 'fail';
      const has = defects.find((x) => x.label === label);
      if (failed && !has) {
        const tmpl = (lists.defects || []).find((x) => x.label === label) || { label, remedial: '' };
        const nd = { label, remedial: tmpl.remedial || '', qty: 1, fromQ: q.id };
        defects.push(nd);
        mats.push(...defaultProductsFor(nd, lists.materials || [], db.uid));
        changed = true;
      } else if (!failed && has?.fromQ === q.id) {
        defects = defects.filter((x) => x !== has);
        mats = mats.filter((m) => m.forKey !== 'd:' + label);
        changed = true;
      }
    }
    if (changed) { patch.defects = defects; patch.materials = mats; setTimeout(() => redrawDefects?.(), 0); }
    return patch;
  };
  const queue = (patch) => {
    if ('checks' in patch) patch = syncChecks({ ...patch });
    current = { ...current, ...patch };
    pending = current;
    $('#saved').textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 400);
    // inspecting (status, checklist or defects) records where the phone is
    if ((patch.status && patch.status !== 'not_inspected') || 'checks' in patch || 'defects' in patch) stampGps();
  };
  // ---- location of the inspector for this visit
  let gpsBusy = false;
  const showGps = (failed = false) => {
    const el2 = $('#gps-line');
    if (!el2) return;
    const g = current.gps;
    el2.innerHTML = g
      ? `${icon('pin')} <span>Recorded at <b>${esc(gpsText(g))}</b> · ${esc(new Date(g.at).toLocaleString('en-IE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span> <a href="${mapLink(g)}" target="_blank" rel="noopener">View map</a>`
      : failed ? `${icon('pin')} <span class="muted">Location not recorded: ${esc(geoError() || 'not available here')}</span>`
        : `${icon('pin')} <span class="muted">Your location is recorded when you inspect this door.</span>`;
  };
  const stampGps = async () => {
    if (lists.gps === false || gpsBusy) return;
    const visit = current.inspectedOn || today();
    if (current.gps?.visit === visit) return;
    gpsBusy = true;
    const g = await getPosition();
    gpsBusy = false;
    if (g && current.id === door.id) {
      queue({ gps: { ...g, visit } });
      showGps();
    } else showGps(true);
  };
  const setStatus = (id) => {
    const st = statusById[id];
    $('#sh-badge').style.setProperty('--pin', st.color);
    $('#sh-badge').classList.toggle('is-hollow', id === 'not_inspected');
    const patch = { status: id };
    if (id !== 'not_inspected' && !current.inspectedOn) {
      patch.inspectedOn = today();
      $('#f-on').value = patch.inspectedOn;
    }
    queue(patch);
  };

  // The door's result, worked out from its checklist and defects:
  //   any failed check or any defect → fail; everything answered → pass.
  // Not applicable / No access / Repaired are left alone.
  const showStatus = (id) => {
    const st = statusById[id || 'not_inspected'];
    $('#sh-badge').style.setProperty('--pin', st.color);
    $('#sh-badge').classList.toggle('is-hollow', st.id === 'not_inspected');
    const r = $(`input[name=status][value=${st.id}]`, el);
    if (r) r.checked = true;
    else $$('input[name=status]', el).forEach((x) => (x.checked = false));
    const ar = $('#auto-res');
    if (ar) {
      ar.innerHTML = ['pass', 'fail'].includes(st.id)
        ? `Result: <span class="status-pill" style="--c:${st.color}">${esc(st.label)}</span> <small>from the checklist and defects</small>`
        : st.id === 'not_inspected' ? '<small>The result is set from the checklist: any failed check or defect gives <b>' + esc(statusById.fail.label) + '</b>, all answered gives <b>' + esc(statusById.pass.label) + '</b>.</small>' : '';
    }
  };
  const autoFail = (patch) => {
    const merged = { ...current, ...patch };
    const cur = merged.status || 'not_inspected';
    if (autoRes && ['not_inspected', 'pass', 'fail'].includes(cur)) {
      const qs = questionsFor(merged, lists.questions || []);
      const checks = merged.checks || {};
      const failed = (merged.defects || []).length > 0 || qs.some((q) => checks[q.id]?.answer === 'fail');
      const allDone = qs.length > 0 && qs.every((q) => checks[q.id]?.answer);
      const next = failed ? 'fail' : allDone ? 'pass' : 'not_inspected';
      if (next !== cur) patch.status = next;
    } else if (!autoRes && ['not_inspected', 'pass'].includes(cur) && ((merged.defects || []).length || Object.values(merged.checks || {}).some((c) => c?.answer === 'fail'))) {
      patch.status = 'fail';
    }
    if (patch.status) showStatus(patch.status);
    if (!current.inspectedOn && (patch.status || '') !== 'not_inspected') {
      patch.inspectedOn = today();
      $('#f-on').value = patch.inspectedOn;
    }
    return patch;
  };

  $('#sh-close').onclick = () => back();
  $$('input[name=status]', el).forEach((r) => (r.onchange = () => {
    setStatus(r.value);
    // back to "Not inspected" with a checklist: work the result out again
    if (autoRes && r.value === 'not_inspected') queue(autoFail({}));
    else showStatus(r.value);
  }));
  showStatus(door.status);
  showGps();
  // Redraw the whole record (after history changes), keeping the scroll place
  const redraw = async () => {
    await flushSave();
    const top = el.scrollTop;
    await drawSheet(await db.get('doors', door.id));
    el.scrollTop = top;
  };
  // Keep the current inspection in history, then start from `patch`
  const archive = async (patch, message) => {
    const old = current.inspectedOn || '';
    queue({ ...patch, history: [snapshotOf(current), ...(current.history || [])] });
    await flushSave();
    await tagPhotosForSnapshot(door.id, old);
    toast(message);
    await redraw();
  };
  let dateAsk = false;
  const hasInspection = () => (current.status || 'not_inspected') !== 'not_inspected' || Object.keys(current.checks || {}).length;
  $$('[data-k]', el).forEach((inp) => {
    const ev = inp.tagName === 'SELECT' || inp.type === 'date' ? 'change' : 'input';
    inp.addEventListener(ev, () => {
      if (inp.dataset.k === 'inspectedOn') {
        const old = current.inspectedOn || '';
        if (old && inp.value && inp.value !== old && hasInspection()) {
          if (dateAsk) return; // one question at a time
          dateAsk = true;
          const newDate = inp.value;
          dialog({
            title: 'Change inspection date',
            body: `<p>Is this a new visit, or are you correcting the date of the inspection already recorded?</p>`,
            buttons: [
              { label: 'Correct the date', value: 'fix' },
              { label: `Keep ${fmtDate(old)} in history`, value: 'keep', kind: 'primary' },
            ],
          }).then(({ value }) => {
            dateAsk = false;
            if (value === 'keep') archive({ inspectedOn: newDate }, `Inspection of ${fmtDate(old)} saved to history`);
            else if (value === 'fix') queue({ inspectedOn: newDate });
            else inp.value = old; // dismissed: leave the date as it was
          });
          return;
        }
      }
      if (inp.value === '__new') return; // handled by the "Add new category" dialog
      queue({ [inp.dataset.k]: inp.value });
      if (inp.dataset.k === 'ref') $('#sh-title').textContent = inp.value || 'Door ' + door.pinNo;
      if (inp.dataset.k === 'zoneNo' || inp.dataset.k === 'zoneName') {
        // a zone number from the project's zone list fills in its name
        const known = zoneMap.get(inp.value.trim().replace(/^zone\s*/i, ''));
        if (inp.dataset.k === 'zoneNo' && known) {
          $('#f-zname').value = known;
          queue({ zoneName: known });
        }
        Object.assign(lastZone, { planId: door.planId, no: $('#f-zone').value, name: $('#f-zname').value });
      }
      if (inp.dataset.k === 'category') Object.assign(lastCategory, { planId: door.planId, value: inp.value });
    });
  });
  // location map: tap to see the pin on the full drawing
  if (door.planId && plan) {
    const others = await db.byIndex('doors', 'planId', door.planId);
    doorMapURL(plan, door, others, getComputedStyle(document.documentElement).getPropertyValue(statusById[door.status || 'not_inspected'].color.slice(4, -1)).trim() || '#cc2a1f')
      .then((u) => { const img = $('#door-map-img'); if (img) img.src = u; })
      .catch(() => $('#door-map')?.remove());
    $('#door-map').onclick = async () => {
      await flushSave();
      if (state.view === 'plan' && state.planId === door.planId) {
        back();
        setTimeout(() => viewer?.focus(door.x, door.y), 80);
      } else go({ view: 'plan', projectId: door.projectId, planId: door.planId, focusDoor: door.id }, { replace: true });
    };
  }
  // category: add a new one from here, or open the list in Settings
  $('#f-cat').addEventListener('change', async (e) => {
    if (e.target.value !== '__new') return;
    const r = await dialog({
      title: 'New category',
      body: `<label class="field"><span>Category name</span><input name="name" id="cat-new" required placeholder="e.g. Plant room"></label>
        <p class="muted small">It's added to your category list for every door and project. Change the list any time in Settings → Door categories.</p>`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Add', value: true, kind: 'primary' }],
    });
    const name = (r.data?.name || '').trim();
    if (r.value !== true || !name) {
      e.target.value = current.category || '';
      return;
    }
    if (!(lists.categories || []).includes(name)) await saveLists({ categories: [...(lists.categories || DEFAULT_CATEGORIES), name] });
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    e.target.insertBefore(opt, e.target.querySelector('option[value="__new"]'));
    e.target.value = name;
    queue({ category: name });
    Object.assign(lastCategory, { planId: door.planId, value: name });
  });
  $('#cat-edit').onclick = async (e) => {
    e.preventDefault();
    await flushSave();
    go({ view: 'settings', focus: 's-cats' });
  };

  // defects
  // Each defect has its own list of products that fix it, each with a quantity
  // (e.g. 3 × 10 mm seal + 4 × 20 mm seal). They are stored as the door's
  // materials, tagged with the defect, so they are costed with everything else.
  const prodOptions = (d) => {
    const cat = defectCat(d);
    return { cat, opts: (lists.materials || []).filter((m) => m.name?.trim() && (!cat || matCat(m) === cat)) };
  };
  const drawDefects = () => {
    const list = current.defects || [];
    $('#def-n').textContent = list.length ? `(${list.length})` : '';
    $('#defects').innerHTML = list.length
      ? list.map((d, i) => {
        const key = 'd:' + d.label;
        const linked = (current.materials || []).filter((m) => m.forKey === key);
        const { cat, opts } = prodOptions(d);
        return `
        <div class="defect" data-i="${i}">
          <div class="defect-top"><b>${esc(d.label)}</b><button class="icon-btn sm def-del" aria-label="Remove defect">${icon('close')}</button></div>
          <div class="defect-fields ${linked.length ? 'no-qty' : ''}">
            <label class="field"><span>Remedial work</span><textarea rows="2" class="def-rem" id="def-rem-${i}">${esc(d.remedial)}</textarea></label>
            ${linked.length ? '' : `<label class="field qty"><span>Qty</span><input type="number" inputmode="numeric" min="1" class="def-qty" id="def-qty-${i}" value="${esc(d.qty ?? 1)}"></label>`}
          </div>
          <div class="def-prods">
            ${linked.length ? `<span class="def-prods-h">Products${cat ? ' · ' + esc(cat) : ''}</span>` : ''}
            ${linked.map((m) => `
              <div class="def-prod-row" data-id="${esc(m.id)}">
                <select class="dp-name" aria-label="Product">
                  ${opts.map((o) => `<option value="${esc(o.id)}" ${o.name === m.name ? 'selected' : ''}>${esc(o.name)}${o.cost && priced() ? ' – ' + euro(o.cost) : ''}</option>`).join('')}
                  ${!opts.some((o) => o.name === m.name) ? `<option value="" selected>${esc(m.name)}</option>` : ''}
                </select>
                <span class="stepper"><button type="button" class="dp-minus" aria-label="One fewer">−</button><input class="dp-qty" type="number" inputmode="decimal" min="0" step="any" value="${esc(m.qty ?? 1)}" aria-label="Quantity"><button type="button" class="dp-plus" aria-label="One more">+</button></span>
                <input class="dp-spec" value="${esc(m.spec || '')}" placeholder="${cat === 'Signs' ? 'e.g. push side' : 'note, e.g. head + hinge side'}" aria-label="Note">
                <button class="icon-btn sm dp-del" aria-label="Remove product">${icon('close')}</button>
              </div>`).join('')}
            ${opts.length ? `<button type="button" class="btn ghost sm dp-add">${icon('plus')} ${linked.length ? 'Add another product' : 'Add product' + (cat ? ' (' + esc(cat.toLowerCase()) + ')' : '')}</button>` : ''}
          </div>
        </div>`;
      }).join('')
      : '<p class="muted small">No defects recorded.</p>';
    const setMat = (id, patch) => queue({ materials: current.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
    $$('.defect', el).forEach((row) => {
      const i = Number(row.dataset.i);
      const d = current.defects[i];
      const key = 'd:' + d.label;
      $('.def-del', row).onclick = () => {
        const defects = [...current.defects];
        defects.splice(i, 1);
        queue(autoFail({ defects, materials: (current.materials || []).filter((m) => m.forKey !== key) }));
        drawDefects();
        drawMaterials();
      };
      $('.def-rem', row).oninput = (e) => {
        queue({ defects: current.defects.map((x, j) => (j === i ? { ...x, remedial: e.target.value } : x)) });
      };
      $('.def-qty', row)?.addEventListener('input', (e) => {
        queue({ defects: current.defects.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 1 } : x)) });
      });
      $('.dp-add', row)?.addEventListener('click', () => {
        const { opts } = prodOptions(d);
        const used = new Set((current.materials || []).filter((m) => m.forKey === key).map((m) => m.name));
        const o = opts.find((x) => !used.has(x.name)) || opts[0];
        queue({ materials: [...(current.materials || []), { id: db.uid(), name: o.name, unit: o.unit || 'each', cost: Number(o.cost) || 0, qty: 1, cat: matCat(o), forKey: key, spec: '' }] });
        drawDefects();
        drawMaterials();
        $$('.dp-name', $$('.defect', el)[i]).at(-1)?.focus();
      });
      $$('.def-prod-row', row).forEach((pr) => {
        const id = pr.dataset.id;
        const qty = $('.dp-qty', pr);
        const setQty = (n) => { qty.value = Math.max(0, Math.round(n * 100) / 100); setMat(id, { qty: Number(qty.value) }); drawMaterials(); };
        qty.oninput = () => { setMat(id, { qty: Number(qty.value) || 0 }); drawMaterials(); };
        $('.dp-minus', pr).onclick = () => setQty((Number(qty.value) || 0) - 1);
        $('.dp-plus', pr).onclick = () => setQty((Number(qty.value) || 0) + 1);
        $('.dp-name', pr).onchange = (e) => {
          const o = (lists.materials || []).find((x) => x.id === e.target.value);
          if (o) { setMat(id, { name: o.name, unit: o.unit || 'each', cost: Number(o.cost) || 0, cat: matCat(o) }); drawMaterials(); }
        };
        $('.dp-spec', pr).oninput = (e) => setMat(id, { spec: e.target.value });
        $('.dp-del', pr).onclick = () => { queue({ materials: current.materials.filter((m) => m.id !== id) }); drawDefects(); drawMaterials(); };
      });
    });
  };
  drawDefects();
  $('#add-defect').onclick = async () => {
    const picked = await pickDefects(current.defects || []);
    if (!picked) return;
    const fresh = picked.map((d) => ({ ...d, qty: 1 }));
    const defects = [...(current.defects || []), ...fresh];
    const patch = { defects, materials: [...(current.materials || []), ...fresh.flatMap((d) => defaultProductsFor(d, lists.materials || [], db.uid))] };
    if (picked.length) autoFail(patch);
    queue(patch);
    drawDefects();
    drawMaterials();
  };
  redrawDefects = () => { drawDefects(); drawMaterials(); };

  // inspection questions
  let arranging = false;
  const openNotes = new Set(); // questions with their note box open
  const drawQuestions = () => {
    if (!$('#questions')) return;
    const qs = questionsFor(current, lists.questions || []);
    const checks = current.checks || {};
    const answered = qs.filter((q) => checks[q.id]?.answer).length;
    const fails = qs.filter((q) => checks[q.id]?.answer === 'fail').length;
    $('#q-n').textContent = qs.length ? `(${answered}/${qs.length}${fails ? ` · ${fails} fail` : ''})` : '';
    // All … toggles light up when every answer matches; Rest N/A while the
    // questions it filled are still N/A
    const allAre = (a) => qs.length > 0 && qs.every((q) => checks[q.id]?.answer === a);
    const memo = restMemo.get(door.id);
    for (const [id, on] of [['#q-all-pass', allAre('pass')], ['#q-all-fail', allAre('fail')], ['#q-rest-na', !!(memo && restStillSet(memo))]]) {
      $(id).hidden = !qs.length || arranging;
      $(id).setAttribute('aria-pressed', String(on));
    }
    $('#q-arrange').setAttribute('aria-pressed', String(arranging));
    $('#q-arrange').innerHTML = arranging ? `${icon('check')} Done arranging` : `${icon('grip')} Arrange`;
    if (arranging) return drawArrange();
    $('#questions').innerHTML = qs.length
      ? qs.map((q, i) => {
        const a = checks[q.id]?.answer || '';
        const note = checks[q.id]?.note || '';
        const open = note || openNotes.has(q.id);
        return `
        <div class="q-row ${a ? 'is-' + a : ''}" data-id="${esc(q.id)}">
          <span class="q-text"><span class="q-no">${i + 1}</span><span class="q-label">${esc(q.text)}${q.removed ? ` <small class="muted">(${q.hidden ? 'hidden question' : 'removed from list'})</small>` : ''}</span>
            <button type="button" class="q-note-btn ${note ? 'has-note' : ''}" aria-label="${note ? 'Edit note' : 'Add a note'}" aria-expanded="${!!open}">${icon('pencil')}<span>${note ? 'Note' : 'Note'}</span></button></span>
          <span class="q-ans" role="group" aria-label="Answer">
            ${ANSWERS.map((x) => `<button type="button" class="q-btn q-${x.id}" data-a="${x.id}" aria-pressed="${a === x.id}">${x.label}</button>`).join('')}
          </span>
          ${open ? `<textarea class="q-note" id="q-note-${esc(q.id)}" rows="2" placeholder="Note on this check, e.g. closer leaking oil">${esc(note)}</textarea>` : ''}
        </div>`;
      }).join('')
      : '<p class="muted small">No questions set up. Add them in Settings.</p>';
    $$('.q-row', el).forEach((row) => {
      $$('.q-btn', row).forEach((b) => (b.onclick = () => {
        const q = qs.find((x) => x.id === row.dataset.id);
        const checks = { ...(current.checks || {}) };
        const prev = checks[q.id]?.answer;
        const keepNote = checks[q.id]?.note;
        if (prev === b.dataset.a) {
          // tap again to clear the answer (a note stays)
          if (keepNote) checks[q.id] = { text: q.text, note: keepNote };
          else delete checks[q.id];
        } else checks[q.id] = { ...checks[q.id], text: q.text, answer: b.dataset.a };
        queue(autoFail({ checks }));
        drawQuestions();
      }));
      const id = row.dataset.id;
      $('.q-note-btn', row).onclick = () => {
        if (openNotes.has(id) && !(current.checks?.[id]?.note)) openNotes.delete(id);
        else openNotes.add(id);
        drawQuestions();
        $(`#q-note-${CSS.escape(id)}`)?.focus();
      };
      const ta = $('.q-note', row);
      if (ta) ta.oninput = () => {
        const q = qs.find((x) => x.id === id);
        const checks = { ...(current.checks || {}) };
        const v = ta.value;
        if (v.trim()) checks[id] = { ...checks[id], text: q.text, note: v };
        else if (checks[id]) {
          const { note, ...rest } = checks[id];
          if (rest.answer) checks[id] = rest;
          else delete checks[id];
        }
        queue({ checks });
        const btn = $('.q-note-btn', row);
        btn.classList.toggle('has-note', !!v.trim());
      };
    });
  };
  drawQuestions();
  $('#q-edit').onclick = async () => {
    await flushSave();
    go({ view: 'settings', focus: 's-qs' });
  };
  // All No action / All Action: set every question; tap the same one again to
  // put the answers back as they were, or tap the other to switch across.
  let beforeAll = null;
  const toggleAll = (answer) => {
    const qs = questionsFor(current, lists.questions || []);
    const cur = current.checks || {};
    const allAre = (a) => qs.length > 0 && qs.every((q) => cur[q.id]?.answer === a);
    let checks;
    if (allAre(answer)) {
      checks = beforeAll ? { ...beforeAll } : Object.fromEntries(Object.entries(cur).filter(([, c]) => c?.note).map(([k, c]) => [k, { text: c.text, note: c.note }]));
      beforeAll = null;
    } else {
      if (!beforeAll || !(allAre('pass') || allAre('fail'))) beforeAll = { ...cur };
      checks = { ...cur };
      for (const q of qs) checks[q.id] = { ...checks[q.id], text: q.text, answer };
    }
    restMemo.delete(door.id);
    queue(autoFail({ checks }));
    drawQuestions();
  };
  $('#q-all-pass').onclick = () => toggleAll('pass');
  $('#q-all-fail').onclick = () => toggleAll('fail');

  // Rest N/A: answer only the questions left unanswered (e.g. a door with no
  // glazing). Tap again to clear just those.
  const restStillSet = (memo) => memo.ids.length > 0 && memo.ids.every((id) => (current.checks || {})[id]?.answer === memo.answer);
  const toggleRest = (answer) => {
    const qs = questionsFor(current, lists.questions || []);
    const checks = { ...(current.checks || {}) };
    const memo = restMemo.get(door.id);
    if (memo && restStillSet(memo)) {
      if (memo.answer === answer) {
        for (const id of memo.ids) {
          // undo, keeping any note
          if (checks[id]?.note) checks[id] = { text: checks[id].text, note: checks[id].note };
          else delete checks[id];
        }
        restMemo.delete(door.id);
      } else {
        for (const id of memo.ids) checks[id] = { ...checks[id], answer }; // switch across
        memo.answer = answer;
      }
    } else {
      const ids = qs.filter((q) => !checks[q.id]?.answer).map((q) => q.id);
      if (!ids.length) return toast('Every question already has an answer.');
      for (const q of qs) if (ids.includes(q.id)) checks[q.id] = { ...checks[q.id], text: q.text, answer };
      restMemo.set(door.id, { answer, ids });
    }
    queue(autoFail({ checks }));
    drawQuestions();
  };
  $('#q-rest-na').onclick = () => toggleRest('na');

  // Arrange: show / hide each question and slide them into your order.
  // This changes the question list used for every door.
  const drawArrange = () => {
    const list = (lists.questions || []).filter((q) => q.text?.trim());
    $('#questions').innerHTML = `
      <p class="muted small arr-note">Drag ${icon('grip')} to move a question, or use the arrows. Tap ${icon('eye')} to hide a question you don't use. This sets the order for every door.</p>
      <div class="arr-list" id="arr-list">
        ${list.map((q, i) => `
          <div class="q-arr ${q.hidden ? 'is-hidden' : ''}" data-id="${esc(q.id)}">
            <button type="button" class="grip" aria-label="Drag to move">${icon('grip')}</button>
            <span class="q-arr-text">${esc(q.text)}</span>
            <span class="q-arr-btns">
              <button type="button" class="icon-btn sm arr-up" aria-label="Move up" ${i ? '' : 'disabled'}>${icon('up')}</button>
              <button type="button" class="icon-btn sm arr-down" aria-label="Move down" ${i < list.length - 1 ? '' : 'disabled'}>${icon('down')}</button>
              <button type="button" class="icon-btn sm arr-eye" aria-label="${q.hidden ? 'Show question' : 'Hide question'}" aria-pressed="${!q.hidden}">${icon(q.hidden ? 'eyeOff' : 'eye')}</button>
            </span>
          </div>`).join('')}
      </div>`;
    const saveOrder = async (ids) => {
      const byId = Object.fromEntries((lists.questions || []).map((q) => [q.id, q]));
      const rest = (lists.questions || []).filter((q) => !ids.includes(q.id));
      await saveLists({ questions: [...ids.map((id) => byId[id]).filter(Boolean), ...rest] });
      drawQuestions();
    };
    makeSortable($('#arr-list'), saveOrder);
    $$('.q-arr', el).forEach((row) => {
      const id = row.dataset.id;
      const ids = () => $$('.q-arr', el).map((r) => r.dataset.id);
      $('.arr-up', row).onclick = () => {
        const o = ids();
        const i = o.indexOf(id);
        if (i > 0) [o[i - 1], o[i]] = [o[i], o[i - 1]];
        saveOrder(o);
      };
      $('.arr-down', row).onclick = () => {
        const o = ids();
        const i = o.indexOf(id);
        if (i < o.length - 1) [o[i + 1], o[i]] = [o[i], o[i + 1]];
        saveOrder(o);
      };
      $('.arr-eye', row).onclick = async () => {
        await saveLists({ questions: lists.questions.map((q) => (q.id === id ? { ...q, hidden: !q.hidden } : q)) });
        queue(autoFail({}));
        drawQuestions();
      };
    });
  };
  $('#q-arrange').onclick = () => {
    arranging = !arranging;
    drawQuestions();
  };

  // recommended actions (several per door)
  const drawActions = () => {
    const list = doorActions(current);
    $('#act-n').textContent = list.length ? `(${list.length})` : '';
    $('#actions').innerHTML = list.length
      ? `<div class="tag-list">${list.map((a, i) => `<span class="tag" data-i="${i}">${esc(a)}<button type="button" class="tag-x" aria-label="Remove ${esc(a)}">${icon('close')}</button></span>`).join('')}</div>`
      : '<p class="muted small">No actions added.</p>';
    $$('.tag', el).forEach((t) => ($('.tag-x', t).onclick = () => {
      const actions = doorActions(current).filter((_, j) => j !== Number(t.dataset.i));
      queue({ actions, action: '' });
      drawActions();
    }));
  };
  drawActions();
  $('#add-action').onclick = async () => {
    const picked = await pickActions(doorActions(current));
    if (!picked?.length) return;
    queue({ actions: [...doorActions(current), ...picked], action: '' });
    drawActions();
  };

  // fire safety signs: several types per door, each with a quantity
  const drawSigns = () => {
    const list = current.signs || [];
    const priced = (lists.materials || []).filter((m) => matCat(m) === 'Signs' && m.name?.trim());
    const types = [...new Set([...(priced.length ? priced.map((m) => m.name) : DEFAULT_SIGNS), ...list.map((x) => x.type)])];
    const need = signsNeeded(current).reduce((a, x) => a + (Number(x.qty) || 0), 0);
    $('#sign-n').textContent = list.length ? `${need} needed` : '';
    $('#sign-add').innerHTML = types.map((t) => `<button type="button" class="chip sign-chip ${list.some((x) => x.type === t) ? 'is-on' : ''}" data-t="${esc(t)}">${icon('plus')} ${esc(t)}</button>`).join('')
      + `<button type="button" class="chip sign-chip" data-t="">${icon('pencil')} Other…</button>`;
    $('#signs').innerHTML = list.length ? list.map((x, i) => `
      <div class="sign-row ${x.state === 'fitted' ? 'is-fitted' : ''}" data-i="${i}">
        <div class="sign-top"><b>${esc(x.type)}</b><button class="icon-btn sm sign-del" aria-label="Remove sign">${icon('close')}</button></div>
        <div class="sign-ctl">
          <span class="stepper"><button type="button" class="sign-minus" aria-label="One fewer">−</button><input class="sign-qty" type="number" inputmode="numeric" min="0" value="${esc(x.qty ?? 1)}" aria-label="Quantity"><button type="button" class="sign-plus" aria-label="One more">+</button></span>
          <select class="sign-face" aria-label="Which face">${['', ...SIGN_FACES].map((f) => `<option value="${esc(f)}" ${f === (x.face || '') ? 'selected' : ''}>${f || 'Face…'}</option>`).join('')}</select>
          <span class="seg sign-state" role="group"><button type="button" class="seg-btn ${x.state !== 'fitted' ? 'is-on' : ''}" data-s="needed">Needed</button><button type="button" class="seg-btn ${x.state === 'fitted' ? 'is-on' : ''}" data-s="fitted">Fitted</button></span>
        </div>
      </div>`).join('') : '<p class="muted small">No signs recorded. Tap a sign above to add it; tap again for another face.</p>';
    const set = (i, patch) => queue({ signs: current.signs.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
    $$('.sign-chip', el).forEach((c) => (c.onclick = async () => {
      let t = c.dataset.t;
      if (!t) {
        const r = await dialog({ title: 'Other sign', body: '<label class="field"><span>Sign wording</span><input name="t" required placeholder="e.g. Fire escape route"></label><label class="check-line"><input type="checkbox" name="keep" checked> Add to my price list (Signs)</label>', buttons: [{ label: 'Cancel', value: false }, { label: 'Add', value: true, kind: 'primary' }] });
        if (r.value !== true || !r.data.t.trim()) return;
        t = r.data.t.trim();
        if (r.data.keep && !(lists.materials || []).some((m) => m.name === t)) await saveLists({ materials: [...(lists.materials || []), { id: db.uid(), cat: 'Signs', name: t, unit: 'each', cost: 0 }] });
      }
      const pm = (lists.materials || []).find((m) => m.name === t && matCat(m) === 'Signs');
      queue({ signs: [...(current.signs || []), { type: t, qty: 1, face: '', state: 'needed', cost: Number(pm?.cost) || 0 }] });
      drawSigns();
    }));
    $$('.sign-row', el).forEach((row) => {
      const i = Number(row.dataset.i);
      const qty = $('.sign-qty', row);
      const setQty = (n) => { qty.value = Math.max(0, n); set(i, { qty: Number(qty.value) }); $('#sign-n').textContent = `${signsNeeded(current).reduce((a, x) => a + (Number(x.qty) || 0), 0)} needed`; };
      qty.oninput = () => setQty(Number(qty.value) || 0);
      $('.sign-minus', row).onclick = () => setQty((Number(qty.value) || 0) - 1);
      $('.sign-plus', row).onclick = () => setQty((Number(qty.value) || 0) + 1);
      $('.sign-face', row).onchange = (e) => set(i, { face: e.target.value });
      $$('.sign-state .seg-btn', row).forEach((b) => (b.onclick = () => { set(i, { state: b.dataset.s }); drawSigns(); }));
      $('.sign-del', row).onclick = () => { queue({ signs: current.signs.filter((_, j) => j !== i) }); drawSigns(); };
    });
  };
  drawSigns();

  // materials with costs
  const drawMaterials = () => {
    const list = current.materials || [];
    $('#materials').innerHTML = list.length
      ? list.map((m, i) => `
        <div class="mat" data-i="${i}">
          <div class="defect-top"><b>${esc(m.name)}${m.forKey ? `<small class="mat-for">for: ${esc(m.forKey.slice(2))}</small>` : ''}</b>
            <span class="row-btns"><button class="btn ghost sm mat-dup" title="Add another size or type of this material">${icon('plus')} size</button>
            <button class="icon-btn sm mat-del" aria-label="Remove material">${icon('close')}</button></span></div>
          <label class="field"><span>Size / type</span><input class="mat-spec" id="mat-spec-${i}" value="${esc(m.spec || '')}" placeholder="e.g. 15 × 4 mm, white, combined" autocomplete="off"></label>
          <div class="mat-fields">
            <label class="field"><span>Qty${m.unit ? ' (' + esc(m.unit) + ')' : ''}</span><input type="number" inputmode="decimal" min="0" step="any" class="mat-qty" id="mat-qty-${i}" value="${esc(m.qty ?? 1)}"></label>
            <label class="field money-f"><span>Unit cost €</span><input type="number" inputmode="decimal" min="0" step="0.01" class="mat-cost" id="mat-cost-${i}" value="${esc(m.cost ?? 0)}"></label>
            <div class="mat-line"><span>Line</span><b class="mat-total">${euro((Number(m.qty) || 0) * (Number(m.cost) || 0))}</b></div>
          </div>
        </div>`).join('') + `<div class="mat-sum"><span>Materials total <small class="muted">ex VAT</small></span><b id="mat-sum">${euro(materialsTotal(current))}</b></div>`
      : '<p class="muted small">No materials added.</p>';
    $$('.mat', el).forEach((row) => {
      const i = Number(row.dataset.i);
      const upd = () => {
        const materials = current.materials.map((m, j) => (j === i ? { ...m, qty: Number($('.mat-qty', row).value) || 0, cost: Number($('.mat-cost', row).value) || 0 } : m));
        queue({ materials });
        const m = materials[i];
        $('.mat-total', row).textContent = euro(m.qty * m.cost);
        $('#mat-sum').textContent = euro(materialsTotal(current));
      };
      $('.mat-qty', row).oninput = upd;
      $('.mat-cost', row).oninput = upd;
      $('.mat-spec', row).oninput = (e) => {
        queue({ materials: current.materials.map((m, j) => (j === i ? { ...m, spec: e.target.value } : m)) });
      };
      $('.mat-dup', row).onclick = () => {
        const m = current.materials[i];
        const materials = [...current.materials];
        materials.splice(i + 1, 0, { ...m, id: db.uid(), spec: '', qty: 1 });
        queue({ materials });
        drawMaterials();
        $(`#mat-spec-${i + 1}`)?.focus();
      };
      $('.mat-del', row).onclick = () => {
        queue({ materials: current.materials.filter((_, j) => j !== i) });
        drawMaterials();
      };
    });
  };
  drawMaterials();
  const showFill = () => {
    const missing = (current.defects || []).filter((x) => !(current.materials || []).some((m) => m.forKey === 'd:' + x.label) && defaultProductsFor(x, lists.materials || [], db.uid).length);
    const b = $('#fill-mats');
    b.hidden = !missing.length;
    b.innerHTML = `${icon('check')} From defects (${missing.length})`;
  };
  showFill();
  $('#fill-mats').onclick = () => {
    const { materials, added } = fillDefectProducts(current, lists.materials || [], db.uid);
    queue({ materials });
    drawDefects();
    drawMaterials();
    showFill();
    toast(`${added} product${added === 1 ? '' : 's'} added from the defects`);
  };
  $('#add-material').onclick = async () => {
    const picked = await pickMaterials();
    if (!picked?.length) return;
    queue({ materials: [...(current.materials || []), ...picked] });
    drawMaterials();
  };

  // photos
  const drawPhotos = async () => {
    const photos = (await db.doorPhotos(door.id)).filter((p) => photoInView(p, { ...current, _current: true }));
    if (!$('#photos')) return; // the door was closed while this loaded
    const nv = photos.filter(isVideo).length;
    $('#ph-n').textContent = photos.length ? `(${photos.length - nv} photo${photos.length - nv === 1 ? '' : 's'}${nv ? `, ${nv} video${nv === 1 ? '' : 's'}` : ''})` : '';
    $('#photos').innerHTML = photos.length
      ? photos.map((p) => isVideo(p)
        ? `<button class="photo is-video" data-id="${p.id}" aria-label="Play video"><img alt="" src="${objUrl(p.thumb)}"><span class="play">${icon('play')}</span><span class="dur">${esc(fmtDuration(p.duration))}</span>${p.link ? `<span class="has-link">${icon('link')}</span>` : ''}</button>`
        : `<button class="photo" data-id="${p.id}"><img alt="Door photo" src="${objUrl(p.thumb)}"></button>`).join('')
      : '<p class="muted small">No photos or videos yet.</p>';
    $$('.photo', el).forEach((b) => (b.onclick = () => openPhoto(photos.find((p) => p.id === b.dataset.id), drawPhotos)));
  };
  drawPhotos();
  const addPhotos = async (files) => {
    if (!files.length) return;
    const bz = busy('Saving…');
    try {
      let bigVideo = false;
      for (const f of files) {
        if (f.type.startsWith('video/') || /\.(mov|mp4|m4v|webm|3gp)$/i.test(f.name)) {
          bz.update('Saving video…');
          const info = await videoInfo(f);
          await db.put('photos', {
            id: db.uid(), projectId: door.projectId, doorId: door.id, kind: 'video', inspection: current.inspectedOn || '',
            blob: f, mime: f.type || 'video/mp4', size: f.size, name: f.name, link: '', ...info,
          });
          if (f.size > 150 * 1048576) bigVideo = true;
        } else {
          bz.update('Saving photo…');
          const { blob, thumb, width, height } = await compressImage(f, 1600, 0.8);
          const gps = lists.gps !== false ? await getPosition({ timeout: 4000 }) : null;
          await db.put('photos', { id: db.uid(), projectId: door.projectId, doorId: door.id, inspection: current.inspectedOn || '', blob, thumb, width, height, ...(gps ? { gps } : {}) });
        }
      }
      bz.done();
      const nVid = files.filter((f) => f.type.startsWith('video/') || /\.(mov|mp4|m4v|webm|3gp)$/i.test(f.name)).length;
      const nPh = files.length - nVid;
      await flushSave();
      await logEvent(door.id, [nPh ? `Added ${nPh} photo${nPh > 1 ? 's' : ''}` : '', nVid ? `Added ${nVid} video${nVid > 1 ? 's' : ''}` : ''].filter(Boolean).join(', '));
      drawPhotos();
      drawHistory();
      if (bigVideo) toast('Large video saved. Short clips (under a minute) keep the phone from filling up.');
    } catch (e) {
      bz.done();
      toast('Could not save: ' + e.message, 'error');
    }
  };
  $('#ph-cam').onchange = (e) => { addPhotos([...e.target.files]); e.target.value = ''; };
  $('#ph-lib').onchange = (e) => { addPhotos([...e.target.files]); e.target.value = ''; };
  $('#ph-vid').onchange = (e) => { addPhotos([...e.target.files]); e.target.value = ''; };

  // history: earlier inspections and the change log
  let showAllLog = false;
  const drawHistory = async () => {
    const d = (await db.get('doors', door.id)) || current;
    const hist = current.history || [];
    const allPhotos = await db.doorPhotos(door.id);
    const pill = (st) => {
      const x = statusById[st || 'not_inspected'];
      return `<span class="status-pill" style="--c:${x.color}">${esc(x.short)}</span>`;
    };
    const log = [...(d.log || [])].reverse();
    const shown = showAllLog ? log : log.slice(0, 12);
    if (!$('#history')) return; // the door was closed while this loaded
    $('#history').innerHTML = `
      <div class="insp-list">
        <div class="insp is-current">
          <span class="insp-date"><b>${current.inspectedOn ? esc(fmtDate(current.inspectedOn)) : 'No date yet'}</b><small>Current inspection</small></span>
          ${pill(current.status)}
        </div>
        ${hist.map((h, i) => {
          const n = allPhotos.filter((p) => photoInView(p, { ...h, _current: false })).length;
          return `
          <div class="insp" data-i="${i}">
            <span class="insp-date"><b>${h.inspectedOn ? esc(fmtDate(h.inspectedOn)) : '(no date)'}</b>
              <small>${(h.defects || []).length} defect${(h.defects || []).length === 1 ? '' : 's'} · ${n} photo${n === 1 ? '' : 's'}${h.inspectedBy ? ' · ' + esc(h.inspectedBy) : ''}</small></span>
            ${pill(h.status)}
            <button class="btn sm insp-view">View</button>
          </div>`;
        }).join('')}
      </div>
      <h4 class="log-head">Change log</h4>
      ${shown.length ? `<ol class="log">${shown.map((e) => `
        <li><time>${esc(new Date(e.at).toLocaleString('en-IE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}${e.by ? ' · ' + esc(e.by) : ''}</time><span>${esc(e.text)}</span></li>`).join('')}</ol>`
        : '<p class="muted small">No changes recorded yet.</p>'}
      ${log.length > 12 ? `<button class="btn ghost sm" id="log-more">${showAllLog ? 'Show fewer' : `Show all ${log.length} changes`}</button>` : ''}`;
    $('#log-more')?.addEventListener('click', () => { showAllLog = !showAllLog; drawHistory(); });
    $$('.insp-view', el).forEach((b) => (b.onclick = () => {
      const i = Number(b.closest('.insp').dataset.i);
      viewInspection(current, hist[i], allPhotos, async () => {
        const h = hist[i];
        queue({ history: hist.filter((_, j) => j !== i) });
        await flushSave();
        for (const p of allPhotos.filter((p) => photoInView(p, { ...h, _current: false }))) await db.remove('photos', p.id);
        toast('Inspection record deleted');
        await redraw();
      });
    }));
  };
  drawHistory();
  afterSave = (id) => id === door.id && $('#history') && drawHistory();
  $('#new-insp').onclick = async () => {
    if (!(await confirmBox('Start a new inspection?', `A copy of the current inspection${current.inspectedOn ? ' (' + fmtDate(current.inspectedOn) + ')' : ''} is kept in this door's history with its photos. Everything carries forward to a new inspection dated today: status, checklist answers, defects, actions, materials and notes. Then change only what's different.`, 'Start new inspection', false))) return;
    // carry everything forward; only the date (and who is inspecting) changes
    await archive({ inspectedOn: today(), inspectedBy: lists.inspector || current.inspectedBy || '' }, `New inspection started ${fmtDate(today())}; previous details carried forward`);
  };

  // actions
  $('#sh-move')?.addEventListener('click', async () => {
    await flushSave();
    const id = door.id;
    back();
    setTimeout(() => setMode('move', id), 50);
  });
  $('#sh-show')?.addEventListener('click', async () => {
    await flushSave();
    go({ view: 'plan', projectId: door.projectId, planId: door.planId, focusDoor: door.id }, { replace: true });
  });
  $('#sh-place')?.addEventListener('click', async () => {
    await flushSave();
    placeDoor(door);
  });
  // learn new zones: a number and name typed on a door join the project's list
  const learnZone = async () => {
    const no = ($('#f-zone')?.value || '').trim();
    const name = ($('#f-zname')?.value || '').trim();
    if (!no || !name) return;
    const p = await db.get('projects', door.projectId);
    const zones = [...(p.zones || [])];
    const i = zones.findIndex((z) => String(z.no) === no);
    if (i >= 0 && zones[i].name) return; // keep the list's name
    if (i >= 0) zones[i] = { no, name };
    else zones.push({ no, name });
    zones.sort((a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
    await db.put('projects', { ...p, zones });
    zoneMap.set(no, name);
  };
  $('#f-zone')?.addEventListener('change', learnZone);
  $('#f-zname')?.addEventListener('change', learnZone);
  $('#sh-dup').onclick = () => duplicateDoor(current);
  $('#sh-del').onclick = async () => {
    if (await confirmBox('Delete door?', `Delete pin ${door.pinNo}${door.ref ? ' (' + door.ref + ')' : ''} and its photos?${state.view === 'plan' ? ' You can undo this from the drawing\'s Undo button until you leave the drawing.' : ' This cannot be undone.'}`)) {
      clearTimeout(saveTimer);
      pending = null;
      const keep = await db.get('doors', door.id);
      const keepPhotos = await db.doorPhotos(door.id);
      await db.deleteDoor(door.id);
      if (state.view === 'plan' && keep) {
        pushUndo(`Pin ${keep.pinNo} deleted`, async () => {
          await db.put('doors', keep);
          for (const ph of keepPhotos) await db.put('photos', ph);
        });
      }
      toast(state.view === 'plan' ? 'Door deleted (Undo at the top brings it back)' : 'Door deleted');
      back();
    }
  };

  if (state.isNew) setTimeout(() => $('#f-ref')?.focus(), 250);
}

// Copy a door with all its details (status, checklist, defects, products,
// actions, signs, notes) to a new pin beside it; only the name changes.
// Photos, repair ticks, history and GPS belong to the original and are not copied.
function nextRef(ref) {
  const m = /^(.*?)(\d+)(\D*)$/.exec(ref || '');
  if (!m) return ref ? ref + ' (copy)' : '';
  return m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0') + m[3];
}
async function duplicateDoor(src) {
  await flushSave();
  const d0 = (await db.get('doors', src.id)) || src;
  const all = await db.projectDoors(d0.projectId);
  let suggest = nextRef(d0.ref);
  while (suggest && all.some((x) => x.ref === suggest)) suggest = nextRef(suggest);
  const r = await dialog({
    title: 'Duplicate door',
    body: `<p>Makes a new pin next to pin ${d0.pinNo} with the same details: status, checklist, defects and products, actions, signs and notes. Photos are not copied.</p>
      <label class="field"><span>New door ref / ID</span><input name="ref" value="${esc(suggest)}" required autocomplete="off"></label>
      <label class="field"><span>Location / room</span><input name="location" value="${esc(d0.location || '')}" autocomplete="off"></label>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Duplicate', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return;
  const pinNo = await db.nextPinNo(d0.projectId);
  const clone = JSON.parse(JSON.stringify({ ...d0, blob: undefined }));
  for (const k of ['id', 'log', 'history', 'remedials', 'gps', 'createdAt', 'updatedAt', 'dirty']) delete clone[k];
  const shift = (v, by) => (v == null ? v : Math.min(0.98, Math.max(0.02, v + by)));
  const copy = await saveDoor({
    ...clone,
    id: db.uid(),
    pinNo,
    ref: r.data.ref.trim(),
    location: r.data.location.trim(),
    x: shift(d0.x, 0.03),
    y: shift(d0.y, 0.03),
    materials: (clone.materials || []).map((m) => ({ ...m, id: db.uid() })),
  }, [`Copied from pin ${d0.pinNo}${d0.ref ? ' (' + d0.ref + ')' : ''}`]);
  if (state.view === 'plan') pushUndo(`Pin ${pinNo} added`, () => db.deleteDoor(copy.id));
  toast(`Pin ${pinNo} ${copy.ref ? '(' + copy.ref + ') ' : ''}created. Drag it into place if needed`);
  go({ ...state, doorId: copy.id }, { replace: true });
}

// Whole project: give every defect that has no products its usual product
async function fillProjectMaterials(doors) {
  let added = 0;
  let nDoors = 0;
  for (const d0 of doors) {
    const d = await db.get('doors', d0.id);
    if (!d) continue;
    const r = fillDefectProducts(d, lists.materials || [], db.uid);
    if (!r.added) continue;
    await saveDoor({ ...d, materials: r.materials }, [`${r.added} product(s) added from its defects`]);
    added += r.added;
    nDoors++;
  }
  return { added, nDoors };
}

async function flushSave() {
  clearTimeout(saveTimer);
  if (!pending) return;
  const rec = pending;
  pending = null;
  await saveDoor(rec);
  const s = $('#saved');
  if (s) s.textContent = 'Saved';
  afterSave?.(rec.id);
}

async function pickDefects(existing) {
  const have = new Set(existing.map((d) => d.label));
  const r = await dialog({
    title: 'Add defects',
    body: `
      <label class="field"><span>Other defect (type your own)</span><input name="custom" id="def-custom" placeholder="Describe the defect"></label>
      <div class="pick-list">
        ${(lists.defects || []).map((d, i) => `
          <label class="pick ${have.has(d.label) ? 'is-had' : ''}">
            <input type="checkbox" name="d${i}" value="${i}" ${have.has(d.label) ? 'disabled' : ''}>
            <span><b>${esc(d.label)}</b><small>${esc(d.remedial)}</small></span>
          </label>`).join('')}
      </div>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Add selected', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return null;
  const picked = Object.entries(r.data).filter(([k]) => k.startsWith('d')).map(([, v]) => lists.defects[Number(v)]);
  const custom = (r.data.custom || '').trim();
  if (custom) picked.unshift({ label: custom, remedial: '' });
  return picked;
}

async function pickActions(existing) {
  const have = new Set(existing);
  const r = await dialog({
    title: 'Add actions',
    body: `
      <label class="field"><span>Other action (type your own)</span><input name="custom" id="act-custom" placeholder="e.g. Replace vision panel"></label>
      <label class="check-line"><input type="checkbox" name="keep" id="act-keep" checked> Add my own action to the list for next time</label>
      <div class="pick-list">
        ${(lists.actions || []).map((a, i) => `
          <label class="pick ${have.has(a) ? 'is-had' : ''}">
            <input type="checkbox" name="a${i}" value="${i}" ${have.has(a) ? 'disabled' : ''}>
            <span><b>${esc(a)}</b></span>
          </label>`).join('')}
      </div>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Add selected', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return null;
  const picked = Object.entries(r.data).filter(([k]) => /^a\d+$/.test(k)).map(([, v]) => lists.actions[Number(v)]);
  const custom = (r.data.custom || '').trim();
  if (custom && !have.has(custom)) {
    picked.push(custom);
    if (r.data.keep && !(lists.actions || []).includes(custom)) await saveLists({ actions: [...(lists.actions || []), custom] });
  }
  return picked;
}

async function pickMaterials() {
  const r = await dialog({
    title: 'Add materials',
    body: `
      <div class="pick-list">
        ${(lists.materials || []).map((m, i) => ({ m, i })).sort((a, b) => MAT_CATEGORIES.indexOf(matCat(a.m)) - MAT_CATEGORIES.indexOf(matCat(b.m))).map(({ m, i }, k, arr) => !m.name?.trim() ? "" : `
          ${k === 0 || matCat(arr[k - 1].m) !== matCat(m) ? `<h4 class="pick-cat">${esc(matCat(m))}</h4>` : ''}
          <label class="pick">
            <input type="checkbox" name="m${i}" value="${i}">
            <span><b>${esc(m.name)}</b><small>${!priced() ? 'per ' + esc(m.unit || 'item') : m.cost ? euro(m.cost) + ' per ' + esc(m.unit || 'item') : 'No price set · per ' + esc(m.unit || 'item')}</small></span>
          </label>`).join('')}
      </div>
      <fieldset class="custom-mat">
        <legend>Other material</legend>
        <label class="field"><span>Name</span><input name="cname" id="mat-cname" placeholder="e.g. Fire-rated letter plate"></label>
        <div class="grid3">
          <label class="field"><span>Unit</span><input name="cunit" id="mat-cunit" placeholder="each"></label>
          <label class="field"><span>Qty</span><input name="cqty" id="mat-cqty" type="number" inputmode="decimal" min="0" step="any" value="1"></label>
          <label class="field"><span>Unit cost €</span><input name="ccost" id="mat-ccost" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></label>
        </div>
        <label class="check-line"><input type="checkbox" name="keep" id="mat-keep" checked> Add to my materials list for next time</label>
      </fieldset>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Add selected', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return null;
  const picked = Object.entries(r.data).filter(([k]) => /^m\d+$/.test(k)).map(([, v]) => {
    const m = lists.materials[Number(v)];
    return { id: db.uid(), name: m.name, unit: m.unit || '', qty: 1, cost: Number(m.cost) || 0, cat: matCat(m) };
  });
  const name = (r.data.cname || '').trim();
  if (name) {
    const m = { name, unit: (r.data.cunit || '').trim() || 'each', cost: Number(r.data.ccost) || 0 };
    picked.push({ id: db.uid(), ...m, qty: Number(r.data.cqty) || 1 });
    if (r.data.keep && !(lists.materials || []).some((x) => x.name === name)) {
      await saveLists({ materials: [...(lists.materials || []), { id: db.uid(), ...m }] });
    }
  }
  return picked;
}

// Create or edit a custom status scheme
async function editScheme(existing) {
  const base = existing || {
    name: '',
    labels: { pass: 'Compliant', fail: 'Non-compliant', na: 'Not applicable', no_access: 'No access', repaired: 'Remedied' },
    include: { na: true, no_access: true, repaired: false },
    answers: { pass: 'Yes', fail: 'No', na: 'N/A' },
  };
  const row = (k, label, colour, optional) => `
    <div class="sc-status">
      <span class="sc-dot" style="background:var(--st-${colour})"></span>
      <label class="field"><span>${label}</span><input name="l_${k}" id="sc-l-${k}" value="${esc(base.labels?.[k] || '')}" required></label>
      ${optional ? `<label class="check-line sc-inc"><input type="checkbox" name="i_${k}" id="sc-i-${k}" ${base.include?.[k] !== false ? 'checked' : ''}> Use</label>` : '<span></span>'}
    </div>`;
  const r = await dialog({
    title: existing ? 'Edit status scheme' : 'New status scheme',
    body: `
      <label class="field"><span>Scheme name</span><input name="name" id="sc-name" required value="${esc(base.name)}" placeholder="e.g. Compliance survey"></label>
      <div class="sc-group"><span class="rf-label">Door statuses</span>
        ${row('pass', 'Good result (green)', 'pass', false)}
        ${row('fail', 'Problem found (red)', 'fail', false)}
        ${row('na', 'Not applicable (grey)', 'na', true)}
        ${row('no_access', 'Could not access (orange)', 'noaccess', true)}
        ${row('repaired', 'Fixed / remedied (blue)', 'repaired', true)}
        <small class="muted">"Not inspected" is always there for doors still to do (hollow pin).</small>
      </div>
      <div class="sc-group"><span class="rf-label">Checklist answer buttons</span>
        <div class="grid3">
          <label class="field"><span>Good</span><input name="a_pass" id="sc-a-pass" value="${esc(base.answers?.pass || '')}" required></label>
          <label class="field"><span>Problem</span><input name="a_fail" id="sc-a-fail" value="${esc(base.answers?.fail || '')}" required></label>
          <label class="field"><span>Not applicable</span><input name="a_na" id="sc-a-na" value="${esc(base.answers?.na || '')}" required></label>
        </div>
      </div>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Save scheme', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return null;
  const d = r.data;
  return {
    id: existing?.id || 'cs-' + db.uid(),
    name: d.name.trim(),
    labels: Object.fromEntries(['pass', 'fail', ...OPTIONAL_STATUSES].map((k) => [k, (d['l_' + k] || '').trim()])),
    include: Object.fromEntries(OPTIONAL_STATUSES.map((k) => [k, !!d['i_' + k]])),
    answers: { pass: d.a_pass.trim(), fail: d.a_fail.trim(), na: d.a_na.trim() },
  };
}

// Read-only view of an earlier inspection
async function viewInspection(door, h, allPhotos, onDelete) {
  const st = statusById[h.status || 'not_inspected'];
  const photos = allPhotos.filter((p) => photoInView(p, { ...h, _current: false }));
  const fails = Object.values(h.checks || {}).filter((c) => c?.answer === 'fail');
  const answered = Object.values(h.checks || {}).filter((c) => c?.answer);
  const urlsHere = [];
  const thumb = (p) => {
    const u = URL.createObjectURL(p.thumb || p.blob);
    urlsHere.push(u);
    return `<img alt="" src="${u}">`;
  };
  const r = await dialog({
    title: `Inspection – ${h.inspectedOn ? fmtDate(h.inspectedOn) : 'no date'}`,
    body: `
      <div class="insp-detail">
        <p><span class="status-pill" style="--c:${st.color}">${esc(st.label)}</span>
          ${h.inspectedBy ? `<span class="muted"> · by ${esc(h.inspectedBy)}</span>` : ''}</p>
        <dl>
          ${h.ref ? `<dt>Door ref</dt><dd>${esc(h.ref)}</dd>` : ''}
          ${h.location ? `<dt>Location</dt><dd>${esc(h.location)}</dd>` : ''}
          ${h.doorType ? `<dt>Door type</dt><dd>${esc(h.doorType)}</dd>` : ''}
          <dt>Checklist</dt><dd>${answered.length ? `${answered.length} answered${fails.length ? `, failed: ${fails.map((c) => esc(c.text)).join('; ')}` : ', none failed'}` : 'Not answered'}</dd>
          <dt>Defects</dt><dd>${(h.defects || []).length ? h.defects.map((x) => `<b>${esc(x.label)}</b>${x.remedial ? ' – ' + esc(x.remedial) : ''}`).join('<br>') : 'None'}</dd>
          <dt>Actions</dt><dd>${(h.actions || []).length ? h.actions.map(esc).join('<br>') : 'None'}</dd>
          ${h.notes ? `<dt>Notes</dt><dd>${esc(h.notes)}</dd>` : ''}
        </dl>
        ${photos.length ? `<div class="photo-strip">${photos.map((p) => `<span class="photo">${thumb(p)}</span>`).join('')}</div>` : ''}
      </div>`,
    buttons: [{ label: 'Delete record', value: 'delete', kind: 'ghost danger-text' }, { label: 'Close', value: true, kind: 'primary' }],
  });
  urlsHere.forEach((u) => URL.revokeObjectURL(u));
  if (r.value === 'delete' && (await confirmBox('Delete this inspection record?', `The inspection of ${h.inspectedOn ? fmtDate(h.inspectedOn) : '(no date)'} and its ${photos.length} photo(s) will be removed. This cannot be undone.`))) onDelete();
}

function openPhoto(photo, onChange) {
  const video = isVideo(photo);
  const wrap = document.createElement('div');
  wrap.className = 'lightbox' + (video ? ' is-video' : '');
  let u = URL.createObjectURL(video ? photo.blob : photo.marked || photo.blob);
  wrap.innerHTML = `
    ${video
      ? `<video src="${u}" controls playsinline preload="metadata"></video>
         <div class="lb-link">
           <label class="field"><span>Link for the PDF report (optional)</span>
             <input id="lb-url" type="url" inputmode="url" placeholder="Paste a Google Drive / OneDrive / YouTube link" value="${esc(photo.link || '')}">
           </label>
           <small>${esc([fmtDuration(photo.duration), fmtSize(photo.size)].filter(Boolean).join(' · '))}. With a link, the video's thumbnail in the PDF can be tapped to play it. Once cloud sync is set up, links will be filled in automatically.</small>
         </div>`
      : `<img alt="Door photo" src="${u}">`}
    <div class="lb-bar">
      <button class="btn ghost danger-text" id="lb-del">${icon('trash')} Delete</button>
      ${video ? '' : `<button class="btn" id="lb-mark">${icon('pencil')} ${photo.marks?.length ? 'Edit markup' : 'Mark up'}</button>`}
      <button class="btn" id="lb-close">Close</button>
    </div>`;
  document.body.append(wrap);
  const close = () => {
    $('video', wrap)?.pause();
    URL.revokeObjectURL(u);
    wrap.remove();
  };
  $('#lb-close', wrap).onclick = async () => {
    if (video) {
      const raw = $('#lb-url', wrap).value;
      const link = cleanLink(raw);
      if (raw.trim() && !link) return toast('That link doesn\'t look right. Paste the full web address.', 'error');
      if (link !== (photo.link || '')) {
        await db.put('photos', { ...photo, link });
        toast(link ? 'Link saved' : 'Link removed');
        onChange();
      }
    }
    close();
  };
  $('img', wrap)?.addEventListener('click', close);
  $('#lb-mark', wrap)?.addEventListener('click', async () => {
    const r = await markupPhoto(photo);
    if (!r) return;
    const next = r.marks.length
      ? { ...photo, marks: r.marks, marked: r.marked, thumb: r.thumb }
      : { ...photo, marks: [], marked: null, thumb: await plainThumb(photo) };
    Object.assign(photo, await db.put('photos', next));
    URL.revokeObjectURL(u);
    u = URL.createObjectURL(photo.marked || photo.blob);
    $('img', wrap).src = u;
    $('#lb-mark', wrap).innerHTML = `${icon('pencil')} ${photo.marks?.length ? 'Edit markup' : 'Mark up'}`;
    toast(r.marks.length ? 'Markup saved' : 'Markup removed');
    onChange();
  });
  $('#lb-del', wrap).onclick = async () => {
    const what = video ? 'video' : 'photo';
    if (await confirmBox(`Delete ${what}?`, `This ${what} will be removed from the door record.`)) {
      await db.remove('photos', photo.id);
      await flushSave();
      await logEvent(photo.doorId, `Deleted ${what}`);
      close();
      onChange();
    }
  };
}

// Logos are kept as small PNG images (with transparency) inside the settings
async function logoFromFile(file, maxSide) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth || 600;
    const h0 = img.naturalHeight || 600;
    const k = Math.min(1, maxSide / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * k);
    c.height = Math.round(h0 * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { data: c.toDataURL('image/png'), w: c.width, h: c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- Settings ----------
async function renderSettings() {
  const est = await db.storageEstimate();
  const projects = await db.all('projects');
  app.innerHTML = `
    <header class="bar">
      <button class="icon-btn" id="back" aria-label="Back">${icon('back')}</button>
      <div class="bar-title"><b>Settings</b><small>Lists and backups</small></div>
      <span></span>
    </header>
    <main class="page">
      <section class="panel">
        <h2 class="h2">Company logo</h2>
        <p class="muted small">Shown on every PDF report. The round logo is also used at the top of the app. Use PNG files; a round logo looks best with transparent corners.</p>
        <div class="logo-grid">
          ${[['banner', 'Banner logo (wide)', 'Across the top of report covers'], ['round', 'Round logo', 'Cover corner and every page header']].map(([k, label, hint]) => {
            const lg = lists[k === 'banner' ? 'logoBanner' : 'logoRound'];
            return `<div class="logo-slot ${k}">
              <div class="logo-prev">${lg ? `<img alt="${label}" src="${lg.data}">` : `<span class="muted small">No ${k} logo</span>`}</div>
              <b>${label}</b><small class="muted">${hint}</small>
              <div class="row-btns">
                <label class="btn sm">${icon('upload')} ${lg ? 'Replace' : 'Upload'}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" id="logo-${k}" hidden></label>
                ${lg ? `<button class="btn ghost sm danger-text" id="logo-del-${k}">Remove</button>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </section>
      <section class="panel">
        <h2 class="h2">My signature</h2>
        <p class="muted small">Save your signature once and use it when signing reports.</p>
        ${lists.signature ? `<div class="sig-show"><img alt="Your saved signature" src="${lists.signature.data}"></div>` : ''}
        <div class="row-btns"><button class="btn sm" id="s-sign">${icon('pencil')} ${lists.signature ? 'Replace' : 'Add'} my signature</button>
          ${lists.signature ? '<button class="btn ghost sm danger-text" id="s-sign-del">Remove</button>' : ''}</div>
      </section>
      <section class="panel">
        <label class="check-line"><input type="checkbox" id="s-gps" ${lists.gps !== false ? 'checked' : ''}> Record my location (GPS) when I inspect a door or take a photo</label>
        <p class="muted small">Shows you were on site and when. Indoors, phones are usually accurate to about 10–50 m, so it confirms the building, not the room. Your phone will ask for permission the first time.</p>
      </section>
      <section class="panel">
        <label class="check-line"><input type="checkbox" id="s-autores" ${lists.autoResult !== false ? 'checked' : ''}> Set each door's pass / fail result from its checklist and defects</label>
        <p class="muted small">When on, the door record shows only Not inspected, Not applicable and No access (and Repaired) as buttons; the pass / fail result is worked out for you. Turn off to choose it by hand.</p>
      </section>
      <section class="panel">
        <label class="field"><span>Inspector name (fills "Inspected by")</span><input id="s-insp" value="${esc(lists.inspector || '')}" placeholder="e.g. Mark Crosby"></label>
      </section>
      <section class="panel">
        <div class="block-head"><h2 class="h2">Status schemes</h2><button class="btn sm" id="s-add-scheme">${icon('plus')} New scheme</button></div>
        <p class="muted small">The wording for door statuses and checklist answers. Each project picks one (in the project's details).</p>
        <div id="s-schemes"></div>
      </section>
      <section class="panel">
        <div class="block-head"><h2 class="h2">Inspection questions</h2><button class="btn sm" id="s-add-q">${icon('plus')} Add</button></div>
        <p class="muted small">Asked of every door, answered Pass / Fail / N/A. Answers already given are kept if you edit or remove a question.</p>
        <div id="s-qs"></div>
      </section>
      <section class="panel">
        <h2 class="h2">Remedial instructions (default)</h2>
        <label class="field"><span>The starting wording for the repairer's instructions on new projects. Each project can change its own in the Repairs tab.</span>
          <textarea id="s-rem" rows="8">${esc(lists.remedialText ?? DEFAULT_REMEDIAL_TEXT)}</textarea></label>
      </section>
      <section class="panel">
        <h2 class="h2">Types of work</h2>
        <label class="field"><span>One per line. Each project picks one; used to group and filter projects and as the report title.</span><textarea id="s-wtypes" rows="7">${esc((lists.workTypes || DEFAULT_WORK_TYPES).join('\n'))}</textarea></label>
      </section>
      <section class="panel">
        <h2 class="h2">End of service questions</h2>
        <label class="field"><span>One per line. All must be answered (Yes / No / N/A) before a service can be closed.</span><textarea id="s-closeq" rows="10">${esc(closeQuestions(lists).join('\n'))}</textarea></label>
      </section>
      <section class="panel">
        <h2 class="h2">Door categories</h2>
        <label class="field"><span>One per line. Used to group and filter doors on drawings, the door list and reports.</span><textarea id="s-cats" rows="7">${esc((lists.categories || DEFAULT_CATEGORIES).join('\n'))}</textarea></label>
      </section>
      <section class="panel">
        <h2 class="h2">Risk ratings</h2>
        <label class="field"><span>One per line. Doors start with "${esc(NO_RISK)}" until a rating is picked.</span><textarea id="s-risks" rows="4">${esc((lists.risks || DEFAULT_RISKS).join('\n'))}</textarea></label>
      </section>
      <section class="panel">
        <h2 class="h2">Recommended actions</h2>
        <label class="field"><span>One per line (each door can have several)</span><textarea id="s-actions" rows="8">${esc((lists.actions || []).join('\n'))}</textarea></label>
      </section>
      <section class="panel">
        <h2 class="h2">${icon('shield')} Owner PIN</h2>
        <p class="muted small">${lists.libPin
          ? 'Prices, costs, totals, your time on the job and My files are hidden until this PIN is entered. They lock again when the app is closed.'
          : 'Set a PIN so anyone else using this app or phone cannot see your prices, costs, time on the job or My files.'}</p>
        <div class="row-btns"><button class="btn sm" id="s-owner-pin">${lists.libPin ? 'Change or remove PIN' : 'Set an owner PIN'}</button>
        ${lists.libPin ? `<button class="btn ghost sm" id="s-owner-toggle">${priced() ? 'Lock now' : 'Unlock'}</button>` : ''}</div>
      </section>
      <section class="panel" ${priced() ? '' : 'hidden'}>
        <div class="block-head"><h2 class="h2">Materials &amp; prices</h2><button class="btn sm" id="s-add-m">${icon('plus')} Add</button></div>
        <p class="muted small">Your unit prices (€ ex VAT). They pre-fill doors when you add a material; changing a price here does not change doors already recorded.</p>
        <div id="s-mats"></div>
      </section>
      <section class="panel">
        <h2 class="h2">Door types</h2>
        <label class="field"><span>One per line</span><textarea id="s-types" rows="8">${esc((lists.doorTypes || []).join('\n'))}</textarea></label>
      </section>
      <section class="panel">
        <div class="block-head"><h2 class="h2">Defect list</h2><button class="btn sm" id="s-add-def">${icon('plus')} Add</button></div>
        <p class="muted small">Each defect has the remedial work it suggests. Editing here does not change doors already recorded.</p>
        <div id="s-defs"></div>
        <button class="btn ghost sm" id="s-reset">Reset to default list</button>
      </section>
      <section class="panel">
        <h2 class="h2">Backup &amp; restore</h2>
        <p class="muted small">${projects.length} project(s) on this phone${est ? ` · using ${(est.usage / 1048576).toFixed(1)} MB` : ''}</p>
        <div class="row-btns">
          <button class="btn" id="s-backup" ${projects.length ? '' : 'disabled'}>Back up all projects</button>
          <label class="btn">Restore from file<input type="file" accept="application/json,.json" id="s-restore" hidden></label>
        </div>
      </section>
      <p class="muted small pad">FSCF Ireland app · data stays on this device until cloud sync is set up.</p>
    </main>`;
  $('#back').onclick = back;
  $('#s-gps').onchange = (e) => saveLists({ gps: e.target.checked });
  $('#s-sign').onclick = async () => {
    const sig = await signaturePad({ title: 'My signature', name: lists.inspector || '', askName: false });
    if (sig) {
      await saveLists({ signature: { data: sig.data, w: sig.w, h: sig.h } });
      toast('Signature saved');
      refresh();
    }
  };
  $('#s-sign-del')?.addEventListener('click', async () => {
    await saveLists({ signature: null });
    refresh();
  });
  $('#s-autores').onchange = (e) => saveLists({ autoResult: e.target.checked });
  for (const k of ['banner', 'round']) {
    const key = k === 'banner' ? 'logoBanner' : 'logoRound';
    $(`#logo-${k}`).onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        await saveLists({ [key]: await logoFromFile(f, k === 'banner' ? 1400 : 500) });
        toast('Logo saved');
        refresh();
      } catch (err) {
        toast('Could not read that image: ' + err.message, 'error');
      }
    };
    $(`#logo-del-${k}`)?.addEventListener('click', async () => {
      await saveLists({ [key]: null });
      refresh();
    });
  }
  $('#s-insp').onchange = (e) => saveLists({ inspector: e.target.value });
  $('#s-types').onchange = (e) => saveLists({ doorTypes: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) });
  // status schemes
  const drawSchemes = async () => {
    const projects = await db.all('projects');
    const used = (id) => projects.filter((p) => (p.scheme || DEFAULT_SCHEME) === id).length;
    $('#s-schemes').innerHTML = allSchemes().map((sc) => `
      <div class="scheme-row" data-id="${esc(sc.id)}">
        <span><b>${esc(sc.name)}</b>
          <span class="scheme-sw">${sc.order.slice(1).map((k) => `<span class="status-pill" style="--c:var(--st-${{ pass: 'pass', fail: 'fail', na: 'na', no_access: 'noaccess', repaired: 'repaired' }[k]})">${esc(sc.labels[k])}</span>`).join('')}</span>
          <small class="muted">Checklist: ${esc([sc.answers.pass, sc.answers.fail, sc.answers.na].join(' / '))} · ${used(sc.id)} project(s)</small></span>
        ${sc.custom ? `<span class="row-btns"><button class="btn sm sc-edit">Edit</button><button class="icon-btn sm sc-del" aria-label="Delete scheme">${icon('trash')}</button></span>` : '<span class="muted small">Built in</span>'}
      </div>`).join('');
    $$('.scheme-row').forEach((row) => {
      const c = (lists.customSchemes || []).find((x) => x.id === row.dataset.id);
      if (!c) return;
      $('.sc-edit', row).onclick = async () => {
        const next = await editScheme(c);
        if (!next) return;
        await saveLists({ customSchemes: lists.customSchemes.map((x) => (x.id === c.id ? next : x)) });
        drawSchemes();
      };
      $('.sc-del', row).onclick = async () => {
        const n = used(c.id);
        if (!(await confirmBox('Delete scheme?', `Delete "${c.name}"?${n ? ` ${n} project(s) use it and will switch to Pass / Fail wording. Their records are kept.` : ''}`))) return;
        await saveLists({ customSchemes: lists.customSchemes.filter((x) => x.id !== c.id) });
        drawSchemes();
      };
    });
  };
  drawSchemes();
  $('#s-add-scheme').onclick = async () => {
    const next = await editScheme(null);
    if (!next) return;
    await saveLists({ customSchemes: [...(lists.customSchemes || []), next] });
    drawSchemes();
    toast('Scheme saved. Choose it in a project\'s details.');
  };

  $('#s-rem').onchange = (e) => saveLists({ remedialText: e.target.value });
  $('#s-wtypes').onchange = (e) => saveLists({ workTypes: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) });
  $('#s-closeq').onchange = (e) => saveLists({ closeQuestions: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) });
  $('#s-cats').onchange = (e) => saveLists({ categories: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) });
  $('#s-risks').onchange = (e) => saveLists({ risks: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) });
  $('#s-actions').onchange = (e) => saveLists({ actions: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) });

  const drawQs = () => {
    $('#s-qs').innerHTML = (lists.questions || []).map((q, i) => `
      <div class="q-edit ${q.hidden ? 'is-hidden' : ''}" data-i="${i}" data-id="${esc(q.id)}">
        <button type="button" class="grip" aria-label="Drag to move">${icon('grip')}</button>
        <textarea class="qe-text" id="qe-text-${i}" rows="2" aria-label="Question ${i + 1}">${esc(q.text)}</textarea>
        <span class="q-edit-btns">
          <button class="icon-btn sm qe-eye" aria-label="${q.hidden ? 'Show question' : 'Hide question'}">${icon(q.hidden ? 'eyeOff' : 'eye')}</button>
          <button class="icon-btn sm qe-up" aria-label="Move up" ${i ? '' : 'disabled'}>${icon('up')}</button>
          <button class="icon-btn sm qe-del" aria-label="Remove">${icon('trash')}</button>
        </span>
      </div>`).join('') || '<p class="muted small">No questions.</p>';
    makeSortable($('#s-qs'), async (ids) => {
      const byId = Object.fromEntries(lists.questions.map((q) => [q.id, q]));
      await saveLists({ questions: ids.map((id) => byId[id]).filter(Boolean) });
      drawQs();
    });
    $$('.q-edit').forEach((row) => {
      const i = Number(row.dataset.i);
      $('.qe-text', row).onchange = (e) => saveLists({ questions: lists.questions.map((q, j) => (j === i ? { ...q, text: e.target.value } : q)) });
      $('.qe-del', row).onclick = async () => { await saveLists({ questions: lists.questions.filter((_, j) => j !== i) }); drawQs(); };
      $('.qe-eye', row).onclick = async () => { await saveLists({ questions: lists.questions.map((q, j) => (j === i ? { ...q, hidden: !q.hidden } : q)) }); drawQs(); };
      $('.qe-up', row).onclick = async () => {
        const qs = [...lists.questions];
        [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]];
        await saveLists({ questions: qs });
        drawQs();
      };
    });
  };
  drawQs();
  if (state.focus === 's-qs') setTimeout(() => $('#s-qs')?.closest('.panel')?.scrollIntoView({ block: 'start' }), 50);
  if (state.focus === 's-cats') setTimeout(() => { $('#s-cats')?.closest('.panel')?.scrollIntoView({ block: 'start' }); $('#s-cats')?.focus(); }, 50);
  $('#s-add-q').onclick = async () => {
    await saveLists({ questions: [...(lists.questions || []), { id: db.uid(), text: '' }] });
    drawQs();
    $$('.qe-text').at(-1)?.focus();
  };

  const drawMats = () => {
    const all = (lists.materials || []).map((m, i) => ({ m, i }));
    const cats = [...new Set([...MAT_CATEGORIES, ...all.map(({ m }) => matCat(m))])];
    $('#s-mats').innerHTML = cats.map((c) => {
      const rows = all.filter(({ m }) => matCat(m) === c);
      if (!rows.length) return '';
      return `<h3 class="mat-cat">${esc(c)} <span class="muted">${rows.length}</span></h3>` + rows.map(({ m, i }) => `
      <div class="m-edit" data-i="${i}">
        <input class="me-name" id="me-name-${i}" value="${esc(m.name)}" aria-label="Material" placeholder="Material">
        <input class="me-unit" id="me-unit-${i}" value="${esc(m.unit)}" aria-label="Unit" placeholder="unit">
        <label class="me-cost"><span>€</span><input id="me-cost-${i}" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(m.cost || '')}" placeholder="0.00" aria-label="Unit cost in euro"></label>
        <select class="me-cat" aria-label="Category">${cats.map((x) => `<option ${x === matCat(m) ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <button class="icon-btn sm me-del" aria-label="Remove">${icon('trash')}</button>
      </div>`).join('');
    }).join('') || '<p class="muted small">No materials.</p>';
    $$('.m-edit').forEach((row) => {
      const i = Number(row.dataset.i);
      const upd = () => saveLists({
        materials: lists.materials.map((m, j) => (j === i ? { ...m, name: $('.me-name', row).value, unit: $('.me-unit', row).value, cost: Number($('.me-cost input', row).value) || 0, cat: $('.me-cat', row).value } : m)),
      });
      $$('input', row).forEach((inp) => (inp.onchange = upd));
      $('.me-cat', row).onchange = async () => { await upd(); drawMats(); };
      $('.me-del', row).onclick = async () => { await saveLists({ materials: lists.materials.filter((_, j) => j !== i) }); drawMats(); };
    });
  };
  if (priced()) drawMats();
  $('#s-owner-pin').onclick = async () => {
    if (lists.libPin && !priced() && !(await unlockOwner())) return;
    await libPinMenu(true);
    refresh();
  };
  $('#s-owner-toggle')?.addEventListener('click', () => {
    if (priced()) { libUnlocked = false; toast('Locked'); refresh(); } else unlockOwner();
  });
  $('#s-add-m').onclick = async () => {
    await saveLists({ materials: [...(lists.materials || []), { id: db.uid(), cat: 'Other', name: '', unit: 'each', cost: 0 }] });
    drawMats();
    $$('.me-name').at(-1)?.focus();
  };

  const drawDefs = () => {
    $('#s-defs').innerHTML = (lists.defects || []).map((d, i) => `
      <div class="def-edit" data-i="${i}">
        <input class="de-label" id="de-label-${i}" value="${esc(d.label)}" aria-label="Defect">
        <textarea class="de-rem" id="de-rem-${i}" rows="2" aria-label="Remedial work">${esc(d.remedial)}</textarea>
        <button class="icon-btn sm de-del" aria-label="Remove">${icon('trash')}</button>
      </div>`).join('');
    $$('.def-edit').forEach((row) => {
      const i = Number(row.dataset.i);
      const upd = () => {
        const defects = lists.defects.map((d, j) => (j === i ? { label: $('.de-label', row).value, remedial: $('.de-rem', row).value } : d));
        saveLists({ defects });
      };
      $('.de-label', row).onchange = upd;
      $('.de-rem', row).onchange = upd;
      $('.de-del', row).onclick = async () => {
        await saveLists({ defects: lists.defects.filter((_, j) => j !== i) });
        drawDefs();
      };
    });
  };
  drawDefs();
  $('#s-add-def').onclick = async () => {
    await saveLists({ defects: [{ label: 'New defect', remedial: '' }, ...lists.defects] });
    drawDefs();
    $('.de-label')?.select();
  };
  $('#s-reset').onclick = async () => {
    if (await confirmBox('Reset defect list?', 'Your edited defect list will be replaced with the default list.', 'Reset')) {
      await saveLists({ defects: DEFAULT_DEFECTS });
      drawDefs();
    }
  };
  $('#s-backup').onclick = async () => {
    const b = busy('Preparing backup…');
    try {
      const { result, videosLeftOut } = await backupProjects(projects, { library: true });
      b.done();
      if (result === 'saved') saveLists({ lastBackupAt: new Date().toISOString() }), toast(videosLeftOut ? `Backup saved (${videosLeftOut} video(s)/large file(s) left out – too large)` : 'Backup saved');
    } catch (e) {
      b.done();
      toast(e.message, 'error');
    }
  };
  $('#s-restore').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const b = busy('Restoring…');
    try {
      const n = await restoreBackup(f);
      await loadLists();
      b.done();
      toast(`Restored ${n} project(s)`);
      refresh();
    } catch (err) {
      b.done();
      toast(err.message, 'error');
    }
  };
}

// ---------- start ----------
async function start() {
  try {
    await loadLists();
  } catch (e) {
    app.innerHTML = `<main class="page"><section class="empty"><h1 class="h1">Storage unavailable</h1><p>This browser is blocking on-device storage (private browsing?). Open the app in a normal browser window.</p></section></main>`;
    return;
  }
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.claude) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushSave());
start();
