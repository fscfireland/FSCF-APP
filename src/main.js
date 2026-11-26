// FSCF Ireland — main app: screens, navigation and the door record.

import * as db from './db.js';
import {
  STATUSES, statusById, DEFAULT_DOOR_TYPES, DEFAULT_DEFECTS, LEAF_CONFIGS, DEFAULT_ACTIONS, DEFAULT_QUESTIONS, DEFAULT_MATERIALS,
  ANSWERS, doorActions, materialsTotal, labourTotal, euro, questionsFor, drawDemoPlan, SCHEMES, DEFAULT_SCHEME, useScheme,
  setCustomSchemes, allSchemes, schemeById, OPTIONAL_STATUSES, statusesInUse, matLabel, zoneText, MATERIALS_VERSION, OLD_DOOR_TYPES, DOOR_TYPES_VERSION, DOOR_TYPE_NOTES, doorTypeGroup,
  DEFAULT_RISKS, NO_RISK, parseZones, zonesToText, DEFAULT_CATEGORIES, DEFAULT_WORK_TYPES, isInspected,
  DEFAULT_SIGNS, SIGN_FACES, signsNeeded, MAT_CATEGORIES, matCat, defectCat, QUESTION_DEFECT, defaultProductsFor, fillDefectProducts, uncostedFails, costAllFails, DEFAULT_KITS, KIND_IDS, kindForWork, DEFAULT_TEMPLATES,
} from './defaults.js';
import { PlanViewer } from './viewer.js';
import { importDrawing, compressImage, thumbFromCanvas, loadPdfJs } from './files.js';
import { TOOLS as AI_TOOLS, systemPrompt, makeRunner, activityText } from './assistant.js';
import { exportProjectXlsx, exportRemedialXlsx, exportPricingXlsx, exportProductionXlsx } from './export.js';
import { startCaps } from './caps.js';
import { REPLACEMENTS, SUPPLY, FIELD_TYPES, DEFAULT_FIELD_SECTIONS, sectionsFor, ratingOf, swingOf, missingFor, readFwAttrs } from './fields.js';
import { exportProjectPdf, exportRemedialPdf, loadJsPdf as loadJsPdfLib } from './report.js';
import { readWorkbook, nextNumbers, totals, tabName, quotePdf, quoteXlsx, sellPrice, money, priceDoors, nextPd, pdName, pad3, WORK_TYPES, STATUSES as Q_STATUSES, VAT_RATES, isInspection, suggestCustomerId, readableTag } from './quotes.js';
import { parseDoorFile, downloadTemplate, matchListValue } from './importer.js';
import { doorMapURL } from './minimap.js';
import { getPosition, geoError, gpsText, mapLink } from './geo.js';
import { signaturePad } from './signature.js';
import { markupPhoto, plainThumb } from './photomark.js';
import { DEFAULT_REMEDIAL_TEXT, remedialItems, remedialProgress, projectProgress } from './remedial.js';
import { MK_COLORS, TOOLS, TEXT_SIZES, renderSvg, lineLengthPx, fmtLength } from './markup.js';
import { isVideo, videoInfo, fmtDuration, fmtSize, cleanLink } from './media.js';
import { saveDoor, logEvent, setActor, snapshotOf, tagPhotosForSnapshot, photoInView, addMonths, FREQUENCIES, freqText } from './history.js';
import { emptyFilter, isFiltered, applyFilter, filterOptions, describeFilter } from './filters.js';
import {
  collLabel, listCollections, activeCollection, plansIn, suggestName, copyCollection, renameCollection, deleteCollection,
  splitColl, joinColl, isFolderPick, inColl, listFolders, sectionLabel, renameFolder,
} from './collections.js';
import { backupProjects, restoreBackup, backupToDrive, driveError, DRIVE_REASONS } from './backup.js';
import { readChecklistFile, guessDefect, downloadChecklist } from './checkimport.js';
import { readFieldwire, ratingToType } from './fieldwire.js';
import { textDoors, readerEstimate, readerGrid } from './drawingtext.js';
import { loadScript, saveFile, safeName } from './files.js';
// The drawing reader (Claude vision) is a separate file, loaded when first used
const reader = async () => { await loadScript('reader.js'); return window.FSCFReader; };
const aiDoors = async (...a) => (await reader()).aiDoors(...a);
const testKey = async (...a) => (await reader()).testKey(...a);
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
  return [s.view, s.projectId, s.planId, s.tab, s.quoteId].join('|');
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
    questions: DEFAULT_QUESTIONS, materials: DEFAULT_MATERIALS, risks: DEFAULT_RISKS, categories: DEFAULT_CATEGORIES, workTypes: DEFAULT_WORK_TYPES, fieldSections: DEFAULT_FIELD_SECTIONS, inspector: '', logoBanner: BRAND_BANNER, logoRound: BRAND_ROUND, ...(s || {}),
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
  if ((s?.typesVersion || 1) < DOOR_TYPES_VERSION) {
    const swap = (t) => OLD_DOOR_TYPES[t] || t;
    const fix = (list) => {
      // renamed types go back to their place in the standard order (e.g. final exits beside Non-rated)
      const out = [...new Set((list || []).filter((t) => !OLD_DOOR_TYPES[t]))];
      for (const [i, t] of DEFAULT_DOOR_TYPES.entries()) if (!out.includes(t)) out.splice(Math.min(i, out.length), 0, t); // adds E30Sa4 / E60Sa4
      return out;
    };
    const kits = Object.fromEntries(Object.entries(s?.kits || {}).map(([k, v]) => [k, v.doorTypes ? { ...v, doorTypes: v.doorTypes.map(swap) } : v]));
    await saveLists({ ...(s?.doorTypes ? { doorTypes: fix(s.doorTypes) } : {}), ...(s?.kits ? { kits } : {}), typesVersion: DOOR_TYPES_VERSION });
    for (const d of await db.all('doors')) {
      if (OLD_DOOR_TYPES[d.doorType]) await db.put('doors', { ...d, doorType: OLD_DOOR_TYPES[d.doorType] });
    }
  }
  if (s?.defects && (s.defVersion || 1) < 2) {
    const have = new Set(s.defects.map((d) => d.label));
    const add = DEFAULT_DEFECTS.filter((d) => !have.has(d.label));
    await saveLists({ defects: [...s.defects, ...add], defVersion: 2 });
  }
  return lists;
}

// ---------- Inspection types ("kits") ----------
// Fire doors use the main lists; dampers, fire alarm, emergency lighting and
// extinguishers keep their own checklist, defects and item types in lists.kits.
let kindNow = 'fd'; // the type of the pin on screen, or being edited in Settings
let planKind = 'fd'; // the type new pins on the drawing on screen will get
// Checklist templates: shipped ones (DEFAULT_TEMPLATES) and your own (lists.customKits)
const templateOf = (id) => DEFAULT_TEMPLATES[id] || (lists.customKits || []).find((x) => x.id === id) || null;
// every type and checklist, in order: the five types, then the templates under them
function kindIds() {
  const hidden = new Set(lists.hiddenKits || []);
  const tpl = [...Object.keys(DEFAULT_TEMPLATES), ...(lists.customKits || []).map((x) => x.id)].filter((id) => !hidden.has(id));
  const base = (id) => templateOf(id)?.base || 'fd';
  return KIND_IDS.flatMap((k) => [k, ...tpl.filter((t) => base(t) === k)]);
}
function kitOf(kind) {
  const t = kind && kind !== 'fd' && !DEFAULT_KITS[kind] ? templateOf(kind) : null;
  if (t) {
    const b = kitOf(t.base || 'fd');
    const own = lists.kits?.[kind] || {};
    const extra = (t.extraDefects || []).map(([label, remedial]) => ({ label, remedial }));
    return {
      ...b, ...t, ...own, id: kind, base: t.base || 'fd',
      questions: own.questions || t.questions || b.questions,
      defects: own.defects || (extra.length ? [...b.defects, ...extra.filter((x) => !b.defects.some((y) => y.label === x.label))] : b.defects),
      doorTypes: own.doorTypes || t.doorTypes || b.doorTypes,
    };
  }
  if (!kind || kind === 'fd' || !DEFAULT_KITS[kind]) {
    return { id: 'fd', base: 'fd', name: 'Fire doors', item: 'Door', report: 'Fire Door Inspection Report', questions: lists.questions || [], defects: lists.defects || [], doorTypes: lists.doorTypes || [] };
  }
  return { id: kind, base: kind, ...DEFAULT_KITS[kind], ...(lists.kits?.[kind] || {}) };
}
const kcls = (k) => 'k-' + (kitOf(k).base || k);
const kq = () => kitOf(kindNow).questions || [];
const kd = () => kitOf(kindNow).defects || [];
const kt = () => kitOf(kindNow).doorTypes || [];
async function saveKit(patch, kind = kindNow) {
  if (!kind || kind === 'fd' || (!DEFAULT_KITS[kind] && !templateOf(kind))) return saveLists(patch);
  return saveLists({ kits: { ...(lists.kits || {}), [kind]: { ...(lists.kits?.[kind] || {}), ...patch } } });
}
const kindOfPlan = (plan) => plan?.inspType || 'fd';
const kindOfDoor = (d, plan) => d?.kind || plan?.inspType || 'fd';
// every type's questions (for exports covering several types)
const allQuestions = () => kindIds().flatMap((k) => kitOf(k).questions || []);

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
    repViewer?.destroy();
    repViewer = null;
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.clear();
    window.scrollTo(0, 0);
    if (state.view === 'projects') await renderProjects();
    else if (state.view === 'project') await renderProject();
    else if (state.view === 'plan') await renderPlan();
    else if (state.view === 'settings') await renderSettings();
    else if (state.view === 'library') await renderLibrary();
    else if (state.view === 'quotes') await renderQuotes();
    else if (state.view === 'quote') await renderQuoteDoc();
    else if (state.view === 'assistant') await renderAssistant();
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
  const groupBy = 'group'; // projects are listed under their group
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
        if (days !== null && days < 2) return `<div class="offline-note">${icon('check')} <span>Saved on this device · backed up ${days ? 'yesterday' : 'today'}${lists.autoBackup ? ' · automatic backup on' : ''}</span> <button class="link-btn" id="home-backup">Back up now</button></div>`;
        return `<div class="backup-warn">${icon('shield')}<span><b>${last ? `Last backup ${days} days ago` : 'Not backed up yet'}</b><small>Your projects are stored only on this device and in this browser. Back up everything to Google Drive.</small></span><button class="btn sm primary" id="home-backup">Back up now</button></div>`;
      })()}
      ${liveHtml}
      <button class="lib-card ai-card" id="ask-claude">${icon('spark')}<span><b>Ask Claude</b><small>Ask about your sites, doors and reports, or have it update them for you</small></span>${icon('more')}</button>
      ${priced() ? `<button class="lib-card" id="my-prices">${icon('list')}<span><b>Prices</b><small>Normal price list, and prices for a site or collection</small></span>${icon('more')}</button>` : ''}
      <button class="lib-card" id="my-quotes">${icon('report')}<span><b>Quotes &amp; invoices</b><small>${priced() ? 'Same numbers, customers and prices as your Excel workbook' : 'Owner only · tap and enter your PIN'}</small></span>${icon(priced() ? 'more' : 'shield')}</button>
      <button class="lib-card" id="my-files">${icon('folder')}<span><b>My files</b><small>${libCount} file${libCount === 1 ? '' : 's'} · private to you${lists.libPin ? ' · PIN locked' : ''}</small></span>${icon(lists.libPin ? 'shield' : 'more')}</button>
      ${projects.length ? `<h1 class="h1">Projects <span class="muted">${projects.length}</span></h1>
      <div class="home-tools">
        <div class="site-pick">
          <label class="search">${icon('search')}<input id="proj-q" type="search" placeholder="Search or pick a site…" value="${esc(state.projQ || '')}" autocomplete="off"><button type="button" class="icon-btn sm site-dd-btn" id="proj-dd" aria-label="Show all sites" aria-expanded="${state.siteDd ? 'true' : 'false'}">${icon('down')}</button></label>
          <div class="site-dd" id="site-dd" ${state.siteDd ? '' : 'hidden'}>${(() => {
            const list = [...shown].sort((a, b) => (a.site || '').localeCompare(b.site || ''));
            return list.length ? list.map((p) => `<button type="button" class="site-dd-row" data-id="${p.id}"><b>${esc(p.site || 'Untitled site')}</b><small>${esc([p.client, p.group].filter(Boolean).join(' · '))}</small></button>`).join('') : '<p class="muted small pad">No sites match.</p>';
          })()}</div>
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
  $('#ask-claude')?.addEventListener('click', () => go({ view: 'assistant' }));
  $('#my-prices')?.addEventListener('click', () => pricesHome());
  $('#my-quotes')?.addEventListener('click', async () => { if (priced() || (await unlockOwner())) go({ view: 'quotes' }); });
  $('#home-backup')?.addEventListener('click', async () => {
    if (await backupEverythingToDrive(await db.all('projects'))) return;
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
  $$('#new-project, #new-project-2').forEach((b) => (b.onclick = () => newProjectMenu()));
  const demo = $('#demo');
  if (demo) demo.onclick = loadDemo;
  $$('.project-card').forEach((el) => (el.onclick = () => go({ view: 'project', projectId: el.dataset.id, tab: 'plans' })));
  // site drop-down: the ▾ button opens every site (or those matching the search); tap one to open it
  const dd = $('#site-dd');
  const setDd = (open) => {
    state.siteDd = open;
    if (dd) dd.hidden = !open;
    $('#proj-dd')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  $('#proj-dd')?.addEventListener('click', (e) => { e.preventDefault(); setDd(!state.siteDd); });
  $$('.site-dd-row').forEach((b) => (b.onclick = () => { setDd(false); go({ view: 'project', projectId: b.dataset.id, tab: 'plans' }); }));
  const closeDd = (e) => {
    if (!state.siteDd || e.target.closest?.('.site-pick')) return;
    setDd(false);
  };
  document.removeEventListener('pointerdown', homeDdCloser);
  homeDdCloser = closeDd;
  document.addEventListener('pointerdown', homeDdCloser);
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
    state.siteDd = !!pq.value.trim(); // typing shows the matching sites
    const pos = pq.selectionStart;
    refresh().then(() => {
      const n = $('#proj-q');
      n?.focus();
      n?.setSelectionRange(pos, pos);
    });
  };
}

let homeDdCloser = () => {};

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

// New project from a Fieldwire report PDF
// ---------- Find fire doors on a compartment drawing ----------
// Keep the screen on while the drawing reader works (phones stop pages when they sleep)
async function keepAwake() {
  try {
    const lock = await navigator.wakeLock?.request('screen');
    return () => lock?.release().catch(() => {});
  } catch {
    return () => {};
  }
}
const usd = (n) => 'US$' + (n < 0.1 ? n.toFixed(2) : n.toFixed(2));
// estimated cost of reading a plan, less any sections already paid for
const readerCost = (plan) => {
  const W = plan.width || 4000;
  const H = plan.height || 2800;
  const { cols, rows, sig } = readerGrid(W, H);
  const c = plan.readerCache?.sig === sig ? plan.readerCache : null;
  const done = c ? Object.keys(c.tiles || {}).length + (c.legend ? 1 : 0) : 0;
  return readerEstimate(W, H) * (1 - done / (cols * rows + 1));
};

// Run the drawing reader on one plan, saving each finished section on the plan
// so an interrupted run carries on later without paying twice.
async function readPlan(plan, onProgress) {
  const p = await db.get('plans', plan.id);
  const res = await aiDoors(p.blob, lists.aiKey, onProgress, p.readerCache || null, async (cache) => {
    const cur = await db.get('plans', plan.id);
    if (cur) await db.put('plans', { ...cur, readerCache: cache });
  });
  const cur = await db.get('plans', plan.id);
  if (cur) { delete cur.readerCache; await db.put('plans', cur); }
  return res;
}

// Pins are added at each door found, numbered on from the project's refs,
// with the rating as the door type and the room as the location.
async function addFoundDoors(projectId, plan, found, kind, how) {
  const all = await db.projectDoors(projectId);
  let added = 0;
  for (const f of found) {
    const pinNo = await db.nextPinNo(projectId);
    const ref = nextFreeRef(all);
    const drawingNo = (f.ref || '').trim();
    const door = await saveDoor({
      id: db.uid(), projectId, planId: plan.id, pinNo, x: Math.min(0.99, Math.max(0.01, f.x)), y: Math.min(0.99, Math.max(0.01, f.y)), kind,
      ref, location: (f.room || '').trim(), doorType: ratingToType(f.rating) || '', leaf: '', status: 'not_inspected',
      defects: [], actions: [], checks: {}, materials: [], notes: [f.rating ? `Rating on drawing: ${f.rating}` : '', drawingNo ? `Door number on drawing: ${drawingNo}` : ''].filter(Boolean).join('\n'),
      zoneNo: '', zoneName: '', risk: '', category: '', inspectedOn: '', inspectedBy: lists.inspector || '', found: how,
    }, [`Pin added by the drawing reader (${how === 'ai' ? 'Claude vision' : 'drawing text'}). Check its position.`]);
    all.push(door);
    added++;
  }
  return added;
}

function noKeyDialog() {
  return dialog({
    title: 'Drawing reader not set up',
    body: `<p>This drawing is a scan or flat image, so the doors can't be read from its text. The <b>drawing reader</b> uses Claude (Anthropic's AI) to look at the drawing and find the fire doors.</p>
      <p class="small">It needs your own Anthropic API key, added once in <b>Settings › Drawing reader</b>. Each drawing read is charged to your account by Anthropic.</p>`,
    buttons: [{ label: 'Not now', value: false }, { label: 'Open Settings', value: 'set', kind: 'primary' }],
  }).then((r) => { if (r.value === 'set') go({ view: 'settings' }); });
}

// From the drawing's menu: find doors on a drawing already in a project
async function findDoorsOnPlan(plan) {
  if (!lists.aiKey) return noKeyDialog();
  const existing = await db.byIndex('doors', 'planId', plan.id);
  const r = await dialog({
    title: `Find fire doors on "${plan.name}"`,
    body: `<p>Claude looks over the drawing and adds a pin at each fire door it finds, with the rating as the door type and the room as the location. Takes 1–4 minutes; keep the app open on this screen.</p>
      ${priced() ? `<p class="small">Estimated cost: about <b>${usd(readerCost(plan))}</b>${plan.readerCache ? ' (part of it was read last time and is not charged again)' : ''}.</p>` : ''}
      <p class="cost-note">${icon('spark')} <span><b>Cost will be charged to your account.</b> The drawing reader is billed by Anthropic to the account of the API key in Settings.</span></p>
      ${existing.length ? `<p class="small">This drawing already has ${existing.length} pin${existing.length === 1 ? '' : 's'}. Doors found right next to one of them are skipped.</p>` : ''}`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Find doors', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return;
  const bz = busy('Starting the drawing reader…');
  const release = await keepAwake();
  try {
    const res = await readPlan(plan, bz.update);
    const p = await db.get('plans', plan.id);
    const fresh = res.doors.filter((f) => !existing.some((d) => d.x != null && Math.hypot(d.x - f.x, d.y - f.y) < 0.015));
    const n = await addFoundDoors(plan.projectId, p, fresh, kindOfPlan(p), 'ai');
    release();
    bz.done();
    await dialog({
      title: n ? `${n} door${n === 1 ? '' : 's'} added` : 'No new doors found',
      body: `<p>${n ? 'Check each pin is in the right spot: press and hold a pin to drag it, and delete any that are not fire doors.' : 'Nothing new was found. You can add pins by hand with Add.'}</p>${priced() ? `<p class="muted small">Drawing reader cost about US$${res.costUsd.toFixed(2)}.</p>` : ''}`,
      buttons: [{ label: 'OK', value: true, kind: 'primary' }],
    });
    go({ view: 'plan', projectId: plan.projectId, planId: plan.id });
  } catch (err) {
    release();
    bz.done();
    console.error(err);
    toast('Drawing reader: ' + (err.status === 401 ? 'the API key was not accepted. Check it in Settings.' : err.message), 'error');
  }
}

// From the home page: a whole new project from a drawing
async function importFromDrawing(file, { manual = false } = {}) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const r = await dialog({
    title: manual ? 'New project: I\'ll pin it myself' : 'New project from a drawing',
    body: `${manual ? '<p class="small">The drawing is added with no pins, and nothing is charged. Open it and tap <b>Add door</b> to drop your own pins.</p>' : `<p class="small">The app adds a drawing for each page and a pin at every fire door it can find, with its rating and room. For CAD PDFs the text is read on this phone for free; for scanned drawings and photos the <b>drawing reader</b> (Claude) is used${lists.aiKey ? '' : ' once it is set up in Settings'}.</p>`}
      <label class="field"><span>Site</span><input name="site" required value="${esc(file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '))}"></label>
      <div class="grid2"><label class="field"><span>Client</span><input name="client" placeholder="e.g. HSE"></label>
        <label class="field"><span>Inspection date</span><input type="date" name="date" value="${today()}"></label></div>
      <label class="field"><span>Address / Eircode</span><input name="address"></label>
      <label class="field"><span>Inspection frequency</span><select name="frequency">${freqOpts('')}</select><small class="muted">Each door's next inspection due date is worked out from its inspection date.</small></label>
      <label class="field"><span>Inspection type</span><select name="kind">${kindIds().map((k) => `<option value="${k}" ${k === 'fd' ? 'selected' : ''}>${esc(kitOf(k).name)}</option>`).join('')}</select></label>
      ${lists.aiKey && !manual ? `<label class="check-line"><input type="checkbox" name="ai" checked> Auto-pin pages with no readable text using the drawing reader</label><p class="cost-note">${icon('spark')} <span><b>Cost will be charged to your account.</b> The drawing reader is billed by Anthropic to the account of the API key in Settings.</span></p>` : ''}`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Create project', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return;
  const kind = r.data.kind || 'fd';
  const useAi = !manual && !!(lists.aiKey && r.data.ai);
  const bz = busy(manual ? 'Adding the drawing…' : 'Reading the drawing…');
  let cost = 0;
  let total = 0;
  const notes = [];
  try {
    const pages = await importDrawing(file, bz.update);
    const text = isPdf && !manual ? await textDoors(file).catch(() => []) : [];
    const project = await db.put('projects', {
      id: db.uid(), site: r.data.site.trim() || file.name, client: r.data.client.trim(), address: r.data.address.trim(), date: r.data.date || today(),
      frequency: Number(r.data.frequency) || 0,
      workType: kindIds().includes(kind) && kind !== 'fd' ? kitOf(kind).name : 'Fire door inspection', scheme: lists.lastScheme || DEFAULT_SCHEME, zones: [], nextPin: 1,
    });
    let first = null;
    let needAi = 0;
    const scanned = [];
    for (const [i, pg] of pages.entries()) {
      const plan = await db.put('plans', { id: db.uid(), projectId: project.id, order: i, sourceName: file.name, collection: '', inspType: kind, ...pg });
      first ||= plan;
      const t = text[i];
      if (t?.doors.length) {
        total += await addFoundDoors(project.id, plan, t.doors, kind, 'text');
        notes.push(`${plan.name}: ${t.doors.length} from the drawing's text`);
      } else if (!manual) scanned.push(plan);
    }
    if (manual) {
      await addBlob(project.id, file, file.name, 'Drawings', { notes: 'Drawing this project was created from' }).catch(() => {});
      bz.done();
      toast(pages.length > 1 ? `Project created with ${pages.length} drawings. Tap Add door to pin` : 'Project created. Tap Add door to drop your pins');
      return go({ view: 'plan', projectId: project.id, planId: first.id });
    }
    // scanned pages: choose which to read (cover sheets and notes pages cost money too)
    let toRead = useAi ? scanned : [];
    if (useAi && scanned.length) {
      bz.done();
      const thumbs = scanned.map((pl) => (pl.thumb ? URL.createObjectURL(pl.thumb) : ''));
      const pick = await dialog({
        title: `Read ${scanned.length === 1 ? 'this drawing' : 'which drawings'}?`,
        body: `<p class="small">${scanned.length === 1 ? 'It has' : 'These have'} no readable text, so the drawing reader (Claude) will look for the doors. Untick cover sheets, notes and legend pages. Each takes 1–4 minutes; keep the app open.</p>
          <div class="pick-list">${scanned.map((pl, i) => `<label class="pick pick-page"><input type="checkbox" name="pg_${i}" checked>
            ${thumbs[i] ? `<img alt="" src="${thumbs[i]}">` : ''}<span><b>${esc(pl.name)}</b>${priced() ? `<small>about ${usd(readerCost(pl))}</small>` : ''}</span></label>`).join('')}</div>
          ${priced() && scanned.length > 1 ? `<p class="small">All ticked: about <b>${usd(scanned.reduce((a, pl) => a + readerCost(pl), 0))}</b></p>` : ''}
          <p class="cost-note">${icon('spark')} <span><b>Cost will be charged to your account.</b> The drawing reader is billed by Anthropic to the account of the API key in Settings.</span></p>`,
        buttons: [{ label: 'Skip for now', value: false }, { label: 'Read ticked drawings', value: true, kind: 'primary' }],
      });
      thumbs.forEach((u) => u && URL.revokeObjectURL(u));
      toRead = pick.value === true ? scanned.filter((_, i) => pick.data['pg_' + i]) : [];
    }
    const release = toRead.length ? await keepAwake() : () => {};
    const bz2 = toRead.length ? busy('Starting the drawing reader…') : { update() {}, done() {} };
    let stopped = null;
    for (const plan of scanned) {
      const n = toRead.indexOf(plan);
      if (n < 0 || stopped) {
        needAi++;
        notes.push(`${plan.name}: ${stopped ? 'not read (stopped)' : useAi ? 'skipped' : 'no readable text, pins not added'}`);
        continue;
      }
      try {
        const res = await readPlan(plan, (m) => bz2.update(`Drawing ${n + 1} of ${toRead.length}: ${m}`));
        cost += res.costUsd;
        total += await addFoundDoors(project.id, plan, res.doors, kind, 'ai');
        notes.push(`${plan.name}: ${res.doors.length} found by the drawing reader`);
        if (plan === scanned[0] && res.site && !r.data.site.trim()) await db.put('projects', { ...(await db.get('projects', project.id)), site: res.site });
      } catch (err) {
        console.error(err);
        notes.push(`${plan.name}: ${err.status === 401 ? 'stopped. The API key was not accepted.' : err.message}`);
        needAi++;
        if (err.status === 401) stopped = err;
      }
    }
    release();
    bz2.done();
    await addBlob(project.id, file, file.name, 'Drawings', { notes: 'Drawing this project was created from' }).catch(() => {});
    bz.done();
    await dialog({
      title: total ? `${total} door${total === 1 ? '' : 's'} found` : 'Project created',
      body: `<ul class="sheet-list small">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        ${total ? '<p>Each door has a pin, numbered from 001, with the rating as its door type and the room as its location. <b>Check each one</b>: press and hold a pin to drag it into place, and delete any that are not fire doors.</p>' : ''}
        ${needAi ? `<p class="small">${lists.aiKey ? 'To read the others later' : 'Scanned pages need the drawing reader. Set it up in <b>Settings › Drawing reader</b>, then'}: open the drawing's menu on the Plans tab and tap <b>Find doors…</b>. Anything already read is not charged again.</p>` : ''}
        ${cost && priced() ? `<p class="muted small">Drawing reader cost about US$${cost.toFixed(2)}.</p>` : ''}`,
      buttons: [{ label: 'Open the drawing', value: true, kind: 'primary' }],
    });
    go({ view: 'plan', projectId: project.id, planId: first.id });
  } catch (err) {
    bz.done();
    console.error(err);
    toast('Could not finish: ' + (err.status === 401 ? 'the drawing reader key was not accepted. Check it in Settings.' : err.message), 'error');
  }
}

// ---------- Quotes & invoices ----------
// Matches the "INVOICES AND QUOTES" workbook: same numbers, customers, sites,
// VAT precedent, rates and terms. Owner only (hidden while prices are locked).
async function quoteBook() {
  return (await db.get('settings', 'quoteBook')) || null;
}
const QTERMS = {
  quote: 'Please read the terms and conditions on page 2 carefully before accepting this quotation. Acceptance of this quote or issue of a purchase order confirms agreement to these terms.',
  worksQuote: '1. A 70% deposit is required before fire doors, bespoke doorsets or special-order items are ordered. 2. VAT is charged at 13.5% on this supply of remedial works. 3. Please read the full terms and conditions on page 2 carefully before accepting this quotation.',
  invoice: 'Payment is due by the date shown above. The terms and conditions on page 2 remain applicable to the quoted and invoiced scope.',
};
const pricingRule = () => lists.pricingRule || 'x1.4';

async function importQuoteBook(file) {
  const bz = busy('Reading your workbook…');
  try {
    const book = await readWorkbook(file, bz.update);
    await db.put('settings', { id: 'quoteBook', ...book });
    bz.done();
    const nx = nextNumbers(book, await db.all('quotes'));
    await dialog({
      title: 'Workbook imported',
      body: `<ul class="sheet-list small">
        <li><b>${book.register.length}</b> quotes and invoices read</li>
        <li><b>${book.customers.length}</b> customers with their addresses, sites, PO numbers and VAT</li>
        <li><b>${book.rates.length}</b> priced items from SERV PD MASTER</li>
        <li><b>${book.pastLines.length}</b> past quote lines to reuse</li>
        <li>Next numbers: tab <b>${nx.tab}</b> · quote <b>${nx.quote}</b> · invoice <b>${nx.inv}</b></li></ul>
        <p class="small">Import it again whenever you add documents in Excel, so the numbers stay in step.</p>`,
      buttons: [{ label: 'OK', value: true, kind: 'primary' }],
    });
    refresh();
  } catch (err) {
    bz.done();
    console.error(err);
    toast('Could not read the workbook: ' + err.message, 'error');
  }
}

async function renderQuotes() {
  const book = await quoteBook();
  const docs = (await db.all('quotes')).sort((a, b) => (b.tab || 0) - (a.tab || 0));
  const nx = nextNumbers(book, docs);
  app.innerHTML = `
    <header class="bar">
      <button class="icon-btn" id="back" aria-label="Back">${icon('back')}</button>
      <div class="bar-title"><b>Quotes &amp; invoices</b><small>${book ? `Next: ${nx.quote} · ${nx.inv} · tab ${nx.tab}` : 'Import your workbook to start'}</small></div>
    </header>
    <main class="page" id="q-body"></main>`;
  $('#back').onclick = back;
  const body = $('#q-body');
  if (!priced()) {
    body.innerHTML = `<p class="muted pad">Prices are locked. Unlock with your owner PIN on the home page to use quotes and invoices.</p>`;
    return;
  }
  const status = (s) => `<span class="q-status q-${(s || '').toLowerCase()}">${esc(s || '')}</span>`;
  const row = (d) => {
    const t = totals(d);
    return `<button class="doc-row" data-id="${d.id}"><span class="q-kind ${d.kind === 'INV' ? 'is-inv' : ''}">${d.kind === 'INV' ? 'INV' : 'Q'}</span>
      <span class="q-main"><b>${esc(d.kind === 'INV' ? d.inv : d.quote)} · ${esc(d.cust?.id || '')}</b><small>${esc((d.site?.lines || [])[0] || (d.cust?.lines || [])[0] || '')} · ${fmtDate(d.date)}</small></span>
      <span class="q-amt"><b>${money(t.total)}</b>${status(d.status)}</span></button>`;
  };
  const wbRecent = book ? [...book.register].reverse().slice(0, 40) : [];
  body.innerHTML = `
    ${book ? '' : `<section class="panel"><h2 class="h2">Start with your workbook</h2>
      <p class="small">Import <b>INVOICES AND QUOTES</b> (the .xlsx). The app reads your numbering, customers and their sites, PO numbers, VAT precedent, the SERV PD MASTER rates, past quote lines and your terms, so new quotes carry on exactly where Excel left off.</p>
      <label class="btn primary">${icon('upload')} Import workbook (.xlsx)<input type="file" class="qb-import" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label></section>`}
    <div class="row-btns">
      <button class="btn primary" id="q-new">${icon('plus')} New quote</button>
      <button class="btn" id="q-fromrep">${icon('door')} Quote from a report</button>
      <button class="btn" id="q-newinv">${icon('plus')} New invoice</button>
    </div>
    <h2 class="h2">Made in the app <span class="muted">${docs.length}</span></h2>
    <div class="doc-list">${docs.map(row).join('') || '<p class="muted small">None yet.</p>'}</div>
    ${book ? `<details class="panel fold-d"><summary class="h2">In the workbook <span class="muted">latest ${wbRecent.length}</span></summary>
      <div class="doc-list">${wbRecent.map((r) => `<div class="doc-row is-wb"><span class="q-kind ${r.kind === 'INV' ? 'is-inv' : ''}">${r.kind === 'INV' ? 'INV' : 'Q'}</span>
        <span class="q-main"><b>${esc(r.kind === 'INV' ? r.inv : r.quote)} · ${esc(r.cust)}</b><small>${esc(r.location || '')} · ${fmtDate(r.date)}</small></span>
        <span class="q-amt"><b>${r.total != null ? money(r.total) : ''}</b>${status(r.status)}${r.kind === 'Q' && r.items?.length ? `<button class="btn sm wb-inv" data-sheet="${esc(r.sheet)}">Invoice</button>` : ''}</span></div>`).join('')}</div></details>
    <section class="panel">
      <h2 class="h2">Workbook &amp; pricing</h2>
      <p class="small muted">From <b>${esc(book.sourceName)}</b>, imported ${fmtDate(book.importedAt.slice(0, 10))}. Re-import after adding documents in Excel.</p>
      <label class="field"><span>Selling price from cost + labour</span><select id="q-rule">
        <option value="x1.4" ${pricingRule() === 'x1.4' ? 'selected' : ''}>× 1.4 (as your pricing docs, e.g. PD-031)</option>
        <option value="margin40" ${pricingRule() === 'margin40' ? 'selected' : ''}>40% margin, ÷ 0.6 (as SERV PD MASTER)</option></select></label>
      <label class="btn">${icon('upload')} Re-import workbook<input type="file" class="qb-import" accept=".xlsx,.xlsm" hidden></label>
    </section>` : ''}`;
  $$('.qb-import').forEach((inp) => (inp.onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importQuoteBook(f); }));
  $('#q-rule')?.addEventListener('change', (e) => saveLists({ pricingRule: e.target.value }));
  $$('.doc-row[data-id]').forEach((b) => (b.onclick = () => go({ view: 'quote', quoteId: b.dataset.id })));
  $('#q-new').onclick = () => newQuoteDoc('Q');
  $('#q-newinv').onclick = () => newInvoiceFrom(null);
  $('#q-fromrep').onclick = () => quoteFromReport(null);
  $$('.wb-inv').forEach((b) => (b.onclick = () => newInvoiceFrom(book.register.find((r) => r.sheet === b.dataset.sheet))));
}

// Choose (or add) the customer and site, then make the document
async function pickCustomer(book) {
  const cs = book?.customers || [];
  const r = await dialog({
    title: 'Customer and site',
    body: `<label class="field"><span>Customer</span><select name="cust" id="pc-cust">
        <option value="">New customer…</option>${cs.map((c) => `<option value="${esc(c.id)}">${esc(c.id)} · ${esc((c.lines.find((l) => !/^(mr|ms|mrs)\b/i.test(l) && l.length > 3) || c.lines[0] || '').slice(0, 40))}</option>`).join('')}</select></label>
      <label class="field"><span>Site / delivery address</span><select name="site" id="pc-site"><option value="">New site…</option></select></label>
      <label class="field"><span>Type of work</span><select name="wt">${Object.entries(WORK_TYPES).map(([k, v]) => `<option value="${k}">${k} · ${v}</option>`).join('')}</select></label>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Next', value: true, kind: 'primary' }],
    onOpen: (el) => {
      const sel = el.querySelector('#pc-cust');
      const site = el.querySelector('#pc-site');
      const wt = el.querySelector('select[name=wt]');
      const fill = () => {
        const c = cs.find((x) => x.id === sel.value);
        site.innerHTML = `<option value="">New site…</option>${(c?.sites || []).map((s, i) => `<option value="${i}" ${i === 0 ? 'selected' : ''}>${esc(s.lines.join(', ').slice(0, 60))}</option>`).join('')}`;
        const s0 = c?.sites?.[0];
        if (s0?.workType && WORK_TYPES[s0.workType]) wt.value = s0.workType;
      };
      sel.onchange = fill;
      site.onchange = () => { const s = cs.find((x) => x.id === sel.value)?.sites?.[+site.value]; if (s?.workType && WORK_TYPES[s.workType]) wt.value = s.workType; };
      fill();
    },
  });
  if (r.value !== true) return null;
  let cust = cs.find((c) => c.id === r.data.cust);
  let site = cust && r.data.site !== '' ? cust.sites[+r.data.site] : null;
  if (!cust) {
    const n = await dialog({
      title: 'New customer',
      body: `<label class="field"><span>Customer address block (one line each: name, role, company, address, Eircode)</span><textarea name="lines" rows="7" required></textarea></label>
        <label class="field"><span>Customer ID</span><input name="id" placeholder="worked out from the name"></label>`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Next', value: true, kind: 'primary' }],
    });
    if (n.value !== true) return null;
    const lines = n.data.lines.split('\n').map((l) => l.trim()).filter(Boolean);
    const all = [...cs, ...(await db.all('quotes')).map((d) => d.cust)];
    const id = (n.data.id || '').trim().toUpperCase() || suggestCustomerId(lines.find((l) => /\b(ltd|limited|hse|services|ireland|hotel|centre|hospital|council|group)\b/i.test(l)) || lines[0] || 'CUST', all);
    cust = { id, lines, sites: [] };
  }
  if (!site) {
    const n = await dialog({
      title: 'Site / delivery address',
      body: `<label class="field"><span>One line each: building, street, town, county, Eircode</span><textarea name="lines" rows="6" required>${esc((cust.lines || []).slice(2).join('\n'))}</textarea></label>
        <label class="field"><span>PO / WO number (if known)</span><input name="po"></label>`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Next', value: true, kind: 'primary' }],
    });
    if (n.value !== true) return null;
    site = { lines: n.data.lines.split('\n').map((l) => l.trim()).filter(Boolean), po: n.data.po.trim(), vatRate: null };
  }
  return { cust: { id: cust.id, lines: cust.lines }, site: { lines: site.lines }, po: site.po || '', vatRate: site.vatRate ?? cust.vatRate ?? null, workType: r.data.wt };
}

