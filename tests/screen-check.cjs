// Run: (cd dist && python3 -m http.server 8765) then  node tests/screen-check.cjs <scratch dir> [S9|Tab]
// Needs ?qa=1 (window.__qa) in the app. Every line it prints is a problem to fix before publishing.
// Full screen sweep: every page and the main pop-ups, phone + tablet, light + dark.
// Reports anything wider than the screen, page errors, and saves a screenshot per page.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const SP = process.argv[2];
const ONLY = process.argv[3];
const OUT = SP + '/sweep';
const LIB = process.env.LIB || SP + '/t/lib'; // local copies of xlsx / jspdf / autotable / jszip
const BOOK = process.env.BOOK || SP + '/wb/book.xlsx'; // a copy of the owner's workbook (never commit it)
fs.mkdirSync(OUT, { recursive: true });

const overflow = (p) => p.evaluate(() => {
  const W = document.documentElement.clientWidth;
  const out = [];
  const docW = document.documentElement.scrollWidth;
  if (docW > W + 1) out.push(`PAGE ${docW}>${W}`);
  const scroller = (e) => { for (let a = e.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if ((o === 'auto' || o === 'scroll' || o === 'hidden') && a !== document.body && a !== document.documentElement) return a; } return null; };
  for (const e of document.querySelectorAll('body *')) {
    if (e.closest('svg') && e.tagName !== 'svg') continue;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const sc = scroller(e);
    const lim = sc ? Math.min(W, sc.getBoundingClientRect().right) : W;
    if (sc && ['auto', 'scroll'].includes(getComputedStyle(sc).overflowX)) continue; // meant to scroll sideways
    if (r.right > lim + 1.5 && r.left < lim) {
      if ([...e.children].some((c) => c.getBoundingClientRect().right > lim + 1.5)) continue;
      out.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className?.baseVal ?? e.className).split(' ').slice(0, 2).join('.')} r=${Math.round(r.right)} lim=${Math.round(lim)} "${(e.innerText || e.value || '').trim().slice(0, 40)}"`);
    }
    // text cut off inside a box that doesn't scroll and has no ellipsis
    if (e.children.length === 0 && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === 'hidden' && getComputedStyle(e).textOverflow !== 'ellipsis' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName)) {
      out.push(`CUT ${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} "${(e.innerText || '').trim().slice(0, 40)}"`);
    }
  }
  return [...new Set(out)].slice(0, 30);
});

(async () => {
  const b = await chromium.launch();
  const report = [];
  for (const dev of ['Galaxy S9+', 'Galaxy Tab S4']) {
    if (ONLY && !dev.includes(ONLY)) continue;
    const ctx = await b.newContext({ ...devices[dev], deviceScaleFactor: 1, acceptDownloads: true });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.route(/xlsx.full.min.js/, (r) => r.fulfill({ path: LIB + '/package/dist/xlsx.full.min.js', contentType: 'application/javascript' }));
    await p.route(/jspdf.umd.min.js/, (r) => r.fulfill({ path: LIB + '/jspdf-2.5.1/package/dist/jspdf.umd.min.js', contentType: 'application/javascript' }));
    await p.route(/jspdf.plugin.autotable.min.js/, (r) => r.fulfill({ path: LIB + '/jspdf-autotable-3.8.2/package/dist/jspdf.plugin.autotable.min.js', contentType: 'application/javascript' }));
    await p.route(/jszip.min.js/, (r) => r.fulfill({ path: LIB + '/jszip/dist/jszip.min.js', contentType: 'application/javascript' }));
    const U = 'http://localhost:8765/index.html?qa=1';
    await p.goto(U); await p.waitForTimeout(1500);
    await p.click('#demo'); await p.waitForTimeout(2500);
    const closeModals = async () => { for (let i = 0; i < 4 && await p.locator('.modal-wrap').count(); i++) { await p.evaluate(() => { const w = [...document.querySelectorAll('.modal-wrap')].pop(); (w.querySelector('.modal-actions button') || w.querySelector('button')).click(); }); await p.waitForTimeout(500); } };
    await closeModals();
    // workbook for the Business pages
    await p.goto(U); await p.waitForTimeout(1500);
    await p.evaluate(() => window.__qa.go({ view: 'business' })); await p.waitForTimeout(1200);
    if (await p.locator('#biz-import').count()) { await p.setInputFiles('#biz-import', BOOK); await p.waitForTimeout(25000); await closeModals(); }
    // a live visit on the demo drawing, so the pin can be recorded on (RAMS lock)
    await p.evaluate(async () => { const db = window.__qa.db; for (const pr of await db.all('projects')) { const pls = (await db.all('plans')).filter((x) => x.projectId === pr.id); const services = { ...(pr.services || {}) }; for (const pl of pls) services['plan:' + pl.id] = { startedAt: new Date().toISOString(), sessions: [{ start: new Date().toISOString(), end: null }], work: 'insp' }; await db.put('projects', { ...pr, services }); } });
    const ids = await p.evaluate(async () => {
      const open = (n) => new Promise((res) => { const r = indexedDB.open('fscf-doors'); r.onsuccess = () => { const d = r.result; const tx = d.transaction(n); const g = tx.objectStore(n).getAll(); g.onsuccess = () => res(g.result); }; });
      const projects = await open('projects'); const plans = await open('plans'); const doors = await open('doors'); const quotes = await open('quotes').catch(() => []);
      const pr = projects[0]; const pl = plans.find((x) => x.projectId === pr.id); const dr = doors.filter((x) => x.planId === pl.id).sort((a, b) => (b.defects?.length || 0) - (a.defects?.length || 0))[0];
      return { pid: pr.id, plid: pl.id, did: dr.id, qid: quotes[0]?.id };
    });
    const views = [
      ['home', { view: 'projects' }],
      ['schedule', { view: 'schedule' }],
      ['repairs-all', { view: 'repairsAll' }],
      ['bizhub', { view: 'bizhub' }],
      ['customers', { view: 'customers' }],
      ['health-safety', { view: 'hs' }],
      ['business', { view: 'business' }],
      ['quotes', { view: 'quotes' }],
      ['pricing', { view: 'pricing' }],
      ['settings', { view: 'settings' }, async () => { await p.evaluate(() => document.querySelectorAll('.panel.fold.is-closed').forEach((x) => x.classList.remove('is-closed'))); }],
      ['defect-list', { view: 'settings', focus: 's-defs', openDefs: true }],
      ['library', { view: 'library' }],
      ['assistant', { view: 'assistant' }],
      ['site-plans', { view: 'project', projectId: ids.pid, tab: 'plans' }],
      ['site-doors', { view: 'project', projectId: ids.pid, tab: 'doors' }],
      ['site-repairs', { view: 'project', projectId: ids.pid, tab: 'repairs' }],
      ['site-files', { view: 'project', projectId: ids.pid, tab: 'files' }],
      ['site-export', { view: 'project', projectId: ids.pid, tab: 'export' }],
      ['drawing', { view: 'plan', projectId: ids.pid, planId: ids.plid }],
      ['pin', { view: 'plan', projectId: ids.pid, planId: ids.plid, doorId: ids.did }],
    ];
    if (ids.qid) views.push(['quote-doc', { view: 'quote', quoteId: ids.qid }]);
    const dialogs = {
      home: ['#qk-new', '#qk-quote'],
      pin: ['#add-defect', '#sh-copyfrom', '#sh-kind', '#sh-copyto'],
      'defect-list': ['.def-cost, [data-act="cost"], button:has-text("Set cost")'],
      business: ['.biz-cust:not(.biz-site)|.biz-soa'],
      'site-plans': ['.coll-copy', '.site-cust'],
      customers: ['.cu-row', '#cu-new'],
      'health-safety': ['.hs-tpl', '#lad-add'],
      'site-files': ['#file-newf'],
      'site-export': ['#pdf'],
    };
    for (const scheme of ['light', 'dark']) {
      await p.emulateMedia({ colorScheme: scheme });
      for (const [name, st, prep] of views) {
        await closeModals();
        await p.evaluate((st) => window.__qa.go(st), st); await p.waitForTimeout(1300);
        if (prep) await prep();
        // open every fold so hidden parts are checked too
        await p.evaluate(() => document.querySelectorAll('details:not([open])').forEach((d) => { d.open = true; }));
        await p.waitForTimeout(300);
        const tag = `${dev.replace(/\W+/g, '')}-${scheme}-${name}`;
        let o = await overflow(p);
        if (name === 'pin') { // the pin is a scrolling sheet: check it at several depths
          const H = await p.evaluate(() => document.getElementById('sheet')?.scrollHeight || 0);
          for (let y = 0; y < H; y += 600) { await p.evaluate((y) => document.getElementById('sheet').scrollTo(0, y), y); await p.waitForTimeout(80); o = o.concat(await overflow(p)); }
          o = [...new Set(o)];
          await p.evaluate(() => document.getElementById('sheet').scrollTo(0, 0));
        }
        if (scheme === 'light' || o.length) await p.screenshot({ path: `${OUT}/${tag}.png`, fullPage: name !== 'pin' && name !== 'drawing' });
        report.push([tag, o]);
        if (scheme === 'light') for (const sel of dialogs[name] || []) {
          let s2 = sel;
          if (sel.includes('|')) { const [pre, post] = sel.split('|'); await p.locator(pre).first().click().catch(() => {}); await p.waitForTimeout(500); s2 = post; }
          const btn = p.locator(s2).first();
          if (!(await btn.count()) || !(await btn.isVisible().catch(() => false))) { report.push([`${tag} dialog ${sel}`, ['(button not found)']]); continue; }
          await btn.click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(900);
          const has = await p.locator('.modal-wrap').count();
          const d = has ? await overflow(p) : ['(no dialog opened)'];
          report.push([`${tag} dialog ${sel}`, d]);
          if (has) await p.screenshot({ path: `${OUT}/${tag}-dlg-${sel.replace(/\W+/g, '')}.png` });
          await closeModals();
          if (name === 'pin') { await p.evaluate((st) => window.__qa.go(st), st); await p.waitForTimeout(1000); }
        }
      }
    }
    report.push([`${dev} page errors`, errs]);
    await ctx.close();
  }
  for (const [k, v] of report) if (v.length) console.log(`\n## ${k}\n  ` + v.join('\n  '));
  console.log('\nchecked', report.length, 'screens/dialogs');
  await b.close();
})();
