# SingleTrack Events — Warehouse

Packing, packlists, stocktaking and transport for trail running events.

Built for the way this work actually happens: standing in a shed with a crate under
one arm, or at an aid station on a ridgeline with no phone reception. Everything
runs on the device — install it once and it keeps working with the mobile data
turned off.

**Live app:** https://singletrackevents.github.io/Singletrack-Events-Warehouse-management-/

Open it on a phone and use "Add to Home Screen" to install it. Every push to
`claude/warehouse-management-trail-events-wrbycb` rebuilds and redeploys it.

## What it does

**Stock** — an item catalogue with categories, bin locations, pack sizes and
reorder points. Every quantity change writes to a movement ledger recording who,
why, and the balance afterwards, so a surprising number on race morning can be
traced back rather than argued about.

**Packlists** — one list per destination, built from reusable templates
("standard aid station", "remote 4WD station", "event village core"). Packing mode
is a full-width tap target per line so a list can be worked one-handed, with a
stepper for partial packs. Must-have items are flagged and warned about before a
list is marked packed.

**QR codes** — every packlist and crate gets a short code (`AS3-7K2M`,
`AS3-7K2M/02`) and a printable QR label. Scanning opens the right list; the code
can also be typed or read out over the radio when the camera won't cooperate.
Supplier barcodes can be linked to items so scanning a carton opens its stock
page.

**Stocktake** — count sessions scoped to everything or one category, ordered by
bin so you walk the racks rather than an alphabet. Expected quantities are
re-read at the moment each line is counted, so a truck leaving mid-count doesn't
create a phantom discrepancy. Uncounted lines are never zeroed.

**Transport** — a load is one vehicle doing one trip: a driver, a run sheet in
delivery order, access notes per stop, and a delivery confirmation with a name.
Departing the warehouse issues everything on board out of stock; reconciling
returns books back whatever came home.

**Paper** — printable packlists with tick boxes and a signature line, plus CSV
export. Paper is still the fallback when a phone dies at an aid station.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Run the test suite |
| `npm run lint` | Lint |
| `npm run icons` | Regenerate PWA icons from `public/icon.svg` |

A new install seeds a worked example — one race a fortnight out and mid-pack, one
in planning, one just finished — so the app opens on something recognisable
rather than an empty shell. Settings → Data clears it once you're ready to enter
your own gear.

### Installing it on a phone

Open the built app in the browser and use "Add to Home Screen". It installs as a
standalone app, precaches itself, and opens offline from then on.

## How the data works

Everything lives in IndexedDB on the device. There is no server, no account and
nothing to pay for — which is what makes it work in the mountains.

Every record nonetheless carries the metadata a sync backend would need: a stable
UUID, a revision counter, `updatedAt`, the originating device, and a soft-delete
tombstone instead of a hard delete. Writes go through `src/db/repo.ts`, which
stamps all of it. Adding a server later is a sync layer, not a data migration.

Until then, data moves as files. Settings → Backup exports the whole device;
an event page exports just that race, its packlists and the catalogue they refer
to — the file you hand to a driver. Imports **merge** by revision, so importing a
stale file can never undo fresher local work.

## Layout

```
src/
  db/          Schema, Dexie database, CRUD helpers, demo data
  domain/      Business logic — stock ledger, packlist lifecycle, stocktake,
               transport, backup, short codes, formatting
  hooks/       Live queries (Dexie useLiveQuery) and search
  components/  Shared UI — sheets, steppers, toasts, scanner, QR codes
  screens/     One file per screen, lazily routed
  sync/        Backend contract, role permissions, sync engine, mock server
  styles/      Design tokens and component CSS
```

Domain logic is kept out of the components and is covered by tests that run
against the real Dexie stack on a fake IndexedDB, so transactions and indexes are
exercised rather than mocked.

```bash
npm test    # 145 tests
```

## Design notes

- **Sunlight and gloves.** 48px minimum tap targets, heavy weights, solid fills,
  16px inputs so iOS doesn't zoom on focus. Light and dark themes, plus a manual
  override for people who keep their phone on one setting.
- **Filters default to what's left.** Packing and counting both open on the
  outstanding items so the list shrinks as the work gets done.
- **Sticky primary action.** The one thing to do next sits under the thumb.
- **Hash routing.** QR deep links resolve wherever the app is served from — a
  subfolder, a static host, a copy on the warehouse laptop — with no server
  rewrites.
- **Scanning degrades.** Native `BarcodeDetector` where it exists, jsQR
  everywhere else (including iOS Safari), and a typed-code fallback under both.

## Sync and access

The app still runs perfectly with no account at all — that is the default, and
nothing about it changed. Connecting a backend is opt-in, from More → Accounts &
sync.

### How sync works

The local database stays the source of truth for everything on screen. Sync runs
behind it and never blocks the UI, because the moment it does the app stops
working in exactly the places it is needed: a shed with thick walls, a valley
with no bars.

- Every write stamps `syncedAt: null`, so **the outbox is a query, not a second
  bookkeeping structure** that could drift out of step with the data.
- A cycle pushes the outbox first, so local work is safe on the server before
  remote changes are merged in.
- Conflicts resolve newest-revision-wins — the same rule as the file import, so
  a device back from a weekend offline cannot stomp fresher work by reconnecting.
- A row edited while its push is in flight stays in the outbox. Revisions are
  compared before anything is marked as sent.

### Roles

| Role | Can do |
| --- | --- |
| **Admin** | Everything, including the catalogue and who else has access |
| **Crew** | Pack, adjust stock, run stocktakes, build loads |
| **Driver** | Assigned loads, confirm deliveries |
| **Volunteer** | One aid station's packlist; record what arrived |

Volunteers are pinned to a single destination for a single event, and may only
change what *arrived* — never what was supposed to be sent, since that would
quietly erase the evidence of a short delivery.

`src/sync/permissions.ts` holds the rules as a table you can read top to bottom.
They run on the client so the UI can hide what someone cannot do; **a real
backend must mirror them in row-level security.** The client copy is a courtesy,
not a security boundary.

### Two ways in

Core crew sign in with an email link. Volunteers scan an invite QR at their aid
station and type their name — no inbox, no password, nothing to remember, because
race morning is the worst possible time to make someone set up an account. Invites
are scoped to one destination and expire after the weekend.

### Adding a real backend

`src/sync/types.ts` defines a `SyncBackend` interface; everything above it —
screens, engine, permission checks — is written against that and not against any
particular vendor. Today the only implementation is `MockBackend`, a stand-in
that stores rows in its own IndexedDB and applies the same conflict rule and the
same permission checks a server will. That makes the engine and the role model
genuinely testable, but it **cannot move data between devices** — the one thing a
real backend is for.

To go live, add an adapter implementing that interface (Supabase is the obvious
fit: Postgres, auth, row-level security, a Sydney region) and register it in
`src/sync/index.ts`. No caller changes.

Still to do before a real race:
- The Supabase adapter and matching row-level security policies.
- Per-screen gating beyond the navigation tabs — the permission model exists and
  the backend refuses disallowed writes, but individual screens do not yet hide
  every control a limited role cannot use.
- Realtime updates, so a change appears without waiting for the next sync.

## Possible next steps

- Photo attachments on delivery confirmations.
- Weight and volume per item to warn when a load won't fit in the vehicle.
- Per-runner template scaling wired to actual entry numbers.
