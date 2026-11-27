// Customer list (owner, 27 Nov 2026).
// The owner's workbook already gives every customer a code: a short abbreviation
// of the company, then a number (CHES-001, STMAR-002, HSEMW-001…). New customers
// typed into the app get a code made the same way. Customers from the workbook
// show up automatically; editing one in the app keeps the app's copy.

// words that say nothing about which company it is
const NOISE = new Set(['ltd', 'limited', 'clg', 'dac', 'plc', 'llp', 'inc', 'the', 'and', 'of', 'co', 'company', 'c/o', 'co.', 't/a', '&']);
// job titles: a line made of these is the contact's role, not the company
const TITLE_RE = /\b(manager|director|officer|foreman|engineer|superintendent|registrar|treasurer|principal|secretary|administrator|supervisor|technician|owner|proprietor|ceo|coo|chairman|chairperson|pic|surveyor|caretaker|head)\b/i;
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

// Name / company / address out of the customer box lines on a workbook tab.
export function splitLines(lines = []) {
  const ls = lines.map(clean).filter(Boolean);
  let name = '';
  let role = '';
  let company = '';
  let i = 0;
  const looksCompany = (s) => !ADDR_RE.test(s) && COMPANY_RE.test(s) || /^[A-Z0-9 &'.,-]{4,}$/.test(s) && s.split(" ").length >= 2 && !TITLE_RE.test(s) && !ADDR_RE.test(s);
  if (ls[0] && looksCompany(ls[0]) && !(ls[1] && looksCompany(ls[1]) && !TITLE_RE.test(ls[1]))) {
    company = ls[0]; i = 1;
    if (ls[i] && !looksCompany(ls[i]) && !ADDR_RE.test(ls[i])) { name = ls[i]; i++; }
    if (ls[i] && TITLE_RE.test(ls[i])) { role = ls[i]; i++; }
  } else {
    name = ls[0] || ''; i = 1;
    if (ls[i] && TITLE_RE.test(ls[i])) { role = ls[i]; i++; }
    if (ls[i] && !ADDR_RE.test(ls[i])) { company = ls[i]; i++; }
  }
  return { name, role, company, address: ls.slice(i).join(', ') };
}

// Every customer: the app's own list first, then workbook customers not edited in the app.
export function allCustomers(own = [], book = null, names = {}) {
  const out = own.map((c) => ({ ...c, source: c.source || 'app' }));
  const have = new Set(out.map((c) => c.code.toUpperCase()));
  for (const c of book?.customers || []) {
    if (!c.id || have.has(c.id.toUpperCase()) || /SAMPLE/i.test(c.id)) continue;
    const s = splitLines(c.lines);
    out.push({ code: c.id.toUpperCase(), ...s, company: names[c.id] || s.company, email: '', phone: '', notes: '', source: 'workbook', bookSites: (c.sites || []).length });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

export const customerLabel = (c) => [c.code, c.company || c.name, c.company && c.name ? c.name : ''].filter(Boolean).join(' · ');
