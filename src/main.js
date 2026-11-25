// FSCF Doors — main app: screens, navigation and the door record.

import * as db from './db.js';
import {
  STATUSES, statusById, DEFAULT_DOOR_TYPES, DEFAULT_DEFECTS, LEAF_CONFIGS, DEFAULT_ACTIONS, DEFAULT_QUESTIONS, DEFAULT_MATERIALS,
  ANSWERS, doorActions, materialsTotal, euro, questionsFor, drawDemoPlan, SCHEMES, DEFAULT_SCHEME, useScheme,
} from './defaults.js';
import { PlanViewer } from './viewer.js';
import { importDrawing, compressImage, thumbFromCanvas } from './files.js';
import { exportProjectXlsx } from './export.js';
import { exportProjectPdf } from './report.js';
import { isVideo, videoInfo, fmtDuration, fmtSize, cleanLink } from './media.js';
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
    questions: DEFAULT_QUESTIONS, materials: DEFAULT_MATERIALS, inspector: '', ...(s || {}),
  };
  return lists;
}

async function saveLists(patch) {
  lists = await db.put('settings', { ...lists, ...patch });
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
  const byProject = {};
  for (const d of allDoors) (byProject[d.projectId] ||= []).push(d);

  app.innerHTML = `
    <header class="bar">
      <div class="brand"><span class="brand-mark">${icon('shield')}</span><div><b>FSCF Doors</b><small>Fire door inspections</small></div></div>
      <button class="icon-btn" id="settings" aria-label="Settings">${icon('gear')}</button>
    </header>
    <main class="page">
      <div class="offline-note">${icon('check')} Saved on this phone — works with no signal</div>
      ${projects.length ? `<h1 class="h1">Projects <span class="muted">${projects.length}</span></h1>` : ''}
      <div class="project-list">
        ${projects.map((p) => projectCard(p, byProject[p.id] || [])).join('')}
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

function projectCard(p, doors) {
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
      <div class="pc-scheme">${esc(scheme.name)}</div>
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
  const cur = p.scheme || DEFAULT_SCHEME;
  const r = await dialog({
    title: existing ? 'Project details' : 'New project',
    body: `
      <label class="field"><span>Site name</span><input name="site" id="pf-site" required value="${esc(p.site)}" placeholder="e.g. Tearmann Ward, Cavan General"></label>
      <label class="field"><span>Client</span><input name="client" id="pf-client" value="${esc(p.client)}" placeholder="e.g. HSE Estates"></label>
      <label class="field"><span>Address</span><input name="address" id="pf-address" value="${esc(p.address)}" placeholder="Town, county / Eircode"></label>
      <label class="field"><span>Inspection date</span><input type="date" name="date" id="pf-date" value="${esc(p.date)}"></label>
      <fieldset class="scheme-set">
        <legend>Status scheme</legend>
        ${Object.values(SCHEMES).map((sc) => `
          <label class="scheme-opt">
            <input type="radio" name="scheme" value="${sc.id}" ${sc.id === cur ? 'checked' : ''}>
            <span><b>${esc(sc.name)}</b><small>${esc(sc.hint)}</small></span>
          </label>`).join('')}
      </fieldset>`,
    buttons: [{ label: 'Cancel', value: false }, { label: existing ? 'Save' : 'Create project', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return null;
  const rec = await db.put('projects', { ...p, ...r.data, id: p.id || db.uid(), nextPin: p.nextPin || 1 });
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
  const plans = await db.projectPlans(project.id);
  const doors = await db.projectDoors(project.id);
  const tab = state.tab || 'plans';

  app.innerHTML = `
    <header class="bar">
      <button class="icon-btn" id="back" aria-label="Back">${icon('back')}</button>
      <div class="bar-title"><b>${esc(project.site || 'Untitled site')}</b><small>${esc([project.client, fmtDate(project.date)].filter(Boolean).join(' · '))}</small></div>
      <button class="icon-btn" id="proj-edit" aria-label="Project details">${icon('more')}</button>
    </header>
    <nav class="tabs" role="tablist">
      ${[['plans', 'Plans', plans.length], ['doors', 'Doors', doors.length], ['export', 'Export', '']].map(([id, label, n]) =>
        `<button role="tab" class="tab ${tab === id ? 'is-on' : ''}" data-tab="${id}" aria-selected="${tab === id}">${label}${n !== '' ? ` <span class="tab-n">${n}</span>` : ''}</button>`).join('')}
    </nav>
    <main class="page" id="tab-body"></main>
  `;
  $('#back').onclick = back;
  $('#proj-edit').onclick = () => editProject(project);
  $$('.tab').forEach((t) => (t.onclick = () => go({ ...state, tab: t.dataset.tab }, { replace: true })));
  const body = $('#tab-body');
  if (tab === 'plans') renderPlansTab(body, project, plans, doors);
  else if (tab === 'doors') renderDoorsTab(body, project, plans, doors);
  else renderExportTab(body, project, plans, doors);
}

function renderPlansTab(body, project, plans, doors) {
  const n = {};
  for (const d of doors) n[d.planId] = (n[d.planId] || 0) + 1;
  body.innerHTML = `
    <div class="plan-grid">
      ${plans.map((p) => `
        <div class="plan-card">
          <button class="plan-open" data-id="${p.id}">
            <img alt="" src="${objUrl(p.thumb || p.blob)}">
          </button>
          <div class="plan-meta">
            <div><b>${esc(p.name)}</b><small>${n[p.id] || 0} doors pinned</small></div>
            <button class="icon-btn sm plan-menu" data-id="${p.id}" aria-label="Plan options">${icon('more')}</button>
          </div>
        </div>`).join('')}
      <label class="plan-card upload">
        <input type="file" id="plan-file" accept="application/pdf,image/*" hidden>
        <span class="upload-ico">${icon('upload')}</span>
        <b>Upload drawing</b>
        <small>PDF or photo of a floor plan. Each PDF page becomes a plan.</small>
      </label>
    </div>`;
  $$('.plan-open', body).forEach((b) => (b.onclick = () => go({ view: 'plan', projectId: project.id, planId: b.dataset.id })));
  $$('.plan-menu', body).forEach((b) => (b.onclick = () => planMenu(plans.find((p) => p.id === b.dataset.id))));
  $('#plan-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const bz = busy('Reading drawing…');
    try {
      const pages = await importDrawing(file, bz.update);
      let order = plans.length;
      let first = null;
      for (const pg of pages) {
        const rec = await db.put('plans', { id: db.uid(), projectId: project.id, order: order++, sourceName: file.name, ...pg });
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

async function planMenu(plan) {
  const r = await dialog({
    title: 'Plan',
    body: `<label class="field"><span>Name</span><input name="name" id="plan-name" value="${esc(plan.name)}"></label>`,
    buttons: [{ label: 'Delete plan', value: 'delete', kind: 'ghost danger-text' }, { label: 'Cancel', value: false }, { label: 'Save', value: 'save', kind: 'primary' }],
  });
  if (r.value === 'save') {
    await db.put('plans', { ...plan, name: r.data.name || plan.name });
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
    (!q || [d.ref, d.location, d.doorType, String(d.pinNo), planName[d.planId]].join(' ').toLowerCase().includes(q)));
  body.innerHTML = `
    <div class="chips" role="group" aria-label="Filter by status">
      <button class="chip ${filter === 'all' ? 'is-on' : ''}" data-f="all">All <b>${doors.length}</b></button>
      ${STATUSES.map((s) => `<button class="chip ${filter === s.id ? 'is-on' : ''}" data-f="${s.id}" style="--c:${s.color}"><i></i>${s.label} <b>${counts[s.id]}</b></button>`).join('')}
    </div>
    <label class="search">${icon('search')}<input id="door-q" type="search" placeholder="Search door ref, room, type…" value="${esc(state.q || '')}"></label>
    ${doors.length ? '' : `<p class="muted pad">No doors yet. Open a plan and tap <b>Add door</b> to drop a pin.</p>`}
    <div class="door-table" role="table">
      ${shown.map((d) => doorRow(d, planName)).join('')}
    </div>
    ${doors.length && !shown.length ? '<p class="muted pad">No doors match this filter.</p>' : ''}
  `;
  $$('.chip', body).forEach((c) => (c.onclick = () => { state.filter = c.dataset.f; renderDoorsTab(body, project, plans, doors); }));
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
        <small>${esc([d.doorType, planName[d.planId]].filter(Boolean).join(' · ') || 'No details yet')}</small>
      </span>
      <span class="dr-side">
        <span class="status-pill" style="--c:${s.color}">${s.short}</span>
        ${nDef ? `<small>${nDef} defect${nDef > 1 ? 's' : ''}</small>` : ''}
        ${materialsTotal(d) ? `<small class="money">${euro(materialsTotal(d))}</small>` : ''}
      </span>
    </button>`;
}

