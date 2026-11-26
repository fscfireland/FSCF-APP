// Reminders ("agenda"): things to do, worked out from the owner's own records,
// sent to Google Calendar (connector), a calendar file (.ics) or Gmail drafts.
// Built as one list with stable ids so the same items can go to Google Tasks
// when a Tasks route exists (see TASKS below).
//
// Where each item comes from:
//  - CHASE PAYMENT: a sent invoice (status UP) past its due date, or falling due.
//    Due date: the invoice's Due Date box, else invoice date + 30 days
//    (FSCF invoice terms: "Payment is due by the date shown above").
//  - SEND INVOICE: an invoice tab with status WIP or PROC (SUMMARY register WIP column).
//  - INSPECTION DUE: doors whose "Next inspection due" date (set on the door,
//    or from the site's inspection frequency) falls in the window.

import { saveFile } from './files.js';

const CAL = 'Google Calendar';
const GMAIL = 'Gmail';
export const CONNECTORS = { CAL, GMAIL };
// Google Tasks: no connector exists yet. When one does (or the online version
// can sign in to Google), add it to the manifest and implement pushTasks().
export const TASKS = { available: false, reason: 'No Google Tasks connector exists in Claude yet. It will be added when one does, or when the online version of the app has its own Google sign-in.' };

const money = (n) => '€' + (Number(n) || 0).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// ---------- Building the list ----------
// s: summarise() result; sites: [{ project, doors }]
export function buildAgenda(s, sites, todayIso, { days = 90 } = {}) {
  const items = [];
  const ref = (e) => `${e.ref}${e.part ? ' ' + e.part : ''}`;
  for (const e of [...s.overdue, ...s.notDue]) {
    const late = e.late > 0;
    items.push({
      id: `chase|${e.id}`, kind: 'chase', date: late ? todayIso : e.due,
      title: `CHASE PAYMENT: ${ref(e)} · ${e.custName || e.cust} · ${money(e.total)}`,
      notes: [`Invoice ${ref(e)}${e.quote ? ` (quote ${e.quote})` : ''} dated ${e.date}, due ${e.due}${late ? `, ${e.late} days overdue` : ''}.`,
        `Customer: ${e.custName || ''} (${e.cust})${e.contact ? ', ' + e.contact : ''}.`, e.site ? `Site: ${e.site}.` : '',
        `Total inc VAT ${money(e.total)}.`, 'Source: FSCF INVOICES AND QUOTES workbook (SUMMARY register) and FSCF invoice terms.'].filter(Boolean).join('\n'),
      entry: e, late,
    });
  }
  for (const e of s.drafts || []) {
    items.push({
      id: `send|${e.id}`, kind: 'send', date: todayIso,
      title: `SEND INVOICE: ${ref(e)} · ${e.custName || e.cust} · ${money(e.subtotal)} ex VAT`,
      notes: [`Invoice ${ref(e)} has status ${e.status} (not sent yet) in the SUMMARY register.`, `Customer: ${e.custName || ''} (${e.cust}).`, e.site ? `Site: ${e.site}.` : '',
        'When sent, set its status to UP in the workbook.', 'Source: FSCF INVOICES AND QUOTES workbook (SUMMARY register, WIP column).'].filter(Boolean).join('\n'),
      entry: e,
    });
  }
  const until = addDays(todayIso, days);
  for (const { project, doors } of sites) {
    const due = doors.filter((d) => d.nextDue && d.nextDue <= until);
    if (!due.length) continue;
    // one reminder per site per month, on the earliest date in that month
    const byMonth = new Map();
    for (const d of due) { const k = d.nextDue < todayIso ? 'overdue' : d.nextDue.slice(0, 7); (byMonth.get(k) || byMonth.set(k, []).get(k)).push(d); }
    for (const [k, list] of byMonth) {
      const first = list.map((d) => d.nextDue).sort()[0];
      const pins = list.map((d) => String(d.pinNo || '').padStart(3, '0')).filter((x) => x !== '000').sort();
      items.push({
        id: `inspect|${project.id}|${k}`, kind: 'inspect', date: k === 'overdue' ? todayIso : first,
        title: `INSPECTION DUE: ${project.site || 'Site'} · ${list.length} door${list.length === 1 ? '' : 's'}${k === 'overdue' ? ' (overdue)' : ''}`,
        notes: [`${list.length} door${list.length === 1 ? '' : 's'} with "Next inspection due" ${k === 'overdue' ? 'before today' : `in ${k}`} (earliest ${first}).`,
          pins.length ? `Doors: ${pins.slice(0, 40).join(', ')}${pins.length > 40 ? ' …' : ''}.` : '', project.client ? `Client: ${project.client}.` : '',
          'Source: the door\'s Next inspection due date in the FSCF app (set on the door or from the site\'s inspection frequency).'].filter(Boolean).join('\n'),
        project,
      });
    }
  }
  const order = { chase: 0, send: 1, inspect: 2 };
  return items.sort((a, b) => (a.date || '').localeCompare(b.date || '') || order[a.kind] - order[b.kind]);
}

