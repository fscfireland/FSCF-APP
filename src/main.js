// FSCF Doors — main app: screens, navigation and the door record.

import * as db from './db.js';
import {
  STATUSES, statusById, DEFAULT_DOOR_TYPES, DEFAULT_DEFECTS, LEAF_CONFIGS, DEFAULT_ACTIONS, DEFAULT_QUESTIONS, DEFAULT_MATERIALS,
  ANSWERS, doorActions, materialsTotal, euro, questionsFor, drawDemoPlan, SCHEMES, DEFAULT_SCHEME, useScheme,
  setCustomSchemes, allSchemes, schemeById, OPTIONAL_STATUSES, statusesInUse, matLabel, zoneText, MATERIALS_VERSION,
  DEFAULT_RISKS, NO_RISK, parseZones, zonesToText, DEFAULT_CATEGORIES,
} from './defaults.js';
import { PlanViewer } from './viewer.js';
import { importDrawing, compressImage, thumbFromCanvas } from './files.js';
import { exportProjectXlsx } from './export.js';
import { exportProjectPdf } from './report.js';
import { parseDoorFile, downloadTemplate, matchListValue } from './importer.js';
import { MK_COLORS, TOOLS, TEXT_SIZES, renderSvg, lineLengthPx, fmtLength } from './markup.js';
import { isVideo, videoInfo, fmtDuration, fmtSize, cleanLink } from './media.js';
import { saveDoor, logEvent, setActor, snapshotOf, tagPhotosForSnapshot, photoInView } from './history.js';
import { emptyFilter, isFiltered, applyFilter, filterOptions, describeFilter } from './filters.js';
import {
  collLabel, listCollections, activeCollection, plansIn, suggestName, copyCollection, renameCollection, deleteCollection,
} from './collections.js';
import { backupProjects, restoreBackup } from './backup.js';
import { icon, $, $$, esc, toast, dialog, confirmBox, busy, fmtDate, today } from './ui.js';

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
    questions: DEFAULT_QUESTIONS, materials: DEFAULT_MATERIALS, risks: DEFAULT_RISKS, categories: DEFAULT_CATEGORIES, inspector: '', ...(s || {}),
  };
  setActor(lists.inspector);
  setCustomSchemes(lists.customSchemes);
  if (s?.materials && (s.matVersion || 1) < MATERIALS_VERSION) {
    const have = new Set(s.materials.map((m) => m.id));
    await saveLists({ materials: [...s.materials, ...DEFAULT_MATERIALS.filter((m) => !have.has(m.id))], matVersion: MATERIALS_VERSION });
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
    byProject[p.id] = allDoors.filter((d) => d.projectId === p.id && (ids.has(d.planId) || (!d.planId && (d.collection || '') === coll)));
    collOf[p.id] = listCollections(pls).length > 1 || coll ? collLabel(coll) : '';
  }

  app.innerHTML = `
    <header class="bar">
      <div class="brand"><span class="brand-mark">${icon('shield')}</span><div><b>FSCF Doors</b><small>Fire door inspections</small></div></div>
      <button class="icon-btn" id="settings" aria-label="Settings">${icon('gear')}</button>
    </header>
    <main class="page">
      <div class="offline-note">${icon('check')} Saved on this phone — works with no signal</div>
      ${projects.length ? `<h1 class="h1">Projects <span class="muted">${projects.length}</span></h1>` : ''}
      <div class="project-list">
        ${projects.map((p) => projectCard(p, byProject[p.id] || [], collOf[p.id])).join('')}
      </div>
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
  $('#settings').onclick = () => go({ view: 'settings' });
  $$('#new-project, #new-project-2').forEach((b) => (b.onclick = () => editProject()));
  const demo = $('#demo');
  if (demo) demo.onclick = loadDemo;
  $$('.project-card').forEach((el) => (el.onclick = () => go({ view: 'project', projectId: el.dataset.id, tab: 'plans' })));
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

function projectCard(p, doors, coll = '') {
  const scheme = useScheme(p);
  const c = countStatuses(doors);
  const lc = (id) => statusById[id].short.toLowerCase();
  return `
    <button class="project-card" data-id="${p.id}">
      <div class="pc-top">
        <div class="pc-title">${esc(p.site || 'Untitled site')}</div>
        <div class="pc-date">${esc(fmtDate(p.date))}</div>
      </div>
      <div class="pc-sub">${esc([p.client, p.address].filter(Boolean).join(' · '))}</div>
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
  const r = await dialog({
    title: existing ? 'Project details' : 'New project',
    body: `
      <label class="field"><span>Site name</span><input name="site" id="pf-site" required value="${esc(p.site)}" placeholder="e.g. Tearmann Ward, Cavan General"></label>
      <label class="field"><span>Client</span><input name="client" id="pf-client" value="${esc(p.client)}" placeholder="e.g. HSE Estates"></label>
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
  if (!existing) go({ view: 'project', projectId: rec.id, tab: 'plans' });
  else refresh();
  return rec;
}

async function loadDemo() {
  const b = busy('Creating demo project…');
  try {
    const project = await db.put('projects', {
      id: db.uid(), site: 'DEMO – Rosewood Nursing Home', client: 'Example client', address: 'Bailieborough, Co. Cavan', date: today(), nextPin: 1, demo: true, scheme: 'passfail',
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
  const tab = state.tab || 'plans';
  const colls = listCollections(allPlans);
  const coll = activeCollection(project, allPlans, state.coll);
  const plans = plansIn(allPlans, coll);
  const planIds = new Set(plans.map((p) => p.id));
  const doors = allDoors.filter((d) => planIds.has(d.planId) || (!d.planId && (coll === '*' || (d.collection || '') === coll)));
  state.collText = colls.length > 1 ? (coll === '*' ? 'All collections' : collLabel(coll)) : '';

  app.innerHTML = `
    <header class="bar">
      <button class="icon-btn" id="back" aria-label="Back">${icon('back')}</button>
      <div class="bar-title"><b>${esc(project.site || 'Untitled site')}</b><small>${esc([project.client, fmtDate(project.date)].filter(Boolean).join(' · '))}</small></div>
      <button class="icon-btn" id="proj-edit" aria-label="Project details">${icon('more')}</button>
    </header>
    <nav class="tabs" role="tablist">
      ${[['plans', 'Plans', allPlans.length], ['doors', 'Doors', doors.length], ['export', 'Export', '']].map(([id, label, n]) =>
        `<button role="tab" class="tab ${tab === id ? 'is-on' : ''}" data-tab="${id}" aria-selected="${tab === id}">${label}${n !== '' ? ` <span class="tab-n">${n}</span>` : ''}</button>`).join('')}
    </nav>
    <main class="page" id="tab-body"></main>
  `;
  $('#back').onclick = back;
  $('#proj-edit').onclick = () => editProject(project);
  $$('.tab').forEach((t) => (t.onclick = () => go({ ...state, tab: t.dataset.tab }, { replace: true })));
  const body = $('#tab-body');
  if (tab === 'plans') return renderPlansTab(body, project, allPlans, allDoors, coll);
  // Doors and Export work on one collection at a time (or all)
  body.innerHTML = '<div id="coll-bar"></div><div id="tab-inner"></div>';
  if (colls.length > 1) {
    $('#coll-bar').innerHTML = `
      <label class="coll-bar">${icon('plan')}<span>Collection</span>
        <select id="coll-sel">
          ${colls.map((c) => `<option value="${esc(c)}" ${c === coll ? 'selected' : ''}>${esc(collLabel(c))}</option>`).join('')}
          <option value="*" ${coll === '*' ? 'selected' : ''}>All collections</option>
        </select>
      </label>`;
    $('#coll-sel').onchange = (e) => pickCollection(project, e.target.value);
  }
  if (tab === 'doors') renderDoorsTab($('#tab-inner'), project, plans, doors);
  else renderExportTab($('#tab-inner'), project, plans, doors);
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
  const card = (p) => `
        <div class="plan-card">
          <button class="plan-open" data-id="${p.id}">
            <img alt="" src="${objUrl(p.thumb || p.blob)}">
          </button>
          <div class="plan-meta">
            <div><b>${esc(p.name)}</b><small>${n[p.id] || 0} doors pinned</small></div>
            <button class="icon-btn sm plan-menu" data-id="${p.id}" aria-label="Plan options">${icon('more')}</button>
          </div>
        </div>`;
  const group = (c) => {
    const ps = plansIn(plans, c);
    const pins = ps.reduce((t, p) => t + (n[p.id] || 0), 0);
    return `
      <section class="coll ${c === active ? 'is-active' : ''}" data-c="${esc(c)}">
        <div class="coll-head">
          <span class="coll-name">${icon('plan')}<span><b>${esc(collLabel(c))}</b><small>${ps.length} drawing${ps.length === 1 ? '' : 's'} · ${pins} pin${pins === 1 ? '' : 's'}${c === active && colls.length > 1 ? ' · <span class="coll-cur">current</span>' : ''}</small></span></span>
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
    ${colls.map(group).join('')}
    <div class="plan-grid">
      <label class="plan-card upload">
        <input type="file" id="plan-file" accept="application/pdf,image/*" hidden>
        <span class="upload-ico">${icon('upload')}</span>
        <b>Upload drawing</b>
        <small>PDF or photo of a floor plan. Each PDF page becomes a plan.</small>
      </label>
    </div>`;
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
  $('#plan-file').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    // which collection does it go in?
    let target = active === '*' ? colls[0] ?? '' : active;
    if (named) {
      const r = await dialog({
        title: 'Add drawing to…',
        body: `
          <label class="field"><span>Collection</span>
            <select name="coll" id="up-coll">${colls.map((c) => `<option value="${esc(c)}" ${c === target ? 'selected' : ''}>${esc(collLabel(c))}</option>`).join('')}<option value="__new">New collection…</option></select></label>
          <label class="field"><span>New collection name (if new)</span><input name="newname" id="up-new" placeholder="${esc(suggestName(colls))}"></label>`,
        buttons: [{ label: 'Cancel', value: false }, { label: 'Add drawing', value: true, kind: 'primary' }],
      });
      if (r.value !== true) return;
      target = r.data.coll === '__new' ? (r.data.newname || '').trim() || suggestName(colls) : r.data.coll;
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
      <label class="field"><span>New collection name</span><input name="name" id="cc-name" required value="${esc(suggestName(colls))}"></label>
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
  const name = (r.data.name || '').trim();
  if (!name) return toast('Give the new collection a name.', 'error');
  if (colls.includes(name)) return toast(`There's already a collection called "${name}".`, 'error');
  const b = busy('Copying drawings and pins…');
  try {
    const res = await copyCollection(project, plans, from, name, r.data.mode, lists.inspector || '');
    b.done();
    toast(`Copied ${res.drawings} drawing${res.drawings === 1 ? '' : 's'} and ${res.pins} pin${res.pins === 1 ? '' : 's'} to "${name}"`);
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
    body: `<label class="field"><span>Name</span><input name="name" id="coll-name" value="${esc(c)}" placeholder="${esc(collLabel(c))}"></label>`,
    buttons: [{ label: 'Delete collection', value: 'delete', kind: 'ghost danger-text' }, { label: 'Cancel', value: false }, { label: 'Save', value: 'save', kind: 'primary' }],
  });
  if (r.value === 'save') {
    const name = (r.data.name || '').trim();
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

async function planMenu(plan, colls = []) {
  const r = await dialog({
    title: 'Plan',
    body: `<label class="field"><span>Name</span><input name="name" id="plan-name" value="${esc(plan.name)}"></label>
      ${colls.length > 1 || plan.collection ? `<label class="field"><span>Collection</span>
        <select name="coll" id="plan-coll">${colls.map((c) => `<option value="${esc(c)}" ${c === (plan.collection || '') ? 'selected' : ''}>${esc(collLabel(c))}</option>`).join('')}</select></label>` : ''}`,
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
    const coll = state.coll && state.coll !== '*' ? state.coll : project.activeCollection ?? (plans[0]?.collection || '');
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
        ${materialsTotal(d) ? `<small class="money">${euro(materialsTotal(d))}</small>` : ''}
      </span>
    </button>`;
}

function renderExportTab(body, project, plans, allDoors) {
  if (state.rfProject !== project.id) {
    state.rfProject = project.id;
    state.rf = emptyFilter();
  }
  const f = state.rf;
  const questions = (lists.questions || []).filter((q) => q.text?.trim());
  const opts = filterOptions(allDoors, questions);
  const doors = applyFilter(allDoors, f);
  const filterText = [state.collText, describeFilter(f, plans, opts.checks)].filter(Boolean).join(' · ');
  const nDef = doors.reduce((a, d) => a + (d.defects || []).length, 0);
  const chip = (group, value, label, on, color) =>
    `<button class="chip ${on ? 'is-on' : ''}" data-g="${group}" data-v="${esc(value)}" ${color ? `style="--c:${color}"` : ''}>${color ? '<i></i>' : ''}${esc(label)}</button>`;
  body.innerHTML = `
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
      <p class="muted">${doors.length} doors · ${nDef} defects · materials ${euro(doors.reduce((t, d) => t + materialsTotal(d), 0))} ex VAT</p>
      <button class="btn primary" id="xlsx">${icon('download')} Export Excel</button>
    </section>
    <section class="panel">
      <h2 class="h2">${icon('shield')} Backup</h2>
      <p>Until cloud sync is switched on, this project is stored only on this phone. Save a backup file (includes plans and photos; videos are too large and stay on the phone) and keep it in Google Drive or email it to yourself.</p>
      <button class="btn" id="backup">Save backup of this project</button>
    </section>
    <section class="panel">
      <h2 class="h2">${icon('report')} Client PDF report</h2>
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
        <label class="check-line"><input type="checkbox" id="pdf-costs"> Include material costs <span class="muted">(leave off for the client copy)</span></label>
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

  $('#xlsx').onclick = async () => {
    const b = busy('Building Excel workbook…');
    try {
      if (!doors.length) return b.done(), noneMsg();
      const r = await exportProjectXlsx(project, lists.questions || [], { doors, filterText });
      b.done();
      if (r === 'saved') toast('Excel file saved');
    } catch (e) {
      b.done();
      toast(e.message, 'error');
    }
  };
  $('#pdf').onclick = async () => {
    const b = busy('Building PDF report…');
    try {
      if (!doors.length) return b.done(), noneMsg();
      const opts = { photos: $('#pdf-photos').checked, passDetail: $('#pdf-pass').checked, costs: $('#pdf-costs').checked, doors, filterText, plans };
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
      if (result === 'saved') toast(videosLeftOut ? `Backup saved (${videosLeftOut} video(s) not included – too large)` : 'Backup saved');
    } catch (e) {
      b.done();
      toast(e.message, 'error');
    }
  };
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
let planColl = ''; // collection of the plan on screen
let placingId = null; // an imported door waiting to be placed as a pin
let placingLabel = '';
let selectedPin = null;

async function renderPlan() {
  const plan = await db.get('plans', state.planId);
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
          <button class="icon-btn" id="plan-filter" aria-label="Filter pins">${icon('filter')}</button>
          <button class="icon-btn" id="to-list" aria-label="Door list">${icon('list')}</button>
        </span>
      </header>
      <div class="viewer" id="viewer"></div>
      <div class="mode-banner" id="banner" hidden></div>
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
  return all.filter((d) => !d.planId && (d.collection || '') === planColl).sort((a, b) => a.pinNo - b.pinNo);
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
    : `${planColl ? planColl + ' · ' : ''}${doors.length} doors · ${c.fail || 0} ${statusById.fail.short.toLowerCase()} · ${c.not_inspected || 0} to do`;
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
      <fieldset class="status-set" aria-label="Status">
        ${STATUSES.map((st) => `<label class="status-opt" style="--c:${st.color}"><input type="radio" name="status" value="${st.id}" ${st.id === (door.status || 'not_inspected') ? 'checked' : ''}><span>${st.label}</span></label>`).join('')}
      </fieldset>

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
      <label class="field"><span>Category</span>
        <select id="f-cat" data-k="category">${['', ...new Set([...(lists.categories || DEFAULT_CATEGORIES), door.category].filter(Boolean))].map((c) => `<option value="${esc(c)}" ${c === (door.category || '') ? 'selected' : ''}>${esc(c || 'No category')}</option>`).join('')}</select>
      </label>
      <label class="field"><span>Risk rating</span>
        <select id="f-risk" data-k="risk">${['', ...new Set([...(lists.risks || DEFAULT_RISKS), door.risk].filter(Boolean))].map((r) => `<option value="${esc(r)}" ${r === (door.risk || '') ? 'selected' : ''}>${esc(r || NO_RISK)}</option>`).join('')}</select>
      </label>
      <datalist id="zone-nos">${zones.map(([n, nm]) => `<option value="${esc(n)}">${esc(nm)}</option>`).join('')}</datalist>
      <datalist id="zone-names">${[...new Set(zones.map(([, nm]) => nm).filter(Boolean))].map((nm) => `<option value="${esc(nm)}"></option>`).join('')}</datalist>

      <section class="block">
        <div class="block-head"><h3>Inspection questions <span class="muted" id="q-n"></span></h3>
          <span class="row-btns">
            <button class="btn sm" id="q-rest">${icon('check')} Mark rest Pass</button>
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

      <section class="block">
        <div class="block-head"><h3>Materials</h3>
          <button class="btn sm" id="add-material">${icon('plus')} Add material</button>
        </div>
        <div id="materials"></div>
      </section>

      <label class="field"><span>Notes</span><textarea id="f-notes" data-k="notes" rows="3" placeholder="Anything else about this door">${esc(door.notes)}</textarea></label>
      <div class="grid2">
        <label class="field"><span>Inspected on</span><input type="date" id="f-on" data-k="inspectedOn" value="${esc(door.inspectedOn)}"></label>
        <label class="field"><span>Inspected by</span><input id="f-by" data-k="inspectedBy" value="${esc(door.inspectedBy)}" placeholder="Name"></label>
        <label class="field"><span>Next inspection due</span><input type="date" id="f-due" data-k="nextDue" value="${esc(door.nextDue || '')}"></label>
      </div>

      <section class="block">
        <div class="block-head"><h3>History</h3>
          <button class="btn sm" id="new-insp">${icon('plus')} New inspection</button>
        </div>
        <div id="history"></div>
      </section>

      <div class="sheet-actions">
        ${!door.planId ? `<button class="btn primary" id="sh-place">${icon('pin')} Place on drawing</button>`
          : state.view === 'plan' ? `<button class="btn" id="sh-move">${icon('move')} Move pin</button>` : `<button class="btn" id="sh-show">${icon('plan')} Show on plan</button>`}
        <button class="btn ghost danger-text" id="sh-del">${icon('trash')} Delete door</button>
      </div>
    </div>`;

  let current = door;
  const queue = (patch) => {
    current = { ...current, ...patch };
    pending = current;
    $('#saved').textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 400);
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

  // A door with defects or failed questions has failed — set that
  // automatically if it is still "Not inspected" or marked "Pass".
  const autoFail = (patch) => {
    if (['not_inspected', 'pass'].includes(current.status || 'not_inspected')) {
      patch.status = 'fail';
      $(`input[name=status][value=fail]`, el).checked = true;
      $('#sh-badge').style.setProperty('--pin', statusById.fail.color);
      $('#sh-badge').classList.remove('is-hollow');
    }
    if (!current.inspectedOn) {
      patch.inspectedOn = today();
      $('#f-on').value = patch.inspectedOn;
    }
    return patch;
  };

  $('#sh-close').onclick = () => back();
  $$('input[name=status]', el).forEach((r) => (r.onchange = () => setStatus(r.value)));
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

  // defects
  const drawDefects = () => {
    const list = current.defects || [];
    $('#def-n').textContent = list.length ? `(${list.length})` : '';
    $('#defects').innerHTML = list.length
      ? list.map((d, i) => `
        <div class="defect" data-i="${i}">
          <div class="defect-top"><b>${esc(d.label)}</b><button class="icon-btn sm def-del" aria-label="Remove defect">${icon('close')}</button></div>
          <div class="defect-fields">
            <label class="field"><span>Remedial work</span><textarea rows="2" class="def-rem" id="def-rem-${i}">${esc(d.remedial)}</textarea></label>
            <label class="field qty"><span>Qty</span><input type="number" inputmode="numeric" min="1" class="def-qty" id="def-qty-${i}" value="${esc(d.qty ?? 1)}"></label>
          </div>
        </div>`).join('')
      : '<p class="muted small">No defects recorded.</p>';
    $$('.defect', el).forEach((row) => {
      const i = Number(row.dataset.i);
      $('.def-del', row).onclick = () => {
        const defects = [...current.defects];
        defects.splice(i, 1);
        queue({ defects });
        drawDefects();
      };
      $('.def-rem', row).oninput = (e) => {
        const defects = current.defects.map((d, j) => (j === i ? { ...d, remedial: e.target.value } : d));
        queue({ defects });
      };
      $('.def-qty', row).oninput = (e) => {
        const defects = current.defects.map((d, j) => (j === i ? { ...d, qty: Number(e.target.value) || 1 } : d));
        queue({ defects });
      };
    });
  };
  drawDefects();
  $('#add-defect').onclick = async () => {
    const picked = await pickDefects(current.defects || []);
    if (!picked) return;
    const defects = [...(current.defects || []), ...picked.map((d) => ({ ...d, qty: 1 }))];
    const patch = { defects };
    if (picked.length) autoFail(patch);
    queue(patch);
    drawDefects();
  };

  // inspection questions
  const drawQuestions = () => {
    const qs = questionsFor(current, lists.questions || []);
    const checks = current.checks || {};
    const answered = qs.filter((q) => checks[q.id]?.answer).length;
    const fails = qs.filter((q) => checks[q.id]?.answer === 'fail').length;
    $('#q-n').textContent = qs.length ? `(${answered}/${qs.length}${fails ? ` · ${fails} fail` : ''})` : '';
    $('#q-rest').hidden = !qs.length || answered === qs.length;
    $('#questions').innerHTML = qs.length
      ? qs.map((q, i) => {
        const a = checks[q.id]?.answer || '';
        return `
        <div class="q-row ${a ? 'is-' + a : ''}" data-id="${esc(q.id)}">
          <span class="q-text"><span class="q-no">${i + 1}</span>${esc(q.text)}${q.removed ? ' <small class="muted">(removed from list)</small>' : ''}</span>
          <span class="q-ans" role="group" aria-label="Answer">
            ${ANSWERS.map((x) => `<button type="button" class="q-btn q-${x.id}" data-a="${x.id}" aria-pressed="${a === x.id}">${x.label}</button>`).join('')}
          </span>
        </div>`;
      }).join('')
      : '<p class="muted small">No questions set up. Add them in Settings.</p>';
    $$('.q-row', el).forEach((row) => {
      $$('.q-btn', row).forEach((b) => (b.onclick = () => {
        const q = qs.find((x) => x.id === row.dataset.id);
        const checks = { ...(current.checks || {}) };
        const prev = checks[q.id]?.answer;
        if (prev === b.dataset.a) delete checks[q.id]; // tap again to clear
        else checks[q.id] = { text: q.text, answer: b.dataset.a };
        const patch = { checks };
        if (b.dataset.a === 'fail' && prev !== 'fail') autoFail(patch);
        else if (!current.inspectedOn) { patch.inspectedOn = today(); $('#f-on').value = patch.inspectedOn; }
        queue(patch);
        drawQuestions();
      }));
    });
  };
  drawQuestions();
  $('#q-edit').onclick = async () => {
    await flushSave();
    go({ view: 'settings', focus: 's-qs' });
  };
  $('#q-rest').onclick = () => {
    const checks = { ...(current.checks || {}) };
    for (const q of questionsFor(current, lists.questions || [])) {
      if (!checks[q.id]?.answer) checks[q.id] = { text: q.text, answer: 'pass' };
    }
    const patch = { checks };
    if (!current.inspectedOn) { patch.inspectedOn = today(); $('#f-on').value = patch.inspectedOn; }
    queue(patch);
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

  // materials with costs
  const drawMaterials = () => {
    const list = current.materials || [];
    $('#materials').innerHTML = list.length
      ? list.map((m, i) => `
        <div class="mat" data-i="${i}">
          <div class="defect-top"><b>${esc(m.name)}</b>
            <span class="row-btns"><button class="btn ghost sm mat-dup" title="Add another size or type of this material">${icon('plus')} size</button>
            <button class="icon-btn sm mat-del" aria-label="Remove material">${icon('close')}</button></span></div>
          <label class="field"><span>Size / type</span><input class="mat-spec" id="mat-spec-${i}" value="${esc(m.spec || '')}" placeholder="e.g. 15 × 4 mm, white, combined" autocomplete="off"></label>
          <div class="mat-fields">
            <label class="field"><span>Qty${m.unit ? ' (' + esc(m.unit) + ')' : ''}</span><input type="number" inputmode="decimal" min="0" step="any" class="mat-qty" id="mat-qty-${i}" value="${esc(m.qty ?? 1)}"></label>
            <label class="field"><span>Unit cost €</span><input type="number" inputmode="decimal" min="0" step="0.01" class="mat-cost" id="mat-cost-${i}" value="${esc(m.cost ?? 0)}"></label>
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
  $('#add-material').onclick = async () => {
    const picked = await pickMaterials();
    if (!picked?.length) return;
    queue({ materials: [...(current.materials || []), ...picked] });
    drawMaterials();
  };

  // photos
  const drawPhotos = async () => {
    const photos = (await db.doorPhotos(door.id)).filter((p) => photoInView(p, { ...current, _current: true }));
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
          await db.put('photos', { id: db.uid(), projectId: door.projectId, doorId: door.id, inspection: current.inspectedOn || '', blob, thumb, width, height });
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
        ${(lists.materials || []).map((m, i) => !m.name?.trim() ? "" : `
          <label class="pick">
            <input type="checkbox" name="m${i}" value="${i}">
            <span><b>${esc(m.name)}</b><small>${m.cost ? euro(m.cost) + ' per ' + esc(m.unit || 'item') : 'No price set · per ' + esc(m.unit || 'item')}</small></span>
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
    return { id: db.uid(), name: m.name, unit: m.unit || '', qty: 1, cost: Number(m.cost) || 0 };
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
  const u = URL.createObjectURL(photo.blob);
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
      <p class="muted small pad">FSCF Doors v0.1 · data stays on this device until cloud sync is set up.</p>
    </main>`;
  $('#back').onclick = back;
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

  $('#s-cats').onchange = (e) => saveLists({ categories: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) });
  $('#s-risks').onchange = (e) => saveLists({ risks: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) });
  $('#s-actions').onchange = (e) => saveLists({ actions: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) });

  const drawQs = () => {
    $('#s-qs').innerHTML = (lists.questions || []).map((q, i) => `
      <div class="q-edit" data-i="${i}">
        <span class="q-no">${i + 1}</span>
        <textarea class="qe-text" id="qe-text-${i}" rows="2" aria-label="Question ${i + 1}">${esc(q.text)}</textarea>
        <span class="q-edit-btns">
          <button class="icon-btn sm qe-up" aria-label="Move up" ${i ? '' : 'disabled'}>${icon('up')}</button>
          <button class="icon-btn sm qe-del" aria-label="Remove">${icon('trash')}</button>
        </span>
      </div>`).join('') || '<p class="muted small">No questions.</p>';
    $$('.q-edit').forEach((row) => {
      const i = Number(row.dataset.i);
      $('.qe-text', row).onchange = (e) => saveLists({ questions: lists.questions.map((q, j) => (j === i ? { ...q, text: e.target.value } : q)) });
      $('.qe-del', row).onclick = async () => { await saveLists({ questions: lists.questions.filter((_, j) => j !== i) }); drawQs(); };
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
  $('#s-add-q').onclick = async () => {
    await saveLists({ questions: [...(lists.questions || []), { id: db.uid(), text: '' }] });
    drawQs();
    $$('.qe-text').at(-1)?.focus();
  };

  const drawMats = () => {
    $('#s-mats').innerHTML = (lists.materials || []).map((m, i) => `
      <div class="m-edit" data-i="${i}">
        <input class="me-name" id="me-name-${i}" value="${esc(m.name)}" aria-label="Material" placeholder="Material">
        <input class="me-unit" id="me-unit-${i}" value="${esc(m.unit)}" aria-label="Unit" placeholder="unit">
        <label class="me-cost"><span>€</span><input id="me-cost-${i}" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(m.cost || '')}" placeholder="0.00" aria-label="Unit cost in euro"></label>
        <button class="icon-btn sm me-del" aria-label="Remove">${icon('trash')}</button>
      </div>`).join('') || '<p class="muted small">No materials.</p>';
    $$('.m-edit').forEach((row) => {
      const i = Number(row.dataset.i);
      const upd = () => saveLists({
        materials: lists.materials.map((m, j) => (j === i ? { ...m, name: $('.me-name', row).value, unit: $('.me-unit', row).value, cost: Number($('.me-cost input', row).value) || 0 } : m)),
      });
      $$('input', row).forEach((inp) => (inp.onchange = upd));
      $('.me-del', row).onclick = async () => { await saveLists({ materials: lists.materials.filter((_, j) => j !== i) }); drawMats(); };
    });
  };
  drawMats();
  $('#s-add-m').onclick = async () => {
    await saveLists({ materials: [...(lists.materials || []), { id: db.uid(), name: '', unit: 'each', cost: 0 }] });
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
      const { result, videosLeftOut } = await backupProjects(projects);
      b.done();
      if (result === 'saved') toast(videosLeftOut ? `Backup saved (${videosLeftOut} video(s) not included – too large)` : 'Backup saved');
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
