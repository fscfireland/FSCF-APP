// "Ask Claude": a chat on the home page that can look through the sites,
// drawings, doors and saved reports on this device, answer questions about
// them, and change door and site details. Every change is shown to the owner
// first (Apply / Skip) and can be undone afterwards.
//
// The tools run here in the browser against the app's own database; only the
// conversation and what the tools return go to Anthropic, with the owner's key.

import * as db from './db.js';
import { saveDoor, FREQUENCIES } from './history.js';
import { statusById, useScheme } from './defaults.js';

const STATUS_IDS = ['not_inspected', 'pass', 'fail', 'repaired', 'na', 'no_access'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DOOR_FIELDS = {
  ref: 'Pin ref / ID (numbers only, e.g. "012")', location: 'Location / room', doorType: 'Door type / rating, e.g. FD30S',
  leaf: 'Leaf configuration, e.g. Single, Double', status: `Result: one of ${STATUS_IDS.join(', ')}`, notes: 'Notes (replaces the notes)',
  inspectedOn: 'Inspection date YYYY-MM-DD', inspectedBy: 'Inspector name', nextDue: 'Next inspection due YYYY-MM-DD',
  zoneNo: 'Fire alarm zone number', zoneName: 'Fire alarm zone name', risk: 'Risk rating', category: 'Category',
};
const SITE_FIELDS = {
  site: 'Site name', client: 'Client', address: 'Address / Eircode', group: 'Group', workType: 'Type of work',
  date: 'Inspection date YYYY-MM-DD', frequency: 'Inspection frequency in months: 0 (not set), 1, 2, 3, 6 or 12',
};

const str = { type: 'string' };
export const TOOLS = [
  {
    name: 'list_sites',
    description: 'List the sites (projects) on this device with client, address, group, type of work, inspection date, visit frequency and door counts by result. Use first to find a site_id.',
    input_schema: { type: 'object', properties: { search: { type: 'string', description: 'Optional words to match in site, client, address or group' } } },
  },
  {
    name: 'get_site',
    description: 'One site in detail: its drawings (with how many pins each), fire alarm zones, services started or closed, door counts by result, and its saved files.',
    input_schema: { type: 'object', properties: { site_id: str }, required: ['site_id'] },
  },
  {
    name: 'find_doors',
    description: 'Find doors / pins on a site. Returns one compact row per door: door_id, pin number, ref, location, drawing, result, door type, defects, repair actions, inspection date, next due, zone. Filters are optional and combine.',
    input_schema: {
      type: 'object',
      properties: {
        site_id: str,
        status: { type: 'string', enum: STATUS_IDS },
        text: { type: 'string', description: 'Words to match in ref, location, door type, notes, defects or actions' },
        drawing: { type: 'string', description: 'Part of a drawing name' },
        limit: { type: 'integer', description: 'Most rows to return (default 200)' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'get_door',
    description: 'Everything recorded on one door: details, checklist answers, defects with remedial work, products, repair actions, notes, signs, earlier inspections and the latest history entries.',
    input_schema: { type: 'object', properties: { door_id: str }, required: ['door_id'] },
  },
  {
    name: 'list_files',
    description: 'Files saved with a site (reports, certificates, drawings, photos), with file_id, folder, type and date. Close-out reports made by the app are here too.',
    input_schema: { type: 'object', properties: { site_id: str }, required: ['site_id'] },
  },
  {
    name: 'read_file',
    description: 'Read the text of a saved PDF or text file (e.g. a report) so you can answer questions about it.',
    input_schema: { type: 'object', properties: { file_id: str, max_chars: { type: 'integer', description: 'Default 20000' } }, required: ['file_id'] },
  },
  {
    name: 'update_doors',
    description: 'Change details on one or more doors. The owner sees every change and taps Apply or Skip, so propose exactly what was asked. Returns whether it was applied.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One plain line saying what this does, e.g. "Mark doors 012 and 014 as failed"' },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              door_id: str,
              set: { type: 'object', description: 'Fields to change: ' + Object.entries(DOOR_FIELDS).map(([k, v]) => `${k} (${v})`).join('; '), properties: Object.fromEntries(Object.keys(DOOR_FIELDS).map((k) => [k, str])) },
              actions: { type: 'array', items: str, description: 'Replace the repair actions (recommendations) with this list' },
              add_defects: { type: 'array', items: { type: 'object', properties: { label: str, remedial: str }, required: ['label'] } },
              remove_defects: { type: 'array', items: str, description: 'Defect labels to remove' },
            },
            required: ['door_id'],
          },
        },
      },
      required: ['summary', 'changes'],
    },
  },
  {
    name: 'update_site',
    description: 'Change a site\'s details. The owner sees the change and taps Apply or Skip. Changing the frequency re-works every inspected door\'s next due date.',
    input_schema: {
      type: 'object',
      properties: {
        site_id: str,
        summary: str,
        set: { type: 'object', description: 'Fields to change: ' + Object.entries(SITE_FIELDS).map(([k, v]) => `${k} (${v})`).join('; '), properties: { ...Object.fromEntries(Object.keys(SITE_FIELDS).map((k) => [k, str])), frequency: { type: 'integer', enum: [0, ...FREQUENCIES.map(([n]) => n)] } } },
      },
      required: ['site_id', 'summary', 'set'],
    },
  },
];