// ---------- Calendar file (.ics): works with no connector ----------
const icsText = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line) => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); };
export function icsOf(items) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FSCF Ireland//FSCF app//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const it of items) {
    const d = it.date.replace(/-/g, '');
    const d2 = addDays(it.date, 1).replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${it.id.replace(/[^A-Za-z0-9|._-]/g, '')}@fscf-app`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${d2}`,
      `SUMMARY:${icsText(it.title)}`, `DESCRIPTION:${icsText(it.notes)}`, 'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(it.title)}`, 'TRIGGER;RELATED=START:PT9H', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
export function saveIcs(items, name = 'FSCF reminders') {
  return saveFile(`${name}.ics`, new Blob([icsOf(items)], { type: 'text/calendar' }));
}

// ---------- Connectors ----------
export async function connectorStatus() {
  if (!window.claude?.use) return { mcp: null, cal: 'outside', gmail: 'outside' };
  let mcp = null;
  try { mcp = await window.claude.use('mcp'); } catch { /* not served */ }
  if (!mcp) return { mcp: null, cal: 'noview', gmail: 'noview' };
  let lt = null;
  try { lt = await mcp.listTools(); } catch { /* treat as unknown */ }
  const st = (name) => {
    if (!lt) return 'unknown';
    const s = lt.servers?.find((x) => x.server === name);
    if (!s || (!s.tools?.length && s.authStatus !== 'unknown')) return 'notconnected';
    return s.authStatus === 'needs_reauth' ? 'needs_reauth' : 'ok';
  };
  return { mcp, cal: st(CAL), gmail: st(GMAIL) };
}
export const CONNECT_HELP = {
  outside: 'This copy of the app is open outside Claude, so it cannot reach Google.',
  noview: 'Google cannot be reached from the app here. Open the app in the Claude app or at claude.ai, signed in.',
  notconnected: (n) => `${n} is not connected to your Claude account. Connect it in claude.ai › Settings › Connectors › ${n}, then reopen the app.`,
  needs_reauth: (n) => `${n} needs signing in again: claude.ai › Settings › Connectors › ${n}.`,
};
export function connectorError(e, server) {
  const c = e?.code;
  if (c === 'server_not_connected' || c === 'selection_required' || c === 'server_not_found') return `${server} is not connected. Connect it in claude.ai › Settings › Connectors › ${server}.`;
  if (c === 'needs_reauth') return `${server} needs signing in again: claude.ai › Settings › Connectors › ${server}.`;
  if (c === 'not_in_manifest' || c === 'approval_required' || c === 'consent_required') return `${server} was not allowed for the app. Tap the button again and choose Allow.`;
  if (c === 'blocked_by_policy') return `${server} is blocked for your account by your organisation's settings.`;
  if (c === 'server_unavailable' || c === 'upstream_error') return `${server} did not answer. Check your signal and try again. (It may have been created anyway: check ${server} before trying again.)`;
  if (c === 'tool_error') return `${server} refused it: ${e?.message || 'no reason given'}`;
  return `${server} failed: ${e?.message || c || 'unknown error'}`;
}

