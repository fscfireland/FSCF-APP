// Customer list (owner, 27 Nov 2026).
// The owner's workbook already gives every customer a code: a short abbreviation
// of the company, then a number (CHES-001, STMAR-002, HSEMW-001…). New customers
// typed into the app get a code made the same way. Customers from the workbook
// show up automatically; editing one in the app keeps the app's copy.

// words that say nothing about which company it is
const NOISE = new Set(['ltd', 'limited', 'clg', 'dac', 'plc', 'llp', 'inc', 'the', 'and', 'of', 'co', 'company', 'c/o', 'co.', 't/a', '&']);
// job titles: a line made of these is the contact's role, not the company
const TITLE_RE = /\b(manager|director|officer|foreman|engineer|superintendent|registrar|treasurer|principal|secretary|administrator|supervisor|technician|owner|proprietor|ceo|coo|chairman|chairperson|pic|surveyor|caretaker|head|chief|assistant)\b/i;
const COMPANY_RE = /\b(ltd|limited|clg|dac|plc|services|hospital|hse|hotel|school|centre|center|home|ireland|group|construction|contractors?|contracts|fire|protection|electrical|mechanical|carpentry|club|council|county|management|trust|housing|university|college|church|bar|restaurant|nursing|residence|campus|afc|gfc)\b/i;

// an address line: a number, or a street / estate word
const ADDR_RE = /\d|\b(street|road|rd|avenue|ave|park|estate|lane|way|hill|square|unit|apartment|drive|crescent|terrace|quay|place|demesne|industrial|business park|main st)\b/i;
const clean = (s) => String(s || '').replace(/^c\/o\s+/i, '').replace(/\s+c\/o$/i, '').replace(/\s+/g, ' ').trim();