export function systemPrompt(today, inspector) {
  return `You are the assistant inside the FSCF Ireland app, used by the director of a fire safety company in Ireland (fire door inspections, remedial works, installs and fire stopping; clients include the HSE and nursing homes). The app replaces Fieldwire: each site has drawings with numbered pins (usually fire doors, but also dampers, alarm devices, extinguishers and the like), and each pin has an inspection record.

Today is ${today}.${inspector ? ` The inspector using the app is ${inspector}.` : ''}

How to work:
- Use the tools to look things up; never guess site names, door numbers or results. Find the site with list_sites, then use find_doors, get_door, list_files and read_file as needed.
- Answer in short, plain English for someone on site on a phone. Use Irish/UK spelling and dates like 26 Nov 2026. Give numbers and door refs, not database ids. No markdown tables; short lists are fine.
- Result values: not_inspected, pass, fail, repaired, na (not applicable), no_access. The site may show them with its own wording.
- Pin ref / ID is always numbers only, three digits: 001, 002 and so on.
- To change anything, call update_doors or update_site. The owner sees each change and taps Apply or Skip, so propose exactly what was asked, nothing extra, and group related changes into one call. If a request is unclear (which site, which doors), ask first.
- If the owner skips a change, accept it and do not propose it again unless asked.
- You cannot delete sites, doors, drawings, photos or files, and you cannot send anything outside the app. Say so if asked.`;
}

// ---- reading ----
const compactDoor = (d, planName) => ({
  door_id: d.id, pin: d.pinNo, ref: d.ref || '', location: d.location || '', drawing: planName || (d.planId ? '' : 'not on a drawing'),
  result: d.status || 'not_inspected', type: d.doorType || '', defects: (d.defects || []).map((x) => x.label),
  actions: d.actions || [], inspected: d.inspectedOn || '', next_due: d.nextDue || '', zone: [d.zoneNo, d.zoneName].filter(Boolean).join(' '),
});
const counts = (doors) => doors.reduce((c, d) => { const s = d.status || 'not_inspected'; c[s] = (c[s] || 0) + 1; return c; }, {});

async function siteOrThrow(id) {
  const p = await db.get('projects', id);
  if (!p) throw new Error(`No site with id ${id}. Use list_sites.`);
  return p;
}