// The Google Calendar connector's event fields are read from the connector
// itself (describeTool), so the app follows whatever it asks for.
let calSchema = null;
async function calendarInput(mcp, it) {
  if (!calSchema) {
    try { calSchema = (await mcp.describeTool(CAL, 'create_event'))?.inputSchema || null; } catch { calSchema = null; }
  }
  const props = calSchema?.properties || {};
  const has = (k) => k in props;
  const pick = (...ks) => ks.find(has);
  const input = {};
  const titleK = pick('summary', 'title', 'name', 'subject');
  const descK = pick('description', 'notes', 'details', 'body');
  const startK = pick('start', 'startTime', 'start_time', 'startDate', 'start_date');
  const endK = pick('end', 'endTime', 'end_time', 'endDate', 'end_date');
  if (!titleK || !startK) throw Object.assign(new Error('The Google Calendar connector asks for event details the app does not recognise. Use "Calendar file" instead, and tell Claude so it can be matched up.'), { code: 'schema' });
  input[titleK] = it.title;
  if (descK) input[descK] = it.notes;
  const dateVal = (iso, k) => {
    const p = props[k] || {};
    if (p.type === 'object' || p.properties) {
      const sub = p.properties || {};
      if ('date' in sub) return { date: iso };
      if ('dateTime' in sub || 'date_time' in sub) return { [('dateTime' in sub) ? 'dateTime' : 'date_time']: `${iso}T09:00:00`, ...(('timeZone' in sub) ? { timeZone: 'Europe/Dublin' } : {}) };
    }
    return /date-time/.test(p.format || '') || /time/i.test(k) ? `${iso}T09:00:00` : iso;
  };
  input[startK] = dateVal(it.date, startK);
  if (endK) input[endK] = dateVal(/dateTime|T09/.test(JSON.stringify(input[startK])) ? it.date : addDays(it.date, 1), endK);
  if (typeof input[endK] === 'string' && /T09:00:00$/.test(input[endK])) input[endK] = input[endK].replace('T09:00:00', 'T09:30:00');
  if (input[endK]?.dateTime) input[endK] = { ...input[endK], dateTime: input[endK].dateTime.replace('T09:00:00', 'T09:30:00') };
  const calK = pick('calendarId', 'calendar_id', 'calendar');
  if (calK && (calSchema.required || []).includes(calK)) input[calK] = 'primary';
  const tzK = pick('timeZone', 'timezone', 'time_zone');
  if (tzK) input[tzK] = 'Europe/Dublin';
  return input;
}
export async function addToCalendar(mcp, it) {
  const r = await mcp.callTool(CAL, 'create_event', await calendarInput(mcp, it));
  const p = r?.payload || {};
  return { eventId: p.id || p.eventId || p.event?.id || '', link: [p.htmlLink, p.link, p.event?.htmlLink].find((u) => typeof u === 'string' && u.startsWith('https://')) || '' };
}

// ---------- Gmail drafts (never sent by the app) ----------
export const emailsIn = (lines) => [...new Set((lines || []).join(' ').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])].map((x) => x.toLowerCase());
export async function gmailDraft(mcp, { to = [], subject, body, file = null }) {
  const input = { to, subject, body };
  if (file) input.attachments = [{ filename: file.name, mimeType: file.type, content: { $file: { data: file.blob, name: file.name, type: file.type } } }];
  const r = await mcp.callTool(GMAIL, 'create_draft', input);
  const p = r?.payload || {};
  return { id: p.id || '', link: typeof p.viewUrl === 'string' && p.viewUrl.startsWith('https://') ? p.viewUrl : '' };
}
export function chaseEmail(e, company = {}) {
  const ref = `${e.ref}${e.part ? ' ' + e.part : ''}`;
  // first name only when the contact line looks like a person (2–4 plain words, no company or job words)
  const words = (e.contact || '').trim().split(/\s+/);
  const person = words.length >= 2 && words.length <= 4 && !/[\d/&@,()]/.test(e.contact) && !/\b(LTD|LIMITED|SERVICES?|PAYMENTS?|HSE|HOSPITAL|HOMES?|HOUSE|DIRECTOR|MANAGER|NURSING|COUNCIL|GROUP|CENTRE|CENTER|PROTECTION|CONTRACTS?|BUILDERS?|ACCOUNTS?|DEPARTMENT|OFFICE|IRELAND|COMPANY|CO|PLC|UNIT|WARD|C\/O)\b/i.test(e.contact);
  const name = person ? words[0] : '';
  return {
    subject: `Invoice ${ref} – FSCF Ireland – payment reminder`,
    body: [`${name ? `Hi ${name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()},` : 'Hi,'}`, '',
      `I hope you are well. This is a reminder that invoice ${ref}${e.quote ? ` (quote ${e.quote})` : ''}${e.site ? ` for ${e.site}` : ''}, dated ${fmt(e.date)}, for ${money(e.total)} including VAT, was due for payment on ${fmt(e.due)}.`, '',
      'Could you let me know when payment will be made? If it has already been paid, please ignore this email, and thank you.', '',
      company.iban ? `Bank details: IBAN ${company.iban}${company.bic ? `, BIC ${company.bic}` : ''}.` : '', '',
      'Kind regards,', 'Mark Crosby', 'FSCF Ireland'].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n'),
  };
}
export function listEmail(items, todayIso) {
  const sec = (k, h) => { const l = items.filter((i) => i.kind === k); return l.length ? [h, ...l.map((i) => `- ${fmt(i.date)}: ${i.title}`), ''] : []; };
  return {
    subject: `FSCF to-do list – ${fmt(todayIso)}`,
    body: [`FSCF Ireland to-do list made by the FSCF app on ${fmt(todayIso)}.`, '',
      ...sec('chase', 'Invoices to chase'), ...sec('send', 'Invoices not sent yet (WIP)'), ...sec('inspect', 'Inspections due'),
      'Taken from the INVOICES AND QUOTES workbook (SUMMARY register) and the doors\' Next inspection due dates in the app.'].join('\n'),
  };
}
const fmt = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