function renderExportTab(body, project, plans, doors) {
  const nDef = doors.reduce((a, d) => a + (d.defects || []).length, 0);
  body.innerHTML = `
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
  $('#xlsx').onclick = async () => {
    const b = busy('Building Excel workbook…');
    try {
      const r = await exportProjectXlsx(project, lists.questions || []);
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
      const opts = { photos: $('#pdf-photos').checked, passDetail: $('#pdf-pass').checked, costs: $('#pdf-costs').checked };
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
let selectedPin = null;

async function renderPlan() {
  const plan = await db.get('plans', state.planId);
  useScheme(await db.get('projects', state.projectId));
  if (!plan) return go({ view: 'project', projectId: state.projectId, tab: 'plans' }, { replace: true });
  mode = null;
  selectedPin = null;
  app.innerHTML = `
    <div class="plan-screen">
      <header class="bar overlay">
        <button class="icon-btn" id="back" aria-label="Back">${icon('back')}</button>
        <div class="bar-title"><b>${esc(plan.name)}</b><small id="plan-counts"></small></div>
        <button class="icon-btn" id="to-list" aria-label="Door list">${icon('list')}</button>
      </header>
      <div class="viewer" id="viewer"></div>
      <div class="mode-banner" id="banner" hidden></div>
      <div class="zoom-ctl">
        <button class="icon-btn" id="zin" aria-label="Zoom in">${icon('zoomIn')}</button>
        <button class="icon-btn" id="zout" aria-label="Zoom out">${icon('zoomOut')}</button>
        <button class="icon-btn" id="zfit" aria-label="Fit to screen">${icon('fit')}</button>
      </div>
      <div class="plan-toolbar">
        <button class="btn primary big" id="add-door">${icon('pin')} Add door</button>
      </div>
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
      await db.put('doors', { ...d, x, y });
      toast('Pin moved');
      setMode(null);
    },
  });
  await viewer.load(plan.blob, plan.width, plan.height);
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
  if (state.focusDoor) {
    const d = await db.get('doors', state.focusDoor);
    if (d) viewer.focus(d.x, d.y);
    selectedPin = state.focusDoor;
    delete state.focusDoor;
    await refreshPins();
  }
}

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
  if (mode === 'add') {
    const pinNo = await db.nextPinNo(state.projectId);
    const door = await db.put('doors', {
      id: db.uid(), projectId: state.projectId, planId: state.planId, pinNo, x, y,
      ref: '', location: '', doorType: '', leaf: '', status: 'not_inspected', defects: [], actions: [], checks: {}, materials: [], notes: '',
      inspectedOn: '', inspectedBy: lists.inspector || '',
    });
    setMode(null);
    go({ ...state, doorId: door.id, isNew: true });
  } else if (mode === 'move' && selectedPin) {
    const d = await db.get('doors', selectedPin);
    await db.put('doors', { ...d, x, y });
    toast('Pin moved');
    setMode(null);
  }
}

