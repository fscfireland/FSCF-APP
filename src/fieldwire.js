// Read a Fieldwire report PDF into a project: site, dates, every task (pin
// number, room, plan, door rating, fire alarm zone, tags), its checklist
// questions, recommendations and task messages. Pin positions are not in the
// PDF's text, so doors come in unplaced, ready to tap onto the drawing.

import { pdfLines } from './files.js';

const clean = (s) => String(s || '').replace(/\\([_#*&])/g, '$1').replace(/\s*\(@[^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
const BOILER = /^below are listed the remedial actions/i;

// E30Sa → E30Sa (FD30S); FD60 → E60 (FD60); E30Sa4 → E30Sa4 (FD30S)
export function ratingToType(r) {
  const m = /(?:FD|EI?)?\s*(\d{2,3})\s*-?\s*(S\s*a\s*4|S\s*a|S)?/i.exec(r || '');
  if (!m) return '';
  const mins = m[1];
  const s = (m[2] || '').replace(/\s+/g, '').toLowerCase();
  return s === 'sa4' ? `E${mins}Sa4 (FD${mins}S)` : s ? `E${mins}Sa (FD${mins}S)` : `E${mins} (FD${mins})`;
}

export async function readFieldwire(file) {
  const lines = (await pdfLines(file, 400)).map((l) => l.replace(/\\([_#*&])/g, '$1'));
  const text = lines.join('\n');
  if (!/fieldwire/i.test(text) && !/\n#\d+\s*-\s/.test('\n' + text)) throw new Error("This doesn't look like a Fieldwire report.");

  // header: report title, "SITE — Eircode X", dates
  const title = clean(lines.find((l) => l.trim()) || '');
  const siteLine = lines.find((l) => /\s[—–-]\s*Eircode/i.test(l)) || '';
  const site = clean(siteLine.split(/\s[—–-]\s*Eircode/i)[0]) || title;
  const eir = /Eircode\s+([A-Z0-9]{3}\s?[A-Z0-9]{4})/i.exec(siteLine);
  const dates = /Dates:\s*(\d{2})-(\d{2})-(\d{4})\s*-\s*(\d{2})-(\d{2})-(\d{4})/.exec(text);
  const date = dates ? `${dates[6]}-${dates[5]}-${dates[4]}` : '';

  // tasks: "#12 - ROOM NAME Priority 2 | Person | …" (the header can wrap over lines)
  const re = /(?:^|\s)#(\d+)\s*-\s*([^#|]{1,160}?)\s+Priority\s*\d\s*\|/g;
  const starts = [];
  let m0;
  while ((m0 = re.exec(text))) starts.push({ at: m0.index, no: Number(m0[1]), name: m0[2].replace(/\s+/g, ' ').trim() });
  const doors = [];
  const checklistOrder = [];
  for (const [k, st] of starts.entries()) {
    const block = text.slice(st.at, k + 1 < starts.length ? starts[k + 1].at : text.length);
    const cut = block.search(/\n\s*(Checklist|Task messages)\b/i);
    const all = (cut > 0 ? block.slice(0, cut) : block).replace(/\s+/g, ' ');
    const bodyLines = block.split('\n').slice(1);
    const name = clean(st.name);
    const plan = clean(/Plan:\s*(.+?)\s+(Tags:|Created\b)/.exec(all)?.[1] || '');
    const tags = (/Tags:\s*(.+?)\s+Created\b/.exec(all)?.[1] || '').split(',').map((x) => clean(x).replace(/^#/, '').replace(/_/g, ' ')).filter(Boolean);
    const rating = /Door Rating:\s*([A-Za-z0-9-]+)/i.exec(all)?.[1] || '';
    const zoneNo = /FA ZONE NO:+\s*([\w-]+)/i.exec(all)?.[1] || '';
    const zoneName = clean(/FA ZONE NAME:+\s*(.+?)(\s+RFID|\s+DOOR COUNT|\s+Door Rating|$)/i.exec(all)?.[1] || '');
    const rfid = /RFID TAG NO:+\s*(\w+)/i.exec(all)?.[1] || '';
    const checks = [];
    const recs = [];
    const msgs = [];
    let mode = '';
    for (const raw of bodyLines) {
      const l = clean(raw);
      if (!l || /^\d{1,3}$/.test(l)) continue;
      if (/^checklist\b/i.test(l)) { mode = 'check'; continue; }
      if (/^task messages/i.test(l)) { mode = 'msg'; continue; }
      if (/^photos?\b/i.test(l)) { mode = ''; continue; }
      if (/created with fieldwire|\bpg\.\s*\d+\s*\/\s*\d+/i.test(l)) continue;
      if (BOILER.test(l)) { mode = 'boiler'; continue; }
      if (/^recommendations? for improvement/i.test(l)) {
        mode = 'rec';
        recs.push(l.replace(/^recommendations? for improvement\s*(\([^)]*\))?\s*:?\s*/i, '').trim());
        continue;
      }
      if (mode === 'check' && l.length > 8 && l.length < 260) { if (!checks.includes(l)) checks.push(l); }
      else if (mode === 'rec' && recs.length) recs[recs.length - 1] += ' ' + l;
      else if (mode === 'msg' && !/\bphoto \d+\b|GPS:/i.test(l)) msgs.push(l.replace(/\s+\d{1,2} [A-Z][a-z]{2} \d{1,2}:\d{2}$/, ''));
    }
    for (const q of checks) if (!checklistOrder.includes(q)) checklistOrder.push(q);
    const m = /^([A-Z]{0,3}-?\d{1,4}[A-Z]?)\s+(.+)$/.exec(name);
    doors.push({
      no: st.no, ref: String(st.no).padStart(3, '0'), location: name, plan: plan.split('/').pop().trim() || plan,
      doorType: ratingToType(rating), rating, zoneNo, zoneName, rfid, tags,
      recommendations: [...new Set(recs.map((r) => r.trim()).filter(Boolean))], messages: msgs, checklist: checks,
      text: all,
    });
  }
  return { title, site, eircode: eir ? eir[1].toUpperCase() : '', date, doors, checklist: checklistOrder };
}