export function makeRunner(ctx) {
  // ctx: { confirm(card) → Promise<'apply'|'skip'>, applyFrequency(project), questionText(door) → [{q, answer, note}], productsFor(defect), pdfText(blob, max) }
  const run = {
    async list_sites({ search = '' }) {
      const q = search.toLowerCase().trim();
      const all = await db.all('projects');
      const out = [];
      for (const p of all) {
        const hay = [p.site, p.client, p.address, p.group, p.workType].join(' ').toLowerCase();
        if (q && !q.split(/\s+/).every((w) => hay.includes(w))) continue;
        const doors = await db.projectDoors(p.id);
        out.push({ site_id: p.id, site: p.site, client: p.client || '', address: p.address || '', group: p.group || '', type_of_work: p.workType || '', date: p.date || '', frequency_months: Number(p.frequency) || 0, doors: doors.length, results: counts(doors) });
      }
      return out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    },
    async get_site({ site_id }) {
      const p = await siteOrThrow(site_id);
      const plans = await db.projectPlans(p.id);
      const doors = await db.projectDoors(p.id);
      const files = await db.byIndex('files', 'projectId', p.id);
      return {
        site_id: p.id, site: p.site, client: p.client || '', address: p.address || '', group: p.group || '', type_of_work: p.workType || '', date: p.date || '',
        frequency_months: Number(p.frequency) || 0, zones: p.zones || [],
        drawings: plans.map((pl) => ({ name: pl.name, collection: pl.collection || '', pins: doors.filter((d) => d.planId === pl.id).length, service: p.closeouts?.[`plan:${pl.id}`] ? `closed ${p.closeouts[`plan:${pl.id}`].closedAt.slice(0, 10)}` : p.services?.[`plan:${pl.id}`] ? 'started' : '' })),
        not_on_a_drawing: doors.filter((d) => !d.planId).length, results: counts(doors), files: files.length,
      };
    },
    async find_doors({ site_id, status, text = '', drawing = '', limit = 200 }) {
      const p = await siteOrThrow(site_id);
      const plans = Object.fromEntries((await db.projectPlans(p.id)).map((pl) => [pl.id, pl.name]));
      const words = text.toLowerCase().split(/\s+/).filter(Boolean);
      const rows = (await db.projectDoors(p.id)).filter((d) => {
        if (status && (d.status || 'not_inspected') !== status) return false;
        if (drawing && !(plans[d.planId] || '').toLowerCase().includes(drawing.toLowerCase())) return false;
        if (words.length) {
          const hay = [d.ref, d.location, d.doorType, d.notes, ...(d.defects || []).map((x) => x.label + ' ' + x.remedial), ...(d.actions || [])].join(' ').toLowerCase();
          if (!words.every((w) => hay.includes(w))) return false;
        }
        return true;
      }).sort((a, b) => (a.pinNo || 0) - (b.pinNo || 0));
      return { total: rows.length, doors: rows.slice(0, Math.min(500, limit)).map((d) => compactDoor(d, plans[d.planId])) };
    },
    async get_door({ door_id }) {
      const d = await db.get('doors', door_id);
      if (!d) throw new Error(`No door with id ${door_id}.`);
      const plan = d.planId ? await db.get('plans', d.planId) : null;
      return {
        ...compactDoor(d, plan?.name), leaf: d.leaf || '', risk: d.risk || '', category: d.category || '', inspected_by: d.inspectedBy || '', notes: d.notes || '',
        checklist: ctx.questionText(d, plan), defects: (d.defects || []).map((x) => ({ label: x.label, remedial: x.remedial || '' })),
        products: (d.materials || []).map((m) => `${m.qty ?? 1} × ${m.name}${m.spec ? ' (' + m.spec + ')' : ''}`),
        signs: (d.signs || []).map((s) => `${s.qty} × ${s.type}${s.state ? ' – ' + s.state : ''}`),
        earlier_inspections: (d.history || []).map((h) => ({ date: h.inspectedOn || '', result: h.status || '', defects: (h.defects || []).map((x) => x.label) })),
        recent_history: (d.log || []).slice(-15).map((e) => `${(e.at || '').slice(0, 10)} ${e.by ? e.by + ': ' : ''}${e.text}`),
      };
    },
    async list_files({ site_id }) {
      await siteOrThrow(site_id);
      return (await db.byIndex('files', 'projectId', site_id)).map((f) => ({ file_id: f.id, name: f.name, folder: f.folder || '', type: f.type || '', added: (f.createdAt || '').slice(0, 10), pages: f.pages || undefined }));
    },
    async read_file({ file_id, max_chars = 20000 }) {
      const f = await db.get('files', file_id);
      if (!f || !f.projectId) throw new Error('No such file on a site.');
      const max = Math.min(60000, max_chars);
      if (/pdf/.test(f.type || '') || /\.pdf$/i.test(f.name)) return { name: f.name, text: await ctx.pdfText(f.blob, max) };
      if (/^text\/|csv|json/.test(f.type || '') || /\.(txt|csv|md)$/i.test(f.name)) return { name: f.name, text: (await f.blob.text()).slice(0, max) };
      return { name: f.name, text: '', note: 'This file is not text or PDF, so it cannot be read here.' };
    },

    // ---- changing: shown to the owner first ----
    async update_doors({ summary, changes }) {
      const plan = [];
      const problems = [];
      for (const ch of changes || []) {
        const d = await db.get('doors', ch.door_id);
        if (!d) { problems.push(`No door ${ch.door_id}`); continue; }
        const p = await db.get('projects', d.projectId);
        useScheme(p);
        const next = { ...d };
        const lines = [];
        for (const [k, v0] of Object.entries(ch.set || {})) {
          if (!(k in DOOR_FIELDS)) { problems.push(`${k} cannot be changed`); continue; }
          let v = String(v0 ?? '').trim();
          if (k === 'status' && !STATUS_IDS.includes(v)) { problems.push(`"${v}" is not a result`); continue; }
          if ((k === 'inspectedOn' || k === 'nextDue') && v && !DATE.test(v)) { problems.push(`${k} must be YYYY-MM-DD`); continue; }
          if (k === 'ref') {
            if (v && !/^\d+$/.test(v)) { problems.push(`Pin ref must be numbers only ("${v}")`); continue; }
            if (v) v = v.padStart(3, '0');
          }
          if ((d[k] || '') === v) continue;
          const show = (x) => (k === 'status' ? statusById[x || 'not_inspected']?.label || x : x) || '(blank)';
          lines.push(`${FIELD_NAME[k] || k}: ${show(d[k])} → ${show(v)}`);
          next[k] = v;
        }
        if (Array.isArray(ch.actions)) {
          next.actions = ch.actions.map((x) => String(x).trim()).filter(Boolean);
          lines.push(`Repair actions: ${next.actions.length ? next.actions.join('; ') : '(none)'}`);
        }
        for (const label of ch.remove_defects || []) {
          if (!(next.defects || []).some((x) => x.label === label)) { problems.push(`Door ${d.ref || d.pinNo} has no defect "${label}"`); continue; }
          next.defects = next.defects.filter((x) => x.label !== label);
          next.materials = (next.materials || []).filter((m) => m.forKey !== 'd:' + label);
          lines.push(`Remove defect: ${label}`);
        }
        for (const nd of ch.add_defects || []) {
          if (!nd?.label || (next.defects || []).some((x) => x.label === nd.label)) continue;
          const def = { label: nd.label.trim(), remedial: (nd.remedial || '').trim() };
          next.defects = [...(next.defects || []), def];
          next.materials = [...(next.materials || []), ...(await ctx.productsFor(def, d.projectId))];
          lines.push(`Add defect: ${def.label}${def.remedial ? ' – ' + def.remedial : ''}`);
        }
        if (lines.length) plan.push({ before: d, next, title: `Pin ${d.pinNo}${d.ref ? ' · ' + d.ref : ''}${d.location ? ' · ' + d.location : ''}`, lines });
      }
      if (!plan.length) return { applied: false, reason: problems.length ? problems.join('; ') : 'Nothing would change.' };
      const answer = await ctx.confirm({ summary, items: plan.map((x) => ({ title: x.title, lines: x.lines })), problems,
        undo: async () => { for (const x of plan) await saveDoor({ ...(await db.get('doors', x.before.id)), ...pick(x.before, x.next) }, ['Change by Claude undone']); } });
      if (answer !== 'apply') return { applied: false, reason: 'The owner skipped this change.' };
      for (const x of plan) await saveDoor(x.next, [`Changed with Claude: ${summary}`]);
      return { applied: true, doors_changed: plan.length, problems };
    },
    async update_site({ site_id, summary, set }) {
      const p = await siteOrThrow(site_id);
      const next = { ...p };
      const lines = [];
      for (const [k, v0] of Object.entries(set || {})) {
        if (!(k in SITE_FIELDS)) continue;
        let v = k === 'frequency' ? Number(v0) || 0 : String(v0 ?? '').trim();
        if (k === 'date' && v && !DATE.test(v)) return { applied: false, reason: 'date must be YYYY-MM-DD' };
        if ((p[k] ?? (k === 'frequency' ? 0 : '')) === v) continue;
        const show = (x) => (k === 'frequency' ? (FREQUENCIES.find(([n]) => n === Number(x))?.[1] || 'Not set') : x || '(blank)');
        lines.push(`${SITE_NAME[k]}: ${show(p[k])} → ${show(v)}`);
        next[k] = v;
      }
      if (!lines.length) return { applied: false, reason: 'Nothing would change.' };
      const answer = await ctx.confirm({ summary, items: [{ title: p.site, lines }], problems: [], undo: async () => { await db.put('projects', { ...(await db.get('projects', p.id)), ...pick(p, next) }); if ('frequency' in (set || {})) await ctx.applyFrequency(await db.get('projects', p.id)); } });
      if (answer !== 'apply') return { applied: false, reason: 'The owner skipped this change.' };
      const rec = await db.put('projects', next);
      if (next.frequency && next.frequency !== (Number(p.frequency) || 0)) await ctx.applyFrequency(rec);
      return { applied: true };
    },
  };
  return async (name, input) => {
    if (!run[name]) throw new Error(`Unknown tool ${name}`);
    return run[name](input || {});
  };
}

