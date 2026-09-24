import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { ConfirmSheet, Field } from '../components/ui';
import { useToast } from '../components/toastContext';
import { db, getSettings } from '../db/db';
import { update } from '../db/repo';
import { useSettings } from '../hooks/useDb';
import { useSession } from '../hooks/sessionContext';
import { can } from '../sync/permissions';
import { downloadJson, exportAll, importBackup, isBackup, wipeAll } from '../domain/backup';
import { plural } from '../domain/format';
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
  const { session } = useSession();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [wiping, setWiping] = useState(false);

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
          {can(session, 'packlist:manage') ? (
            <Link to="/import" className="row">
              <span className="row-icon">📄</span>
              <span className="row-body">
                <span className="row-title">Import a pack list</span>
                <span className="row-sub">Read a run sheet from Excel, CSV or PDF onto an event</span>
              </span>
              <span className="row-chevron">›</span>
            </Link>
          ) : null}
          {can(session, 'template:manage') ? (
            <Link to="/templates" className="row">
              <span className="row-icon">📋</span>
              <span className="row-body">
                <span className="row-title">Packlist templates</span>
                <span className="row-sub">Standing patterns for each destination type</span>
              </span>
              <span className="row-chevron">›</span>
            </Link>
          ) : null}
          {can(session, 'stocktake:read') ? (
            <Link to="/stocktake" className="row">
              <span className="row-icon">🔢</span>
              <span className="row-body">
                <span className="row-title">Stocktakes</span>
                <span className="row-sub">Open and completed counts</span>
              </span>
              <span className="row-chevron">›</span>
            </Link>
          ) : null}
        </div>
      </section>

      {can(session, 'data:export') ? (
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

      ) : null}

      {can(session, 'data:wipe') ? (
      <section className="section">
        <div className="section-head">
          <h2>Data</h2>
        </div>
        <div className="list">
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

      ) : null}

      {wiping ? (
        <ConfirmSheet
          title="Erase everything?"
          body={
            <>
              Every item, event, packlist and movement on this device is deleted. Backups you have
              already exported are unaffected.
              <div className="mt-2">
                It clears this device only. While you are signed in, syncing will bring the data
                back.
              </div>
            </>
          }
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

    </Screen>
  );
}