async function refreshPins() {
  if (!viewer) return;
  const doors = (await db.byIndex('doors', 'planId', state.planId)).sort((a, b) => a.pinNo - b.pinNo);
  viewer.setPins(
    doors.map((d) => ({
      id: d.id, x: d.x, y: d.y, label: d.pinNo,
      color: statusById[d.status || 'not_inspected'].color,
      hollow: (d.status || 'not_inspected') === 'not_inspected',
      title: `Pin ${d.pinNo} ${d.ref || ''} ${statusById[d.status || 'not_inspected'].label}`,
    })),
    selectedPin || state.doorId
  );
  const c = countStatuses(doors);
  const el = $('#plan-counts');
  if (el) el.textContent = `${doors.length} doors · ${c.fail || 0} ${statusById.fail.short.toLowerCase()} · ${c.not_inspected || 0} to do`;
}

// ---------- Door record sheet ----------
let sheetDoorId = null;
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
      </div>

      <section class="block">
        <div class="block-head"><h3>Inspection questions <span class="muted" id="q-n"></span></h3>
          <button class="btn sm" id="q-rest">${icon('check')} Mark rest Pass</button>
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
      </div>

      <div class="sheet-actions">
        ${state.view === 'plan' ? `<button class="btn" id="sh-move">${icon('move')} Move pin</button>` : `<button class="btn" id="sh-show">${icon('plan')} Show on plan</button>`}
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
  $$('[data-k]', el).forEach((inp) => {
    const ev = inp.tagName === 'SELECT' || inp.type === 'date' ? 'change' : 'input';
    inp.addEventListener(ev, () => {
      queue({ [inp.dataset.k]: inp.value });
      if (inp.dataset.k === 'ref') $('#sh-title').textContent = inp.value || 'Door ' + door.pinNo;
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
          <div class="defect-top"><b>${esc(m.name)}</b><button class="icon-btn sm mat-del" aria-label="Remove material">${icon('close')}</button></div>
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
    const photos = await db.doorPhotos(door.id);
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
            id: db.uid(), projectId: door.projectId, doorId: door.id, kind: 'video',
            blob: f, mime: f.type || 'video/mp4', size: f.size, name: f.name, link: '', ...info,
          });
          if (f.size > 150 * 1048576) bigVideo = true;
        } else {
          bz.update('Saving photo…');
          const { blob, thumb, width, height } = await compressImage(f, 1600, 0.8);
          await db.put('photos', { id: db.uid(), projectId: door.projectId, doorId: door.id, blob, thumb, width, height });
        }
      }
      bz.done();
      drawPhotos();
      if (bigVideo) toast('Large video saved. Short clips (under a minute) keep the phone from filling up.');
    } catch (e) {
      bz.done();
      toast('Could not save: ' + e.message, 'error');
    }
  };
  $('#ph-cam').onchange = (e) => { addPhotos([...e.target.files]); e.target.value = ''; };
  $('#ph-lib').onchange = (e) => { addPhotos([...e.target.files]); e.target.value = ''; };
  $('#ph-vid').onchange = (e) => { addPhotos([...e.target.files]); e.target.value = ''; };

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
  $('#sh-del').onclick = async () => {
    if (await confirmBox('Delete door?', `Delete pin ${door.pinNo}${door.ref ? ' (' + door.ref + ')' : ''} and its photos? This cannot be undone.`)) {
      clearTimeout(saveTimer);
      pending = null;
      await db.deleteDoor(door.id);
      toast('Door deleted');
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
  await db.put('doors', rec);
  const s = $('#saved');
  if (s) s.textContent = 'Saved';
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
        <div class="block-head"><h2 class="h2">Inspection questions</h2><button class="btn sm" id="s-add-q">${icon('plus')} Add</button></div>
        <p class="muted small">Asked of every door, answered Pass / Fail / N/A. Answers already given are kept if you edit or remove a question.</p>
        <div id="s-qs"></div>
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
