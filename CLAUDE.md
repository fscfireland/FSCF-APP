# FSCF Ireland app – notes for Claude

Read this first in every session. It holds the owner's standing rules. The owner
is Mark Crosby, director of FSCF Ireland (fire door inspection, remedial repairs,
replacements, fire stopping). He is not a coder: reply in plain language and
give working results.

## The app
- Field app for fire door inspections, remedials and replacements. It replaces Fieldwire.
- Vanilla JS (ES modules) in `src/`, bundled by esbuild (`npm run build`) into `dist/`.
  `dist/artifact.html` is a single-file copy that is published as the owner's app.
- **The owner's app link:** https://claude.ai/artifact/HLzc3tFevBuKKzBXUWeSZg.
  Always republish to this URL (Artifact tool, `url` set to it). Never create a new artifact for the app.
  A stale duplicate exists at https://claude.ai/artifact/6UdMHH6yDVSH2t37tsnEbw. Don't update it.
- Data is stored on each device (IndexedDB `fscf-doors`). The Supabase online version is not live yet,
  so each device and each person keeps their own copy.
- Bump `VERSION` in `public/sw.js` on every release.
- Develop on branch `claude/fscf-fire-door-app-cirxvt`. Commit and push after every change.
- The owner uses a **Samsung (Android) phone and tablet**. Test at Samsung sizes
  (Playwright devices `Galaxy S9+`, `Galaxy Tab S4`).
- See `docs/ARCHITECTURE.md` for the code map.

## Standing rules (do not break these)

### 1. Everything must be cited or referenced
Every check, question, defect, remedial, rule, default value, threshold and piece of
guidance in the app, and everything in its reports, must point to a source document:
a standard, regulation, technical guidance document, manufacturer's certificate or
data sheet, or an FSCF document. The aim is that every line the app produces can be
traced back to a reference. Nothing should be the app's own opinion.
- Cite in the text, e.g. `(BS 8214:2026, 13.1)`, `(Gen App Regs 2007, Reg 12(f))`,
  `(TGD B 2024)`, `(I.S. EN 1634-1)`, `(EN 1935)`, `(DHF guide to BS EN 1125/179)`,
  `(Fire Safety for Building Owners manual)`.
- When adding anything new, find and state its source. If no source can be found, say so
  to the owner and mark it `(FSCF practice, source to be confirmed)` rather than inventing one.
- Never make up a clause number. Check it against the document (Drive or the owner's
  uploads) or say it is unconfirmed.
- Sources already used and saved in the owner's Drive:
  - HSA guide to the General Application Regulations 2007 (Regs 11–12)
  - Safety, Health and Welfare at Work Act 2005
  - BS 8214:2016 and BS 8214:2026
  - TGD M, TGD B, the DHF best-practice guide, and the Fire Safety for Building Owners manual
  - BM TRADA Q-Mark Fire Door Maintenance: SUIN 058 (Iss 1, 05/01/2026) with DCS 058 condition survey (Iss 2),
    and the Accepted Repair Techniques (ART index Iss 10, every ART issued 01/01/2026) – `src/arts.js`
  - GAI Specifier's Guide, Ironmongery for Fire and Escape Doors (section 8, maintenance)

### 2. Capitals house style
Everything on screen, and in every PDF and Excel file, is in CAPITALS (`src/caps.js`),
with two exceptions:
- Fire ratings keep the small "a" the standards use: E30Sa, E60Sa4, EW30Sa.
- Checklist questions, defects and repair items: only the heading before the colon is in
  capitals, and the rest stays as written ("DOOR LEAF: free from damage…").

Long lines in PDFs wrap; they are never shrunk or cut off.

### 3. Doors and pins
- Pin refs / IDs are always numeric: 001, 002, 003… Never letters.
- Door types use the European classification first with FD in brackets: `E30Sa (FD30S)`.
  Final exits are not fire doors and have their own checklists (EN 1125 panic / EN 179 emergency).
- Leaf / swing options include SASD RH, SASD LH, DADD, SADD BLRH, SADD BLLH and SADD Equal pair.

### 4. Money
- Margins and FSCF cost prices never appear to the customer.
- Costs are hidden unless the owner unlocks them with the owner PIN (`priced()`).
- Drawing reader (Claude vision) costs are shown only as a warning, "Cost will be
  charged to your account", with no amounts unless prices are unlocked.

