# Architecture (plain English)

## The recommendation

**A web app that keeps your data on the phone, syncs to a Supabase database in Ireland, and is hosted for free on Cloudflare Pages. Claude reads and writes that database through Supabase's official connector.**

```
 Phone (browser / home-screen app)            Cloud (EU – Ireland)
 ┌──────────────────────────────┐            ┌──────────────────────────┐
 │ FSCF Doors app               │   sync     │ Supabase                 │
 │  • on-phone database         │ ─────────▶ │  • Postgres database     │◀── Claude (Supabase
 │  • plans + photos stored     │ ◀───────── │  • private file storage  │    connector): "price up
 │  • works with no signal      │ when online│  • login required        │    Clonskeagh", "draft the
 └──────────────────────────────┘            └──────────────────────────┘    Tearmann Ward report"
          ▲ app files served by Cloudflare Pages (free)
```

### Why this setup

- **Offline first.** The app saves every change to a database inside the phone's browser (IndexedDB). It never waits for signal. When signal returns, a sync step sends the changes up. Every record already has a "changed at" time and a "needs syncing" flag, so sync can be added without changing how you use the app.
- **Claude can use the data directly.** Supabase is a standard Postgres database, and Supabase has an official connector for Claude. Once it's connected, Claude can run queries like "every failed door at Clonskeagh with its defects", with no export step. There's a `door_defects` view that lays defects out one per row, ready for pricing.
- **Private and secure.** You need to log in to see anything. Row-level security means each row can only be read by its owner. Drawings and photos go into private storage buckets with no public links. The project is created in the EU (Ireland) region, which suits GDPR and HSE data.
- **Cheap.**
  - Cloudflare Pages hosting: €0.
  - Supabase free tier: €0. It includes 500 MB of database and 1 GB of file storage. Photos are shrunk to about 200–300 KB each, so that's roughly 3,000–4,000 photos.
  - When storage fills up: Supabase Pro at about $25 (≈ €23) a month, with 100 GB of files. That's about a quarter of the $999+ a year Truto connector.
  - One catch: Supabase pauses a free project after a week with no activity. Daily use stops that from happening, and a paused project restarts with one click.
- **No app store.** On iPhone, open it in Safari and choose Share → Add to Home Screen. On Android, open it in Chrome and choose Install app.

### What was ruled out

- **Fieldwire API**: it's an add-on with the price only available from sales. That locks you into their plan.
- **Google Sheets/Drive as the database**: it's easy for Claude to read, but it handles offline use, photos and several people editing at once badly.
- **A native iPhone/Android app**: it needs app-store accounts and costs more to build and maintain, for no gain in v1.

## How it lines up with Fieldwire

| Fieldwire | FSCF Doors |
| --- | --- |
| Projects with plans/sheets | Projects with plans (PDF pages or images) |
| Tap the plan to create a task pin | Tap **Add door**, then tap the plan to drop a numbered pin |
| Status colours: Priority 1/2/3 (red/orange/yellow), Completed (green), Verified (blue) | Inspection statuses: Not inspected (grey), Pass (green), Fail (red), No access (amber), Repaired (blue) |
| Task: title, category, photos, checklist | Door record: ref, location, type, leaf, defects + remedial + qty, photos, action, notes |
| Task list with filters | Door list with status chips and counts |
| CSV/PDF task reports, plan export with pins | Excel export built for pricing, plus a client PDF report with charts, marked-up plans and photos |

## Roadmap

1. **Done (v0.1):** projects, plan upload, pinch-zoom viewer, pins, door records, photos, door list, Excel export, backup/restore, offline.
2. **Next (phase 2): go live.**
   - Put it on Cloudflare Pages at a proper web address.
   - Create the Supabase project. Mark creates the account and I give the exact clicks.
   - Run `supabase/schema.sql`.
   - Add login and background sync.
   - Connect Supabase to Claude.
4. **Later:** Finnan as a second user, sharing with clients, report templates, links to the quotes and invoices workbook.