const FIELD_NAME = { ref: 'Pin ref / ID', location: 'Location', doorType: 'Door type', leaf: 'Leaf', status: 'Result', notes: 'Notes', inspectedOn: 'Inspected on', inspectedBy: 'Inspected by', nextDue: 'Next due', zoneNo: 'Zone', zoneName: 'Zone name', risk: 'Risk', category: 'Category' };
const SITE_NAME = { site: 'Site name', client: 'Client', address: 'Address', group: 'Group', workType: 'Type of work', date: 'Inspection date', frequency: 'Frequency' };
// the fields a change touched, with their values from `before`
function pick(before, next) {
  const out = {};
  for (const k of Object.keys(next)) if (next[k] !== before[k]) out[k] = before[k];
  return out;
}

// Tool activity shown in the chat while Claude works
export function activityText(name, input) {
  switch (name) {
    case 'list_sites': return input?.search ? `Looking for sites matching "${input.search}"` : 'Looking through your sites';
    case 'get_site': return 'Opening the site';
    case 'find_doors': return 'Searching the doors';
    case 'get_door': return 'Reading a door record';
    case 'list_files': return 'Checking the site\'s files';
    case 'read_file': return 'Reading a report';
    case 'update_doors': return 'Preparing changes';
    case 'update_site': return 'Preparing a change to the site';
    default: return name;
  }
}