### 5. Repairs, replacements, inspections
- Repairs are kept separate from inspections, with their own photos, sheet and plan tab.
- Remedials come from the checklist and defects.
- Replacements use the Replacement drop-down and its fields (`src/fields.js`,
  Settings › Fields). They feed the production list export for the joinery.

### 6. Backups
- Google Drive backups go to the Drive folder **16 FSCF IRELAND APP BACKUPS**
  (id `1NOIIZ0iNsIFQB8zUYQeGTtOCWubN2w7H`), with an automatic daily backup while the app is open.
- The owner's Drive top-level folders are numbered (01 COMPANY & ADMIN … 16). New top-level
  folders take the next number.

## Working style
- Show a clickable mock-up first when a change is large or visual and the owner asks to see it.
- Test every change (Playwright, plus openpyxl or pdftotext for exports) before publishing.
- Keep existing behaviour unless the owner asks to change it. Add, don't rework.

## Handover (end of the first long session, 26 Nov 2026)
- All work is committed on branch `claude/fscf-fire-door-app-cirxvt`. A new session that is given
  a different branch name should start from this branch (`git fetch origin claude/fscf-fire-door-app-cirxvt`
  and branch from / merge it) so nothing is lost, then publish to the owner's app link above.
- The owner's invoices and quotes workbook ("INVOICES AND QUOTES REV …" xlsx) is modelled by the app's
  Quotes & invoices section (`src/quotes.js`). The owner has uploaded it to the app's **Pricing Hub**
  (owner-only page, added by a parallel session) – copies are also in Google Drive. Check the latest
  revision before changing quotes.
- Done recently: Replacement fields + production list; BM TRADA Q-Mark DCS 058 checklist (`qmark`),
  ART picker with revisions (`src/arts.js`), door grade level, architrave survey (MFSS 058, tick per door);
  ironmongery maintenance (on by default); capitals house style in app, PDFs and Excel; Drive backups.
- Business page (owner-only, home screen and Pricing Hub, `src/business.js`): overdue / unpaid / paid invoices,
  year totals by month, customers and their sites, type of work, materials / labour / margin from the SERV PD
  pricing tabs, quote win rate, Excel summary. Built from the imported workbook + app documents; "Mark paid" on
  workbook invoices is stored in settings `bizMarks` (the Excel file is not changed). Each workbook import
  archives the one it replaces (settings records `kind: 'bookArchive'`, register/customers/PD totals only), warns
  if the new file looks older, and shows what changed; Business › Workbook imports lists, views and compares them.
  Business figures take Date / Subtotal / Total from the SUMMARY register first. Customer names can be set by the owner
  (settings `bizNames`). Invoices with status WIP/PROC are "not sent yet": listed, but not counted as invoiced or owed
  (the owner's SUMMARY keeps WIP separate). Customer panel lists each invoice with its work-type code (FDREM, CALLO…).
- Reminders (`src/agenda.js`, Business page): chase payment / send WIP invoice / inspection due (door nextDue, 90 days).
  Out to Google Calendar (connector `Google Calendar`, tool `create_event`; fields read at run time with describeTool),
  a .ics calendar file (no connector needed), and Gmail drafts (connector `Gmail`, `create_draft`; never sends).
  Already-added items kept in settings `calSync`. Artifact manifest: Google Drive create_file, Google Calendar
  create_event, Gmail create_draft, downloads. Google Tasks: no connector exists yet; the agenda list has stable ids
  ready for it (TASKS in agenda.js). Next step the owner wants:
  customer portal / website login per customer (needs the Supabase online version).
- Left for later (owner's choice): the rest of the BM TRADA paperwork – Scheme Procedures Acceptance (SPA 058,
  prescribed wording, client signature), Record of Maintenance Activities (RMA 058) and the RMA pack PDF,
  RMA register (LMR/CMR 058), photo tags before/during/after, maintenance label fitted, operative initials,
  ARTs completed with revisions, annual ART expiry warning. Also: reference audit of the older default
  questions/defects (rule 1), headings on questions/defects that have none ("DOOR CLOSER: …"),
  ironmongery maintenance as a priced item in customer quotes, Supabase online version / own web address.
