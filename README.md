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

**Food plan** — race projections in, shopping list and aid station quantities
out. Each event carries its races and their projected fields; each aid station
names the races passing through it (twice, where the course doubles back) and a
per-runner ratio per item — 0.2 cans of coke, 0.022 packs of electrolyte — plus
flat amounts for the salt shaker and the tea box. Quantities are derived, never
typed: bump the 50k field by fifty and every station feeding it moves, along
with the totals-to-order list, which nets demand off warehouse stock and
exports as a CSV for the supplier run. One tap sends the computed quantities
onto each station's packlist, and it's safe to tap again whenever projections
change — planned items are set to today's numbers, hand-added lines are never
touched.

**Import a pack list** — the crew's lists already exist as spreadsheets and PDF
run sheets, so the app reads them rather than asking for them again. Pick an
event, pick a file (Excel, CSV or PDF), and the sheet is read on the device:
stations across the top, one block per station, or a plain list. Headings are
matched to the event's destinations and names to the catalogue, loosely enough
that "Trestle table" finds "Trestle Tables" and "GC Carpark" finds Grand Canyon
Carpark. Everything is shown back before it is written: the matcher's guesses
are marked as guesses, anything the warehouse has never heard of is offered as
a new item with a category, and a heading that matches no station can be
skipped or created. An item lands on a packlist once however many times the
file mentions it, and importing the same file twice changes nothing.

**Packing assistant** — on any packlist, an admin can tap "Check this list" and
Claude reads the list against the catalogue, the templates for that kind of
station, the food plan, earlier editions of the same station and the notes the
admin has written, then says what looks missing, which quantities look wrong
and what it would ask. Every suggestion is a button: add the item, set the
quantity, or dismiss it, and a dismissal can be made permanent with one more
tap. Its memory is a list of short notes under More → Packing assistant, each
pinned to an event, a kind of destination, or neither, so it stays specific to
how SingleTrack packs. Nothing it says touches a list until somebody taps. See
"The packing assistant" below for setup and cost.

**Codes** — every packlist gets a short code (`AS3-7K2M`) that can be typed into
the scanner or read out over the radio. Supplier barcodes can be linked to items
so scanning a carton opens its stock page.

**Stocktake** — count sessions scoped to everything or one category, ordered by
bin so you walk the racks rather than an alphabet. Expected quantities are
re-read at the moment each line is counted, so a truck leaving mid-count doesn't
create a phantom discrepancy. Uncounted lines are never zeroed.

**Transport** — a load is one vehicle doing one trip: a driver, a run sheet in
delivery order, access notes per stop, and a delivery confirmation with a name.
Departing the warehouse issues everything on board out of stock; reconciling
returns books back whatever came home.

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

A new install seeds the SingleTrack warehouse catalogue and the season's events
with their aid stations, so the app opens on something recognisable rather than
an empty shell. More → Data → Erase everything clears this device if you want to
start from nothing.

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

Until then, data moves as files. More → Backup & handover exports the whole
device as one file. Imports **merge** by revision, so importing a stale file can
never undo fresher local work.

## Layout

```
src/
  db/          Schema, Dexie database, CRUD helpers, seed data
  domain/      Business logic — stock ledger, packlist lifecycle, stocktake,
               transport, backup, short codes, formatting, pack list import
               (a workbook reader, a PDF-to-grid pass, name matching)
  hooks/       Live queries (Dexie useLiveQuery) and search
  components/  Shared UI — sheets, steppers, toasts, scanner, invite QR codes
  screens/     One file per screen, lazily routed
  sync/        Backend contract, role permissions, sync engine, Supabase adapter
  assistant/   The packing assistant: what it is shown, what comes back, its notes
supabase/      Database schema and row-level security policies
  functions/   The one server-side piece: the Edge Function that calls Claude
  styles/      Design tokens and component CSS
```

Domain logic is kept out of the components and is covered by tests that run
against the real Dexie stack on a fake IndexedDB, so transactions and indexes are
exercised rather than mocked.

**The database schema is tested too.** `src/test/pg.ts` boots Postgres in-process
(PGlite, Postgres compiled to WebAssembly) and applies `supabase/schema.sql`
unchanged, stubbing only the two things Supabase provides — `auth.uid()` and
`auth.users`. That means the security policies are executed rather than assumed:
`src/test/rls.test.ts` drops superuser privileges and checks what a volunteer can
actually read and write. Two SQL bugs reached production before this existed,
because the only way to run the schema was to deploy it.

```bash
npm test    # 499 tests, including the Postgres schema and policies
```

## Design notes

- **Sunlight and gloves.** 48px minimum tap targets, heavy weights, solid fills,
  16px inputs so iOS doesn't zoom on focus. Light and dark themes follow the
  phone.
- **Filters default to what's left.** Packing and counting both open on the
  outstanding items so the list shrinks as the work gets done.
- **Sticky primary action.** The one thing to do next sits under the thumb.
- **Hash routing.** Invite QR codes and typed deep links resolve wherever the app
  is served from (a subfolder, a static host, a copy on the warehouse laptop)
  with no server rewrites.
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
- The pull cursor belongs to the account that set it. The server shows each
  account a different slice of its log, so a phone handed from a volunteer to
  a driver, or from one account to another, starts its pull from the
  beginning rather than skipping everything written before the old account's
  position.