// A code prefix from the company (or the contact's name when there is no company).
export function codePrefix(company, name = '') {
  const src = clean(company) || clean(name);
  const words = src.replace(/[^A-Za-z0-9'& .\/-]/g, ' ').split(/[\s.\/-]+/).map((w) => w.replace(/'s$/i, '').replace(/'/g, '')).filter((w) => w && !NOISE.has(w.toLowerCase()));
  if (!words.length) return 'CUST';
  const up = (w) => w.toUpperCase();
  // St Mary's → STMAR, St Camillus → STCAM (as in the workbook)
  if (/^(st|saint)$/i.test(words[0]) && words[1]) return ('ST' + up(words[1]).slice(0, 3)).replace(/[^A-Z0-9]/g, '');
  // HSE Mid West → HSEMW, TR Carpentry → TRC, DOR Contract Services → DORC
  if (/^[A-Z]{2,4}$/.test(words[0])) return (words[0] + words.slice(1).map((w) => up(w[0])).join('')).slice(0, 5);
  // three or more words → initials (Sport Ireland Facilities → SIF)
  if (words.length >= 3) return words.slice(0, 5).map((w) => up(w[0])).join('');
  // one or two words → first four letters (Cheshire → CHES, Cranston Construction → CRAN)
  return up(words[0]).replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'CUST';
}

// Next free code for that prefix, e.g. SCOTH-001 taken → SCOTH-002.
export function makeCode(company, name, taken = []) {
  const pre = codePrefix(company, name);
  const used = new Set(taken.map((c) => String(c).toUpperCase()));
  for (let n = 1; n < 1000; n++) {
    const code = `${pre}-${String(n).padStart(3, '0')}`;
    if (!used.has(code)) return code;
  }
  return `${pre}-${Date.now() % 1000}`;
}

// Phone numbers and emails written in a customer box (never FSCF's own)
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RE = /(?:\+353|\(?00353\)?)?[\s(]*0?\d{1,3}\)?[\s-]?\d{3}[\s-]?\d{3,4}/g;
const OWN_RE = /1007192|100 7192|f\.s\.c\.f|fscf/i;
export function contactBits(lines = []) {
  const emails = [];
  const phones = [];
  const rest = [];
  for (const raw of lines) {
    const l = String(raw || '');
    if (OWN_RE.test(l)) continue;
    const e = l.match(EMAIL_RE) || [];
    // a line that is only phone numbers / emails (with labels like "Phone:", "T", "M", "Tel")
    const stripped = l.replace(EMAIL_RE, '').replace(/\b(phone|tel|mobile|mob|email|e-mail|t|m|e)\b\s*[:.]?/gi, '').replace(/[|,;/]/g, ' ');
    const p = (stripped.match(PHONE_RE) || []).map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x.replace(/\D/g, '').length >= 8);
    const leftover = stripped.replace(PHONE_RE, '').replace(/[\s()+-]/g, '');
    if (e.length || (p.length && !leftover)) { emails.push(...e); phones.push(...p); if (leftover && !p.length) rest.push(l); continue; }
    rest.push(l);
  }
  return { emails: [...new Set(emails.map((x) => x.toLowerCase()))], phones: [...new Set(phones)], rest };
}

// Name / company / address out of the customer box lines on a workbook tab.
export function splitLines(lines = []) {
  const ls = contactBits(lines).rest.map(clean).filter(Boolean);
  let name = '';
  let role = '';
  let company = '';
  let i = 0;
  const looksCompany = (s) => !ADDR_RE.test(s) && COMPANY_RE.test(s) || /^[A-Z0-9 &'.,-]{4,}$/.test(s) && s.split(" ").length >= 2 && !TITLE_RE.test(s) && !ADDR_RE.test(s);
  // a single word in capitals (ROOSKEY, MONAGHAN) is a place, so part of the address
  const place = (s) => /^[A-Z][A-Z'.-]+$/.test(s);
  const isAddr = (s) => ADDR_RE.test(s) || place(s);
  if (ls[0] && ls[1] && TITLE_RE.test(ls[1]) && !COMPANY_RE.test(ls[0])) {
    // PAUL HOLDEN / FIRE PREVENTION OFFICER / HSE CAPITAL & ESTATES
    name = ls[0]; role = ls[1]; i = 2;
    while (ls[i] && TITLE_RE.test(ls[i]) && !/\b(ltd|limited|clg|dac|plc|hse|hospital|ireland|group|services)\b/i.test(ls[i])) { role += ', ' + ls[i]; i++; }
    // straight after the job title comes the company, even one word (IBTS, TURNUA)
    if (ls[i] && !ADDR_RE.test(ls[i])) { company = ls[i]; i++; }
  } else if (ls[0] && !TITLE_RE.test(ls[0]) && ls[1] && isAddr(ls[1]) && ls[0].split(' ').length >= 2 && (looksCompany(ls[0]) || ls[0].split(' ').length >= 3)) {
    // Poyntz Urban Logistics / 16 Merrion Row: a company straight away followed by its address
    company = ls[0]; i = 1;
  } else if (ls[0] && looksCompany(ls[0]) && !(ls[1] && looksCompany(ls[1]) && !TITLE_RE.test(ls[1]))) {
    company = ls[0]; i = 1;
    if (ls[i] && !looksCompany(ls[i]) && !isAddr(ls[i])) { name = ls[i]; i++; }
    if (ls[i] && TITLE_RE.test(ls[i])) { role = ls[i]; i++; }
  } else {
    name = ls[0] || ''; i = 1;
    if (ls[i] && TITLE_RE.test(ls[i])) { role = ls[i]; i++; }
    if (ls[i] && !ADDR_RE.test(ls[i])) { company = ls[i]; i++; }
  }
  return { name, role, company, address: ls.slice(i).join(', ') };
}

// Every customer: the app's own list first, then workbook customers not edited in the app.
export function allCustomers(own = [], book = null, names = {}, gmail = {}) {
  const out = own.map((c) => ({ ...c, source: c.source || 'app' }));
  const have = new Set(out.map((c) => c.code.toUpperCase()));
  // phones and emails from every quote and invoice of each customer, newest first
  const found = {};
  for (const d of [...(book?.register || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''))) {
    const code = (d.cust || '').toUpperCase();
    if (!code || !d.custLines?.length) continue;
    const bits = contactBits(d.custLines);
    if (!bits.emails.length && !bits.phones.length) continue;
    const who = splitLines(d.custLines).name;
    const f = (found[code] ||= { emails: [], phones: [], notes: [] });
    for (const e of bits.emails) if (!f.emails.includes(e)) f.emails.push(e);
    for (const p of bits.phones) if (!f.phones.includes(p)) f.phones.push(p);
    f.notes.push(`${who ? who + ': ' : ''}${[...bits.phones, ...bits.emails].join(', ')} (${d.quote || d.inv || d.sheet})`);
  }
  for (const c of book?.customers || []) {
    if (!c.id || /SAMPLE/i.test(c.id)) continue;
    const code = c.id.toUpperCase();
    const s = splitLines(c.lines);
    const f = found[code] || { emails: [], phones: [], notes: [] };
    const ph = splitPhones(f.phones);
    const fromBook = { name: s.name, role: s.role, company: names[c.id] || s.company, address: s.address, email: f.emails.join(', '), phone: ph.phone, mobile: ph.mobile };
    const note = f.notes.length ? `From your workbook: ${[...new Set(f.notes)].join('; ')}` : '';
    if (have.has(code)) {
      // an app copy keeps what the owner typed; empty boxes are filled from the workbook
      const i = out.findIndex((x) => x.code.toUpperCase() === code);
      const o = out[i];
      out[i] = { ...o, ...Object.fromEntries(Object.entries(fromBook).filter(([k, v]) => v && !o[k])), notes: o.notes || note, bookSites: (c.sites || []).length };
      continue;
    }
    out.push({ code, ...fromBook, notes: note, source: 'workbook', bookSites: (c.sites || []).length });
  }
  // landlines and mobiles in their own boxes (older copies kept both in Phone)
  for (const c of out) {
    if (c.mobile || !c.phone) continue;
    const ph = splitPhones(String(c.phone).split(/\s*[,;/|]\s*/));
    if (ph.mobile) { c.phone = ph.phone; c.mobile = ph.mobile; }
  }
  // emails found in the owner's sent Gmail: added to workbook customers, and to app copies with no email yet
  for (const c of out) {
    const g = gmail?.[c.code.toUpperCase()] || [];
    if (!g.length) continue;
    const have = emailList(c.email);
    if (c.source === 'app' && have.length) continue; // the owner's own list stays as he left it
    // the same address written with or without dots (enda.mullarkey@ / endamullarkey@): keep the one actually emailed
    const bare = (x) => x.replace(/\./g, '');
    const sent = g.map((x) => x.toLowerCase());
    const all = [...new Set([...sent, ...have.filter((x) => !sent.some((y) => bare(y) === bare(x)))])];
    c.email = all.join(', ');
    c.gmailFound = g.length;
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

export const customerLabel = (c) => [c.code, c.company || c.name, c.company && c.name ? c.name : ''].filter(Boolean).join(' · ');

// "a@x.ie, b@y.ie" → ['a@x.ie', 'b@y.ie']
export const emailList = (v) => String(v || '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
// Opens a new message in Gmail (the Gmail app on Android) to these addresses
export const gmailCompose = (to) => `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent([].concat(to).join(','))}`;

// Irish mobiles start 08 (083, 085, 086, 087, 089), or +353 8 / 00353 8; everything else is a landline
export const isMobile = (n) => {
  let d = String(n || '').replace(/[^\d+]/g, '');
  d = d.replace(/^(\+|00)353/, '0').replace(/^00?(?=8)/, '0');
  return /^08\d{7,8}$/.test(d);
};
export function splitPhones(list = []) {
  const all = list.map((x) => String(x || '').trim()).filter(Boolean);
  return { phone: all.filter((x) => !isMobile(x)).join(', '), mobile: all.filter(isMobile).join(', ') };
}

// Merge the customer lists of two devices: the newer copy of each customer wins, and the
// archive of previous details is the union of both, so no version is lost on either side.
export function mergeCustomers(mine = [], theirs = []) {
  const by = new Map(mine.map((c) => [c.code.toUpperCase(), c]));
  for (const t of theirs) {
    const k = t.code.toUpperCase();
    const m = by.get(k);
    if (!m) { by.set(k, t); continue; }
    const newer = (t.updatedAt || '') > (m.updatedAt || '') ? t : m;
    const hist = [...(m.history || []), ...(t.history || [])];
    const seen = new Set();
    const history = hist.filter((h) => { const key = h.at + JSON.stringify(h.before); if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => a.at.localeCompare(b.at));
    by.set(k, { ...newer, history });
  }
  return [...by.values()];
}
