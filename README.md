# SingleTrack Events — Warehouse

Packing, packlists, stocktaking and transport for trail running events.

Built for the way this work actually happens: standing in a shed with a crate under
one arm, or at an aid station on a ridgeline with no phone reception. Everything
runs on the device — install it once and it keeps working with the mobile data
turned off.

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
  styles/      Design tokens and component CSS
```

Domain logic is kept out of the components and is covered by tests that run
against the real Dexie stack on a fake IndexedDB, so transactions and indexes are
exercised rather than mocked.

```bash
npm test    # 93 tests
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

## Possible next steps

- A sync server, using the metadata already on every record.
- Photo attachments on delivery confirmations.
- Weight and volume per item to warn when a load won't fit in the vehicle.
- Per-runner template scaling wired to actual entry numbers.
