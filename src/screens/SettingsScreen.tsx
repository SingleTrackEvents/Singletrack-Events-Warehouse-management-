import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { ConfirmSheet, Field, Pill } from '../components/ui';
import { useToast } from '../components/toastContext';
import { db, getSettings } from '../db/db';
import { update } from '../db/repo';
import { useSettings } from '../hooks/useDb';
import { downloadJson, exportAll, importBackup, isBackup, wipeAll } from '../domain/backup';
import { seedDemoData } from '../db/seed';
import { countDuplicates, mergeDuplicates } from '../domain/duplicates';
import { formatDateTime, plural } from '../domain/format';
import type { Settings } from '../db/types';

/**
 * Settings, backup and handover.
 *
 * Until a sync server exists, this screen is how data travels: export a file,
 * send it however you like, import it at the other end. Imports merge by
 * revision so a stale file can never clobber newer work.
 */
export default function SettingsScreen() {
  const settings = useSettings();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [wiping, setWiping] = useState(false);
  const [reseeding, setReseeding] = useState(false);
  const [merging, setMerging] = useState(false);

  // Two phones that each seeded demo data end up with two of everything once
  // they sync, and someone will eventually add the same item twice by hand.
  const duplicates = useLiveQuery(() => countDuplicates(), []);

  const counts = useLiveQuery(async () => ({
    items: await db.items.count(),
    events: await db.events.count(),
    packlists: await db.packlists.count(),
    movements: await db.movements.count(),
  }));

  const set = (changes: Partial<Settings>) => {
    void getSettings().then((current) => update(db.settings, current.id, changes));
  };

  const doExport = async () => {
    const backup = await exportAll('Full warehouse backup');
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJson(backup, `singletrack-warehouse-${stamp}.json`);
    toast('Backup saved to downloads');
  };

  const doImport = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isBackup(parsed)) {
        toast('That file is not a warehouse backup', 'error');
        return;
      }
      const result = await importBackup(parsed, 'merge');
      toast(`Imported · ${result.added} new, ${result.updated} updated, ${result.skipped} older`);
    } catch {
      toast('That file could not be read', 'error');
    }
  };

  return (
    <Screen title="More">
      <section className="section">
        <div className="section-head">
          <h2>This device</h2>
        </div>
        <div className="card card-pad stack">
          <Field label="Your name" hint="Stamped on packlists, counts and stock movements.">
            {(id) => (
              <input
                id={id}
                className="input"
                value={settings?.crewName ?? ''}
                placeholder="Jess Nolan"
                onChange={(event) => set({ crewName: event.target.value })}
              />
            )}
          </Field>
          <Field label="Theme">
            {(id) => (
              <select
                id={id}
                className="select"
                value={settings?.theme ?? 'system'}
                onChange={(event) => set({ theme: event.target.value as Settings['theme'] })}
              >
                <option value="system">Match the phone</option>
                <option value="light">Always light</option>
                <option value="dark">Always dark</option>
              </select>
            )}
          </Field>
          <Field label="Vehicles" hint="Comma separated. Offered when planning a load.">
            {(id) => (
              <input
                id={id}
                className="input"
                value={(settings?.vehicles ?? []).join(', ')}
                onChange={(event) =>
                  set({
                    vehicles: event.target.value
                      .split(',')
                      .map((entry) => entry.trim())
                      .filter(Boolean),
                  })
                }
              />
            )}
          </Field>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Set up</h2>
        </div>
        <div className="list">
          <Link to="/access" className="row">
            <span className="row-icon">👥</span>
            <span className="row-body">
              <span className="row-title">Accounts &amp; sync</span>
              <span className="row-sub">Share live data with the crew and invite volunteers</span>
            </span>
            <span className="row-chevron">›</span>
          </Link>
          <Link to="/templates" className="row">
            <span className="row-icon">📋</span>
            <span className="row-body">
              <span className="row-title">Packlist templates</span>
              <span className="row-sub">Standing patterns for each destination type</span>
            </span>
            <span className="row-chevron">›</span>
          </Link>
          <Link to="/stocktake" className="row">
            <span className="row-icon">🔢</span>
            <span className="row-body">
              <span className="row-title">Stocktakes</span>
              <span className="row-sub">Open and completed counts</span>
            </span>
            <span className="row-chevron">›</span>
          </Link>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Backup &amp; handover</h2>
        </div>
        <div className="card card-pad">
          <p className="small muted mb-3">
            Everything lives on this device. Export a file to back it up, or to hand a race over to
            another phone — imports merge, keeping whichever copy of each record was edited last.
          </p>
          <div className="btn-row mb-2">
            <button type="button" className="btn btn-primary" onClick={() => void doExport()}>
              ⬆ Export backup
            </button>
            <button type="button" className="btn btn-outline" onClick={() => fileInput.current?.click()}>
              ⬇ Import file
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void doImport(file);
              event.target.value = '';
            }}
          />
          {counts ? (
            <p className="tiny muted mt-2">
              On this device: {plural(counts.items, 'item')}, {plural(counts.events, 'event')},{' '}
              {plural(counts.packlists, 'packlist')}, {plural(counts.movements, 'stock movement')}.
            </p>
          ) : null}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Data</h2>
        </div>
        <div className="list">
          <button
            type="button"
            className="row"
            disabled={!duplicates || duplicates.items + duplicates.templates === 0}
            onClick={() => setMerging(true)}
          >
            <span className="row-icon">🧹</span>
            <span className="row-body">
              <span className="row-title">Merge duplicates</span>
              <span className="row-sub">
                {!duplicates
                  ? 'Checking…'
                  : duplicates.items + duplicates.templates === 0
                    ? 'Nothing duplicated'
                    : `${plural(duplicates.items, 'duplicate item')}, ${plural(duplicates.templates, 'template')}`}
              </span>
            </span>
            <span className="row-chevron">›</span>
          </button>
          <button type="button" className="row" onClick={() => setReseeding(true)}>
            <span className="row-icon">🌱</span>
            <span className="row-body">
              <span className="row-title">Reload demo data</span>
              <span className="row-sub">Adds the worked example back alongside your data</span>
            </span>
            <span className="row-chevron">›</span>
          </button>
          <button type="button" className="row" onClick={() => setWiping(true)}>
            <span className="row-icon">🗑</span>
            <span className="row-body">
              <span className="row-title" style={{ color: 'var(--danger)' }}>
                Erase everything on this device
              </span>
              <span className="row-sub">Export a backup first — this cannot be undone</span>
            </span>
            <span className="row-chevron">›</span>
          </button>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>About</h2>
        </div>
        <div className="card card-pad small muted">
          <p>
            <span className="strong">SingleTrack Events — Warehouse</span>
          </p>
          <p>
            Works with no signal: everything is stored on the device and the app keeps running once
            installed. Add it to your home screen from the browser share menu for a full-screen,
            offline copy.
          </p>
          <div className="row-flex wrap mt-2">
            <Pill tone="ok">Offline-first</Pill>
            <Pill tone="info">Sync-ready records</Pill>
          </div>
          {settings ? (
            <p className="tiny mt-3">Settings last changed {formatDateTime(settings.updatedAt)}.</p>
          ) : null}
        </div>
      </section>

      {wiping ? (
        <ConfirmSheet
          title="Erase everything?"
          body="Every item, event, packlist and movement on this device is deleted. Backups you have already exported are unaffected."
          confirmLabel="Erase"
          tone="danger"
          onCancel={() => setWiping(false)}
          onConfirm={() => {
            void wipeAll().then(async () => {
              await getSettings();
              toast('Device cleared');
              setWiping(false);
            });
          }}
        />
      ) : null}

      {merging ? (
        <ConfirmSheet
          title="Merge duplicates?"
          body={
            <>
              Keeps one of each and folds the rest into it. Packlists, stocktakes and the stock
              ledger are repointed at the copy that stays, so nothing loses its history.
              <div className="mt-2">
                Quantities are never added together — two records for one shelf is a naming problem,
                not twice the stock, so check the counts afterwards.
              </div>
            </>
          }
          confirmLabel="Merge"
          onCancel={() => setMerging(false)}
          onConfirm={() => {
            void mergeDuplicates().then((summary) => {
              toast(
                `Merged ${plural(summary.itemsMerged, 'item')} and ${plural(summary.templatesMerged, 'template')}`,
              );
              setMerging(false);
            });
          }}
        />
      ) : null}

      {reseeding ? (
        <ConfirmSheet
          title="Reload the demo data?"
          body="The example races, catalogue and templates are added again. Anything you have entered is left alone, so you may end up with duplicates."
          confirmLabel="Reload demo"
          onCancel={() => setReseeding(false)}
          onConfirm={() => {
            void seedDemoData().then(() => {
              toast('Demo data reloaded');
              setReseeding(false);
            });
          }}
        />
      ) : null}
    </Screen>
  );
}