### Roles

| Role | Can do |
| --- | --- |
| **Admin** | Everything, including the catalogue, who else has access, and the packing assistant |
| **Crew, all events** | The warehouse: pack, adjust stock, run stocktakes, keep templates, build loads |
| **Crew, one event** | Pack, build loads and plan food for that event; read the catalogue |
| **Driver** | Assigned loads for one event, confirm deliveries |
| **Volunteer** | One aid station's packlist; record what arrived |

An invite names an event, or for crew may name none. Crew given one event see
that event and nothing else: the events list holds one race, the transport tab
one race's runs, and the stock tab is read-only. Stocktakes, templates, backups
and starting a new event belong to the warehouse crew, who are invited with
"All events". Typing another event's address, or opening another event's
packlist or load, sends them home; the server never sends those rows in the
first place.

Volunteers are pinned to a single destination for a single event, and may only
change what *arrived* — never what was supposed to be sent, since that would
quietly erase the evidence of a short delivery.

Someone holding an aid station invite gets the app cut down to that one job: no
tabs, no warehouse, no stocktake, no backups. Their packlist opens as a
confirm-only view — every line shows what the warehouse says is coming, and the
only number they can move is how many turned up. Typing another screen's address
sends them back to their station.

The rules are enforced in three places, because two of them are only courtesies:
the screens hide what a role cannot do, `update()` in `src/db/repo.ts` drops a
forbidden change before it can reach this device's database, and
`push_records()` in `supabase/schema.sql` merges an incoming row field by field
so a restricted role can only move the fields it owns. **The server copy is the
only real boundary** — the browser holds a publishable key, so anything the
policies allow is allowed to anyone who cares to try.

`src/sync/permissions.ts` holds the rules as a table you can read top to bottom.

### Two ways in

Core crew sign in with an email link. Volunteers scan an invite QR at their aid
station and type their name — no inbox, no password, nothing to remember, because
race morning is the worst possible time to make someone set up an account. Invites
are scoped to one destination and expire after the weekend.

Signing out keeps the phone connected and shows the sign-in page, and nothing
else, until someone signs in again. Work already on the phone stays there. Only
a phone that has never been connected runs with no account at all. A phone that
reloads with no signal keeps the account it had, using the access it was given
the last time the server answered.

### The Supabase backend

`src/sync/types.ts` defines a `SyncBackend` interface; everything above it —
screens, engine, permission checks — is written against that rather than a
vendor. Two implementations exist: `MockBackend` (an on-device stand-in for
trying the flow) and `SupabaseBackend`.

**Setup, once:**

1. Supabase → SQL Editor → run `supabase/schema.sql` whole. It is re-runnable.
2. Authentication → Providers → enable **Email** (magic links) and **Anonymous
   sign-ins**. Volunteers get an anonymous account behind the scenes so they
   never have to make one.
3. Authentication → URL Configuration → set **Site URL** to where the app is
   served, and add the same URL under **Redirect URLs**. Miss this and sign-in
   links bounce to `http://localhost:3000`: Supabase silently ignores a redirect
   that is not on the allow-list and falls back to the Site URL, whose default
   is localhost.
4. Authentication → Emails → edit the **Magic Link** template so it includes the
   code as well as the link: add `{{ .Token }}` somewhere in the body. Signing
   in by code is the path that works inside an installed app — following the
   link opens the phone's default browser, which for a home-screen app is a
   separate place with its own storage, so the tab ends up signed in and the app
   does not.
5. Authentication → Passkeys → enable, and set:
   - **Relying Party ID** — the bare domain, no scheme or path
     (`singletrackevents.github.io`)
   - **Relying Party Origins** — the full origin
     (`https://singletrackevents.github.io`)
   - **Display Name** — what the phone shows during the prompt
6. Authentication → Emails → SMTP Settings → connect a real email sender.
   **The built-in one allows only a couple of messages an hour for the entire
   project.** Passkeys make this far less pressing — each person needs one email
   ever — but the first sign-in on every account still goes through it.

### Passkeys

Crew sign in with a face, a fingerprint or a device PIN. Nothing is delivered,
so none of the failure modes email brings — undeliverable links, one-time tokens
consumed by preview scanners, a project-wide rate limit — apply at all.

Registering a passkey needs a live session, so the **first** sign-in on an
account is still by email. After that, that device never needs email again. Each
device gets its own passkey; they are listed and revocable under Accounts & sync.

Volunteers are deliberately excluded: their access is a short-lived guest session
tied to an invite, and a passkey would outlive the invite it came from.

The API is in beta and behind `experimental: { passkey: true }`, so it may change
without notice. The email path is kept as a fallback for exactly that reason, and
for devices with no WebAuthn support — `deviceSupportsPasskeys()` checks before
offering the button.

The first person to sign in becomes the admin; everyone after needs an invite.

