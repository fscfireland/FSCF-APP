# FSCF Doors

Fire door inspection app for FSCF Ireland. It's a mobile web app: it runs in the phone's browser, can be added to the home screen, and works with no signal.

**Status: v0.1 prototype.** Everything is saved on the phone. Cloud sync and Claude access come in phase 2 (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## What it does now

- **Projects**: one per site (site name, client, address, inspection date).
- **Plans**: upload a floor plan as a PDF or an image. Each PDF page becomes its own plan. Pinch to zoom and drag to pan. Double-tap zooms in.
- **Pins**: tap **Add door**, then tap the plan. Pins are numbered 1, 2, 3… per project and coloured by status:
  grey = not inspected, green = pass, red = fail, amber = no access, blue = repaired.
  To move a pin, open it and tap **Move pin**, then drag it or tap the new spot.
- **Door record**: door ref, location, door type (FD30/EI 30 etc.), leaf configuration, status, photos (camera or gallery), defects with suggested remedial work and quantity, recommended action, notes, and inspected on/by. It saves as you type.
  Adding a defect to a door that's "Not inspected" or "Pass" sets it to "Fail" automatically.
- **Inspection questions**: a checklist set up in Settings, answered Pass / Fail / N/A for each door. "Mark rest Pass" fills in any unanswered questions as Pass. A Fail answer sets the door to Fail.
- **Recommended actions**: each door can have several, picked from your list or typed in. Actions you type are saved to the list for next time.
- **Materials**: a priced materials list in Settings. Each door shows quantity × unit cost per line and a door total (€ ex VAT).
- **Door list**: all doors on a project, with status filter chips and counts, plus search.
- **Excel export**: Summary, Doors, Checklist, Defects (pricing), Materials and Material totals (with formulas and totals), and Defect totals.
- **Settings**: edit the questions, actions, materials and prices, the defect list (each with its default remedial wording), door types and the inspector name. You can also back up and restore everything, photos included.

## Running it (for developers)

```bash
npm install
npm run dev      # builds to dist/ and serves on http://localhost:5173
npm run build    # builds dist/ for hosting
```

`dist/` is a static site. Host it on Cloudflare Pages (build command `npm run build`, output folder `dist`).
`dist/artifact.html` is a single-file copy used for the preview inside Claude.

## Code map

| File | What it does |
| --- | --- |
| `src/main.js` | Screens, navigation and the door record form |
| `src/viewer.js` | Plan viewer: pinch-zoom, pan and pins |
| `src/db.js` | On-phone database (IndexedDB), with sync-ready fields |
| `src/files.js` | PDF and photo processing, file saving |
| `src/export.js` | Excel workbook |
| `src/backup.js` | Backup and restore |
| `src/defaults.js` | Statuses, door types, default defect list |
| `public/sw.js` | Offline caching (service worker) |
| `supabase/schema.sql` | Cloud database for phase 2 |
