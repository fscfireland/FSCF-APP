// FSCF house style: everything on screen in capitals, with two exceptions.
//  1. Fire ratings keep the small "a" the standards use: E30Sa, E60Sa4, EW30Sa.
//  2. Checklist questions, defects and repair items: only the heading before
//     the colon is in capitals ("DOOR LEAF: free from damage…", "HINGES: fewer
//     than 3…"); the rest stays as written.
// Text the user types (inputs, notes boxes) is left as typed. Ask Claude's
// answers keep normal case so they stay readable.

const RATING = /\b(E[IW]?\d{2,3}S)A(\d?)\b/g;
export const caps = (s) => s.toUpperCase().replace(RATING, '$1a$2');
export function headCaps(s) {
  const m = /^(\s*)([^:\n]{2,40}):(\s*)/.exec(s);
  return m ? m[1] + caps(m[2]) + ':' + m[3] + s.slice(m[0].length) : s;
}

const SKIP = 'script, style, textarea, input, svg, [contenteditable], .keep-case, .ai-msg, .ai-log';
const HEAD = '.hc, .q-label, .q-arr-text, .defect > .defect-top b, .rep-check b';
const done = new WeakMap(); // text node -> the text we set, so we don't redo it

function fixText(node) {
  const el = node.parentElement;
  if (!el || done.get(node) === node.nodeValue || !/[a-z]/.test(node.nodeValue)) return;
  if (el.closest(SKIP)) return;
  if (el.tagName === 'OPTION' && !el.hasAttribute('value')) el.setAttribute('value', el.textContent); // keep the stored value as written
  const head = el.closest(HEAD);
  const v = head ? (node === firstText(head) ? headCaps(node.nodeValue) : node.nodeValue) : caps(node.nodeValue);
  if (v !== node.nodeValue) node.nodeValue = v;
  done.set(node, node.nodeValue);
}
function firstText(el) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) if (n.nodeValue.trim()) return n;
  return null;
}
function fixTree(root) {
  if (root.nodeType === 3) return fixText(root);
  if (root.nodeType !== 1) return;
  if (root.matches?.('input[placeholder], textarea[placeholder]') && /[a-z]/.test(root.placeholder)) root.placeholder = caps(root.placeholder);
  root.querySelectorAll?.('input[placeholder], textarea[placeholder]').forEach((i) => { if (/[a-z]/.test(i.placeholder)) i.placeholder = caps(i.placeholder); });
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  const list = [];
  while ((n = w.nextNode())) list.push(n);
  list.forEach(fixText);
}

export function startCaps(root = document.body) {
  fixTree(root);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') fixText(m.target);
      else m.addedNodes.forEach(fixTree);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}

// ---------- reports: PDFs and Excel workbooks in the same house style ----------
// Question, defect and repair texts keep the "HEADING: rest as written" rule;
// links and e-mail addresses are left alone.
let headTexts = new Set();
export function setHeadTexts(list) {
  headTexts = new Set(list.filter(Boolean).map((s) => String(s).trim()));
}
export function smartCaps(s) {
  if (typeof s !== 'string') return s;
  if (!/[a-z]/.test(s)) return s.replace(RATING, '$1a$2');
  if (/https?:\/\/|www\.|@[\w-]+\./i.test(s)) return s;
  const k = s.trim();
  if (headTexts.has(k)) return headCaps(s);
  if (/…$/.test(k)) {
    const pre = k.slice(0, -1).trim();
    for (const h of headTexts) if (h.startsWith(pre)) return headCaps(s);
  }
  // "Q3: question text" / "Defect – remedial": the known text after a label
  for (const sep of [': ', ' – ', ' - ']) {
    const i = s.indexOf(sep);
    if (i > 0 && headTexts.has(s.slice(i + sep.length).trim())) return caps(s.slice(0, i + sep.length)) + headCaps(s.slice(i + sep.length));
  }
  return caps(s);
}

// Every text cell in a SheetJS workbook (formulas and numbers untouched)
export function capsWorkbook(wb) {
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    for (const ref of Object.keys(ws)) {
      if (ref[0] === '!') continue;
      const c = ws[ref];
      if (c && c.t === 's' && !c.f && typeof c.v === 'string') {
        c.v = smartCaps(c.v);
        if (c.w) delete c.w;
        if (c.h) delete c.h;
        if (c.r) delete c.r;
      }
    }
  }
  return wb;
}

// A jsPDF document whose text comes out in the house style. Lines that
// splitTextToSize has already styled are drawn as they are.
export function capsPdf(doc) {
  const styled = new Set();
  const map = (v) => (Array.isArray(v) ? v.map(map) : typeof v === 'string' && !styled.has(v) ? smartCaps(v) : v);
  const text = doc.text.bind(doc);
  const split = doc.splitTextToSize.bind(doc);
  const width = doc.getTextWidth.bind(doc);
  doc.text = (t, ...a) => text(map(t), ...a);
  doc.splitTextToSize = (t, ...a) => {
    const out = split(map(t), ...a);
    (Array.isArray(out) ? out : [out]).forEach((l) => styled.add(l));
    return out;
  };
  doc.getTextWidth = (t, ...a) => width(map(t), ...a);
  // table plug-ins measure with these
  if (doc.getStringUnitWidth) {
    const unit = doc.getStringUnitWidth.bind(doc);
    doc.getStringUnitWidth = (t, ...a) => unit(map(t), ...a);
  }
  if (doc.getTextDimensions) {
    const dim = doc.getTextDimensions.bind(doc);
    doc.getTextDimensions = (t, ...a) => dim(map(t), ...a);
  }
  return doc;
}