**If you have already run the schema, run it again after pulling.** It is
re-runnable and carries its own migrations, including a fix for the `seq` column
that made every update to an already-synced record fail with `column "seq" can
only be updated to DEFAULT`.

**The server is a sync log, not a query surface.** One `records` table keyed by
`(table_name, id)`, with `event_id` and `destination_id` lifted out as columns
purely so policies can filter on them. The app queries its local database and
never this one, so mirroring the relational shape would buy nothing and cost a
great deal of schema and migration risk.

Conflict resolution lives in the `push_records` function rather than the client,
because two phones can push at once and only the database can settle that safely.

**Security note.** The browser holds only a publishable key, so the row-level
security policies in `supabase/schema.sql` *are* the access control — the checks
in `src/sync/permissions.ts` only shape the UI. Two things worth understanding
before trusting it:

- Scope columns are supplied by the client, so `row_in_scope` is deliberately
  strict: a scoped user is denied any row whose own scope is null, rather than
  treating null as "applies everywhere".
- `push_records` is `security definer`, so it repeats by hand every check the
  policies would have made. Change one and you must change the other.

Still to do before a real race:
- **Test it with two real phones.** The adapter is written and its mapping is
  unit-tested, but it has never spoken to the live project — this environment
  cannot reach `supabase.co`.
- Per-screen gating beyond the navigation tabs — the permission model exists and
  the server refuses disallowed writes, but individual screens do not yet hide
  every control a limited role cannot use.
- Realtime updates, so a change appears without waiting for the next sync.

## The packing assistant

The assistant is the only part of the app that needs a server, and it needs one
for exactly one reason: a Claude API key cannot live in a published web page.
So the app talks to a small Supabase Edge Function
(`supabase/functions/assistant/index.ts`) that holds the key, checks that the
caller is a signed-in admin, adds the instructions and asks Claude. The phone
assembles everything the assistant reads (`src/assistant/context.ts`) from its
own local database, so the function never reads the sync log and never sees a
volunteer's or driver's token as anything but a refusal.

It runs on Claude Opus 5. The catalogue is sent with prompt caching turned on,
so checks within the same hour reuse it at a tenth of the price. A check costs
roughly ten to fifteen cents cold and a few cents warm; each result says what it
cost. The assistant is admin only: only an admin sees the button, only an admin
receives the notes, and the function refuses everyone else before it spends
anything.

### Its memory

Notes live in a synced table of their own (`assistantNotes`), admin only in
both directions: `can_read_table` and `can_write_table` in the schema refuse it
to crew and drivers, `src/sync/permissions.ts` mirrors that, and
`src/test/rls.test.ts` proves it against Postgres. A note applies everywhere,
to one event, or to one kind of destination, and only the ones that apply are
sent with a check. Two ways in:

- **Written.** More → Packing assistant → +. "Grand Canyon Carpark has no
  power, always a generator."
- **Learned.** After a check, the assistant may offer up to three rules it
  thinks worth keeping; each is saved only if you tap "Remember this".
  Dismissing a suggestion with "Never for this kind of list" also writes a
  note, worded so it still reads sensibly a season later.

### Setup, once

1. **A Claude account.** Sign in at platform.claude.com, create the
   organisation as SingleTrack Events, add prepaid credit and set a monthly
   spend limit. Under API Keys create one key named for this job.
2. **The key into Supabase.** Project → Edge Functions → Secrets → add
   `ANTHROPIC_API_KEY`. The key never enters this repository, the build or a
   phone. Revoking it in the Console and pasting a new one here is the whole
   rotation.
3. **Deploy the function.** Either paste `supabase/functions/assistant/index.ts`
   into Edge Functions → Deploy a new function, named `assistant`, or from a
   machine with the Supabase CLI:

   ```bash
   supabase link --project-ref <your project ref>
   supabase functions deploy assistant
   ```

   The function's own `deno.json` pins the Anthropic SDK; nothing is installed
   in this repository for it.
4. **Re-run `supabase/schema.sql`.** It is re-runnable, and this version adds
   the notes table to the read and write rules.
5. **Test it.** In the app, More → Packing assistant → Test the connection. It
   names the model when everything is in place, and says plainly which step is
   missing when it is not.

`VITE_ASSISTANT_URL` overrides where the app looks for the function, for a
staging project or a local `supabase functions serve`.

### What it is shown

Plain text sections, rendered by small pure functions so the wording is tested
without a database: the whole catalogue with codes, units and kit contents; the
destination, its access, hours and the races through it; the list itself; the
templates for that destination type and access; what the food plan calls for at
that station; the same-named station at earlier events (the quantities that
actually left the warehouse, where the list got that far) and its sibling
stations at this event; and the notes that apply. The answer comes back as a
fixed JSON shape (`src/assistant/protocol.ts`), and the app re-reads it
defensively before offering a button off the back of it.

The function does not opt into Anthropic's server-side fallback models. A
packing list does not trip the safety classifiers, and if one ever did the app
says so rather than quietly answering from a different model.

## Possible next steps

- Photo attachments on delivery confirmations.
- Weight and volume per item to warn when a load won't fit in the vehicle.
- Per-runner template scaling wired to actual entry numbers.