async function newQuoteDoc(kind = 'Q', preset = null) {
  const book = await quoteBook();
  const pick = preset || (await pickCustomer(book));
  if (!pick) return;
  const nx = nextNumbers(book, await db.all('quotes'));
  const insp = pick.workType === 'FDINSP';
  const vat = vatPrecedent(book, pick.cust.id, pick.workType) ?? (insp ? 0.23 : pick.vatRate ?? 0.135);
  const doc = await db.put('quotes', {
    id: db.uid(), kind, tab: nx.tab, quote: nx.quote, inv: '', part: '', date: today(), days: 30,
    cust: pick.cust, site: pick.site, po: pick.po || '', workType: pick.workType, status: 'PROC',
    vatRate: vat, vatMode: 'normal', preLims: 0, fuel: 0, items: [], notes: [], specialOrder: '',
    p1Terms: insp ? QTERMS.quote : QTERMS.worksQuote.replace('13.5%', `${+(vat * 100).toFixed(1)}%`),
  });
  go({ view: 'quote', quoteId: doc.id });
}

// An invoice from a quote made in the app or one in the workbook
async function newInvoiceFrom(src) {
  const book = await quoteBook();
  const appQuotes = (await db.all('quotes')).filter((d) => d.kind === 'Q').sort((a, b) => b.tab - a.tab);
  if (!src) {
    const wbQuotes = book ? [...book.register].reverse().filter((r) => r.kind === 'Q' && r.items?.length).slice(0, 60) : [];
    const r = await dialog({
      title: 'Invoice which quote?',
      body: `<label class="field"><span>Quote</span><select name="q">
        ${appQuotes.map((d) => `<option value="app:${d.id}">${esc(d.quote)} · ${esc(d.cust.id)} · ${esc((d.site?.lines || [])[0] || '')} (app)</option>`).join('')}
        ${wbQuotes.map((w) => `<option value="wb:${esc(w.sheet)}">${esc(w.quote)} · ${esc(w.cust)} · ${esc(w.location || '')}</option>`).join('')}
        <option value="none">No quote (a new invoice)</option></select></label>`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Next', value: true, kind: 'primary' }],
    });
    if (r.value !== true) return;
    if (r.data.q === 'none') {
      const pick = await pickCustomer(book);
      if (!pick) return;
      return makeInvoice(book, { quote: nextNumbers(book, await db.all('quotes')).quote, ...pick, items: [], notes: [], vatMode: 'normal' }, 'full', true);
    }
    src = r.data.q.startsWith('app:') ? appQuotes.find((d) => d.id === r.data.q.slice(4)) : book.register.find((w) => w.sheet === r.data.q.slice(3));
  }
  if (!src) return;
  // a workbook quote → the same shape as an app quote
  if (src.sheet) {
    const c = book.customers.find((x) => x.id === src.cust);
    const site = c?.sites.find((s) => (s.lines[0] || '').toUpperCase() === (src.siteLines?.[0] || '').toUpperCase());
    src = { quote: src.quote, cust: { id: src.cust, lines: c?.lines || [] }, site: { lines: src.siteLines || site?.lines || [] }, po: site?.po || src.po || '', workType: src.workType || site?.workType || 'FDREM', vatRate: src.vatRate ?? 0.135, vatMode: src.vatRate === 0 ? 'rct' : 'normal', items: src.items, notes: src.notes || [] };
  }
  const r = await dialog({
    title: `Invoice for ${src.quote}`,
    body: `<fieldset class="scheme-set"><legend>What does this invoice cover?</legend>
      <label class="scheme-opt"><input type="radio" name="part" value="full" checked><span><b>The full quote</b><small>Every line, ready to adjust to what was done.</small></span></label>
      <label class="scheme-opt"><input type="radio" name="part" value="DEP"><span><b>Deposit</b><small>One line: a % of the quote total.</small></span></label>
      <label class="scheme-opt"><input type="radio" name="part" value="BAL"><span><b>Balance</b><small>Every line, less a deposit already invoiced.</small></span></label></fieldset>
      <div class="grid2"><label class="field"><span>Deposit %</span><input name="pct" type="number" value="70" min="1" max="100"></label>
      <label class="field"><span>Deposit already invoiced (€)</span><input name="paid" type="number" step="0.01" placeholder="for a balance"></label></div>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Make invoice', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return;
  return makeInvoice(book, src, r.data.part, false, +r.data.pct || 70, +r.data.paid || 0);
}

async function makeInvoice(book, src, part, fresh, pct = 70, paid = 0) {
  const nx = nextNumbers(book, await db.all('quotes'));
  const sub = totals(src).subtotal;
  let items = (src.items || []).map((it) => ({ ...it }));
  if (part === 'DEP') items = [{ desc: `${pct}% DEPOSIT AS PER QUOTE ${src.quote}`, qty: 1, unit: Math.round(sub * pct) / 100 }];
  if (part === 'BAL' && paid) items.push({ desc: `LESS DEPOSIT PREVIOUSLY INVOICED`, qty: 1, unit: -paid });
  const doc = await db.put('quotes', {
    id: db.uid(), kind: 'INV', tab: nx.tab, quote: src.quote, inv: nx.inv, part: part === 'full' ? '' : part, date: today(), days: 30,
    cust: src.cust, site: src.site, po: src.po || '', workType: src.workType || 'FDREM', status: 'WIP',
    vatRate: src.vatRate ?? 0.135, vatMode: src.vatMode || 'normal', preLims: 0, fuel: 0, items, notes: part === 'DEP' ? [] : [...(src.notes || [])], specialOrder: src.specialOrder || '',
    p1Terms: QTERMS.invoice, fromQuoteId: src.id || null,
  });
  if (fresh) toast('New invoice: no quote linked; quote number reserved as ' + src.quote);
  go({ view: 'quote', quoteId: doc.id });
}

async function renderQuoteDoc() {
  const doc = await db.get('quotes', state.quoteId);
  if (!doc) return back();
  const book = await quoteBook();
  const isInv = doc.kind === 'INV';
  app.innerHTML = `
    <header class="bar">
      <button class="icon-btn" id="back" aria-label="Back">${icon('back')}</button>
      <div class="bar-title"><b>${esc(isInv ? `${doc.inv} · ${doc.quote}` : doc.quote)} · ${esc(doc.cust.id)}</b><small>${esc(tabName(doc))}</small></div>
    </header>
    <main class="page q-edit" id="qd"></main>`;
  $('#back').onclick = back;
  const el = $('#qd');
  let cur = doc;
  let timer = null;
  const tiedSite = doc.projectId ? (await db.get('projects', doc.projectId))?.site || '' : '';
  const save = () => { clearTimeout(timer); timer = setTimeout(async () => { cur = await db.put('quotes', cur); }, 400); };
  const draw = () => {
    const t = totals(cur);
    el.innerHTML = `
      ${cur.projectId ? `<section class="panel q-tie">${icon('door')}<span><b>From the report: ${esc(tiedSite || 'project')}</b><small>Breakdown: ${esc(pdName(cur))} · ${(cur.items || []).filter((i) => i.doorId).length} doors</small></span>
        <button class="btn sm" id="q-refresh">Refresh prices</button></section>` : ''}
      <section class="panel">
        <div class="grid2">
          <label class="field"><span>Date</span><input type="date" data-k="date" value="${esc(cur.date)}"></label>
          <label class="field"><span>${isInv ? 'Due after (days)' : 'Valid for (days)'}</span><input type="number" data-k="days" value="${cur.days || 30}"></label>
          <label class="field"><span>Type of work</span><select data-k="workType">${Object.entries(WORK_TYPES).map(([k, v]) => `<option value="${k}" ${k === cur.workType ? 'selected' : ''}>${k} · ${v}</option>`).join('')}</select></label>
          <label class="field"><span>Status</span><select data-k="status">${Object.entries(Q_STATUSES).map(([k, v]) => `<option value="${k}" ${k === cur.status ? 'selected' : ''}>${k} · ${v}</option>`).join('')}</select></label>
          ${isInv ? `<label class="field"><span>PO / WO number</span><input data-k="po" value="${esc(cur.po || '')}"></label>` : ''}
        </div>
      </section>
      <section class="panel">
        <div class="grid2">
          <label class="field"><span>Customer · ${esc(cur.cust.id)}</span><textarea rows="6" data-lines="cust">${esc((cur.cust.lines || []).join('\n'))}</textarea></label>
          <label class="field"><span>Delivery address / site</span><textarea rows="6" data-lines="site">${esc((cur.site?.lines || []).join('\n'))}</textarea></label>
        </div>
      </section>
      <section class="panel">
        <div class="block-head"><h3>Lines</h3><span class="row-btns">
          <button class="btn sm" id="qi-rate">${icon('list')} Price list</button>
          <button class="btn sm" id="qi-past">${icon('search')} Past quotes</button>
          <button class="btn sm" id="qi-proj">${icon('door')} From a project</button>
          <button class="btn sm" id="qi-blank">${icon('plus')} Line</button></span></div>
        <div class="qi-list">${(cur.items || []).map((it, i) => `
          <div class="qi" data-i="${i}">
            <textarea class="qi-desc" rows="2" placeholder="Description">${esc(it.desc)}</textarea>
            <div class="qi-nums">
              <label><span>Qty</span><input class="qi-qty" type="number" step="any" value="${it.qty}"></label>
              <label><span>Unit €</span><input class="qi-unit" type="number" step="0.01" value="${it.unit}"></label>
              <b class="qi-amt">${money((Number(it.qty) || 0) * (Number(it.unit) || 0))}</b>
              <button class="icon-btn qi-del" aria-label="Remove line">${icon('trash')}</button>
            </div>
          </div>`).join('') || '<p class="muted small">No lines yet. Add from your price list, a past quote, a project, or type one.</p>'}</div>
        <label class="field"><span>Notes under the lines (one per line)</span><textarea rows="4" data-lines="notes">${esc((cur.notes || []).join('\n'))}</textarea></label>
      </section>
      <section class="panel">
        <div class="grid2">
          <label class="field"><span>VAT rate</span><select data-k="vatRate" data-num="1">${[...new Set([...VAT_RATES, Number(cur.vatRate) || 0])].map((v) => `<option value="${v}" ${v === Number(cur.vatRate) ? 'selected' : ''}>${(v * 100).toFixed(1)}%</option>`).join('')}</select></label>
          <label class="field"><span>VAT</span><select data-k="vatMode"><option value="normal" ${cur.vatMode !== 'rct' ? 'selected' : ''}>Charged on this ${isInv ? 'invoice' : 'quote'}</option><option value="rct" ${cur.vatMode === 'rct' ? 'selected' : ''}>Accounted for by the principal contractor</option></select></label>
          <label class="field"><span>Pre Lims (€)</span><input type="number" step="0.01" data-k="preLims" data-num="1" value="${cur.preLims || 0}"></label>
          <label class="field"><span>Fuel surcharge (€)</span><input type="number" step="0.01" data-k="fuel" data-num="1" value="${cur.fuel || 0}"></label>
        </div>
        <div class="q-tot">
          ${qTotHtml(t, cur)}
        </div>
      </section>
      <section class="panel">
        <label class="field"><span>Terms on page 1</span><textarea rows="4" data-k="p1Terms">${esc(cur.p1Terms || '')}</textarea></label>
        <label class="field"><span>Special-order item (adds the no-returns clause)</span><input data-k="specialOrder" value="${esc(cur.specialOrder || '')}" placeholder="e.g. back to back handles"></label>
        <p class="muted small">Page 2: your ${isInspection(cur) ? 'inspection' : 'works'} terms from the workbook${book?.terms?.[isInspection(cur) ? 'insp' : 'works'] ? '' : ' (import the workbook to include them)'}.</p>
      </section>
      <div class="row-btns q-actions">
        <button class="btn primary" id="q-pdf">${icon('report')} PDF to send</button>
        <button class="btn" id="q-xlsx">${icon('sheet')} Excel tab for the workbook</button>
        ${!isInv ? `<button class="btn" id="q-toinv">${icon('plus')} Make invoice</button>` : ''}
        <button class="btn ghost danger-text" id="q-del">${icon('trash')} Delete</button>
      </div>
      <p class="muted small pad">${cur.pd ? `The Excel file has the pricing doc <b>${esc(pdName(cur))}</b> and the quote tab, linked: the quote lines read each door's price from the PD's DOOR PRICING SUMMARY. Move <b>both</b> tabs into the workbook together (select both, then Move or Copy) so the links follow. ` : ''}The Excel file has the tab <b>${esc(tabName(cur))}</b>, in the same cells as your samples with live formulas, plus a SUMMARY ROW tab. In Excel: right-click the tab › Move or Copy › into INVOICES AND QUOTES, placed after tab ${cur.tab - 1}; then copy the SUMMARY ROW into the register.</p>`;
    // field edits
    $$('[data-k]', el).forEach((inp) => (inp.oninput = inp.onchange = () => {
      cur = { ...cur, [inp.dataset.k]: inp.dataset.num ? Number(inp.value) || 0 : inp.dataset.k === 'days' ? +inp.value || 30 : inp.value };
      save();
      if (inp.tagName === 'SELECT' || inp.dataset.num) redrawTotals();
    }));
    $$('[data-lines]', el).forEach((ta) => (ta.oninput = () => {
      const lines = ta.value.split('\n').map((l) => l.trim()).filter(Boolean);
      if (ta.dataset.lines === 'notes') cur = { ...cur, notes: lines };
      else cur = { ...cur, [ta.dataset.lines]: { ...(cur[ta.dataset.lines] || {}), lines } };
      save();
    }));
    $$('.qi', el).forEach((row) => {
      const i = +row.dataset.i;
      const upd = (k, v) => { const items = [...cur.items]; items[i] = { ...items[i], [k]: v }; cur = { ...cur, items }; save(); };
      row.querySelector('.qi-desc').oninput = (e) => upd('desc', e.target.value);
      row.querySelector('.qi-qty').oninput = (e) => { upd('qty', Number(e.target.value) || 0); redrawTotals(row); };
      row.querySelector('.qi-unit').oninput = (e) => { upd('unit', Number(e.target.value) || 0); redrawTotals(row); };
      row.querySelector('.qi-del').onclick = () => { cur = { ...cur, items: cur.items.filter((_, j) => j !== i) }; save(); draw(); };
    });
    const addLines = (lines) => { if (!lines?.length) return; cur = { ...cur, items: [...(cur.items || []), ...lines] }; save(); draw(); };
    $('#qi-blank').onclick = () => addLines([{ desc: '', qty: 1, unit: 0 }]);
    $('#qi-rate').onclick = async () => addLines(await pickFromRates(book));
    $('#qi-past').onclick = async () => addLines(await pickFromPast(book));
    $('#qi-proj').onclick = async () => addLines(await linesFromProject());
    $('#q-pdf').onclick = async () => {
      await db.put('quotes', cur);
      const b = busy('Making the PDF…');
      try {
        const blob = await quotePdf(cur, { jsPDF: await loadJsPdfLib(), lists, book });
        b.done();
        await saveFile(`${safeName(tabName(cur))}.pdf`, blob);
      } catch (err) { b.done(); console.error(err); toast('PDF failed: ' + err.message, 'error'); }
    };
    $('#q-xlsx').onclick = async () => {
      await db.put('quotes', cur);
      try {
        const pd = cur.projectId && cur.pd ? priceDoors(await db.projectDoors(cur.projectId), book, cur.mult || pricingRule()) : null;
        await quoteXlsx(cur, book, pd);
      } catch (err) { console.error(err); toast('Excel failed: ' + err.message, 'error'); }
    };
    $('#q-refresh')?.addEventListener('click', async () => {
      const pd = priceDoors(await db.projectDoors(cur.projectId), book, cur.mult || pricingRule());
      const manual = (cur.items || []).filter((i) => !i.doorId);
      cur = { ...cur, items: [...pd.doors.map((d) => ({ desc: d.label, qty: 1, unit: d.price, doorId: d.doorId })), ...manual] };
      cur = await db.put('quotes', cur);
      draw();
      toast(`Prices refreshed from the report${pd.missing ? ` · ${pd.missing} item${pd.missing === 1 ? '' : 's'} still missing a rate` : ''}`);
    });
    $('#q-toinv')?.addEventListener('click', async () => { await db.put('quotes', cur); newInvoiceFrom(cur); });
    $('#q-del').onclick = async () => {
      if (!(await confirmBox('Delete this document?', `${tabName(cur)} is removed from the app. Its number is not reused.`))) return;
      await db.remove('quotes', cur.id);
      back();
    };
  };
  const redrawTotals = (row) => {
    if (row) { const it = cur.items[+row.dataset.i]; row.querySelector('.qi-amt').textContent = money((Number(it.qty) || 0) * (Number(it.unit) || 0)); }
    const t = totals(cur);
    const box = $('.q-tot', el);
    if (box) box.innerHTML = qTotHtml(t, cur);
  };
  draw();
}

const qTotHtml = (t, cur) => `<span>Subtotal</span><b>${money(t.subtotal)}</b>
  ${t.preLims ? `<span>Pre Lims</span><b>${money(t.preLims)}</b>` : ''}${t.fuel ? `<span>Fuel surcharge</span><b>${money(t.fuel)}</b>` : ''}
  <span>VAT ${(t.vatRate * 100).toFixed(1)}%${cur.vatMode === 'rct' ? ' (principal contractor)' : ''}</span><b>${money(t.vatDue)}</b>
  <span class="q-grand">TOTAL</span><b class="q-grand">${money(t.total)}</b>`;

// Search SERV PD MASTER (and the app's own price list): cost + labour → selling price
async function pickFromRates(book) {
  const rule = pricingRule();
  const rates = [
    ...(book?.rates || []).map((r) => ({ name: r.type === 'Tag' ? readableTag(r.item).name : r.item.replace(/^RECOMMENDATION(S)? FOR IMPROVEMENT\s*(\([^)]*\))?\s*:?\s*/i, ''), src: r.type, cost: r.cost, labour: r.labour, sell: sellPrice(r.cost, r.labour, rule) })),
    ...(lists.materials || []).filter((m) => Number(m.cost)).map((m) => ({ name: m.name, src: 'App price list', cost: null, labour: null, sell: Number(m.cost) })),
  ];
  return searchPick('Price list', rates, (r) => `${r.name} ${r.src}`, (r) => `<b>${esc(r.name)}</b><small>${esc(r.src)}${r.cost != null ? ` · cost €${r.cost} + labour €${r.labour}` : ''}</small><em>${money(r.sell)}</em>`,
    (r, qty) => ({ desc: r.name.toUpperCase(), qty, unit: r.sell }));
}

async function pickFromPast(book) {
  const rows = (book?.pastLines || []).map((l) => ({ ...l }));
  return searchPick('Past quote lines', rows, (r) => `${r.desc} ${r.cust} ${r.ref}`, (r) => `<b>${esc(r.desc)}</b><small>${esc(r.cust)} · ${esc(r.ref)} · ${fmtDate(r.date)}</small><em>${money(r.unit)}</em>`,
    (r, qty) => ({ desc: r.desc, qty, unit: r.unit }));
}

async function searchPick(title, rows, hay, show, make) {
  if (!rows.length) { toast('Nothing to pick from yet. Import your workbook first.', 'error'); return []; }
  const picked = [];
  await dialog({
    title,
    body: `<label class="search">${icon('search')}<input id="sp-q" type="search" placeholder="Search…" autocomplete="off"></label>
      <div class="sp-list" id="sp-list"></div><p class="muted small" id="sp-n"></p>`,
    buttons: [{ label: 'Done', value: true, kind: 'primary' }],
    onOpen: (box) => {
      const list = box.querySelector('#sp-list');
      const q = box.querySelector('#sp-q');
      const paint = () => {
        const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
        const hits = rows.filter((r) => { const h = hay(r).toLowerCase(); return words.every((w) => h.includes(w)); }).slice(0, 60);
        list.innerHTML = hits.map((r, i) => `<div class="sp-row" data-i="${i}">${show(r)}<input class="sp-qty" type="number" value="1" min="0" step="any" aria-label="Quantity"><button type="button" class="btn sm sp-add">Add</button></div>`).join('') || '<p class="muted small">No matches.</p>';
        list.querySelectorAll('.sp-row').forEach((row) => {
          row.querySelector('.sp-add').onclick = () => {
            picked.push(make(hits[+row.dataset.i], Number(row.querySelector('.sp-qty').value) || 1));
            row.classList.add('is-added');
            box.querySelector('#sp-n').textContent = `${picked.length} line${picked.length === 1 ? '' : 's'} added`;
          };
        });
      };
      q.oninput = paint;
      q.onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(); };
      paint();
      setTimeout(() => q.focus(), 50);
    },
  });
  return picked;
}

// One line per door with its products priced (like the PD door summary)
async function linesFromProject() {
  const projects = (await db.all('projects')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!projects.length) { toast('No projects yet', 'error'); return []; }
  const r = await dialog({
    title: 'Lines from a project',
    body: `<label class="field"><span>Project</span><select name="p">${projects.map((p) => `<option value="${p.id}">${esc(p.site)}${p.client ? ' · ' + esc(p.client) : ''}</option>`).join('')}</select></label>
      <fieldset class="scheme-set"><legend>Which doors</legend>
        <label class="scheme-opt"><input type="radio" name="which" value="priced" checked><span><b>Doors with products priced</b><small>One line per door: "ID: ref - room", priced from its products.</small></span></label>
        <label class="scheme-opt"><input type="radio" name="which" value="count"><span><b>A single inspection line</b><small>Door count × a rate per door.</small></span></label></fieldset>
      <label class="field"><span>Rate per door (for an inspection line)</span><input name="rate" type="number" step="0.01" value="19"></label>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Add lines', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return [];
  const p = projects.find((x) => x.id === r.data.p);
  const doors = (await db.projectDoors(p.id)).sort((a, b) => (a.pinNo || 0) - (b.pinNo || 0));
  if (r.data.which === 'count') return [{ desc: `FIRE DOOR INSPECTION — ${(p.site || '').toUpperCase()} — ${doors.length} DOORS`, qty: doors.length, unit: Number(r.data.rate) || 0 }];
  const out = [];
  for (const d of doors) {
    const amt = (d.materials || []).reduce((a, m) => a + (Number(m.qty) || 0) * (Number(m.cost) || 0), 0);
    if (amt > 0) out.push({ desc: `ID: ${d.ref || d.pinNo} - ${(d.location || '').toUpperCase()}`, qty: 1, unit: Math.round(amt * 100) / 100 });
  }
  if (!out.length) toast('No door in that project has priced products yet. Use Cost all fails on the project first.', 'error');
  return out;
}


// A customer quote from a report: one line per failed door at its full price;
// the breakdown is a pricing doc in the SERV PD layout, linked to the quote.
// the standard lines under the items on your works quotes (as A-229)
const DEFAULT_WORKS_NOTES = ['E/O for weekend or OOH works', 'Touch up paint works if required by others', 'Each repair element to be repaired using industry best practice guidance', 'ASDMA, BS8214:2016, BWF Guidance documents', 'Costs inclusive of waste disposal. H&S, handover folder, insurance', 'admin and site supervision.', 'Drop seals are face fix drop seals.'];
// VAT the customer was last charged for this type of work
function vatPrecedent(book, custId, workType) {
  const hit = [...(book?.register || [])].reverse().find((x) => x.cust === custId && x.workType === workType && x.vatRate != null);
  return hit ? hit.vatRate : null;
}
// ---------- Prices for one site, and for one collection ----------
// A product can cost more or less on one job (e.g. a handle at €25 for Kells
// but €28 in Cork), or change between visits. Prices are layered: the
// collection's own price, then the site's (project.prices), then the normal
// price list. A new collection copied from another starts with its prices.
let siteProject = null;
let siteColl = '';
const mlist = () => siteMaterials(siteProject, siteColl);
const doorColl = (d, plan) => (plan ? plan.collection || '' : d?.collection || '');
function siteMaterials(project, coll = null) {
  const site = project?.prices || {};
  const own = coll != null ? project?.collPrices?.[coll] || {} : {};
  return (lists.materials || []).map((m) => {
    const s = site[m.id];
    const c = own[m.id];
    if (!s && !c) return m;
    return { ...m, cost: c?.cost ?? s?.cost ?? m.cost, labour: c?.labour ?? s?.labour ?? m.labour, sitePrice: true };
  });
}
const priceCount = (project, coll = null) => Object.keys((coll == null ? project?.prices : project?.collPrices?.[coll]) || {}).length;

// Products already on doors take their price from the layers again
async function repriceDoors(project) {
  const plans = Object.fromEntries((await db.projectPlans(project.id)).map((pl) => [pl.id, pl]));
  const cache = {};
  let n = 0;
  for (const d of await db.projectDoors(project.id)) {
    const coll = doorColl(d, plans[d.planId]);
    const byName = (cache[coll] ||= new Map(siteMaterials(project, coll).map((m) => [m.name.trim().toLowerCase(), m])));
    let changed = false;
    const materials = (d.materials || []).map((x) => {
      const m = !x.custom && byName.get((x.name || '').trim().toLowerCase());
      if (!m || ((Number(x.cost) || 0) === (Number(m.cost) || 0) && (Number(x.labour) || 0) === (Number(m.labour) || 0))) return x;
      changed = true;
      return { ...x, cost: Number(m.cost) || 0, labour: Number(m.labour) || 0 };
    });
    if (changed) { await saveDoor({ ...d, materials }, ['Re-priced from the site / collection prices']); n++; }
  }
  return n;
}

// scope: null = the whole site, otherwise a collection name ('' = Main drawings)
async function editSitePrices(project, scope = null) {
  const p0 = await db.get('projects', project.id);
  const colls = listCollections(await db.projectPlans(p0.id));
  if (scope != null && !colls.includes(scope)) scope = null;
  const own = (scope == null ? p0.prices : p0.collPrices?.[scope]) || {};
  const under = scope == null ? siteMaterials({ ...p0, prices: {} }) : siteMaterials(p0); // what applies without this level
  const all = (lists.materials || []).filter((m) => m.name?.trim());
  const base = Object.fromEntries(under.map((m) => [m.id, m]));
  const cats = [...new Set([...MAT_CATEGORIES, ...all.map(matCat)])].filter((c) => all.some((m) => matCat(m) === c));
  const others = colls.filter((c) => c !== scope && priceCount(p0, c));
  const scopeOpts = `<option value="__site" ${scope == null ? 'selected' : ''}>Whole site${priceCount(p0) ? ` (${priceCount(p0)})` : ''}</option>
    ${colls.length > 1 || (colls.length === 1 && colls[0] !== '') ? colls.map((c) => `<option value="${esc(c)}" ${scope === c ? 'selected' : ''}>Collection: ${esc(collLabel(c))}${priceCount(p0, c) ? ` (${priceCount(p0, c)})` : ''}</option>`).join('') : ''}`;
  const r = await dialog({
    title: `Prices · ${p0.site}`,
    body: `<label class="field"><span>Prices for</span><select name="scope" id="sp-scope">${scopeOpts}</select></label>
      <p class="small">${scope == null
        ? 'Set a different material or labour price for this site. Leave a box empty to use your normal price (shown in the box).'
        : `Set prices for <b>${esc(collLabel(scope))}</b> only. Leave a box empty to use the site price, or your normal price (shown in the box).`} Doors already priced are updated.</p>
      ${others.length ? `<div class="sp-copy"><select id="sp-from"><option value="">Copy prices from…</option>${others.map((c) => `<option value="${esc(c)}">${esc(collLabel(c))} (${priceCount(p0, c)})</option>`).join('')}${scope != null && priceCount(p0) ? '<option value="__site">Whole site</option>' : ''}</select></div>` : ''}
      <label class="search sp-search">${icon('search')}<input type="search" id="sp-q" placeholder="Search products…"></label>
      <label class="check-line small"><input type="checkbox" id="sp-only"> Only show products with a price set here</label>
      ${cats.map((c) => `<h3 class="pp-h sp-cat" data-cat="${esc(c)}">${esc(c)}</h3>
        ${all.filter((m) => matCat(m) === c).map((m) => {
          const u = base[m.id] || m;
          const from = u.sitePrice ? 'site' : 'normal';
          return `<div class="sp-row ${own[m.id] ? 'is-set' : ''}" data-cat="${esc(c)}" data-name="${esc(m.name.toLowerCase())}" data-id="${esc(m.id)}">
          <span class="sp-name"><b>${esc(m.name)}</b><small>${from === 'site' ? 'Site' : 'Normal'}: ${euro(u.cost)} + ${euro(u.labour || 0)} labour${m.unit && m.unit !== 'each' ? ' per ' + esc(m.unit) : ''}</small></span>
          <label><small>Material €</small><input name="c_${m.id}" type="number" inputmode="decimal" min="0" step="0.01" value="${own[m.id]?.cost ?? ''}" placeholder="${esc(u.cost || 0)}"></label>
          <label><small>Labour €</small><input name="l_${m.id}" type="number" inputmode="decimal" min="0" step="0.01" value="${own[m.id]?.labour ?? ''}" placeholder="${esc(u.labour || 0)}"></label>
        </div>`;
        }).join('')}`).join('')}`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Save prices', value: true, kind: 'primary' }],
    onOpen: (form) => {
      const filter = () => {
        const q = $('#sp-q', form).value.trim().toLowerCase();
        const only = $('#sp-only', form).checked;
        $$('.sp-row', form).forEach((row) => {
          const set = [...row.querySelectorAll('input')].some((i) => i.value !== '');
          row.classList.toggle('is-set', set);
          row.hidden = (q && !row.dataset.name.includes(q)) || (only && !set);
        });
        $$('.sp-cat', form).forEach((h) => { h.hidden = !$$(`.sp-row[data-cat="${CSS.escape(h.dataset.cat)}"]`, form).some((x) => !x.hidden); });
      };
      $('#sp-q', form).addEventListener('input', filter);
      $('#sp-only', form).addEventListener('change', filter);
      form.addEventListener('input', (e) => { const row = e.target.closest('.sp-row'); if (row) row.classList.toggle('is-set', [...row.querySelectorAll('input')].some((i) => i.value !== '')); });
      // switch to another level: the dialog closes and opens again for it
      $('#sp-scope', form).addEventListener('change', (e) => {
        form.dataset.switchTo = e.target.value;
        form.querySelector('.modal-actions button[type=button]')?.click();
      });
      $('#sp-from', form)?.addEventListener('change', (e) => {
        const src = e.target.value === '__site' ? p0.prices || {} : p0.collPrices?.[e.target.value] || {};
        for (const [id, v] of Object.entries(src)) {
          const c = form.querySelector(`input[name="c_${CSS.escape(id)}"]`);
          const l = form.querySelector(`input[name="l_${CSS.escape(id)}"]`);
          if (c && v.cost != null) c.value = v.cost;
          if (l && v.labour != null) l.value = v.labour;
        }
        filter();
        toast(`${Object.keys(src).length} price${Object.keys(src).length === 1 ? '' : 's'} copied in. Save to keep them.`);
      });
    },
  });
  if (r.value !== true) {
    const to = r.form?.dataset.switchTo;
    if (to) return editSitePrices(p0, to === '__site' ? null : to);
    return;
  }
  const prices = {};
  for (const m of all) {
    const c = r.data['c_' + m.id];
    const l = r.data['l_' + m.id];
    if ((c ?? '') === '' && (l ?? '') === '') continue;
    prices[m.id] = { ...(c !== '' ? { cost: Number(c) || 0 } : {}), ...(l !== '' ? { labour: Number(l) || 0 } : {}) };
  }
  const next = scope == null ? { ...p0, prices } : { ...p0, collPrices: { ...(p0.collPrices || {}), [scope]: prices } };
  if (scope != null && !Object.keys(prices).length) delete next.collPrices[scope];
  const rec = await db.put('projects', next);
  const n = await repriceDoors(rec);
  const k = Object.keys(prices).length;
  toast(`${k} price${k === 1 ? '' : 's'} saved for ${scope == null ? 'the whole site' : collLabel(scope)}${n ? ` · ${n} door${n === 1 ? '' : 's'} re-priced` : ''}`);
  refresh();
}

// Home screen: pick any site and collection to price, or the normal list
async function pricesHome() {
  const projects = (await db.all('projects')).sort((a, b) => (a.site || '').localeCompare(b.site || ''));
  const collsOf = {};
  for (const p of projects) collsOf[p.id] = listCollections(await db.projectPlans(p.id));
  const r = await dialog({
    title: 'Prices',
    body: `<p class="small">Your normal price list applies everywhere. A site can have its own prices, and each collection on a site can have its own again (e.g. a later visit).</p>
      <button type="button" class="lib-card" id="ph-normal">${icon('list')}<span><b>Normal price list</b><small>${(lists.materials || []).length} products · used on every site</small></span>${icon('more')}</button>
      <label class="field"><span>Site</span><select name="p" id="ph-p">${projects.map((p) => `<option value="${p.id}">${esc(p.site)}${priceCount(p) || Object.keys(p.collPrices || {}).length ? ' ✦' : ''}</option>`).join('')}</select></label>
      <label class="field"><span>Prices for</span><select name="c" id="ph-c"></select></label>
      <p class="small muted">✦ = has its own prices.</p>`,
    buttons: [{ label: 'Close', value: false }, { label: 'Open prices', value: true, kind: 'primary' }],
    onOpen: (form) => {
      const fill = () => {
        const p = projects.find((x) => x.id === $('#ph-p', form).value);
        const cs = collsOf[p?.id] || [];
        $('#ph-c', form).innerHTML = `<option value="__site">Whole site${priceCount(p) ? ` (${priceCount(p)})` : ''}</option>` + (cs.length > 1 || (cs.length === 1 && cs[0] !== '') ? cs.map((c) => `<option value="${esc(c)}">Collection: ${esc(collLabel(c))}${priceCount(p, c) ? ` (${priceCount(p, c)})` : ''}</option>`).join('') : '');
      };
      $('#ph-p', form).addEventListener('change', fill);
      fill();
      $('#ph-normal', form).onclick = () => { form.dataset.normal = '1'; form.querySelector('.modal-actions button[type=button]')?.click(); };
    },
  });
  if (r.value !== true) {
    if (r.form?.dataset.normal) { state.allMats = true; openFolds.add('mats'); go({ view: 'settings' }); }
    return;
  }
  const p = projects.find((x) => x.id === r.data.p);
  if (p) await editSitePrices(p, r.data.c === '__site' ? null : r.data.c);
}

// Before a quote is made from a report: the cost (materials + labour), the
// margin to put on it, and prelims. The margin is for the owner only: the
// quote shows each door's price, never the cost or margin.
const MARGINS = [
  { id: 'x1.4', label: '× 1.4', hint: 'as your PD sheets (28.6% margin)', mult: 1.4 },
  { id: 'm40', label: '40% margin', hint: '÷ 0.6, as SERV PD MASTER', mult: 1 / 0.6 },
];
const marginMult = (choice, pct) => {
  const m = MARGINS.find((x) => x.id === choice);
  if (m) return m.mult;
  const p = Math.min(90, Math.max(0, Number(pct) || 0));
  return 1 / (1 - p / 100);
};
async function pricingStep(project, pd, pdNo) {
  const mat = pd.doors.reduce((a, d) => a + d.materials, 0);
  const lab = pd.doors.reduce((a, d) => a + d.labour, 0);
  const cost = mat + lab;
  const last = lists.lastMargin || { choice: pricingRule() === 'margin40' ? 'm40' : 'x1.4', pct: 35 };
  const noLabour = pd.items.filter((i) => i.status !== 'MISSING' && !i.labour).length;
  const r = await dialog({
    title: `Price the quote · ${project.site}`,
    body: `<p class="small"><b>${pd.doors.length}</b> failed door${pd.doors.length === 1 ? '' : 's'}. Only you see this: the quote shows each door's price, not the cost or margin.</p>
      <div class="ps-costs">
        <div><span>Materials</span><b>${money(mat)}</b></div>
        <div><span>Labour</span><b>${money(lab)}</b></div>
        <div class="ps-tot"><span>Cost</span><b>${money(cost)}</b></div>
      </div>
      ${pd.missing ? `<p class="small ps-warn">${pd.missing} item${pd.missing === 1 ? ' has' : 's have'} no rate yet (shown as MISSING at €0 in the pricing doc).</p>` : ''}
      ${noLabour ? `<p class="small muted">${noLabour} item${noLabour === 1 ? ' has' : 's have'} no labour set. Add labour in Settings › Products.</p>` : ''}
      <fieldset class="ps-set"><legend>Margin</legend>
        ${MARGINS.map((m) => `<label class="ps-opt"><input type="radio" name="mg" value="${m.id}" ${last.choice === m.id ? 'checked' : ''}><span><b>${m.label}</b><small>${m.hint}</small></span></label>`).join('')}
        <label class="ps-opt"><input type="radio" name="mg" value="pct" ${last.choice === 'pct' ? 'checked' : ''}><span><b>Margin %</b><small>of the selling price</small></span><input class="ps-pct" name="pct" type="number" inputmode="decimal" min="0" max="90" step="0.5" value="${esc(last.pct ?? 35)}"></label>
      </fieldset>
      <fieldset class="ps-set"><legend>Pre Lims</legend>
        <label class="field"><span>Cost € (your margin is added on top)</span><input name="pl" type="number" inputmode="decimal" min="0" step="0.01" value="" placeholder="0.00"></label>
        <label class="field"><span>What it covers (for you)</span><input name="pln" placeholder="e.g. site set-up, access equipment, travel"></label>
      </fieldset>
      <div class="ps-costs ps-out">
        <div><span>Doors at selling price</span><b id="ps-sell"></b></div>
        <div><span>Your margin</span><b id="ps-margin"></b></div>
        <div><span>Pre Lims at selling price</span><b id="ps-pl"></b></div>
        <div class="ps-tot"><span>Quote total ex VAT</span><b id="ps-total"></b></div>
      </div>
      <p class="small muted">Next: choose the customer and site. Pricing doc: <b>${pdNo}</b>.</p>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Next', value: true, kind: 'primary' }],
    onOpen: (form) => {
      const upd = () => {
        const fd = Object.fromEntries(new FormData(form).entries());
        const mult = marginMult(fd.mg, fd.pct);
        const sell = pd.doors.reduce((a, d) => a + Math.round(d.exMargin * mult * 100) / 100, 0);
        const plCost = Number(fd.pl) || 0;
        const pl = Math.round(plCost * mult * 100) / 100;
        const allCost = cost + plCost;
        const allSell = sell + pl;
        $('#ps-sell', form).textContent = money(sell);
        $('#ps-margin', form).textContent = `${money(allSell - allCost)}${allSell ? ` (${((1 - allCost / allSell) * 100).toFixed(1)}%)` : ''}`;
        $('#ps-pl', form).textContent = money(pl);
        $('#ps-total', form).textContent = money(sell + pl);
      };
      form.addEventListener('input', upd);
      form.addEventListener('change', upd);
      $('.ps-pct', form).addEventListener('focus', () => { $('input[value=pct]', form).checked = true; upd(); });
      upd();
    },
  });
  if (r.value !== true) return null;
  const choice = r.data.mg || 'x1.4';
  await saveLists({ lastMargin: { choice, pct: Number(r.data.pct) || 0 } });
  const mult = marginMult(choice, r.data.pct);
  const plCost = Math.round((Number(r.data.pl) || 0) * 100) / 100;
  return { mult, choice: choice === 'pct' ? `${Number(r.data.pct) || 0}%` : choice, preLims: Math.round(plCost * mult * 100) / 100, preLimsCost: plCost, preLimsNote: (r.data.pln || '').trim() };
}

async function quoteFromReport(project) {
  const book = await quoteBook();
  if (!book) return toast('Import your INVOICES AND QUOTES workbook first (Quotes & invoices).', 'error');
  if (!project) {
    const projects = (await db.all('projects')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!projects.length) return toast('No projects yet', 'error');
    const r = await dialog({
      title: 'Quote from which report?',
      body: `<label class="field"><span>Project</span><select name="p">${projects.map((p) => `<option value="${p.id}">${esc(p.site)}${p.client ? ' · ' + esc(p.client) : ''}</option>`).join('')}</select></label>`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Next', value: true, kind: 'primary' }],
    });
    if (r.value !== true) return;
    project = projects.find((p) => p.id === r.data.p);
  }
  const doors = await db.projectDoors(project.id);
  const pd = priceDoors(doors, book, pricingRule());
  if (!pd.doors.length) return toast('No failed doors in this report to price.', 'error');
  const appDocs = await db.all('quotes');
  const pdNo = 'PD-' + pad3(nextPd(book, appDocs));
  const setup = await pricingStep(project, pd, pdNo);
  if (!setup) return;
  const priced2 = priceDoors(doors, book, setup.mult);
  const pick = await pickCustomer(book);
  if (!pick) return;
  const nx = nextNumbers(book, appDocs);
  const notes = [...DEFAULT_WORKS_NOTES];
  const vat = vatPrecedent(book, pick.cust.id, 'FDREM') ?? 0.135;
  const doc = await db.put('quotes', {
    id: db.uid(), kind: 'Q', tab: nx.tab, quote: nx.quote, inv: '', part: '', date: today(), days: 30,
    cust: pick.cust, site: pick.site, po: pick.po || '', workType: 'FDREM', status: 'PROC',
    vatRate: vat, vatMode: vat === 0 ? 'rct' : 'normal', preLims: setup.preLims, preLimsCost: setup.preLimsCost, preLimsNote: setup.preLimsNote, fuel: 0, specialOrder: '',
    items: priced2.doors.map((d) => ({ desc: d.label, qty: 1, unit: d.price, doorId: d.doorId })),
    notes, mult: setup.mult, marginChoice: setup.choice,
    p1Terms: QTERMS.worksQuote.replace('13.5%', `${+(vat * 100).toFixed(1)}%`),
    projectId: project.id, pd: pdNo,
  });
  go({ view: 'quote', quoteId: doc.id });
}

// ---------- Ask Claude ----------
// A chat that looks through the sites, doors and reports on this device and
// changes details when asked; every change is shown first with Apply / Skip.
const chat = { messages: [], items: [], busy: false, cost: 0 };
const AI_SUGGEST = ['Which doors failed on my last site, and why?', 'What inspections are due in the next month?', 'Summarise the latest report for a site', 'Mark door 012 as failed with a loose handle'];

const mdLite = (t) => {
  const lines = esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
  let html = '';
  let inList = false;
  for (const l of lines) {
    const m = /^\s*(?:[-•*]|\d+[.)])\s+(.*)$/.exec(l);
    if (m) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${m[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    html += l.trim() ? `<p>${l}</p>` : '';
  }
  return html + (inList ? '</ul>' : '');
};

async function pdfText(blob, max) {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: await blob.arrayBuffer() }).promise;
  let out = '';
  for (let i = 1; i <= pdf.numPages && out.length < max; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    out += `\n--- page ${i} ---\n` + tc.items.map((x) => x.str + (x.hasEOL ? '\n' : ' ')).join('');
  }
  return out.slice(0, max);
}

const aiCtx = {
  confirm: (card) => new Promise((resolve) => {
    chat.items.push({ kind: 'card', card, state: 'pending', resolve });
    drawChat();
  }),
  applyFrequency: (p) => applyFrequency(p),
  productsFor: async (def, door) => defaultProductsFor(def, siteMaterials(await db.get('projects', door.projectId), doorColl(door, door.planId ? await db.get('plans', door.planId) : null)), db.uid),
  pdfText,
  questionText: (d, plan) => {
    const qs = questionsFor(d, kitOf(kindOfDoor(d, plan)).questions || []);
    const answered = qs.filter((q) => d.checks?.[q.id]?.answer).map((q) => ({ question: q.text, answer: d.checks[q.id].answer, ...(d.checks[q.id].note ? { note: d.checks[q.id].note } : {}) }));
    return { answered, unanswered: qs.length - answered.length };
  },
};

function drawChat() {
  const log = $('#ai-log');
  if (!log) return;
  const card = (it, i) => {
    const c = it.card;
    const btns = it.state === 'pending'
      ? `<div class="ai-card-btns"><button class="btn ai-skip" data-i="${i}">Skip</button><button class="btn primary ai-apply" data-i="${i}">${icon('check')} Apply</button></div>`
      : it.state === 'applied' ? `<div class="ai-card-btns"><span class="ai-done">${icon('check')} Applied</span><button class="btn ghost sm ai-undo" data-i="${i}">${icon('undo')} Undo</button></div>`
        : `<div class="ai-card-btns"><span class="ai-done muted">${it.state === 'undone' ? 'Undone' : 'Skipped'}</span></div>`;
    return `<div class="ai-change is-${it.state}"><b>${esc(c.summary)}</b>
      ${c.items.map((x) => `<div class="ai-chg-item"><span>${esc(x.title)}</span><ul>${x.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`).join('')}
      ${c.problems?.length ? `<p class="small muted">Left out: ${esc(c.problems.join('; '))}</p>` : ''}${btns}</div>`;
  };
  log.innerHTML = (chat.items.length ? '' : `<div class="ai-hello">${icon('spark')}<p><b>Ask me about your sites, doors and reports.</b> I can also change details for you; you'll see every change first and tap Apply or Skip.</p>
      <div class="ai-suggest">${AI_SUGGEST.map((s) => `<button class="chip ai-sug">${esc(s)}</button>`).join('')}</div>
      <p class="small muted">Uses your Claude key from Settings. What you ask, and the records Claude looks at, are sent to Anthropic to answer.</p></div>`)
    + chat.items.map((it, i) => it.kind === 'user' ? `<div class="ai-msg is-user">${esc(it.text)}</div>`
      : it.kind === 'claude' ? `<div class="ai-msg is-claude">${mdLite(it.text)}</div>`
        : it.kind === 'act' ? `<div class="ai-act">${esc(it.text)}…</div>`
          : it.kind === 'error' ? `<div class="ai-msg is-error">${esc(it.text)}</div>`
            : card(it, i)).join('')
    + (chat.busy ? '<div class="ai-act ai-thinking"><span class="spinner"></span> Claude is working…</div>' : '')
    + (chat.cost && priced() ? `<p class="ai-cost">This chat so far: about ${usd(chat.cost)}</p>` : '');
  $$('.ai-sug', log).forEach((b) => (b.onclick = () => { $('#ai-q').value = b.textContent; $('#ai-q').focus(); }));
  $$('.ai-apply, .ai-skip', log).forEach((b) => (b.onclick = () => {
    const it = chat.items[Number(b.dataset.i)];
    if (it.state !== 'pending') return;
    it.state = b.classList.contains('ai-apply') ? 'applied' : 'skipped';
    it.resolve(it.state === 'applied' ? 'apply' : 'skip');
    drawChat();
  }));
  $$('.ai-undo', log).forEach((b) => (b.onclick = async () => {
    const it = chat.items[Number(b.dataset.i)];
    try { await it.card.undo(); it.state = 'undone'; toast('Change undone'); } catch (err) { toast('Undo failed: ' + err.message, 'error'); }
    drawChat();
  }));
  const send = $('#ai-send');
  if (send) send.disabled = chat.busy;
  log.lastElementChild?.scrollIntoView({ block: 'end' });
}

async function renderAssistant() {
  app.innerHTML = `
    <header class="bar">
      <button class="icon-btn" id="back" aria-label="Back">${icon('back')}</button>
      <div class="bar-title"><b>Ask Claude</b><small>Your sites, doors and reports</small></div>
      <button class="btn ghost sm" id="ai-new">New chat</button>
    </header>
    <main class="page ai-page"><div class="ai-log" id="ai-log"></div></main>
    <form class="ai-input" id="ai-form">
      <textarea id="ai-q" rows="1" placeholder="Ask about a site, door or report…" enterkeyhint="send"></textarea>
      <button class="btn primary" id="ai-send" type="submit" aria-label="Send">${icon('up')}</button>
    </form>`;
  $('#back').onclick = back;
  $('#ai-new').onclick = () => {
    if (chat.busy) return toast('Wait for Claude to finish first');
    for (const it of chat.items) if (it.state === 'pending') it.resolve('skip');
    Object.assign(chat, { messages: [], items: [], cost: 0 });
    drawChat();
  };
  const q = $('#ai-q');
  q.oninput = () => { q.style.height = 'auto'; q.style.height = Math.min(140, q.scrollHeight) + 'px'; };
  $('#ai-form').onsubmit = (e) => {
    e.preventDefault();
    const text = q.value.trim();
    if (!text || chat.busy) return;
    q.value = '';
    q.style.height = 'auto';
    askClaude(text);
  };
  drawChat();
}

async function askClaude(text) {
  if (!lists.aiKey) {
    const r = await dialog({
      title: 'Ask Claude is not set up',
      body: `<p>Ask Claude uses your own Anthropic API key, the same one as the drawing reader, added once in <b>Settings › Drawing reader</b>. Each question costs a few cents, billed by Anthropic.</p>`,
      buttons: [{ label: 'Not now', value: false }, { label: 'Open Settings', value: 'set', kind: 'primary' }],
    });
    if (r.value === 'set') go({ view: 'settings' });
    return;
  }
  const mark = chat.messages.length;
  chat.items.push({ kind: 'user', text });
  chat.messages.push({ role: 'user', content: text });
  chat.busy = true;
  drawChat();
  const run = makeRunner(aiCtx);
  const system = systemPrompt(fmtDate(todayDublin()), lists.inspector || '');
  const unlock = await keepAwake();
  try {
    const R = await reader();
    for (let turn = 0; turn < 25; turn++) {
      const res = await R.chatTurn(lists.aiKey, { system, tools: AI_TOOLS, messages: chat.messages });
      const u = res.usage || {};
      chat.cost += ((u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1) * 4 / 1e6 + (u.output_tokens || 0) * 20 / 1e6;
      chat.messages.push({ role: 'assistant', content: res.content });
      for (const b of res.content) if (b.type === 'text' && b.text.trim()) chat.items.push({ kind: 'claude', text: b.text.trim() });
      if (res.stop_reason === 'pause_turn') continue;
      if (res.stop_reason === 'refusal') { chat.items.push({ kind: 'error', text: 'Claude declined to answer that.' }); break; }
      if (res.stop_reason === 'max_tokens') { chat.items.push({ kind: 'error', text: 'The answer was cut short. Ask for less at once.' }); break; }
      if (res.stop_reason !== 'tool_use') break;
      const results = [];
      for (const t of res.content.filter((b) => b.type === 'tool_use')) {
        chat.items.push({ kind: 'act', text: activityText(t.name, t.input) });
        drawChat();
        try {
          results.push({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(await run(t.name, t.input)) });
        } catch (err) {
          results.push({ type: 'tool_result', tool_use_id: t.id, content: err.message || String(err), is_error: true });
        }
      }
      chat.messages.push({ role: 'user', content: results });
      drawChat();
    }
  } catch (err) {
    console.error(err);
    chat.messages.length = mark; // forget the failed question so the chat can carry on
    const msg = err?.status === 401 ? 'Your Claude key was not accepted. Check it in Settings › Drawing reader.'
      : /fetch|network|load failed/i.test(err?.message || '') ? 'No internet connection. Try again when you have signal.'
        : 'Claude could not answer: ' + (err?.message || err);
    chat.items.push({ kind: 'error', text: msg });
  } finally {
    unlock?.();
    chat.busy = false;
    drawChat();
  }
}

async function importFieldwire(file) {
  const b = busy('Reading the Fieldwire report…');
  let fw;
  try { fw = await readFieldwire(file); } catch (err) { b.done(); return toast('Could not read that report: ' + err.message, 'error'); }
  b.done();
  if (!fw.doors.length) return toast('No tasks / doors found in that report.', 'error');
  // Fieldwire attributes (height, width, wall, undercut, finish…) onto the door's fields
  for (const d of fw.doors) {
    if (!d.text) continue;
    const { attrs, swing, handing } = readFwAttrs(d.text, lists.fieldSections || DEFAULT_FIELD_SECTIONS);
    d.attrs = attrs;
    const sw = (swing || handing || '').toUpperCase();
    const base = /SADD/.test(sw) ? 'SADD' : /DADD/.test(sw) ? 'DADD' : /SASD/.test(sw) ? 'SASD' : '';
    const hand = /LEFT|\bLH\b/.test(sw + ' ' + (handing || '').toUpperCase()) ? 'LH' : /RIGHT|\bRH\b/.test(sw + ' ' + (handing || '').toUpperCase()) ? 'RH' : '';
    const cand = base === 'SASD' && hand ? `SASD ${hand}` : base === 'DADD' ? 'DADD' : '';
    if (cand && LEAF_CONFIGS.includes(cand)) d.leaf = cand;
  }
  // does the checklist match one we already have?
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const want = fw.checklist.map(norm).sort().join('|');
  const match = fw.checklist.length ? kindIds().find((k) => (kitOf(k).questions || []).filter((q) => q.text?.trim() && !q.hidden).map((q) => norm(q.text)).sort().join('|') === want) : null;
  const plans = [...new Set(fw.doors.map((d) => d.plan).filter(Boolean))];
  const withRecs = fw.doors.filter((d) => d.recommendations.length).length;
  const r = await dialog({
    title: 'New project from Fieldwire',
    body: `<p>Found <b>${fw.doors.length} doors</b>${plans.length ? ` on ${plans.length} drawing${plans.length === 1 ? '' : 's'}` : ''}, ${withRecs} with recommendations${fw.checklist.length ? `, and a ${fw.checklist.length}-question checklist` : ''}.</p>
      <label class="field"><span>Site</span><input name="site" required value="${esc(fw.site)}"></label>
      <div class="grid2"><label class="field"><span>Client</span><input name="client" placeholder="e.g. HSE"></label>
        <label class="field"><span>Inspection date</span><input type="date" name="date" value="${esc(fw.date)}"></label></div>
      <label class="field"><span>Address / Eircode</span><input name="address" value="${esc(fw.eircode)}"></label>
      <label class="field"><span>Inspection frequency</span><select name="frequency">${freqOpts('')}</select><small class="muted">Each door's next inspection due date is worked out from its inspection date.</small></label>
      ${fw.checklist.length ? `<label class="field"><span>Checklist</span><select name="kit">
        ${match ? `<option value="${match}" selected>Use "${esc(kitOf(match).name)}" (same questions)</option>` : `<option value="__new" selected>Create "${esc(fw.checklist.length + ' point check')}" from the report</option>`}
        ${kindIds().filter((k) => k !== match).map((k) => `<option value="${k}">${esc(kitOf(k).name)}</option>`).join('')}</select></label>` : ''}
      <p class="muted small">Doors come in <b>not yet placed</b>. Add the drawing on the Plans tab, then use <b>Place</b> to tap each door onto it. Doors with recommendations come in as Fail, with each recommendation as a repair action; the others as Pass.</p>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Create project', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return;
  const bz = busy('Creating the project…');
  try {
    let kind = r.data.kit || 'fd';
    if (kind === '__new') {
      kind = 'c-' + db.uid().slice(0, 8);
      const name = `Fire doors – ${fw.checklist.length} point check`;
      await saveLists({
        customKits: [...(lists.customKits || []), { id: kind, base: 'fd', name }],
        kits: { ...(lists.kits || {}), [kind]: { name, item: 'Door', report: `${fw.checklist.length} Point Fire Door Inspection Report`, questions: fw.checklist.map((text, i) => ({ id: `${kind}-${i + 1}`, text, defect: guessDefect(text, lists.defects || []) || undefined })) } },
      });
    }
    const zones = [];
    for (const d of fw.doors) if (d.zoneNo && !zones.some((z) => z.no === d.zoneNo)) zones.push({ no: d.zoneNo, name: d.zoneName });
    const maxNo = Math.max(0, ...fw.doors.map((d) => d.no || 0));
    const project = await db.put('projects', {
      id: db.uid(), site: r.data.site.trim() || fw.site, client: r.data.client.trim(), address: r.data.address.trim(), date: r.data.date || today(),
      workType: 'Fire door inspection', scheme: lists.lastScheme || DEFAULT_SCHEME, zones, nextPin: maxNo + 1, sourceReport: fw.title,
    });
    for (const d of [...fw.doors].sort((a, c) => a.no - c.no)) {
      const notes = [
        d.plan ? `Fieldwire plan: ${d.plan}` : '',
        d.rating ? `Door rating: ${d.rating}` : '',
        d.rfid ? `RFID tag: ${d.rfid}` : '',
        d.tags.length ? `Tags: ${d.tags.join(', ')}` : '',
        d.messages.length ? `Notes: ${d.messages.join(' · ')}` : '',
      ].filter(Boolean).join('\n');
      await saveDoor({
        id: db.uid(), projectId: project.id, planId: null, collection: '', pinNo: d.no, x: null, y: null, kind,
        ref: d.ref, location: d.location, doorType: d.doorType, leaf: '', zoneNo: d.zoneNo, zoneName: d.zoneName, risk: '', category: '',
        sourcePlan: d.plan, status: d.recommendations.length ? 'fail' : 'pass', defects: [], actions: d.recommendations, checks: {}, materials: [],
        ...(d.attrs && Object.keys(d.attrs).length ? { attrs: d.attrs, replacement: d.attrs.h || d.attrs.w ? 'df' : '' } : {}),
        ...(d.leaf ? { leaf: d.leaf } : {}),
        notes, inspectedOn: r.data.date || fw.date || '', inspectedBy: lists.inspector || '',
      }, [`Imported from Fieldwire report "${fw.title}"`]);
    }
    // keep the original report with the project
    await addBlob(project.id, file, file.name, 'Reports', { notes: 'Original Fieldwire report this project was created from' });
    bz.done();
    toast(`${fw.doors.length} doors imported. Add the drawing, then tap Place`);
    go({ view: 'project', projectId: project.id, tab: 'plans' });
  } catch (err) {
    bz.done();
    console.error(err);
    toast('Import failed: ' + err.message, 'error');
  }
}

const freqOpts = (cur) => `<option value="">Not set</option>${FREQUENCIES.map(([n, t]) => `<option value="${n}" ${Number(cur) === n ? 'selected' : ''}>${t}</option>`).join('')}`;

// The site's visit frequency changed: work out every inspected door's next due date again
async function applyFrequency(project) {
  const f = Number(project.frequency) || 0;
  if (!f) return;
  let n = 0;
  for (const d of await db.projectDoors(project.id)) {
    if (!d.inspectedOn) continue;
    const due = addMonths(d.inspectedOn, f);
    if (due !== d.nextDue) { await saveDoor({ ...d, nextDue: due }, [`Next inspection due set from the site's frequency (${freqText(f).toLowerCase()})`]); n++; }
  }
  if (n) toast(`Next inspection due updated on ${n} door${n === 1 ? '' : 's'} (${freqText(f).toLowerCase()})`);
}

async function editProject(existing) {
  const p = existing || { client: '', site: '', address: '', date: today(), scheme: lists.lastScheme || DEFAULT_SCHEME };
  const cur = schemeById(p.scheme) ? p.scheme : DEFAULT_SCHEME;
  const allProjects = await db.all('projects');
  const groupNames = [...new Set(allProjects.map((x) => x.group).filter(Boolean))].sort();
  const clientNames = [...new Set(allProjects.map((x) => x.client).filter(Boolean))].sort();
  // every type of work: the saved list, plus each checklist (inspection type) by name
  const wtNow = p.workType ?? (existing ? '' : 'Fire door inspection');
  const workTypeOpts = [...new Set([...(lists.workTypes || DEFAULT_WORK_TYPES), ...kindIds().filter((k) => !['fd', 'dampers', 'alarm', 'emlight', 'ext'].includes(k)).map((k) => kitOf(k).name), ...(wtNow ? [wtNow] : []), ...(existing ? [''] : [])])];
  setTimeout(() => {
    const sel = $('#pf-type');
    const other = $('#pf-type-other');
    if (sel && other) sel.onchange = () => { other.hidden = sel.value !== '__other'; if (!other.hidden) other.focus(); };
  }, 0);
  const r = await dialog({
    title: existing ? 'Project details' : 'New project',
    body: `
      <label class="field"><span>Site name</span><input name="site" id="pf-site" required value="${esc(p.site)}" placeholder="e.g. Tearmann Ward, Cavan General"></label>
      <label class="field"><span>Client</span><input name="client" id="pf-client" value="${esc(p.client)}" placeholder="e.g. HSE Estates" list="pf-clients"></label>
      <div class="grid2">
        <label class="field"><span>Group</span><input name="group" id="pf-group" value="${esc(p.group || '')}" placeholder="e.g. Cavan / Monaghan, or Block B" list="pf-groups" autocomplete="off"></label>
        <label class="field"><span>Type of work</span><select name="workType" id="pf-type">${workTypeOpts.map((t) => `<option value="${esc(t)}" ${t === wtNow ? 'selected' : ''}>${esc(t || 'None')}</option>`).join('')}<option value="__other">Other – type your own…</option></select>
          <input name="workTypeOther" id="pf-type-other" placeholder="e.g. Fire curtain check" autocomplete="off" hidden></label>
      </div>
      <datalist id="pf-groups">${groupNames.map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist>
      <datalist id="pf-clients">${clientNames.map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist>
      <label class="field"><span>Address</span><input name="address" id="pf-address" value="${esc(p.address)}" placeholder="Town, county / Eircode"></label>
      <div class="grid2">
        <label class="field"><span>Inspection date</span><input type="date" name="date" id="pf-date" value="${esc(p.date)}"></label>
        <label class="field"><span>Inspection frequency</span><select name="frequency">${freqOpts(p.frequency)}</select><small class="muted">Each door's next inspection due date is worked out from its inspection date.</small></label>
      </div>
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
  const { zones: zonesRaw, workTypeOther, ...form } = r.data;
  if (form.workType === '__other') form.workType = (workTypeOther || '').trim();
  r.data.workType = form.workType;
  form.frequency = Number(form.frequency) || 0;
  const rec = await db.put('projects', { ...p, ...form, zones: parseZones(zonesRaw), id: p.id || db.uid(), nextPin: p.nextPin || 1 });
  if (existing && form.frequency && form.frequency !== (Number(p.frequency) || 0)) await applyFrequency(rec);
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
      { x: 0.15, y: 0.44, ref: 'GF-01', location: 'Bedroom 1', status: 'pass', doorType: 'E30Sa (FD30S)' },
      { x: 0.36, y: 0.44, ref: 'GF-02', location: 'Bedroom 2', status: 'fail', doorType: 'E30Sa (FD30S)', defects: [0, 4] },
      { x: 0.57, y: 0.44, ref: 'GF-03', location: 'Day room', status: 'fail', doorType: 'E30Sa (FD30S)', defects: [3, 7, 18] },
      { x: 0.73, y: 0.44, ref: 'GF-04', location: 'Store', status: 'no_access', doorType: 'E30 (FD30)' },
      { x: 0.19, y: 0.56, ref: 'GF-05', location: 'Kitchen', status: 'repaired', doorType: 'E60Sa (FD60S)' },
      { x: 0.42, y: 0.56, ref: 'GF-06', location: 'Dining', status: 'not_inspected', doorType: '' },
      { x: 0.835, y: 0.44, ref: 'GF-08', location: 'Office', status: 'na', doorType: 'Non-rated' },
      { x: 0.875, y: 0.56, ref: 'GF-07', location: 'Stair core', status: 'fail', doorType: 'E60Sa (FD60S)', defects: [1, 9] },
    ];
    let n = 1;
    for (const d of demoDoors) {
      await db.put('doors', {
        id: db.uid(), projectId: project.id, planId: plan.id, pinNo: n, x: d.x, y: d.y, ref: String(n++).padStart(3, '0'), location: d.location,
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
      <div class="bar-title"><b>${esc(project.site || 'Untitled site')}</b><small>${esc([project.client, fmtDate(project.date), freqText(project.frequency).toLowerCase()].filter(Boolean).join(' · '))}</small></div>
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
    const pdf = await exportProjectPdf(p, { ...lists, questions: allQuestions() }, { title: kitOf(kindOfPlan(plan)).report, photos: true, passDetail: true, costs: false, doors, plans, filterText: '', returnBlob: true, closeout: { ...rec, declarationBlobs: declFiles.map((f) => f.blob) } }, b.update);
    const stamp = closedAt.slice(0, 10);
    const label = [p.site || p.client || 'Project', rec.coll].filter(Boolean).join(' – ');
    const pdfRec = await addBlob(p.id, pdf.blob, `Closed report – ${label} – ${stamp}.pdf`, 'Reports', { notes: `Final report, service closed ${fmtDate(stamp)}${rec.closedBy ? ' by ' + rec.closedBy : ''}` });
    b.update('Building the Excel workbook…');
    let xlsRec = null;
    try {
      const qs = allQuestions().filter((q) => q.text?.trim() && !q.hidden);
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
const repPhotoCache = {};
let repViewer = null;
// Pin colour on the repairs drawing: where each door's repairs are up to
const REP_STAGES = [
  ['todo', 'To do', '#c62828'],
  ['part', 'Started', '#ef8f00'],
  ['done', 'Done', '#1565c0'],
  ['verified', 'Verified', '#2e7d32'],
];
const repStage = (p) => (p.allVerified ? 'verified' : p.complete ? 'done' : p.done ? 'part' : 'todo');

// The drawing in the Repairs tab: only doors with repairs, coloured by
// progress; tapping a pin opens that door's repair list.
async function drawRepairPlan(body, plans, withWork) {
  repViewer?.destroy();
  repViewer = null;
  const box = $('#rep-plan', body);
  if (!box) return;
  const onPlans = plans.filter((pl) => withWork.some(({ d }) => d.planId === pl.id));
  if (!onPlans.length) { box.hidden = true; return; }
  const plan = onPlans.find((pl) => pl.id === state.repPlan) || onPlans[0];
  const pins = withWork.filter(({ d }) => d.planId === plan.id && d.x != null);
  const count = (k) => pins.filter(({ p }) => repStage(p) === k).length;
  box.innerHTML = `
    <div class="block-head"><h2 class="h2">${icon('plan')} Drawing</h2>
      ${onPlans.length > 1 ? `<select id="rep-plan-sel" aria-label="Drawing">${onPlans.map((pl) => `<option value="${pl.id}" ${pl.id === plan.id ? 'selected' : ''}>${esc(pl.name)}</option>`).join('')}</select>` : `<span class="muted small">${esc(plan.name)}</span>`}</div>
    <div class="rep-viewer" id="rep-viewer"></div>
    <div class="rep-plan-ctl">
      <div class="rep-legend">${REP_STAGES.map(([k, label, c]) => `<span><i style="--c:${c}"></i>${label} <b>${count(k)}</b></span>`).join('')}</div>
      <span class="row-btns"><button class="icon-btn sm" id="rp-zout" aria-label="Zoom out">${icon('zoomOut')}</button><button class="icon-btn sm" id="rp-zin" aria-label="Zoom in">${icon('zoomIn')}</button><button class="icon-btn sm" id="rp-fit" aria-label="Fit">${icon('fit')}</button></span>
    </div>
    <p class="muted small">Tap a pin to open that door's repair list. Pinch to zoom.</p>`;
  $('#rep-plan-sel', box)?.addEventListener('change', (e) => { state.repPlan = e.target.value; drawRepairPlan(body, plans, withWork); });
  const full = await db.get('plans', plan.id);
  if (!full?.blob || !$('#rep-viewer', box)) return;
  const vb = $('#rep-viewer', box);
  vb.style.height = Math.round(Math.max(240, Math.min(window.innerHeight * 0.62, vb.clientWidth * (full.height / full.width) + 24))) + 'px';
  repViewer = new PlanViewer(vb, {
    onTap: () => {},
    onPinTap: (id) => go({ ...state, doorId: id, repair: true }),
  });
  await repViewer.load(full.blob, full.width, full.height);
  if (full.markups?.length) repViewer.setMarkups?.(full.markups);
  repViewer.setPins(pins.map(({ d, p }) => {
    const st = REP_STAGES.find(([k]) => k === repStage(p));
    return { id: d.id, x: d.x, y: d.y, label: d.pinNo, color: st[2], hollow: false, title: `Pin ${d.pinNo} ${d.ref || ''}: ${p.done} of ${p.total} repairs done` };
  }), null);
  $('#rp-zin', box).onclick = () => repViewer?.zoomBy(1.5);
  $('#rp-zout', box).onclick = () => repViewer?.zoomBy(1 / 1.5);
  $('#rp-fit', box).onclick = () => repViewer?.fit();
}

// One door's repairs: tick and verify each item, repair photos (kept apart
// from the inspection photos) and repair notes. Opened from the Repairs tab,
// or from a pin when the drawing is in Repairs mode.
async function drawRepairSheet(door) {
  const el = $('#sheet');
  const project = await db.get('projects', door.projectId);
  useScheme(project);
  const plan = door.planId ? await db.get('plans', door.planId) : null;
  let d = door;
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const save = async (patch, note) => {
    d = await saveDoor({ ...(await db.get('doors', d.id)), ...patch }, note ? [note] : []);
    delete repPhotoCache[project.id];
  };
  const draw = () => {
    const p = remedialProgress(d);
    const st = statusById[d.status || 'not_inspected'];
    el.innerHTML = `
      <div class="sheet-grip"></div>
      <header class="sheet-head">
        <span class="pin-badge ${st.id === 'not_inspected' ? 'is-hollow' : ''}" style="--pin:${st.color}">${d.pinNo ?? ''}</span>
        <div class="sheet-title"><b>Repairs · ${esc(d.ref || 'Door ' + d.pinNo)}</b><small>${esc([d.location, plan?.name].filter(Boolean).join(' · '))} · ${p.done} of ${p.total} done${p.verified ? ` · ${p.verified} verified` : ''}</small></div>
        <button class="icon-btn" id="rs-close" aria-label="Close">${icon('close')}</button>
      </header>
      <div class="sheet-body">
        <div class="rep-bar"><i style="--w:${p.total ? (p.done / p.total) * 100 : 0}%"></i></div>
        <section class="block">
          <div class="block-head"><h3>Repair items</h3>${p.awaiting ? `<button class="btn sm" id="rs-verify-all">${icon('shield')} Verify all (${p.awaiting})</button>` : ''}</div>
          ${p.total ? `<ul class="rep-items">${p.items.map((it) => {
            const r = d.remedials?.[it.key];
            return `<li><label class="rep-check ${r?.done ? 'is-done' : ''}"><input type="checkbox" class="rs-tick" data-key="${esc(it.key)}" ${r?.done ? 'checked' : ''}>
              <span><b>${esc(it.text)}${it.qty ? ` (×${it.qty})` : ''}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}${r?.done ? `<small class="rep-by">Done by ${esc(r.by || 'unknown')} · ${esc(when(r.at))}</small>` : ''}${r?.verified ? `<small class="rep-ver">Verified by ${esc(r.vby || 'unknown')} · ${esc(when(r.vat))}</small>` : ''}</span></label>
              ${r?.done ? `<label class="ver-check ${r.verified ? 'is-on' : ''}"><input type="checkbox" class="rs-ver" data-key="${esc(it.key)}" ${r.verified ? 'checked' : ''}>${icon('shield')} Verified</label>` : ''}</li>`;
          }).join('')}</ul>` : '<p class="muted small">No repair items on this door.</p>'}
        </section>
        <section class="block">
          <div class="block-head"><h3>Repair photos &amp; videos <span class="muted" id="rs-n"></span></h3>
            <div class="row-btns">
              <label class="btn sm primary">${icon('camera')} Photo<input type="file" accept="image/*" capture="environment" id="rs-cam" hidden></label>
              <label class="btn sm">${icon('video')} Video<input type="file" accept="video/*" capture="environment" id="rs-vid" hidden></label>
              <label class="btn sm">${icon('image')} Gallery<input type="file" accept="image/*,video/*" multiple id="rs-lib" hidden></label>
            </div>
          </div>
          <div class="photo-strip" id="rs-photos"></div>
          <p class="muted small">Kept apart from the inspection photos. They go in the repairs completion report, not the inspection report.</p>
        </section>
        <section class="block">
          <label class="field"><span>Repair notes</span><textarea id="rs-notes" rows="3" placeholder="e.g. Closer replaced with Dorma TS83; frame packed at hinge side">${esc(d.repairNotes || '')}</textarea></label>
        </section>
        <div class="row-btns">
          <button class="btn" id="rs-insp">${icon('door')} Inspection record</button>
          ${p.complete && d.status !== 'repaired' && STATUSES.some((s) => s.id === 'repaired') ? `<button class="btn primary" id="rs-repaired">${icon('check')} Set status to ${esc(statusById.repaired.label)}</button>` : ''}
        </div>
      </div>`;
    $('#rs-close').onclick = () => back();
    $('#rs-insp').onclick = () => go({ ...state, repair: false }, { replace: true });
    $$('.rs-tick', el).forEach((cb) => (cb.onchange = async () => {
      const remedials = { ...((await db.get('doors', d.id)).remedials || {}) };
      remedials[cb.dataset.key] = cb.checked ? { done: true, by: lists.inspector || project.remedialAck?.by || '', at: new Date().toISOString() } : { done: false, verified: false };
      await save({ remedials });
      draw();
    }));
    const verify = async (keys, on) => {
      const remedials = { ...((await db.get('doors', d.id)).remedials || {}) };
      let who = '';
      if (on) {
        who = await askVerifier(keys.map((k) => remedials[k]?.by).filter(Boolean));
        if (!who) return draw();
      }
      for (const k of keys) {
        if (!remedials[k]?.done) continue;
        remedials[k] = on ? { ...remedials[k], verified: true, vby: who, vat: new Date().toISOString() } : { ...remedials[k], verified: false, vby: '', vat: '' };
      }
      await save({ remedials });
      draw();
    };
    $$('.rs-ver', el).forEach((cb) => (cb.onchange = () => verify([cb.dataset.key], cb.checked)));
    $('#rs-verify-all')?.addEventListener('click', () => verify(remedialItems(d).map((i) => i.key).filter((k) => d.remedials?.[k]?.done && !d.remedials?.[k]?.verified), true));
    $('#rs-repaired')?.addEventListener('click', async () => { await save({ status: 'repaired' }); toast(`Door set to ${statusById.repaired.label}`); draw(); if (state.view === 'plan') refreshPins(); });
    let nt = null;
    $('#rs-notes').oninput = (e) => { clearTimeout(nt); const v = e.target.value; nt = setTimeout(() => save({ repairNotes: v }), 500); };
    $('#rs-cam').onchange = (e) => { addRepairPhotos([...e.target.files]); e.target.value = ''; };
    $('#rs-lib').onchange = (e) => { addRepairPhotos([...e.target.files]); e.target.value = ''; };
    $('#rs-vid').onchange = (e) => { addRepairPhotos([...e.target.files]); e.target.value = ''; };
    drawPhotos();
  };
  const drawPhotos = async () => {
    const photos = (await db.doorPhotos(d.id)).filter((x) => x.stage === 'repair');
    if (!$('#rs-photos')) return;
    const nv = photos.filter(isVideo).length;
    $('#rs-n').textContent = photos.length ? `(${photos.length - nv} photo${photos.length - nv === 1 ? '' : 's'}${nv ? `, ${nv} video${nv === 1 ? '' : 's'}` : ''})` : '';
    $('#rs-photos').innerHTML = photos.length
      ? photos.map((x) => isVideo(x)
        ? `<button class="photo is-video" data-id="${x.id}" aria-label="Play video"><img alt="" src="${objUrl(x.thumb)}"><span class="play">${icon('play')}</span><span class="dur">${esc(fmtDuration(x.duration))}</span></button>`
        : `<button class="photo" data-id="${x.id}"><img alt="Repair photo" src="${objUrl(x.thumb)}"></button>`).join('')
      : '<p class="muted small">No repair photos or videos yet. Photograph each door after repair.</p>';
    $$('#rs-photos .photo', el).forEach((b) => (b.onclick = () => openPhoto(photos.find((x) => x.id === b.dataset.id), drawPhotos)));
  };
  const addRepairPhotos = async (files) => {
    if (!files.length) return;
    const bz = busy('Saving…');
    try {
      let nVid = 0;
      let bigVideo = false;
      for (const f of files) {
        if (f.type.startsWith('video/') || /\.(mov|mp4|m4v|webm|3gp)$/i.test(f.name)) {
          bz.update('Saving video…');
          const info = await videoInfo(f);
          await db.put('photos', { id: db.uid(), projectId: d.projectId, doorId: d.id, stage: 'repair', inspection: '', kind: 'video', blob: f, mime: f.type || 'video/mp4', size: f.size, name: f.name, link: '', ...info });
          nVid++;
          if (f.size > 150 * 1048576) bigVideo = true;
          continue;
        }
        bz.update('Saving photo…');
        const { blob, thumb, width, height } = await compressImage(f, 1600, 0.8);
        const gps = lists.gps !== false ? await getPosition({ timeout: 4000 }) : null;
        await db.put('photos', { id: db.uid(), projectId: d.projectId, doorId: d.id, stage: 'repair', inspection: '', blob, thumb, width, height, ...(gps ? { gps } : {}) });
      }
      bz.done();
      const nPh = files.length - nVid;
      await logEvent(d.id, [nPh ? `Added ${nPh} repair photo${nPh > 1 ? 's' : ''}` : '', nVid ? `Added ${nVid} repair video${nVid > 1 ? 's' : ''}` : ''].filter(Boolean).join(', '));
      if (bigVideo) toast('Large video saved. Short clips (under a minute) keep the phone from filling up.');
      delete repPhotoCache[project.id];
      drawPhotos();
    } catch (e) {
      bz.done();
      toast('Could not save: ' + e.message, 'error');
    }
  };
  draw();
}

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
  const repPhotoCount = repPhotoCache[project.id] || {};
  if (!repPhotoCache[project.id]) {
    // count each door's repair photos, then show them on the buttons
    db.byIndex('photos', 'projectId', project.id).catch(() => []).then((ps) => {
      const c = {};
      for (const p of ps || []) if (p.stage === 'repair') c[p.doorId] = (c[p.doorId] || 0) + 1;
      repPhotoCache[project.id] = c;
      if (Object.keys(c).length && body.isConnected) renderRepairsTab(body, project, plans, doors);
    });
  }
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
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

    <section class="panel rep-plan" id="rep-plan"></section>

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
          <button class="btn sm rep-open-r">${icon('camera')} Repair photos &amp; notes${repPhotoCount[d.id] ? ` (${repPhotoCount[d.id]})` : ''}</button>
          ${d.planId ? `<button class="btn ghost sm rep-plan">${icon('plan')} On the drawing</button>` : ''}
          <button class="btn ghost sm rep-open">Inspection record</button>
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
  drawRepairPlan(body, plans, withWork);
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
    $('.rep-open', sec).onclick = () => go({ ...state, doorId: id, repair: false });
    const openRepair = () => go({ ...state, doorId: id, repair: true });
    $('.rep-open-r', sec).onclick = openRepair;
    $('.rep-head', sec).onclick = openRepair;
    $('.rep-map', sec)?.addEventListener('click', openRepair);
    $('.rep-plan', sec)?.addEventListener('click', () => {
      const d = doors.find((x) => x.id === id);
      go({ view: 'plan', projectId: project.id, planId: d.planId, repair: true });
      setTimeout(() => { if (state.view === 'plan') go({ ...state, doorId: id }); }, 350); // closing the repairs leaves you on the drawing
    });
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
  if (coll !== '*') await db.put('projects', { ...((await db.get('projects', project.id)) || project), activeCollection: coll });
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
            <div><b>${esc(p.name)}</b><small><button type="button" class="kind-chip kind-pick ${kcls(kindOfPlan(p))}" data-id="${p.id}" aria-label="Inspection type: ${esc(kitOf(kindOfPlan(p)).name)}. Tap to change">${esc(kitOf(kindOfPlan(p)).name)} ${icon('down')}</button> ${n[p.id] || 0} pin${(n[p.id] || 0) === 1 ? '' : 's'}</small></div>
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
        <input type="file" id="plan-file" accept="application/pdf,image/*" multiple hidden>
        <span class="upload-ico">${icon('upload')}</span>
        <b>Upload drawings</b>
        <small>PDFs or photos of floor plans – pick several at once. Each PDF page becomes a plan.</small>
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
  $$('.kind-pick', body).forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    const pl = plans.find((p) => p.id === b.dataset.id);
    const k = await pickKind(`Inspection type for "${pl.name}"`, kindOfPlan(pl));
    if (k) { await setPlanKind(pl, k); refresh(); }
  }));
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
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    // which collection do they go in?
    let target = active === '*' || isFolderPick(active) ? plansIn(plans, active)[0]?.collection || colls[0] || '' : active;
    if (named) {
      const r = await dialog({
        title: files.length > 1 ? `Add ${files.length} drawings to…` : 'Add drawing to…',
        body: `
          <label class="field"><span>Collection</span>
            <select name="coll" id="up-coll">${collOptions(colls, target, { folders: false })}<option value="__new">New collection…</option></select></label>
          <div class="grid2">
            <label class="field"><span>If new: main folder (optional)</span><input name="newfolder" id="up-newf" list="up-folders" placeholder="e.g. Remedial repairs"></label>
            <label class="field"><span>If new: name / section</span><input name="newname" id="up-new" placeholder="${esc(suggestName(colls, false))}"></label>
          </div>
          <datalist id="up-folders">${listFolders(colls).map((f) => `<option value="${esc(f)}"></option>`).join('')}</datalist>`,
        buttons: [{ label: 'Cancel', value: false }, { label: files.length > 1 ? `Add ${files.length} drawings` : 'Add drawing', value: true, kind: 'primary' }],
      });
      if (r.value !== true) return;
      target = r.data.coll === '__new' ? joinColl((r.data.newfolder || '').trim(), (r.data.newname || '').trim() || suggestName(colls, !(r.data.newfolder || '').trim())) : r.data.coll;
    }
    const kind = await pickKind(files.length > 1 ? 'What are these drawings for?' : 'What is this drawing for?', kindIds().find((k) => kitOf(k).name === project.workType) || kindForWork(project.workType));
    if (!kind) return;
    const bz = busy('Reading drawing…');
    let order = plansIn(plans, target).length;
    let first = null;
    let added = 0;
    const failed = [];
    // in name order, so "1 Lower ground", "2 Ground"… stay in sequence
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const [n, file] of files.entries()) {
      try {
        const pages = await importDrawing(file, (m) => bz.update(files.length > 1 ? `Drawing ${n + 1} of ${files.length}: ${m}` : m));
        for (const pg of pages) {
          const rec = await db.put('plans', { id: db.uid(), projectId: project.id, order: order++, sourceName: file.name, collection: target, inspType: kind, ...pg });
          first ||= rec;
          added++;
        }
      } catch (err) {
        console.error(err);
        failed.push(file.name);
      }
    }
    bz.done();
    if (failed.length) toast(`Could not read ${failed.join(', ')}`, 'error');
    else toast(added > 1 ? `${added} plans added` : 'Plan added');
    if (added === 1) go({ view: 'plan', projectId: project.id, planId: first.id });
    else refresh();
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
          <span><b>Pins and door details</b><small>Pin ref, room, door type and leaf. Every door starts as Not inspected with a blank checklist. Best for a repeat service.</small></span></label>
        <label class="scheme-opt"><input type="radio" name="mode" value="all">
          <span><b>Everything</b><small>Also status, checklist answers, defects, actions, materials and notes, ready to update.</small></span></label>
        <label class="scheme-opt"><input type="radio" name="mode" value="none">
          <span><b>Drawings only, no pins</b><small>Start a different inspection (e.g. dampers or emergency lighting) on the same drawings.</small></span></label>
      </fieldset>
      <label class="field"><span>Inspection type for the copied drawings</span><select name="kind"><option value="">Same as now</option>${kindIds().map((k) => `<option value="${k}">${esc(kitOf(k).name)}</option>`).join('')}</select></label>
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
    const pp = await db.get('projects', project.id);
    if (pp.collPrices?.[from]) await db.put('projects', { ...pp, collPrices: { ...pp.collPrices, [name]: { ...pp.collPrices[from] } } });
    if (r.data.kind) {
      // the copies become a different type; any copied pins keep their own type
      for (const pl of await db.projectPlans(project.id)) {
        if ((pl.collection || '') !== name) continue;
        for (const d of await db.byIndex('doors', 'planId', pl.id)) if (!d.kind) await db.put('doors', { ...d, kind: kindOfPlan(pl) });
        await db.put('plans', { ...pl, inspType: r.data.kind });
      }
    }
    b.done();
    toast(`Copied ${res.drawings} drawing${res.drawings === 1 ? '' : 's'}${res.pins ? ` and ${res.pins} pin${res.pins === 1 ? '' : 's'}` : ''} to "${collLabel(name)}"`);
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
    const pp = await db.get('projects', project.id);
    if (pp.collPrices?.[c]) { const cp = { ...pp.collPrices, [name]: pp.collPrices[c] }; delete cp[c]; await db.put('projects', { ...pp, collPrices: cp }); }
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

// Choose an inspection type (big buttons, one tap)
async function pickKind(title, current) {
  const r = await dialog({
    title,
    body: `<p class="muted small">Sets the checklist, defects and item types for every new pin on the drawing.</p>
      <div class="kind-list">${kindIds().map((k) => `<label class="kind-opt ${kcls(k)}"><input type="radio" name="kind" value="${k}" ${k === current ? 'checked' : ''}><span><b>${esc(kitOf(k).name)}</b><small>Each pin is ${/^[aeiou]/i.test(kitOf(k).item) ? 'an' : 'a'} ${esc(kitOf(k).item.toLowerCase())} · ${(kitOf(k).questions || []).filter((q) => q.text?.trim() && !q.hidden).length} checks</small></span></label>`).join('')}</div>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Use this type', value: true, kind: 'primary' }],
  });
  return r.value === true ? r.data.kind || current : null;
}
async function setPlanKind(plan, newKind) {
  if (newKind === kindOfPlan(plan)) return;
  const oldKind = kindOfPlan(plan);
  const pins = await db.byIndex('doors', 'planId', plan.id);
  const nNew = kitOf(newKind).name.toLowerCase();
  let moveAll = true;
  if (pins.length) {
    const inspected = pins.filter((d) => (d.status || 'not_inspected') !== 'not_inspected' || Object.keys(d.checks || {}).length).length;
    const r = await dialog({
      title: `Change the pins too?`,
      body: `<p>There ${pins.length === 1 ? 'is 1 pin' : `are ${pins.length} pins`} on "${esc(plan.name)}" already${inspected ? ` (${inspected} inspected)` : ''}.</p>
        <p>Change ${pins.length === 1 ? 'it' : 'them'} to <b>${esc(nNew)}</b> as well, or keep ${pins.length === 1 ? 'it' : 'them'} as ${esc(kitOf(oldKind).name.toLowerCase())}? New pins will be ${esc(nNew)} either way.</p>`,
      buttons: [{ label: `Keep as ${kitOf(oldKind).name.toLowerCase()}`, value: 'keep' }, { label: `Change ${pins.length === 1 ? 'it' : 'all'}`, value: 'move', kind: 'primary' }],
    });
    if (r.value == null) return false;
    moveAll = r.value === 'move';
  }
  for (const d of pins) {
    if (moveAll) { if (d.kind !== newKind) await db.put('doors', { ...d, kind: newKind }); }
    else if (!d.kind) await db.put('doors', { ...d, kind: oldKind });
  }
  await db.put('plans', { ...(await db.get('plans', plan.id)), inspType: newKind });
  toast(`${plan.name}: ${kitOf(newKind).name}`);
  return true;
}

// Remove pins from a drawing, all of them or only one type (e.g. door pins
// copied onto a dampers drawing). Their photos go with them.
async function removePins(plan) {
  const pins = await db.byIndex('doors', 'planId', plan.id);
  if (!pins.length) return toast('There are no pins on this drawing');
  const byKind = {};
  for (const d of pins) (byKind[kindOfDoor(d, plan)] ||= []).push(d);
  const kinds = Object.keys(byKind);
  const r = await dialog({
    title: `Remove pins from "${plan.name}"`,
    body: `<p>Tick the pins to remove. Their details and photos are deleted; this cannot be undone.</p>
      <div class="kind-list">${kinds.map((k) => `<label class="kind-opt ${kcls(k)}"><input type="checkbox" name="k_${k}" ${kinds.length === 1 || k !== kindOfPlan(plan) ? 'checked' : ''}><span><b>${esc(kitOf(k).name)}</b><small>${byKind[k].length} pin${byKind[k].length === 1 ? '' : 's'}${byKind[k].some((d) => (d.status || 'not_inspected') !== 'not_inspected') ? ` · ${byKind[k].filter((d) => (d.status || 'not_inspected') !== 'not_inspected').length} inspected` : ''}</small></span></label>`).join('')}</div>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Remove', value: true, kind: 'primary danger' }],
  });
  if (r.value !== true) return;
  const gone = kinds.filter((k) => r.data['k_' + k]).flatMap((k) => byKind[k]);
  if (!gone.length) return;
  for (const d of gone) await db.deleteDoor(d.id);
  toast(`${gone.length} pin${gone.length === 1 ? '' : 's'} removed`);
  refresh();
}

async function planMenu(plan, colls = []) {
  const r = await dialog({
    title: 'Plan',
    body: `<label class="field"><span>Name</span><input name="name" id="plan-name" value="${esc(plan.name)}"></label>
      <label class="field"><span>Inspection type</span><select name="kind" id="plan-kind">${kindIds().map((k) => `<option value="${k}" ${k === kindOfPlan(plan) ? 'selected' : ''}>${esc(kitOf(k).name)}</option>`).join('')}</select>
        <small class="muted">Sets the checklist, defects and item types for every pin on this drawing.</small></label>
      ${colls.length > 1 || plan.collection ? `<label class="field"><span>Collection</span>
        <select name="coll" id="plan-coll">${collOptions(colls, plan.collection || '', { folders: false })}</select></label>` : ''}`,
    buttons: [{ label: 'Delete plan', value: 'delete', kind: 'ghost danger-text' }, { label: 'Remove pins…', value: 'pins', kind: 'ghost' }, { label: 'Find doors…', value: 'find', kind: 'ghost' }, { label: 'Cancel', value: false }, { label: 'Save', value: 'save', kind: 'primary' }],
  });
  if (r.value === 'save') {
    await setPlanKind(plan, r.data.kind || kindOfPlan(plan));
    await db.put('plans', { ...(await db.get('plans', plan.id)), name: r.data.name || plan.name, ...(r.data.coll != null ? { collection: r.data.coll } : {}) });
    refresh();
  } else if (r.value === 'pins') {
    await removePins(plan);
  } else if (r.value === 'find') {
    await findDoorsOnPlan(plan);
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
        <small>${esc([d.category, d.doorType, d.zoneNo ? 'Zone ' + d.zoneNo : '', d.risk ? 'Risk: ' + d.risk : '', planName[d.planId]].filter(Boolean).join(' · ') || 'No details yet')}${d.planId ? '' : ' <span class="unplaced">Not on a drawing</span>'}${d.replacement ? ` <span class="rep-badge">${esc(SUPPLY[d.replacement])}</span>` : ''}</small>
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
  const questions = allQuestions().filter((q) => q.text?.trim() && !q.hidden);
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
        const pk = Object.fromEntries(plans.map((pl) => [pl.id, kindOfPlan(pl)]));
        const n = doors.filter((d) => uncostedFails(d, kitOf(d.kind || pk[d.planId]).questions, lists.materials || []).count).length;
        return n ? `<p class="fill-note">${icon('sheet')} <span>${n} door${n === 1 ? ' has' : 's have'} fails that aren't costed yet (failed checks with no defect, or defects with no product). <button class="link-btn" id="fill-all">Cost all fails</button> so they're on the repairs and pricing sheets.</span></p>` : '';
      })()}
      <div class="row-btns"><button class="btn primary" id="xlsx">${icon('download')} Export Excel</button>
        <button class="btn" id="prod-xlsx">${icon('sheet')} Production list (replacements)</button></div>
      ${(() => { const n = doors.filter((d) => d.replacement).length; return `<p class="muted small">${n ? `${n} door${n === 1 ? '' : 's'} marked for replacement. The production list has one row per door with its sizes and choices, for the joinery. No prices.` : 'No doors are marked for replacement yet. Set the Replacement box on a door to add it to the production list.'}</p>`; })()}
    </section>
    ${`<section class="panel">
      <h2 class="h2">${icon('report')} Customer quote from this report</h2>
      <p>One line per failed door at its full price, numbered on from your workbook. The door-by-door breakdown goes in a pricing doc tab laid out like your SERV PDs, with the quote's lines linked to it, so changing a rate in Excel updates the quote.</p>
      <div class="row-btns"><button class="btn primary" id="rep-quote">${icon(priced() ? 'report' : 'shield')} Make the quote${priced() ? '' : ' (owner PIN)'}</button>
      ${priced() ? `<button class="btn" id="site-prices">${icon('list')} Prices for this site${priceCount(project) + Object.values(project.collPrices || {}).reduce((a, x) => a + Object.keys(x).length, 0) ? ' ✦' : ''}</button>` : ''}</div>
    </section>`}
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
    toast(`${added} item${added === 1 ? '' : 's'} added on ${nDoors} door${nDoors === 1 ? '' : 's'}. Check the products and quantities on each door`);
    refresh();
  });
  $('#rep-quote')?.addEventListener('click', async () => { if (priced() || (await unlockOwner())) quoteFromReport(project); });
  $('#site-prices')?.addEventListener('click', () => editSitePrices(project, state.coll && state.coll !== '*' && !String(state.coll).startsWith('F:') ? state.coll : null));
  $('#xlsx').onclick = async () => {
    const b = busy('Building Excel workbook…');
    try {
      if (!doors.length) return b.done(), noneMsg();
      const r = await exportProjectXlsx(project, questions, { doors, filterText, hideCosts: !priced(), fieldSections: lists.fieldSections || DEFAULT_FIELD_SECTIONS });
      b.done();
      if (r === 'saved') toast('Excel file saved');
    } catch (e) {
      b.done();
      toast(e.message, 'error');
    }
  };
  $('#prod-xlsx').onclick = async () => {
    const reps = doors.filter((d) => d.replacement);
    if (!reps.length) return toast('No doors are marked for replacement. Set the Replacement box on a door first.', 'error');
    const b = busy('Building the production list…');
    try {
      const r = await exportProductionXlsx(project, { doors: reps, plans, sections: lists.fieldSections || DEFAULT_FIELD_SECTIONS, filterText });
      b.done();
      if (r === 'saved') toast('Production list saved');
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
      const r = await exportProjectPdf(project, { ...lists, questions: allQuestions() }, opts, b.update);
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
let placingQueue = []; // the doors still to place after this one, in order
let selectedPin = null;

async function renderPlan() {
  const plan = await db.get('plans', state.planId);
  noteWeather(state.projectId);
  useScheme(await db.get('projects', state.projectId));
  planColl = plan?.collection || '';
  if (!plan) return go({ view: 'project', projectId: state.projectId, tab: 'plans' }, { replace: true });
  kindNow = kindOfPlan(plan);
  planKind = kindNow;
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
        <button class="btn big ${state.repair ? 'is-on' : ''}" id="rep-toggle" aria-label="Repairs" aria-pressed="${state.repair ? 'true' : 'false'}">${icon('check')}<span class="tb-txt"> Repairs</span></button>
        <button class="btn big" id="sel-toggle" aria-label="Select">${icon('cursor')}<span class="tb-txt"> Select</span></button>
        <button class="btn big" id="mk-toggle" aria-label="Markup">${icon('pencil')}<span class="tb-txt"> Markup</span></button>
        <button class="btn primary big" id="add-door">${icon('pin')} Add ${esc(kitOf(planKind).item.toLowerCase())}</button>
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
  $('#rep-toggle').onclick = (e) => {
    state.repair = !state.repair;
    e.currentTarget.classList.toggle('is-on', !!state.repair);
    e.currentTarget.setAttribute('aria-pressed', state.repair ? 'true' : 'false');
    toast(state.repair ? 'Repairs mode: tap a pin to see and tick its repairs' : 'Inspection mode: tap a pin to open its inspection record');
  };
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

// The drawing a door came from in its source report (Fieldwire), if known
const sourcePlanOf = (d) => d.sourcePlan || /Fieldwire plan:\s*(.+)/.exec(d.notes || '')?.[1]?.trim() || '';

function startPlacing(d, queue = []) {
  placingId = d.id;
  placingQueue = queue;
  placingLabel = `pin ${d.pinNo}${d.ref ? ' · ' + d.ref : ''}${d.location ? ' · ' + d.location : ''}`;
  setMode('place');
}

async function placeNextInQueue() {
  while (placingQueue.length) {
    const d = await db.get('doors', placingQueue.shift());
    if (d && !d.planId) return startPlacing(d, placingQueue);
  }
  placingId = null;
  setMode(null);
}

async function pickDoorToPlace() {
  const list = await unplacedDoors();
  if (!list.length) return;
  // group by the drawing each came from; the group most like this drawing's name first
  const plan = await db.get('plans', state.planId);
  const words = (t) => new Set(String(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1));
  const here = words(plan?.name || '');
  const score = (name) => [...words(name)].filter((w) => here.has(w)).length;
  const groups = new Map();
  for (const d of list) {
    const g = sourcePlanOf(d) || 'Not linked to a drawing';
    (groups.get(g) || groups.set(g, []).get(g)).push(d);
  }
  const ordered = [...groups.entries()].sort((a, b) => score(b[0]) - score(a[0]) || a[0].localeCompare(b[0]));
  const many = ordered.length > 1;
  const r = await dialog({
    title: `Place on this drawing (${list.length} waiting)`,
    body: `<p class="small">Pick the first one. After you tap where it is, the next one from the same group comes up, so you can place them one after another. <b>Skip</b> or <b>Stop</b> at any time.</p>
      <div class="pick-list place-pick">${ordered.map(([g, ds]) => `
        ${many ? `<p class="pick-group">${esc(g)} <span class="muted">(${ds.length})</span></p>` : ''}
        ${ds.map((d) => `<label class="pick"><input type="radio" name="door" value="${d.id}">
          <span><b>${esc(d.pinNo + (d.ref ? ' · ' + d.ref : ''))}</b><small>${esc([d.location, d.doorType].filter(Boolean).join(' · '))}</small></span></label>`).join('')}`).join('')}</div>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Start placing', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return;
  const d = list.find((x) => x.id === r.data?.door);
  if (!d) return toast('Pick a door to start with', 'error');
  const group = groups.get(sourcePlanOf(d) || 'Not linked to a drawing');
  // the rest of its group first, then everything else still waiting
  const inGroup = [...group.slice(group.indexOf(d) + 1), ...group.slice(0, group.indexOf(d))];
  const rest = [...inGroup, ...ordered.flatMap(([, ds]) => ds).filter((x) => x !== d && !inGroup.includes(x))].map((x) => x.id);
  startPlacing(d, rest);
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
        <label class="field"><span>${esc(kitOf(kindNow).item)} type</span><select name="doorType" id="b-type">${opts(kt(), 'No type')}</select></label>
        <label class="field"><span>Leaf / swing</span><select name="leaf" id="b-leaf">${opts(LEAF_CONFIGS.filter(Boolean), 'Not set')}</select></label>
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
    banner.innerHTML = `<span>Tap to add</span><button type="button" class="kind-chip kind-pick ${kcls(planKind)}" id="add-kind" aria-label="New pin type: ${esc(kitOf(planKind).name)}. Tap to change">${esc(kitOf(planKind).name)} ${icon('down')}</button><button class="btn sm" id="cancel-mode">Cancel</button>`;
    add.classList.add('is-on');
    add.innerHTML = `${icon('close')} Cancel`;
  } else if (m === 'move') {
    banner.hidden = false;
    banner.innerHTML = `<span>Drag the pin, or tap its new position</span><button class="btn sm" id="cancel-mode">Done</button>`;
  } else if (m === 'place') {
    banner.hidden = false;
    banner.innerHTML = `<span>Tap where <b>${esc(placingLabel)}</b> is${placingQueue.length ? ` <small>(${placingQueue.length} more after)</small>` : ''}</span>${placingQueue.length ? '<button class="btn sm" id="place-skip">Skip</button>' : ''}<button class="btn sm" id="cancel-mode">${placingQueue.length ? 'Stop' : 'Cancel'}</button>`;
  } else if (m === 'hint') {
    banner.hidden = false;
    banner.innerHTML = `<span>Tip: press and hold a pin to drag it</span><button class="btn sm" id="cancel-mode">OK</button>`;
  } else {
    banner.hidden = true;
    add.classList.remove('is-on');
    add.innerHTML = `${icon('pin')} Add ${esc(kitOf(planKind).item.toLowerCase())}`;
  }
  $('#cancel-mode')?.addEventListener('click', () => { placingQueue = []; placingId = null; setMode(null); });
  $('#place-skip')?.addEventListener('click', () => placeNextInQueue());
  // change the type for new pins right here; pins already placed are not touched
  $('#add-kind')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const k = await pickKind('What are you adding?', planKind);
    if (!k || k === planKind) return;
    const pl = await db.get('plans', state.planId);
    // existing pins keep their own type
    for (const d of await db.byIndex('doors', 'planId', pl.id)) if (!d.kind) await db.put('doors', { ...d, kind: kindOfPlan(pl) });
    await db.put('plans', { ...pl, inspType: k });
    planKind = k;
    kindNow = k;
    setMode('add');
    toast(`New pins: ${kitOf(k).name.toLowerCase()}`);
  });
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
    if (placingQueue.length) await placeNextInQueue();
    return;
  }
  if (mode === 'add') {
    const pinNo = await db.nextPinNo(state.projectId);
    const ref = nextFreeRef(await db.projectDoors(state.projectId));
    const door = await saveDoor({
      id: db.uid(), projectId: state.projectId, planId: state.planId, pinNo, x, y, kind: planKind,
      ref, location: '', doorType: '', leaf: '', status: 'not_inspected', defects: [], actions: [], checks: {}, materials: [], notes: '',
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
    : `${planColl ? collLabel(planColl) + ' · ' : ''}${doors.length} pin${doors.length === 1 ? "" : "s"} · ${c.fail || 0} ${statusById.fail.short.toLowerCase()} · ${c.not_inspected || 0} to do`;
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
  const sheetKey = state.doorId + (state.repair ? '|r' : '');
  if (sheetDoorId === sheetKey) return;
  if (sheetDoorId) await flushSave();
  sheetDoorId = sheetKey;
  const door = await db.get('doors', state.doorId);
  if (!door) {
    sheetDoorId = null;
    return back();
  }
  document.body.classList.add('sheet-open');
  sheetRoot.innerHTML = `<div class="sheet-backdrop" id="sheet-bd"></div><section class="sheet ${state.repair ? 'is-repair' : ''}" role="dialog" aria-label="${state.repair ? 'Repairs' : 'Door record'}" id="sheet"></section>`;
  $('#sheet-bd').onclick = () => back();
  if (state.repair) await drawRepairSheet(door);
  else await drawSheet(door);
  if (state.view === 'plan') refreshPins();
}

async function drawSheet(door) {
  const el = $('#sheet');
  const plan = await db.get('plans', door.planId);
  kindNow = kindOfDoor(door, plan);
  const K = kitOf(kindNow);
  useScheme(await db.get('projects', door.projectId));
  const s = statusById[door.status || 'not_inspected'];
  const types = [...new Set([...(kt() || []), door.doorType].filter(Boolean))];
  // pass / fail comes from the checklist and defects (unless switched off in
  // Settings, or no checklist is set up)
  const autoRes = lists.autoResult !== false && questionsFor(door, kq() || []).length > 0;
  // fire alarm zones already used on this project: number → name
  const project = await db.get('projects', door.projectId);
  siteProject = project;
  siteColl = doorColl(door, plan);
  const freq = Number(project?.frequency) || 0;
  const zoneMap = new Map((project?.zones || []).filter((z) => z.no).map((z) => [String(z.no), z.name || '']));
  for (const x of await db.byIndex('doors', 'projectId', door.projectId)) {
    if (x.zoneNo && !zoneMap.get(x.zoneNo)) zoneMap.set(x.zoneNo, x.zoneName || '');
  }
  const zones = [...zoneMap.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  el.innerHTML = `
    <div class="sheet-grip" aria-hidden="true"></div>
    <header class="sheet-head">
      <span class="pin-badge lg ${s.id === 'not_inspected' ? 'is-hollow' : ''}" id="sh-badge" style="--pin:${s.color}">${door.pinNo}</span>
      <div class="sheet-title"><b id="sh-title">${esc(door.ref || K.item + ' ' + door.pinNo)}</b><small><button type="button" class="kind-chip kind-pick ${kcls(kindNow)}" id="sh-kind" aria-label="Inspection type: ${esc(K.name)}. Tap to change">${esc(K.name)} ${icon('down')}</button> ${esc(plan?.name || '')} <span id="saved" class="saved">Saved</span></small></div>
      <button class="icon-btn" id="sh-close" aria-label="Close">${icon('close')}</button>
    </header>
    <div class="sheet-body">
      ${door.planId ? `<button type="button" class="door-map" id="door-map" aria-label="Show on the drawing"><img alt="Where this door is on ${esc(plan?.name || 'the drawing')}" id="door-map-img"><span>${icon('plan')} ${esc(plan?.name || 'Drawing')} · tap to view</span></button>` : ''}
      <fieldset class="status-set" aria-label="Status">
        ${STATUSES.filter((st) => !autoRes || !['pass', 'fail'].includes(st.id)).map((st) => `<label class="status-opt" style="--c:${st.color}"><input type="radio" name="status" value="${st.id}" ${st.id === (door.status || 'not_inspected') ? 'checked' : ''}><span>${st.label}</span></label>`).join('')}
      </fieldset>
      ${autoRes ? '<p class="auto-res" id="auto-res"></p>' : ''}
      <div class="dup-row">
        <button type="button" class="btn" id="sh-dup">${icon('plus')} Duplicate here</button>
        <button type="button" class="btn" id="sh-copyto">${icon('plan')} Copy to drawing…</button>
        <button type="button" class="btn" id="sh-copyfrom">${icon('sheet')} Copy details from…</button>
      </div>

      <div class="grid2">
        <label class="field"><span>Pin ref / ID</span><input id="f-ref" data-k="ref" value="${esc(door.ref)}" placeholder="e.g. 001" autocomplete="off"></label>
        <label class="field"><span>Location / room</span><input id="f-location" data-k="location" value="${esc(door.location)}" placeholder="e.g. Bedroom 4" autocomplete="off"></label>
        <label class="field"><span>${esc(K.item)} type</span>
          <select id="f-type" data-k="doorType"><option value="">Select…</option>${(() => {
            const groups = [...new Set(types.map(doorTypeGroup))];
            const opt = (t) => `<option ${t === door.doorType ? 'selected' : ''}>${esc(t)}</option>`;
            return groups.length < 2 ? types.map(opt).join('') : groups.map((g) => `<optgroup label="${esc(g)}">${types.filter((t) => doorTypeGroup(t) === g).map(opt).join('')}</optgroup>`).join('');
          })()}</select>
          <small class="muted type-note" id="f-type-note">${esc(DOOR_TYPE_NOTES.find(([re]) => re.test(door.doorType || ''))?.[1] || '')}</small>
        </label>
        <label class="field" ${kitOf(kindNow).base === 'fd' ? '' : 'hidden'}><span>Leaf / swing</span>
          <select id="f-leaf" data-k="leaf">${LEAF_CONFIGS.map((t) => `<option value="${esc(t)}" ${t === (door.leaf || '') ? 'selected' : ''}>${esc(t || 'Select…')}</option>`).join('')}</select>
          <small class="muted type-note">SA = single action, DA = double action, SD = single door, DD = double door, RH / LH = right / left hand, BL = big leaf (unequal pair).</small>
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

      <section class="block rep-block" id="rep-block">
        <label class="field"><span>Replacement</span>
          <select id="f-repl">${REPLACEMENTS.map(([v, l]) => `<option value="${v}" ${v === (door.replacement || '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <div id="rep-fields"></div>
      </section>

      <section class="block">
        <div class="block-head"><h3>Inspection questions <span class="muted" id="q-n"></span></h3>
          <span class="row-btns">
            <button type="button" class="btn sm q-all q-all-pass" id="q-all-pass" aria-pressed="false" title="Set every question to ${esc(ANSWERS[0].label)}; tap again to undo">${icon('check')} All ${esc(ANSWERS[0].label)}</button>
            <button type="button" class="btn sm q-all q-all-fail" id="q-all-fail" aria-pressed="false" title="Set every question to ${esc(ANSWERS[1].label)}; tap again to undo">${icon('close')} All ${esc(ANSWERS[1].label)}</button>
            <button type="button" class="btn sm q-all q-rest-pass" id="q-rest-pass" aria-pressed="false" title="Answer only the unanswered questions ${esc(ANSWERS[0].label)}; tap again to undo">Rest ${esc(ANSWERS[0].label)}</button>
            <button type="button" class="btn sm q-all q-rest-fail" id="q-rest-fail" aria-pressed="false" title="Answer only the unanswered questions ${esc(ANSWERS[1].label)}; tap again to undo">Rest ${esc(ANSWERS[1].label)}</button>
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
        <p class="fill-note" id="cost-fails" hidden></p>
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
        <label class="field"><span>Next inspection due</span><input type="date" id="f-due" data-k="nextDue" value="${esc(door.nextDue || (freq && door.inspectedOn ? addMonths(door.inspectedOn, freq) : ''))}">${freq ? `<small class="muted">Auto: ${esc(freqText(freq).toLowerCase())} from the inspection date</small>` : ''}</label>
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
        <button class="btn ghost danger-text" id="sh-del">${icon('trash')} Delete ${esc(K.item.toLowerCase())}</button>
      </div>
    </div>`;

  // a due date shown but not yet stored (frequency set after this door was inspected)
  let current = freq && door.inspectedOn && !door.nextDue ? { ...door, nextDue: addMonths(door.inspectedOn, freq) } : door;
  let redrawDefects = null;
  // A failed checklist question adds its defect (and that defect's usual
  // product); answering it again as pass / N/A takes them back off.
  const syncChecks = (patch) => {
    const checks = patch.checks;
    const qs = kq() || [];
    let defects = [...(patch.defects || current.defects || [])];
    let mats = [...(patch.materials || current.materials || [])];
    let changed = false;
    for (const q of qs) {
      const label = q.defect || QUESTION_DEFECT[q.id];
      if (!label) continue;
      const failed = checks[q.id]?.answer === 'fail';
      const has = defects.find((x) => x.label === label);
      if (failed && !has) {
        const tmpl = (kd() || []).find((x) => x.label === label) || { label, remedial: '' };
        const nd = { label, remedial: tmpl.remedial || '', qty: 1, fromQ: q.id };
        defects.push(nd);
        mats.push(...defaultProductsFor(nd, mlist(), db.uid));
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
    if (freq && patch.inspectedOn && !('nextDue' in patch)) {
      patch = { ...patch, nextDue: addMonths(patch.inspectedOn, freq) };
      const due = $('#f-due');
      if (due) due.value = patch.nextDue;
    }
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
      const qs = questionsFor(merged, kq() || []);
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
  // A final exit door type brings its own checklist (panic EN 1125 / emergency EN 179)
  const switchForType = async (type) => {
    const k = /final exit.*panic/i.test(type) ? 'fdpanic' : /final exit.*emergency/i.test(type) ? 'fdemerg' : null;
    if (!k || k === kindNow || !kindIds().includes(k)) return;
    if ((current.status || 'not_inspected') !== 'not_inspected' || Object.keys(current.checks || {}).length) {
      if (!(await confirmBox('Switch to the final exit checklist?', `This is now a ${type.toLowerCase()} door. Switch pin ${door.pinNo} to the "${kitOf(k).name}" checklist? Answers already given are kept on the record.`, 'Switch checklist', false))) return;
    }
    queue({ kind: k });
    await flushSave();
    await drawSheet(await db.get('doors', door.id));
    if (state.view === 'plan') refreshPins();
    toast(`Checklist switched to ${kitOf(k).name}`);
  };
  $('#sh-kind').onclick = async () => {
    const k = await pickKind(`What is pin ${door.pinNo}?`, kindNow);
    if (!k || k === kindNow) return;
    if ((current.status || 'not_inspected') !== 'not_inspected' || Object.keys(current.checks || {}).length) {
      if (!(await confirmBox('Change this pin\'s type?', `This pin already has ${esc(K.name.toLowerCase())} answers. They are kept on the record, and the ${esc(kitOf(k).name.toLowerCase())} checks are added.`, 'Change type', false))) return;
    }
    queue({ kind: k });
    await flushSave();
    await drawSheet(await db.get('doors', door.id));
    if (state.view === 'plan') refreshPins();
  };
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
      if (inp.dataset.k === 'doorType' && $('#f-type-note')) $('#f-type-note').textContent = DOOR_TYPE_NOTES.find(([re]) => re.test(inp.value))?.[1] || '';
      if (inp.dataset.k === 'doorType') switchForType(inp.value);
      if (inp.dataset.k === 'ref') $('#sh-title').textContent = inp.value || K.item + ' ' + door.pinNo;
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
    const cats = cat === 'Ironmongery' ? ['Ironmongery', 'Hinges'] : [cat];
    return { cat, opts: mlist().filter((m) => m.name?.trim() && (!cat || cats.includes(matCat(m)))) };
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
              <div class="def-prod-row ${m.custom ? 'is-custom' : ''}" data-id="${esc(m.id)}">
                ${m.custom ? `<input class="dp-name dp-text" value="${esc(m.name || '')}" placeholder="Type the item, e.g. 100 mm stainless hinge" aria-label="Product">
                ${priced() ? `<span class="dp-cost-l"><label>Material €<input class="dp-cost" type="number" inputmode="decimal" min="0" step="any" value="${m.cost ? esc(m.cost) : ''}" placeholder="0.00"></label><label>Labour €<input class="dp-lab" type="number" inputmode="decimal" min="0" step="any" value="${m.labour ? esc(m.labour) : ''}" placeholder="0.00"></label></span>` : ''}`
                : `<select class="dp-name" aria-label="Product">
                  ${opts.map((o) => `<option value="${esc(o.id)}" ${o.name === m.name ? 'selected' : ''}>${esc(o.name)}${o.cost && priced() ? ' – ' + euro(o.cost) : ''}</option>`).join('')}
                  ${!opts.some((o) => o.name === m.name) ? `<option value="" selected>${esc(m.name)}</option>` : ''}
                </select>`}
                <span class="stepper"><button type="button" class="dp-minus" aria-label="One fewer">−</button><input class="dp-qty" type="number" inputmode="decimal" min="0" step="any" value="${esc(m.qty ?? 1)}" aria-label="Quantity"><button type="button" class="dp-plus" aria-label="One more">+</button></span>
                <input class="dp-spec" value="${esc(m.spec || '')}" placeholder="${cat === 'Signs' ? 'e.g. push side' : 'note, e.g. head + hinge side'}" aria-label="Note">
                <button class="icon-btn sm dp-del" aria-label="Remove product">${icon('close')}</button>
              </div>`).join('')}
            <div class="dp-btns">
              ${opts.length ? `<button type="button" class="btn sm dp-pick">${icon('list')} Pick products${cat ? ' (' + esc(cat.toLowerCase()) + ')' : ''}</button>` : ''}
              <button type="button" class="btn ghost sm dp-add">${icon('plus')} ${linked.length ? 'Add another product' : 'Add your own product'}</button>
            </div>
          </div>
        </div>`;
      }).join('')
      : '<p class="muted small">No defects recorded.</p>';
    const setMat = (id, patch) => queue({ materials: current.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
    // A typed-in product joins the price list (Settings › Products) so it can be
    // picked on any site from now on; later edits on this line update that entry.
    const rememberProduct = async (id) => {
      const m = (current.materials || []).find((x) => x.id === id);
      const name = (m?.name || '').trim();
      if (!m || !name) return;
      const all = lists.materials || [];
      const own = m.libId && all.find((x) => x.id === m.libId);
      const same = all.find((x) => (x.name || '').trim().toLowerCase() === name.toLowerCase());
      if (own) {
        if (own.name === name && (Number(own.cost) || 0) === (Number(m.cost) || 0) && (Number(own.labour) || 0) === (Number(m.labour) || 0)) return;
        if (same && same.id !== own.id) return; // renamed to an item that already exists: leave the list alone
        await saveLists({ materials: all.map((x) => (x.id === own.id ? { ...x, name, cost: Number(m.cost) || x.cost || 0, labour: Number(m.labour) || 0 } : x)) });
        return;
      }
      if (same) { setMat(id, { libId: same.id }); return; }
      const item = { id: db.uid(), cat: m.cat && m.cat !== 'Other' ? m.cat : matCat({ name }), name, unit: m.unit || 'each', cost: Number(m.cost) || 0, labour: Number(m.labour) || 0 };
      await saveLists({ materials: [...all, item] });
      setMat(id, { libId: item.id });
      toast(`"${name}" saved to your products, ready to pick on any site`);
    };
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
        const { cat } = prodOptions(d);
        queue({ materials: [...(current.materials || []), { id: db.uid(), custom: true, name: '', unit: 'each', cost: 0, qty: 1, cat: cat || 'Other', forKey: key, spec: '' }] });
        drawDefects();
        $$('.dp-text', $$('.defect', el)[i]).at(-1)?.focus();
      });
      // tick several products at once, each with its quantity
      $('.dp-pick', row)?.addEventListener('click', async () => {
        const { cat, opts } = prodOptions(d);
        const optNames = new Set(opts.map((o) => o.name.trim().toLowerCase()));
        const mine = (current.materials || []).filter((m) => m.forKey === key && (!m.custom || optNames.has((m.name || '').trim().toLowerCase())));
        const groups = [...new Set(opts.map((o) => matCat(o)))].sort((x, y) => (y === cat) - (x === cat));
        const r = await dialog({
          title: `Products for: ${d.label}`,
          body: `<p class="small muted">Tick everything this fault needs and set the quantities. Untick to take a product off.</p>
            ${groups.map((g) => `${groups.length > 1 ? `<h3 class="pp-h">${esc(g)}</h3>` : ''}<div class="pp-list">
              ${opts.map((o, j) => [o, j]).filter(([o]) => matCat(o) === g).map(([o, j]) => {
                const have = mine.find((m) => m.name.trim().toLowerCase() === o.name.trim().toLowerCase());
                return `<label class="pp-row"><input type="checkbox" name="c${j}" ${have ? 'checked' : ''}>
                  <span><b>${esc(o.name)}</b>${priced() && o.cost ? `<small>${euro(o.cost)} ${esc(o.unit && o.unit !== 'each' ? 'per ' + o.unit : 'each')}</small>` : ''}</span>
                  <span class="stepper pp-step"><button type="button" class="pp-minus" aria-label="One fewer">−</button><input class="pp-qty" type="number" inputmode="decimal" min="0" step="any" name="q${j}" value="${esc(have ? have.qty ?? 1 : 1)}" aria-label="Quantity"><button type="button" class="pp-plus" aria-label="One more">+</button></span></label>`;
              }).join('')}</div>`).join('')}`,
          buttons: [{ label: 'Cancel', value: false }, { label: 'Done', value: true, kind: 'primary' }],
          onOpen: (form) => {
            // typing a quantity ticks the product
            $$('.pp-qty', form).forEach((q) => q.addEventListener('input', () => { q.closest('.pp-row').querySelector('input[type=checkbox]').checked = Number(q.value) > 0; }));
            $$('.pp-minus, .pp-plus', form).forEach((b) => b.addEventListener('click', (e) => {
              e.preventDefault();
              const row = b.closest('.pp-row');
              const q = row.querySelector('.pp-qty');
              const box = row.querySelector('input[type=checkbox]');
              const was = Number(q.value) || 0;
              // the first + on an unticked product just ticks it at its quantity
              const next = b.classList.contains('pp-plus') ? (box.checked ? was + 1 : Math.max(1, was)) : Math.max(0, was - 1);
              q.value = next;
              box.checked = next > 0;
            }));
          },
        });
        if (r.value !== true) return;
        const keepOthers = (current.materials || []).filter((m) => m.forKey !== key);
        const typed = (current.materials || []).filter((m) => m.forKey === key && m.custom && !optNames.has((m.name || '').trim().toLowerCase()));
        const chosen = opts.map((o, j) => [o, j]).filter(([, j]) => r.data['c' + j] && Number(r.data['q' + j]) > 0).map(([o, j]) => {
          const have = mine.find((m) => m.name.trim().toLowerCase() === o.name.trim().toLowerCase());
          return { ...(have || { id: db.uid(), spec: '' }), name: o.name, unit: o.unit || 'each', cost: Number(o.cost) || 0, labour: Number(o.labour) || 0, cat: matCat(o), forKey: key, qty: Number(r.data['q' + j]) };
        });
        queue({ materials: [...keepOthers, ...chosen, ...typed] });
        drawDefects();
        drawMaterials();
        toast(`${chosen.length} product${chosen.length === 1 ? '' : 's'} on this fault`);
      });
      $$('.def-prod-row', row).forEach((pr) => {
        const id = pr.dataset.id;
        const qty = $('.dp-qty', pr);
        const setQty = (n) => { qty.value = Math.max(0, Math.round(n * 100) / 100); setMat(id, { qty: Number(qty.value) }); drawMaterials(); };
        qty.oninput = () => { setMat(id, { qty: Number(qty.value) || 0 }); drawMaterials(); };
        $('.dp-minus', pr).onclick = () => setQty((Number(qty.value) || 0) - 1);
        $('.dp-plus', pr).onclick = () => setQty((Number(qty.value) || 0) + 1);
        if (pr.classList.contains('is-custom')) {
          const nm = $('.dp-name', pr);
          nm.oninput = () => { setMat(id, { name: nm.value }); drawMaterials(); };
          // an empty free-text line is dropped when you leave it
          nm.onblur = () => setTimeout(() => {
            if (!nm.value.trim() && !pr.contains(document.activeElement)) { queue({ materials: current.materials.filter((m) => m.id !== id) }); drawDefects(); drawMaterials(); return; }
            rememberProduct(id);
          }, 150);
          $('.dp-cost', pr)?.addEventListener('input', (e) => { setMat(id, { cost: Number(e.target.value) || 0 }); drawMaterials(); });
          $('.dp-cost', pr)?.addEventListener('change', () => rememberProduct(id));
          $('.dp-lab', pr)?.addEventListener('input', (e) => { setMat(id, { labour: Number(e.target.value) || 0 }); drawMaterials(); });
          $('.dp-lab', pr)?.addEventListener('change', () => rememberProduct(id));
        } else {
          $('.dp-name', pr).onchange = (e) => {
            const o = mlist().find((x) => x.id === e.target.value);
            if (o) { setMat(id, { name: o.name, unit: o.unit || 'each', cost: Number(o.cost) || 0, labour: Number(o.labour) || 0, cat: matCat(o) }); drawMaterials(); }
          };
        }
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
    const patch = { defects, materials: [...(current.materials || []), ...fresh.flatMap((d) => defaultProductsFor(d, mlist(), db.uid))] };
    if (picked.length) autoFail(patch);
    queue(patch);
    drawDefects();
    drawMaterials();
  };
  redrawDefects = () => { drawDefects(); drawMaterials(); showFill?.(); };

  // inspection questions
  let arranging = false;
  const openNotes = new Set(); // questions with their note box open
  const drawQuestions = () => {
    if (!$('#questions')) return;
    const qs = questionsFor(current, kq() || []);
    const checks = current.checks || {};
    const answered = qs.filter((q) => checks[q.id]?.answer).length;
    const fails = qs.filter((q) => checks[q.id]?.answer === 'fail').length;
    $('#q-n').textContent = qs.length ? `(${answered}/${qs.length}${fails ? ` · ${fails} fail` : ''})` : '';
    // All … toggles light up when every answer matches; Rest N/A while the
    // questions it filled are still N/A
    const allAre = (a) => qs.length > 0 && qs.every((q) => checks[q.id]?.answer === a);
    const memo = restMemo.get(door.id);
    for (const [id, on] of [['#q-all-pass', allAre('pass')], ['#q-all-fail', allAre('fail')], ['#q-rest-pass', !!(memo && memo.answer === 'pass' && restStillSet(memo))], ['#q-rest-fail', !!(memo && memo.answer === 'fail' && restStillSet(memo))], ['#q-rest-na', !!(memo && memo.answer === 'na' && restStillSet(memo))]]) {
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
    go({ view: 'settings', focus: 's-qs', setKind: kindNow });
  };
  // All No action / All Action: set every question; tap the same one again to
  // put the answers back as they were, or tap the other to switch across.
  let beforeAll = null;
  const toggleAll = (answer) => {
    const qs = questionsFor(current, kq() || []);
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
    const qs = questionsFor(current, kq() || []);
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
  $('#q-rest-pass').onclick = () => toggleRest('pass');
  $('#q-rest-fail').onclick = () => toggleRest('fail');

  // Arrange: show / hide each question and slide them into your order.
  // This changes the question list used for every door.
  const drawArrange = () => {
    const list = (kq() || []).filter((q) => q.text?.trim());
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
      const byId = Object.fromEntries((kq() || []).map((q) => [q.id, q]));
      const rest = (kq() || []).filter((q) => !ids.includes(q.id));
      await saveKit({ questions: [...ids.map((id) => byId[id]).filter(Boolean), ...rest] });
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
        await saveKit({ questions: kq().map((q) => (q.id === id ? { ...q, hidden: !q.hidden } : q)) });
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
            <label class="field money-f"><span>Material €</span><input type="number" inputmode="decimal" min="0" step="0.01" class="mat-cost" id="mat-cost-${i}" value="${esc(m.cost ?? 0)}"></label>
            <label class="field money-f"><span>Labour €</span><input type="number" inputmode="decimal" min="0" step="0.01" class="mat-lab" id="mat-lab-${i}" value="${esc(m.labour ?? 0)}"></label>
            <div class="mat-line"><span>Line</span><b class="mat-total">${euro((Number(m.qty) || 0) * ((Number(m.cost) || 0) + (Number(m.labour) || 0)))}</b></div>
          </div>
        </div>`).join('') + `<div class="mat-sum mat-sum3"><span>Materials <b id="mat-sum">${euro(materialsTotal(current))}</b></span><span>Labour <b id="lab-sum">${euro(labourTotal(current))}</b></span><span>Total <small class="muted">ex VAT, before margin</small> <b id="all-sum">${euro(materialsTotal(current) + labourTotal(current))}</b></span></div>`
      : '<p class="muted small">No materials added.</p>';
    $$('.mat', el).forEach((row) => {
      const i = Number(row.dataset.i);
      const upd = () => {
        const materials = current.materials.map((m, j) => (j === i ? { ...m, qty: Number($('.mat-qty', row).value) || 0, cost: Number($('.mat-cost', row).value) || 0, labour: Number($('.mat-lab', row).value) || 0 } : m));
        queue({ materials });
        const m = materials[i];
        $('.mat-total', row).textContent = euro(m.qty * (m.cost + m.labour));
        $('#mat-sum').textContent = euro(materialsTotal(current));
        $('#lab-sum').textContent = euro(labourTotal(current));
        $('#all-sum').textContent = euro(materialsTotal(current) + labourTotal(current));
      };
      $('.mat-qty', row).oninput = upd;
      $('.mat-cost', row).oninput = upd;
      $('.mat-lab', row).oninput = upd;
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
    const u = uncostedFails(current, kq() || [], mlist());
    const b = $('#fill-mats');
    b.hidden = !u.count;
    b.innerHTML = `${icon('check')} Cost all fails (${u.count})`;
    const n = $('#cost-fails');
    n.hidden = !u.count;
    n.innerHTML = u.count ? `${icon('sheet')}<span>${[u.qs.length ? `${u.qs.length} failed check${u.qs.length > 1 ? 's have' : ' has'} no defect` : '', u.defs.length ? `${u.defs.length} defect${u.defs.length > 1 ? 's have' : ' has'} no product` : ''].filter(Boolean).join(' and ')}, so ${u.count > 1 ? "they're" : "it's"} not on the repairs or pricing yet. <button type="button" class="link-btn cost-fails-btn">Cost all fails</button></span>` : '';
    $('.cost-fails-btn', n)?.addEventListener('click', costFails);
  };
  const costFails = () => {
    const r = costAllFails(current, kq() || [], kd() || [], mlist(), db.uid);
    queue({ defects: r.defects, materials: r.materials });
    drawDefects();
    drawMaterials();
    showFill();
    toast([r.addedDefects ? `${r.addedDefects} defect${r.addedDefects > 1 ? 's' : ''}` : '', r.addedProducts ? `${r.addedProducts} product${r.addedProducts > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ') + ' added');
  };
  showFill();
  $('#fill-mats').onclick = costFails;
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
  $('#sh-copyto').onclick = () => duplicateDoor(current, { other: true });

  // Replacement: one drop-down; choosing a replacement opens its fields
  const drawRep = () => {
    const box = $('#rep-fields');
    if (!box) return;
    const secs = sectionsFor(lists.fieldSections || DEFAULT_FIELD_SECTIONS, current, kitOf(kindNow), kindNow);
    $('#rep-block').hidden = !kitOf(kindNow).base && !secs.length && !(lists.fieldSections || []).some((sc) => sc.when === 'replacement' && (!sc.base || kitOf(kindNow).base === sc.base || kindNow === sc.base));
    const a = current.attrs || {};
    const fieldHtml = (f) => {
      const v = a[f.id] ?? '';
      const id = `fa-${f.id}`;
      if (f.type === 'number') return `<label class="field"><span>${esc(f.label)}</span><span class="unit-in"><input id="${id}" data-attr="${f.id}" data-type="number" inputmode="decimal" value="${esc(v)}" autocomplete="off">${f.unit ? `<em>${esc(f.unit)}</em>` : ''}</span></label>`;
      if (f.type === 'yesno') return `<label class="field"><span>${esc(f.label)}</span><select id="${id}" data-attr="${f.id}"><option value=""></option><option value="yes" ${v === 'yes' ? 'selected' : ''}>Yes</option><option value="no" ${v === 'no' ? 'selected' : ''}>No</option></select></label>`;
      if (f.type === 'list') {
        const opts = [...(f.options || [])];
        const own = v !== '' && !opts.includes(v);
        return `<label class="field"><span>${esc(f.label)}</span><select id="${id}" data-attr="${f.id}" data-list="1"><option value="">Select…</option>${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}${own ? `<option selected>${esc(v)}</option>` : ''}${f.own ? '<option value="__own">Type your own…</option>' : ''}</select></label>`;
      }
      return f.long
        ? `<label class="field span2"><span>${esc(f.label)}</span><textarea id="${id}" data-attr="${f.id}" rows="2" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea></label>`
        : `<label class="field"><span>${esc(f.label)}</span><input id="${id}" data-attr="${f.id}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" autocomplete="off"></label>`;
    };
    box.innerHTML = secs.map((sc) => `
      <div class="rep-sec">
        <h4>${esc(sc.name)}</h4>
        ${sc.when === 'replacement' ? `<p class="rep-auto"><span>Rating <b>${esc(ratingOf(current) || 'set the door type')}</b></span><span>Swing <b>${esc(swingOf(current) || 'set leaf / swing')}</b></span><span>Supply <b>${esc(SUPPLY[current.replacement] || '')}</b></span></p>` : ''}
        <div class="grid2">${sc.fields.map(fieldHtml).join('')}</div>
        ${sc.when === 'replacement' ? '<button type="button" class="btn sm" id="rep-copy">Copy sizes from another door…</button>' : ''}
      </div>`).join('');
    $$('[data-attr]', box).forEach((inp) => {
      const ev = inp.tagName === 'SELECT' ? 'change' : 'input';
      inp.addEventListener(ev, async () => {
        let val = inp.value;
        if (val === '__own') {
          const r = await dialog({ title: 'Type your own', body: `<label class="field"><span>${esc(inp.closest('.field').querySelector('span').textContent)}</span><input name="v" required autocomplete="off"></label>`, buttons: [{ label: 'Cancel', value: false }, { label: 'Use this', value: true, kind: 'primary' }] });
          if (r.value !== true || !r.data.v.trim()) return drawRep();
          val = r.data.v.trim();
        }
        if (inp.dataset.type === 'number') val = val.trim() === '' ? '' : Number.isFinite(Number(val)) ? Number(val) : val;
        const attrs = { ...(current.attrs || {}) };
        if (val === '') delete attrs[inp.dataset.attr];
        else attrs[inp.dataset.attr] = val;
        queue({ attrs });
        if (inp.dataset.list || inp.value === '__own') drawRep();
      });
    });
    $('#rep-copy')?.addEventListener('click', async () => {
      await flushSave();
      const all = (await db.projectDoors(current.projectId)).filter((d) => d.id !== current.id && Object.keys(d.attrs || {}).length);
      if (!all.length) return toast('No other door in this project has replacement details yet.');
      const r = await dialog({
        title: 'Copy sizes from another door',
        body: `<p class="small">Copies every replacement field (sizes, undercut, finish, seals, glazing, lock…). Anything already typed here is replaced.</p>
          <label class="field"><span>Copy from</span><select name="src">${all.sort((x, y) => (x.pinNo || 0) - (y.pinNo || 0)).map((d) => `<option value="${d.id}">${esc([d.ref || `Pin ${d.pinNo}`, d.location, d.attrs?.h && d.attrs?.w ? `${d.attrs.h} × ${d.attrs.w}` : ''].filter(Boolean).join(' · '))}</option>`).join('')}</select></label>`,
        buttons: [{ label: 'Cancel', value: false }, { label: 'Copy', value: true, kind: 'primary' }],
      });
      if (r.value !== true) return;
      const src = all.find((d) => d.id === r.data.src);
      queue({ attrs: { ...(src.attrs || {}) }, replacement: current.replacement || src.replacement || 'df' });
      drawRep();
      toast(`Copied from ${src.ref || 'pin ' + src.pinNo}`);
    });
  };
  $('#f-repl').onchange = (e) => {
    queue({ replacement: e.target.value });
    drawRep();
    if (state.view === 'plan') refreshPins?.();
  };
  ['#f-type', '#f-leaf'].forEach((sel) => $(sel)?.addEventListener('change', () => setTimeout(drawRep, 0)));
  drawRep();
  $('#sh-copyfrom').onclick = async () => {
    await flushSave();
    const changed = await copyDetailsFrom(await db.get('doors', door.id));
    if (changed) {
      await drawSheet(changed);
      if (state.view === 'plan') refreshPins();
    }
  };
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
// Pin ref / ID is always a number: 001, 002 … the next after the highest on the site
function nextFreeRef(all) {
  const refs = all.map((d) => (d.ref || '').trim());
  const used = new Set(refs);
  let n = refs.reduce((m, r) => (/^\d+$/.test(r) ? Math.max(m, Number(r)) : m), 0) + 1;
  while (used.has(String(n).padStart(3, '0'))) n++;
  return String(n).padStart(3, '0');
}
async function duplicateDoor(src, { other = false } = {}) {
  await flushSave();
  const d0 = (await db.get('doors', src.id)) || src;
  const all = await db.projectDoors(d0.projectId);
  const suggest = nextFreeRef(all);
  const plans = (await db.projectPlans(d0.projectId)).filter((pl) => pl.id !== d0.planId).sort((a, b) => (a.collection || '').localeCompare(b.collection || '') || (a.order || 0) - (b.order || 0));
  if (other && !plans.length) return toast('There is no other drawing in this project to copy to. Upload one first.');
  const planOpts = plans.map((pl) => `<option value="${pl.id}">${esc([pl.collection, pl.name].filter(Boolean).join(' › '))}</option>`).join('');
  const item = kitOf(kindOfDoor(d0, await db.get('plans', d0.planId))).item.toLowerCase();
  const r = await dialog({
    title: other ? `Copy ${item} to another drawing` : `Duplicate ${item}`,
    body: `<p>Makes a new pin ${other ? 'on the drawing you pick' : `next to pin ${d0.pinNo}`} with the same details as pin ${d0.pinNo}: status, checklist, defects and products, actions, signs and notes. Photos are not copied.</p>
      ${other ? `<label class="field"><span>Copy to drawing</span><select name="plan">${planOpts}</select><small class="muted">It lands in the same spot on that drawing; press and hold the pin to drag it into place.</small></label>` : ''}
      <label class="field"><span>New pin ref / ID</span><input name="ref" value="${esc(suggest)}" required autocomplete="off"></label>
      <label class="field"><span>Location / room</span><input name="location" value="${esc(d0.location || '')}" autocomplete="off"></label>
      `,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Duplicate', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return;
  const toPlan = other ? plans.find((pl) => pl.id === r.data.plan) || null : null;
  const moved = !!toPlan;
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
    ...(moved ? { planId: toPlan.id } : {}),
    x: moved ? d0.x : shift(d0.x, 0.03),
    y: moved ? d0.y : shift(d0.y, 0.03),
    materials: (clone.materials || []).map((m) => ({ ...m, id: db.uid() })),
  }, [`Copied from pin ${d0.pinNo}${d0.ref ? ' (' + d0.ref + ')' : ''}`]);
  if (state.view === 'plan' && !moved) pushUndo(`Pin ${pinNo} added`, () => db.deleteDoor(copy.id));
  toast(`Pin ${pinNo} ${copy.ref ? '(' + copy.ref + ') ' : ''}created${moved ? ` on ${toPlan.name}` : ''}. Drag it into place if needed`);
  if (moved) go({ view: 'plan', projectId: d0.projectId, planId: toPlan.id, doorId: copy.id });
  else go({ ...state, doorId: copy.id }, { replace: true });
}

// Copy the details of another door (any drawing in the project) onto this one.
// Keeps this pin's number, ref, place on the drawing and its photos.
async function copyDetailsFrom(target) {
  const all = (await db.projectDoors(target.projectId)).filter((d) => d.id !== target.id);
  if (!all.length) return toast('There are no other pins in this project to copy from.'), null;
  const plans = Object.fromEntries((await db.projectPlans(target.projectId)).map((pl) => [pl.id, pl]));
  const byPlan = new Map();
  for (const d of all.sort((a, b) => (a.pinNo || 0) - (b.pinNo || 0))) {
    const k = d.planId || '';
    if (!byPlan.has(k)) byPlan.set(k, []);
    byPlan.get(k).push(d);
  }
  const groups = [...byPlan.entries()].sort(([a], [b]) => (a === target.planId ? -1 : b === target.planId ? 1 : 0));
  const opt = (d) => `<option value="${d.id}">${esc([d.ref || `Pin ${d.pinNo}`, d.location, d.doorType].filter(Boolean).join(' · '))}</option>`;
  const has = (target.status && target.status !== 'not_inspected') || Object.keys(target.checks || {}).length || (target.defects || []).length;
  const r = await dialog({
    title: 'Copy details from another pin',
    body: `<p>Copies the door type, leaf / swing, status, checklist answers and notes, defects, products, actions, signs and notes onto pin ${target.pinNo}. This pin keeps its own ref, place on the drawing and photos.</p>
      <label class="field"><span>Copy from</span><select name="src">${groups.map(([pid, ds]) => `<optgroup label="${esc(plans[pid] ? [plans[pid].collection, plans[pid].name].filter(Boolean).join(' › ') + (pid === target.planId ? ' (this drawing)' : '') : 'No drawing')}">${ds.map(opt).join('')}</optgroup>`).join('')}</select></label>
      <label class="check-line"><input type="checkbox" name="loc" ${target.location ? '' : 'checked'}> Copy the location / room too</label>
      ${has ? '<p class="muted small">This pin already has answers; they will be replaced. You can undo from the door history.</p>' : ''}`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Copy details', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return null;
  const src = all.find((d) => d.id === r.data.src);
  if (!src) return null;
  const keep = ['id', 'projectId', 'planId', 'pinNo', 'ref', 'x', 'y', 'log', 'history', 'remedials', 'gps', 'createdAt', 'updatedAt', 'dirty', 'location'];
  const clone = JSON.parse(JSON.stringify(src));
  for (const k of keep) delete clone[k];
  const next = {
    ...target,
    ...clone,
    location: r.data.loc ? src.location || '' : target.location,
    materials: (clone.materials || []).map((m) => ({ ...m, id: db.uid() })),
  };
  const saved = await saveDoor(next, [`Details copied from pin ${src.pinNo}${src.ref ? ' (' + src.ref + ')' : ''}`]);
  toast(`Details copied from ${src.ref || 'pin ' + src.pinNo}`);
  return saved || (await db.get('doors', target.id));
}

// Whole project: give every defect that has no products its usual product
async function fillProjectMaterials(doors) {
  let added = 0;
  let nDoors = 0;
  for (const d0 of doors) {
    const d = await db.get('doors', d0.id);
    if (!d) continue;
    const K = kitOf(kindOfDoor(d, await db.get('plans', d.planId)));
    const dPlan = await db.get('plans', d.planId);
    const r = costAllFails(d, K.questions, K.defects, siteMaterials(await db.get('projects', d.projectId), doorColl(d, dPlan)), db.uid);
    if (!r.addedDefects && !r.addedProducts) continue;
    await saveDoor({ ...d, defects: r.defects, materials: r.materials }, [`Fails costed: ${r.addedDefects} defect(s), ${r.addedProducts} product(s) added`]);
    added += r.addedDefects + r.addedProducts;
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
        ${(kd() || []).map((d, i) => `
          <label class="pick ${have.has(d.label) ? 'is-had' : ''}">
            <input type="checkbox" name="d${i}" value="${i}" ${have.has(d.label) ? 'disabled' : ''}>
            <span class="hc"><b>${esc(d.label)}</b><small>${esc(d.remedial)}</small></span>
          </label>`).join('')}
      </div>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Add selected', value: true, kind: 'primary' }],
  });
  if (r.value !== true) return null;
  const picked = Object.entries(r.data).filter(([k]) => k.startsWith('d')).map(([, v]) => kd()[Number(v)]);
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
        ${mlist().map((m, i) => ({ m, i })).sort((a, b) => MAT_CATEGORIES.indexOf(matCat(a.m)) - MAT_CATEGORIES.indexOf(matCat(b.m))).map(({ m, i }, k, arr) => !m.name?.trim() ? "" : `
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
    const m = mlist()[Number(v)];
    return { id: db.uid(), name: m.name, unit: m.unit || '', qty: 1, cost: Number(m.cost) || 0, labour: Number(m.labour) || 0, cat: matCat(m) };
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
          ${h.ref ? `<dt>Pin ref</dt><dd>${esc(h.ref)}</dd>` : ''}
          ${h.location ? `<dt>Location</dt><dd>${esc(h.location)}</dd>` : ''}
          ${h.doorType ? `<dt>Door type</dt><dd>${esc(h.doorType)}</dd>` : ''}
          <dt>Checklist</dt><dd>${answered.length ? `${answered.length} answered${fails.length ? `, failed: ${fails.map((c) => esc(c.text)).join('; ')}` : ', none failed'}` : 'Not answered'}</dd>
          <dt>Defects</dt><dd class="hc">${(h.defects || []).length ? h.defects.map((x) => `<b>${esc(x.label)}</b>${x.remedial ? ' – ' + esc(x.remedial) : ''}`).join('<br>') : 'None'}</dd>
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
const openFolds = new Set(['qs']);
// Which product categories belong to each inspection type (Labour and Other show for all)
const KIND_CATS = {
  fd: ['Seals', 'Closers', 'Hinges', 'Ironmongery', 'Hold-open', 'Signs', 'Glazing', 'Fire stopping', 'Timber & repairs'],
  dampers: ['Dampers', 'Fire stopping'],
  alarm: ['Fire alarm'],
  emlight: ['Emergency lighting'],
  ext: ['Extinguishers', 'Signs'],
};
async function renderSettings() {
  kindNow = state.setKind || 'fd';
  const est = await db.storageEstimate();
  const projects = await db.all('projects');
  app.innerHTML = `
    <header class="bar">
      <button class="icon-btn" id="back" aria-label="Back">${icon('back')}</button>
      <div class="bar-title"><b>Settings</b><small>Lists and backups</small></div>
      <span></span>
    </header>
    <main class="page">
      <div class="set-group"><h2>Inspection checks</h2><p class="muted small">Pick a type, then edit its questions, item types, defects and prices. Tap a heading to open or close it.</p></div>
      <section class="panel kind-panel">
        <label class="field kind-select"><span>Inspection type</span>
          <select id="s-kind">${kindIds().map((k) => `<option value="${k}" ${k === kindNow ? 'selected' : ''}>${esc(kitOf(k).name)}</option>`).join('')}</select></label>
        <p class="muted small">The questions, ${esc(kitOf(kindNow).item.toLowerCase())} types, defects and products below are for <b>${esc(kitOf(kindNow).name.toLowerCase())}</b> only. Each drawing's type is set from its label on the Plans tab.</p>
        <div class="row-btns"><button type="button" class="btn sm" id="s-kit-new">${icon('plus')} New checklist from this one</button>
          <label class="btn sm">${icon('upload')} Import checklist<input type="file" id="s-kit-import" accept=".pdf,.xlsx,.xls,.csv,.txt,.json,application/pdf" hidden></label>
          <button type="button" class="btn ghost sm" id="s-kit-dl">${icon('download')} Download this checklist</button>
          ${templateOf(kindNow) ? `<button type="button" class="btn ghost sm danger-text" id="s-kit-del">${icon('trash')} Remove this checklist</button>` : ''}</div>
        ${templateOf(kindNow) ? `<label class="field"><span>Checklist name</span><input id="s-kname" value="${esc(kitOf(kindNow).name)}"></label>` : ''}
        ${kindNow !== 'fd' ? `<div class="grid2"><label class="field"><span>Name of each item</span><input id="s-kitem" value="${esc(kitOf(kindNow).item)}"></label><label class="field"><span>Report title</span><input id="s-kreport" value="${esc(kitOf(kindNow).report)}"></label></div>` : ''}
      </section>
      <section class="panel fold" data-fold="qs">
        <div class="block-head"><h2 class="h2">Inspection questions · ${esc(kitOf(kindNow).name)}</h2><button class="btn sm" id="s-add-q">${icon('plus')} Add</button></div>
        <p class="muted small">Asked of every ${esc(kitOf(kindNow).item.toLowerCase())} on a ${esc(kitOf(kindNow).name.toLowerCase())} drawing, answered Pass / Fail / N/A. Answers already given are kept if you edit or remove a question.</p>
        <div id="s-qs"></div>
      </section>
      <section class="panel fold" data-fold="types">
        <h2 class="h2">${esc(kitOf(kindNow).item)} types · ${esc(kitOf(kindNow).name)}</h2>
        <label class="field"><span>One per line</span><textarea id="s-types" rows="8">${esc(kt().join('\n'))}</textarea></label>
      </section>
      <section class="panel fold" data-fold="defs">
        <div class="block-head"><h2 class="h2">Defect list · ${esc(kitOf(kindNow).name)}</h2><button class="btn sm" id="s-add-def">${icon('plus')} Add</button></div>
        <p class="muted small">Each defect has the remedial work it suggests. Editing here does not change doors already recorded.</p>
        <div id="s-defs"></div>
        <button class="btn ghost sm" id="s-reset">Reset to default list</button>
      </section>
      <section class="panel fold" data-fold="mats" ${priced() ? '' : 'hidden'}>
        <div class="block-head"><h2 class="h2">Products &amp; prices · ${esc(kitOf(kindNow).name)}</h2><button class="btn sm" id="s-add-m">${icon('plus')} Add</button></div>
        <p class="muted small">Your unit prices (€ ex VAT). They pre-fill doors when you add a material; changing a price here does not change doors already recorded.</p>
        <p class="muted small">${state.allMats ? 'Showing every product.' : `Showing products for ${esc(kitOf(kindNow).name.toLowerCase())}, plus labour and other.`} <button type="button" class="link-btn" id="s-allmats">${state.allMats ? 'Show only this type' : 'Show all products'}</button></p>
        <div id="s-mats"></div>
      </section>
      <div class="set-group"><h2>You and your company</h2></div>
      <section class="panel">
        <label class="field"><span>Inspector name (fills "Inspected by")</span><input id="s-insp" value="${esc(lists.inspector || '')}" placeholder="e.g. Mark Crosby"></label>
      </section>
      <section class="panel fold" data-fold="logo">
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
      <section class="panel fold" data-fold="sign">
        <h2 class="h2">My signature</h2>
        <p class="muted small">Save your signature once and use it when signing reports.</p>
        ${lists.signature ? `<div class="sig-show"><img alt="Your saved signature" src="${lists.signature.data}"></div>` : ''}
        <div class="row-btns"><button class="btn sm" id="s-sign">${icon('pencil')} ${lists.signature ? 'Replace' : 'Add'} my signature</button>
          ${lists.signature ? '<button class="btn ghost sm danger-text" id="s-sign-del">Remove</button>' : ''}</div>
      </section>
      <section class="panel">
        <h2 class="h2">${icon('shield')} Owner PIN</h2>
        <p class="muted small">${lists.libPin
          ? 'Prices, costs, totals, your time on the job and My files are hidden until this PIN is entered. They lock again when the app is closed.'
          : 'Set a PIN so anyone else using this app or phone cannot see your prices, costs, time on the job or My files.'}</p>
        <div class="row-btns"><button class="btn sm" id="s-owner-pin">${lists.libPin ? 'Change or remove PIN' : 'Set an owner PIN'}</button>
        ${lists.libPin ? `<button class="btn ghost sm" id="s-owner-toggle">${priced() ? 'Lock now' : 'Unlock'}</button>` : ''}</div>
      </section>
      <section class="panel">
        <label class="check-line"><input type="checkbox" id="s-gps" ${lists.gps !== false ? 'checked' : ''}> Record my location (GPS) when I inspect a door or take a photo</label>
        <p class="muted small">Shows you were on site and when. Indoors, phones are usually accurate to about 10–50 m, so it confirms the building, not the room. Your phone will ask for permission the first time.</p>
      </section>
      <section class="panel">
        <label class="check-line"><input type="checkbox" id="s-autores" ${lists.autoResult !== false ? 'checked' : ''}> Set each door's pass / fail result from its checklist and defects</label>
        <p class="muted small">When on, the door record shows only Not inspected, Not applicable and No access (and Repaired) as buttons; the pass / fail result is worked out for you. Turn off to choose it by hand.</p>
      </section>
      <div class="set-group"><h2>Lists used on every project</h2></div>
      <section class="panel fold" data-fold="work">
        <h2 class="h2">Types of work</h2>
        <label class="field"><span>One per line. Each project picks one; used to group and filter projects and as the report title.</span><textarea id="s-wtypes" rows="7">${esc((lists.workTypes || DEFAULT_WORK_TYPES).join('\n'))}</textarea></label>
      </section>
      <section class="panel fold" data-fold="close">
        <h2 class="h2">End of service questions</h2>
        <label class="field"><span>One per line. All must be answered (Yes / No / N/A) before a service can be closed.</span><textarea id="s-closeq" rows="10">${esc(closeQuestions(lists).join('\n'))}</textarea></label>
      </section>
      <section class="panel fold" data-fold="rem">
        <h2 class="h2">Remedial instructions (default)</h2>
        <label class="field"><span>The starting wording for the repairer's instructions on new projects. Each project can change its own in the Repairs tab.</span>
          <textarea id="s-rem" rows="8">${esc(lists.remedialText ?? DEFAULT_REMEDIAL_TEXT)}</textarea></label>
      </section>
      <section class="panel fold" data-fold="cats">
        <h2 class="h2">Door categories</h2>
        <label class="field"><span>One per line. Used to group and filter doors on drawings, the door list and reports.</span><textarea id="s-cats" rows="7">${esc((lists.categories || DEFAULT_CATEGORIES).join('\n'))}</textarea></label>
      </section>
      <section class="panel fold" data-fold="risk">
        <h2 class="h2">Risk ratings</h2>
        <label class="field"><span>One per line. Doors start with "${esc(NO_RISK)}" until a rating is picked.</span><textarea id="s-risks" rows="4">${esc((lists.risks || DEFAULT_RISKS).join('\n'))}</textarea></label>
      </section>
      <section class="panel fold" data-fold="acts">
        <h2 class="h2">Recommended actions</h2>
        <label class="field"><span>One per line (each door can have several)</span><textarea id="s-actions" rows="8">${esc((lists.actions || []).join('\n'))}</textarea></label>
      </section>
      <section class="panel fold" data-fold="schemes">
        <div class="block-head"><h2 class="h2">Status schemes</h2><button class="btn sm" id="s-add-scheme">${icon('plus')} New scheme</button></div>
        <p class="muted small">The wording for door statuses and checklist answers. Each project picks one (in the project's details).</p>
        <div id="s-schemes"></div>
      </section>
      <div class="set-group"><h2>Drawing reader</h2></div>
      <section class="panel">
        <p class="muted small">Finds the fire doors on scanned drawings and photos of drawings, using Claude (Anthropic's AI). Add your own Anthropic API key: make one at console.anthropic.com › API keys, and add some credit there. The key stays on this phone and is sent only to Anthropic.${priced() ? ' Roughly US$0.30–0.80 per drawing.' : ' Each drawing read is charged to the account.'}</p>
        ${lists.aiKey ? `<p class="small"><b>Key saved</b> (ending …${esc(lists.aiKey.slice(-4))})</p>` : ''}
        <label class="field"><span>${lists.aiKey ? 'Replace key' : 'Anthropic API key'}</span><input id="s-aikey" type="password" autocomplete="off" placeholder="sk-ant-…"></label>
        <div class="row-btns">
          <button class="btn" id="s-aikey-save">Save key</button>
          ${lists.aiKey ? '<button class="btn ghost danger-text" id="s-aikey-del">Remove key</button>' : ''}
        </div>
      </section>
      <div class="set-group"><h2>Fields</h2></div>
      <section class="panel" id="s-fields"></section>
      <div class="set-group"><h2>Backup</h2></div>
      <section class="panel">
        <h2 class="h2">Backup &amp; restore</h2>
        <p class="muted small">${projects.length} project(s) on this phone${est ? ` · using ${(est.usage / 1048576).toFixed(1)} MB` : ''}</p>
        <div class="row-btns">
          <button class="btn primary" id="s-backup-drive" ${projects.length ? '' : 'disabled'}>${icon('cloud')} Back up everything to Google Drive</button>
          <button class="btn" id="s-backup" ${projects.length ? '' : 'disabled'}>Save backup file</button>
          <label class="btn">Restore from file(s)<input type="file" accept="application/json,.json" id="s-restore" multiple hidden></label>
        </div>
        <label class="check-line"><input type="checkbox" id="s-autobk" ${lists.autoBackup ? 'checked' : ''}> Back up to Google Drive automatically, once a day</label>
        <p class="muted small">Runs whenever the app is open on this device (it can't run while the app is closed). Turns on after your first Google Drive backup on this device.${lists.autoBackupIssue ? ` <b class="warn-text">Last automatic backup didn't run: ${esc(DRIVE_REASONS[lists.autoBackupIssue] || DRIVE_REASONS.error)}</b>` : ''}</p>
        <p class="muted small">Google Drive backups go in the <b>16 FSCF IRELAND APP BACKUPS</b> folder: every site, drawing, pin, photo, file, quote and your settings. Big backups are split into parts; to restore, pick all the parts together. Videos over 50 MB stay on the phone.${lists.lastBackupAt ? ` Last backup: ${esc(new Date(lists.lastBackupAt).toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' }))}.` : ''}</p>
      </section>
      <p class="muted small pad">FSCF Ireland app · data stays on this device until cloud sync is set up.</p>
    </main>`;
  $('#back').onclick = back;
  $('#s-gps').onchange = (e) => saveLists({ gps: e.target.checked });
  $('#s-aikey-save').onclick = async () => {
    const k = $('#s-aikey').value.trim();
    if (!k) return toast('Paste the key first', 'error');
    const b = busy('Checking the key…');
    try {
      await testKey(k);
      b.done();
      await saveLists({ aiKey: k });
      toast('Drawing reader is ready');
      refresh();
    } catch (err) {
      b.done();
      toast(err.status === 401 ? 'That key was not accepted. Check it and try again.' : 'Could not check the key: ' + err.message, 'error');
    }
  };
  $('#s-aikey-del')?.addEventListener('click', async () => {
    if (!(await confirmBox('Remove key?', 'The drawing reader stops working on this phone until a key is added again.'))) return;
    await saveLists({ aiKey: '' });
    refresh();
  });
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
  $('#s-types').onchange = (e) => saveKit({ doorTypes: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) });
  $('#s-kind').onchange = (e) => { state.setKind = e.target.value; refresh(); };
  $('#s-kname')?.addEventListener('change', (e) => saveKit({ name: e.target.value.trim() || kitOf(kindNow).name }));
  $('#s-kit-new').onclick = async () => {
    const src = kitOf(kindNow);
    const r = await dialog({
      title: 'New checklist',
      body: `<p>Starts as a copy of <b>${esc(src.name)}</b>: same questions, ${esc(src.item.toLowerCase())} types and defects, which you can then change.</p>
        <label class="field"><span>Name</span><input name="name" required placeholder="e.g. Fire doors – 29 point check"></label>`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Create', value: true, kind: 'primary' }],
    });
    if (r.value !== true || !r.data.name.trim()) return;
    const id = 'c-' + db.uid().slice(0, 8);
    await saveLists({
      customKits: [...(lists.customKits || []), { id, base: src.base || 'fd', name: r.data.name.trim() }],
      kits: { ...(lists.kits || {}), [id]: { name: r.data.name.trim(), item: src.item, report: src.report, questions: src.questions.map((q, i) => ({ ...q, id: `${id}-${i + 1}`, defect: q.defect || QUESTION_DEFECT[q.id] || undefined })), defects: src.defects, doorTypes: src.doorTypes } },
    });
    state.setKind = id;
    toast('Checklist created');
    refresh();
  };
  $('#s-kit-dl').onclick = () => {
    const k = kitOf(kindNow);
    downloadChecklist({ ...k, questions: k.questions.map((q) => ({ ...q, defect: q.defect || QUESTION_DEFECT[q.id] || '' })), baseName: kitOf(k.base || 'fd').name }).catch((e) => toast(e.message, 'error'));
  };
  $('#s-kit-import').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const b = busy('Reading the checklist…');
    let got;
    try { got = await readChecklistFile(file); } catch (err) { b.done(); return toast('Could not read that file: ' + err.message, 'error'); }
    b.done();
    if (!got.questions?.length) return toast("No checklist questions found in that file. Try an Excel or text file with one question per line.", 'error');
    const r = await dialog({
      title: 'Import checklist',
      body: `<p>Found <b>${got.questions.length}</b> question${got.questions.length === 1 ? '' : 's'} in ${esc(file.name)}. Untick any you don't want.</p>
        <label class="field"><span>Checklist name</span><input name="name" required value="${esc(got.name || '')}" placeholder="e.g. Fire doors – 29 point check"></label>
        <label class="field"><span>Inspection type it belongs to</span><select name="base">${KIND_IDS.map((k) => `<option value="${k}" ${k === (got.base || kitOf(kindNow).base || 'fd') ? 'selected' : ''}>${esc(kitOf(k).name)}</option>`).join('')}</select>
          <small class="muted">It uses that type's ${'item'} types, defects and prices.</small></label>
        <div class="pick-list imp-qs">${got.questions.map((q, i) => `<label class="pick"><input type="checkbox" name="q${i}" checked><span><b>${i + 1}. ${esc(q.text)}</b></span></label>`).join('')}</div>`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Create checklist', value: true, kind: 'primary' }],
    });
    if (r.value !== true) return;
    const base = r.data.base || 'fd';
    const bk = kitOf(base);
    const id = 'c-' + db.uid().slice(0, 8);
    const qs = got.questions.filter((_, i) => r.data['q' + i]).map((q, i) => ({ id: `${id}-${i + 1}`, text: q.text, defect: q.defect || guessDefect(q.text, got.defects || bk.defects) || undefined }));
    const name = r.data.name.trim() || got.name || 'Imported checklist';
    await saveLists({
      customKits: [...(lists.customKits || []), { id, base, name }],
      kits: { ...(lists.kits || {}), [id]: { name, item: got.item || bk.item, report: got.report || `${name} Report`, questions: qs, ...(got.defects ? { defects: got.defects } : {}), ...(got.doorTypes ? { doorTypes: got.doorTypes } : {}) } },
    });
    state.setKind = id;
    openFolds.add('qs');
    toast(`"${name}" created with ${qs.length} questions`);
    refresh();
  };
  $('#s-kit-del')?.addEventListener('click', async () => {
    if (!(await confirmBox('Remove this checklist?', `"${kitOf(kindNow).name}" will no longer be offered for new drawings and pins. Pins already done with it keep their answers.`, 'Remove'))) return;
    await saveLists({ hiddenKits: [...new Set([...(lists.hiddenKits || []), kindNow])] });
    state.setKind = kitOf(kindNow).base || 'fd';
    refresh();
  });
  $('#s-allmats')?.addEventListener('click', () => { state.allMats = !state.allMats; refresh(); });
  // fold / unfold sections; remembered while the app is open
  for (const sec of $$('.panel.fold')) {
    const key = sec.dataset.fold;
    sec.classList.toggle('is-closed', !openFolds.has(key));
    const h = $('h2', sec);
    h.classList.add('fold-head');
    h.setAttribute('role', 'button');
    h.tabIndex = 0;
    const toggle = () => {
      const closed = sec.classList.toggle('is-closed');
      if (closed) openFolds.delete(key); else openFolds.add(key);
    };
    h.onclick = toggle;
    h.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
  }
  $('#s-kitem')?.addEventListener('change', (e) => saveKit({ item: e.target.value.trim() || kitOf(kindNow).item }));
  $('#s-kreport')?.addEventListener('change', (e) => saveKit({ report: e.target.value.trim() || kitOf(kindNow).report }));
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
    $('#s-qs').innerHTML = (kq() || []).map((q, i) => `
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
      const byId = Object.fromEntries(kq().map((q) => [q.id, q]));
      await saveKit({ questions: ids.map((id) => byId[id]).filter(Boolean) });
      drawQs();
    });
    $$('.q-edit').forEach((row) => {
      const i = Number(row.dataset.i);
      $('.qe-text', row).onchange = (e) => saveKit({ questions: kq().map((q, j) => (j === i ? { ...q, text: e.target.value } : q)) });
      $('.qe-del', row).onclick = async () => { await saveKit({ questions: kq().filter((_, j) => j !== i) }); drawQs(); };
      $('.qe-eye', row).onclick = async () => { await saveKit({ questions: kq().map((q, j) => (j === i ? { ...q, hidden: !q.hidden } : q)) }); drawQs(); };
      $('.qe-up', row).onclick = async () => {
        const qs = [...kq()];
        [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]];
        await saveKit({ questions: qs });
        drawQs();
      };
    });
  };
  drawQs();
  if (state.focus === 's-qs') setTimeout(() => $('#s-qs')?.closest('.panel')?.scrollIntoView({ block: 'start' }), 50);
  if (state.focus === 's-cats') setTimeout(() => { $('#s-cats')?.closest('.panel')?.scrollIntoView({ block: 'start' }); $('#s-cats')?.focus(); }, 50);
  $('#s-add-q').onclick = async () => {
    await saveKit({ questions: [...(kq() || []), { id: db.uid(), text: '' }] });
    drawQs();
    $$('.qe-text').at(-1)?.focus();
  };

  const drawMats = () => {
    const show = state.allMats ? null : new Set([...(KIND_CATS[kitOf(kindNow).base] || []), 'Labour', 'Other']);
    const all = (lists.materials || []).map((m, i) => ({ m, i })).filter(({ m }) => !show || show.has(matCat(m)) || (show.has('Other') && !MAT_CATEGORIES.includes(matCat(m))));
    const cats = [...new Set([...(show ? KIND_CATS[kitOf(kindNow).base] || [] : []), ...MAT_CATEGORIES, ...all.map(({ m }) => matCat(m))])];
    $('#s-mats').innerHTML = cats.map((c) => {
      const rows = all.filter(({ m }) => matCat(m) === c);
      if (!rows.length) return '';
      return `<h3 class="mat-cat">${esc(c)} <span class="muted">${rows.length}</span></h3>` + rows.map(({ m, i }) => `
      <div class="m-edit" data-i="${i}">
        <input class="me-name" id="me-name-${i}" value="${esc(m.name)}" aria-label="Material" placeholder="Material">
        <label class="me-cap"><small>Unit</small><input class="me-unit" id="me-unit-${i}" value="${esc(m.unit)}" aria-label="Unit" placeholder="unit"></label>
        <label class="me-cap me-cost"><small>Material €</small><input id="me-cost-${i}" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(m.cost || '')}" placeholder="0.00" aria-label="Material cost in euro"></label>
        <label class="me-cap me-cost me-lab"><small>Labour €</small><input id="me-lab-${i}" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(m.labour || '')}" placeholder="0.00" aria-label="Labour in euro"></label>
        <select class="me-cat" aria-label="Category">${cats.map((x) => `<option ${x === matCat(m) ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <button class="icon-btn sm me-del" aria-label="Remove">${icon('trash')}</button>
      </div>`).join('');
    }).join('') || '<p class="muted small">No materials.</p>';
    $$('.m-edit').forEach((row) => {
      const i = Number(row.dataset.i);
      const upd = () => saveLists({
        materials: lists.materials.map((m, j) => (j === i ? { ...m, name: $('.me-name', row).value, unit: $('.me-unit', row).value, cost: Number($(`#me-cost-${i}`, row).value) || 0, labour: Number($(`#me-lab-${i}`, row).value) || 0, cat: $('.me-cat', row).value } : m)),
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
    await saveLists({ materials: [...(lists.materials || []), { id: db.uid(), cat: state.allMats ? 'Other' : (KIND_CATS[kitOf(kindNow).base] || ['Other'])[0], name: '', unit: 'each', cost: 0 }] });
    openFolds.add('mats');
    drawMats();
    $$('.me-name').at(-1)?.focus();
  };

  const drawDefs = () => {
    $('#s-defs').innerHTML = (kd() || []).map((d, i) => `
      <div class="def-edit" data-i="${i}">
        <input class="de-label" id="de-label-${i}" value="${esc(d.label)}" aria-label="Defect">
        <textarea class="de-rem" id="de-rem-${i}" rows="2" aria-label="Remedial work">${esc(d.remedial)}</textarea>
        <button class="icon-btn sm de-del" aria-label="Remove">${icon('trash')}</button>
      </div>`).join('');
    $$('.def-edit').forEach((row) => {
      const i = Number(row.dataset.i);
      const upd = () => {
        const defects = kd().map((d, j) => (j === i ? { label: $('.de-label', row).value, remedial: $('.de-rem', row).value } : d));
        saveLists({ defects });
      };
      $('.de-label', row).onchange = upd;
      $('.de-rem', row).onchange = upd;
      $('.de-del', row).onclick = async () => {
        await saveKit({ defects: kd().filter((_, j) => j !== i) });
        drawDefs();
      };
    });
  };
  drawDefs();
  $('#s-add-def').onclick = async () => {
    await saveKit({ defects: [{ label: 'New defect', remedial: '' }, ...kd()] });
    drawDefs();
    $('.de-label')?.select();
  };
  $('#s-reset').onclick = async () => {
    if (await confirmBox('Reset defect list?', 'Your edited defect list will be replaced with the default list.', 'Reset')) {
      await saveKit({ defects: kindNow === 'fd' ? DEFAULT_DEFECTS : DEFAULT_KITS[kindNow]?.defects || null });
      drawDefs();
    }
  };
  $('#s-backup-drive').onclick = () => backupEverythingToDrive(projects);
  $('#s-autobk').onchange = async (e) => {
    await saveLists({ autoBackup: e.target.checked });
    if (e.target.checked && !lists.driveBackupFolder) toast('Tap "Back up everything to Google Drive" once to connect it; after that it backs up by itself each day.');
    else toast(e.target.checked ? 'Automatic backup on' : 'Automatic backup off');
  };
  drawFieldsEditor($('#s-fields'));
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
    const fs = [...e.target.files];
    e.target.value = '';
    if (!fs.length) return;
    const b = busy('Restoring…');
    try {
      let n = 0;
      for (const f of fs) n += await restoreBackup(f);
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

// ---------- Settings › Fields ----------
// Sections of your own fields (like Fieldwire attributes). The Replacement
// details section shows on a door once it is marked for replacement.
const fieldSecs = () => JSON.parse(JSON.stringify(lists.fieldSections || DEFAULT_FIELD_SECTIONS));
function drawFieldsEditor(el) {
  if (!el) return;
  const secs = fieldSecs();
  const typeName = Object.fromEntries(FIELD_TYPES);
  el.innerHTML = `
    <p class="muted small">Extra details you record on a door, like Fieldwire attributes: a number (with a unit), a list you write, text, or yes/no. Fields in a <b>replacement</b> section show when a door's Replacement box is set; the others always show.</p>
    ${secs.map((sc, si) => `
      <div class="fs-sec">
        <div class="fs-head"><span><b>${esc(sc.name)}</b><small>${sc.when === 'replacement' ? 'Shows when a door is marked for replacement' : 'Always shows'} · ${sc.base === 'fd' ? 'fire door and final exit checklists' : sc.base ? esc(kitOf(sc.base).name) : 'every inspection type'}</small></span>
          <button class="btn sm ghost" data-sec-edit="${si}">Edit</button></div>
        ${sc.fields.map((f, fi) => `
          <div class="fs-row"><span><b>${esc(f.label)}</b><small>${esc(typeName[f.type] || f.type)}${f.unit ? ` · ${esc(f.unit)}` : ''}${f.type === 'list' ? ` · ${esc((f.options || []).join(', '))}` : ''}</small></span>
            <span class="fs-btns">
              <button class="icon-btn sm" data-up="${si}:${fi}" aria-label="Move up" ${fi ? '' : 'disabled'}>${icon('up')}</button>
              <button class="icon-btn sm" data-edit="${si}:${fi}" aria-label="Edit ${esc(f.label)}">${icon('pencil')}</button>
            </span></div>`).join('')}
        <button class="btn sm" data-add="${si}">${icon('plus')} Add a field</button>
      </div>`).join('')}
    <div class="row-btns"><button class="btn" id="fs-add-sec">${icon('plus')} Add a section</button>
      <button class="btn ghost" id="fs-reset">Reset to FSCF replacement fields</button></div>`;
  const save = async (next) => { await saveLists({ fieldSections: next }); drawFieldsEditor(el); };
  $$('[data-up]', el).forEach((b) => (b.onclick = () => {
    const [si, fi] = b.dataset.up.split(':').map(Number);
    const f = secs[si].fields;
    [f[fi - 1], f[fi]] = [f[fi], f[fi - 1]];
    save(secs);
  }));
  $$('[data-edit]', el).forEach((b) => (b.onclick = async () => {
    const [si, fi] = b.dataset.edit.split(':').map(Number);
    const r = await editField(secs[si].fields[fi]);
    if (r === 'delete') secs[si].fields.splice(fi, 1);
    else if (r) secs[si].fields[fi] = r;
    else return;
    save(secs);
  }));
  $$('[data-add]', el).forEach((b) => (b.onclick = async () => {
    const r = await editField(null);
    if (!r || r === 'delete') return;
    secs[+b.dataset.add].fields.push(r);
    save(secs);
  }));
  $$('[data-sec-edit]', el).forEach((b) => (b.onclick = async () => {
    const si = +b.dataset.secEdit;
    const r = await editSection(secs[si]);
    if (r === 'delete') secs.splice(si, 1);
    else if (r) secs[si] = r;
    else return;
    save(secs);
  }));
  $('#fs-add-sec').onclick = async () => {
    const r = await editSection(null);
    if (r && r !== 'delete') save([...secs, r]);
  };
  $('#fs-reset').onclick = async () => {
    if (!(await confirmBox('Reset fields?', 'Puts back the FSCF replacement fields as they came. Sections you added are removed. Values already typed on doors are kept.', 'Reset', true))) return;
    save(JSON.parse(JSON.stringify(DEFAULT_FIELD_SECTIONS)));
  };
}

async function editField(f) {
  const cur = f || { type: 'text' };
  const r = await dialog({
    title: f ? `Edit "${f.label}"` : 'Add a field',
    body: `
      <label class="field"><span>Name</span><input name="label" required value="${esc(cur.label || '')}" placeholder="e.g. Frame depth" autocomplete="off"></label>
      <label class="field"><span>Type</span><select name="type" id="fe-type">${FIELD_TYPES.map(([v, l]) => `<option value="${v}" ${v === cur.type ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field" id="fe-unit"><span>Unit (optional)</span><input name="unit" value="${esc(cur.unit || '')}" placeholder="e.g. mm"></label>
      <label class="field" id="fe-opts"><span>Choices, one per line</span><textarea name="options" rows="5">${esc((cur.options || []).join('\n'))}</textarea></label>
      <label class="check-line" id="fe-own"><input type="checkbox" name="own" ${cur.own ? 'checked' : ''}> Allow "Type your own" as well as the choices</label>
      <label class="check-line"><input type="checkbox" name="need" ${cur.need ? 'checked' : ''}> Needed before the door can go to the joinery (listed as an open query when empty)</label>`,
    buttons: [...(f ? [{ label: 'Delete field', value: 'delete', kind: 'danger-text' }] : []), { label: 'Cancel', value: false }, { label: f ? 'Save' : 'Add', value: true, kind: 'primary' }],
    onOpen: (form) => {
      const sync = () => {
        const t = form.querySelector('#fe-type').value;
        form.querySelector('#fe-unit').hidden = t !== 'number';
        form.querySelector('#fe-opts').hidden = t !== 'list';
        form.querySelector('#fe-own').hidden = t !== 'list';
      };
      form.querySelector('#fe-type').onchange = sync;
      sync();
    },
  });
  if (r.value === 'delete') return (await confirmBox('Delete field?', `"${f.label}" is removed from every door's form. Values already typed stay in backups.`, 'Delete', true)) ? 'delete' : null;
  if (r.value !== true || !r.data.label.trim()) return null;
  const type = r.data.type;
  return {
    ...cur,
    id: cur.id || 'f' + Date.now().toString(36),
    label: r.data.label.trim(),
    type,
    unit: type === 'number' ? (r.data.unit || '').trim() : '',
    options: type === 'list' ? (r.data.options || '').split('\n').map((x) => x.trim()).filter(Boolean) : [],
    own: type === 'list' && !!r.data.own,
    need: !!r.data.need,
  };
}

async function editSection(sc) {
  const cur = sc || { name: '', when: 'always', base: 'fd', fields: [] };
  const r = await dialog({
    title: sc ? `Edit "${sc.name}"` : 'Add a section',
    body: `
      <label class="field"><span>Section name</span><input name="name" required value="${esc(cur.name)}" placeholder="e.g. Door survey" autocomplete="off"></label>
      <label class="field"><span>When it shows</span><select name="when"><option value="always" ${cur.when !== 'replacement' ? 'selected' : ''}>Always</option><option value="replacement" ${cur.when === 'replacement' ? 'selected' : ''}>When the door is marked for replacement</option></select></label>
      <label class="field"><span>Which inspections</span><select name="base">
        <option value="fd" ${cur.base === 'fd' ? 'selected' : ''}>Fire door and final exit checklists</option>
        <option value="" ${!cur.base ? 'selected' : ''}>Every inspection type</option>
        ${kindIds().filter((k) => !kitOf(k).base || k === 'fd').filter((k) => k !== 'fd').map((k) => `<option value="${k}" ${cur.base === k ? 'selected' : ''}>${esc(kitOf(k).name)}</option>`).join('')}
      </select></label>`,
    buttons: [...(sc ? [{ label: 'Delete section', value: 'delete', kind: 'danger-text' }] : []), { label: 'Cancel', value: false }, { label: sc ? 'Save' : 'Add', value: true, kind: 'primary' }],
  });
  if (r.value === 'delete') return (await confirmBox('Delete section?', `"${sc.name}" and its ${sc.fields.length} field(s) are removed from the door form. Values already typed stay in backups.`, 'Delete', true)) ? 'delete' : null;
  if (r.value !== true || !r.data.name.trim()) return null;
  return { ...cur, id: cur.id || 's' + Date.now().toString(36), name: r.data.name.trim(), when: r.data.when, base: r.data.base };
}

// New project: start blank, from a drawing (file or a photo taken now), or
// from a Fieldwire report.
async function newProjectMenu() {
  let picked = null;
  await dialog({
    title: 'New project',
    body: `<div class="np-list">
      <button type="button" class="np-opt" data-np="blank">${icon('plus')}<span><b>Blank project</b><small>Type the site details, then upload drawings</small></span></button>
      <label class="np-opt">${icon('pin')}<span><b>Drawing only – I'll pin it myself</b><small>Upload a PDF, picture or photo with no automatic pins. Free</small></span><input type="file" data-np="manual" accept="application/pdf,.pdf,image/*" hidden></label>
      <label class="np-opt">${icon('plan')}<span><b>From a drawing, auto-pinned</b><small>PDF or picture from your files, Drive or downloads. Pins are placed at the door symbols automatically. Scanned drawings and photos use the drawing reader: cost will be charged to your account</small></span><input type="file" data-np="drawing" accept="application/pdf,.pdf,image/*" hidden></label>
      <label class="np-opt">${icon('camera')}<span><b>From a photo of a drawing, auto-pinned</b><small>Take a photo of a paper drawing now. Auto-pinning a photo uses the drawing reader: cost will be charged to your account</small></span><input type="file" data-np="photo" accept="image/*" capture="environment" hidden></label>
      <label class="np-opt">${icon('upload')}<span><b>From a Fieldwire report</b><small>Fieldwire PDF report: drawings, pins and checklist answers come across</small></span><input type="file" data-np="fieldwire" accept="application/pdf,.pdf" hidden></label>
    </div>`,
    buttons: [{ label: 'Cancel', value: false }],
    onOpen: (form) => {
      const shut = () => form.querySelector('.modal-actions button')?.click();
      form.querySelector('[data-np=blank]').onclick = () => { picked = { kind: 'blank' }; shut(); };
      form.querySelectorAll('input[type=file]').forEach((inp) => (inp.onchange = () => {
        const f = inp.files[0];
        if (!f) return;
        picked = { kind: inp.dataset.np, file: f };
        shut();
      }));
    },
  });
  if (!picked) return;
  if (picked.kind === 'blank') return editProject();
  if (picked.kind === 'fieldwire') return importFieldwire(picked.file);
  if (picked.kind === 'manual') return importFromDrawing(picked.file, { manual: true });
  return importFromDrawing(picked.file);
}

// Back up every site and file to Google Drive. Returns false when Drive
// isn't reachable from here (the caller then saves a file instead).
let backingUp = false;
async function backupEverythingToDrive(projects, { quiet = false } = {}) {
  if (backingUp) return true;
  backingUp = true;
  const b = quiet ? { update() {}, done() {} } : busy('Preparing backup…');
  if (quiet) toast('Backing up to Google Drive…');
  try {
    const r = await backupToDrive(projects, { library: true, folderId: lists.driveBackupFolder || '', onProgress: b.update });
    b.done();
    if (r?.unavailable) {
      await saveLists({ autoBackupIssue: r.unavailable });
      if (quiet) return true;
      const ask = await dialog({
        title: 'Google Drive not reachable here',
        body: `<p>${esc(DRIVE_REASONS[r.unavailable] || DRIVE_REASONS.error)}</p><p class="small">You can still save a backup file now and choose Google Drive when your phone asks where to save it.</p>`,
        buttons: [{ label: 'Not now', value: false }, { label: 'Save a backup file', value: true, kind: 'primary' }],
      });
      if (ask.value === true) {
        const b2 = busy('Preparing backup…');
        const { result } = await backupProjects(projects, { library: true });
        b2.done();
        if (result === 'saved') { await saveLists({ lastBackupAt: new Date().toISOString() }); toast('Backup file saved'); refresh(); }
      }
      return true;
    }
    const first = !lists.driveBackupFolder;
    await saveLists({ lastBackupAt: new Date().toISOString(), driveBackupFolder: r.folderId, autoBackupIssue: '' });
    toast(`Backed up to Google Drive › 16 FSCF IRELAND APP BACKUPS${r.parts > 1 ? ` (${r.parts} parts)` : ''}${r.videosLeftOut ? ` · ${r.videosLeftOut} large video(s) left on the device` : ''}`);
    if (!quiet && first && lists.autoBackup === undefined) {
      const ok = await confirmBox('Back up automatically?', 'Back up to the same Google Drive folder once a day whenever the app is open on this device. You can turn this off in Settings › Backup.', 'Yes, every day', false);
      await saveLists({ autoBackup: !!ok });
    }
    refresh();
    return true;
  } catch (e) {
    b.done();
    console.error(e);
    if (quiet) await saveLists({ autoBackupIssue: 'error' });
    else toast(driveError(e), 'error');
    return true;
  } finally {
    backingUp = false;
  }
}

// Automatic backup: once a day while the app is open and Drive can be reached
async function autoBackupTick() {
  if (!lists.autoBackup || !lists.driveBackupFolder || backingUp) return;
  if (document.visibilityState !== 'visible' || $('.modal-wrap') || $('.busy') || document.body.classList.contains('sheet-open')) return;
  const last = lists.lastBackupAt ? Date.parse(lists.lastBackupAt) : 0;
  if (Date.now() - last < 22 * 3600e3) return;
  const projects = await db.all('projects');
  if (!projects.length) return;
  await flushSave();
  await backupEverythingToDrive(projects, { quiet: true });
}

// ---------- start ----------
async function start() {
  try {
    await loadLists();
  } catch (e) {
    app.innerHTML = `<main class="page"><section class="empty"><h1 class="h1">Storage unavailable</h1><p>This browser is blocking on-device storage (private browsing?). Open the app in a normal browser window.</p></section></main>`;
    return;
  }
  startCaps(document.body);
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.claude) {
    // When a new version has been published, offer a one-tap refresh
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || $('#update-bar')) return;
      const bar = document.createElement('div');
      bar.id = 'update-bar';
      bar.className = 'update-bar';
      bar.innerHTML = `<span>${icon('check')} A new version of the app is ready</span><button class="btn sm primary" type="button">Update now</button>`;
      bar.querySelector('button').onclick = async () => { await flushSave(); location.reload(); };
      document.body.append(bar);
    });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // check for a newer version whenever the app is brought back to the front
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {}));
    }).catch(() => {});
  }
}
setTimeout(() => autoBackupTick().catch(() => {}), 20000);
setInterval(() => autoBackupTick().catch(() => {}), 15 * 60000);
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushSave());
start();
