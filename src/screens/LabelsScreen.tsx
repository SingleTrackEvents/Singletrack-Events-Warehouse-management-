import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { QrCode } from '../components/QrCode';
import { ConfirmSheet } from '../components/ui';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { alive, byId, create, liveWhere, softDelete } from '../db/repo';
import { usePacklist, usePacklistLines } from '../hooks/useDb';
import { makeContainerCode, scanUrl } from '../domain/codes';
import { PACKLIST_STATUS_LABELS } from '../domain/packlists';
import { downloadCsv, slugify } from '../domain/backup';
import { formatDate, formatQty } from '../domain/format';
import type { Container } from '../db/types';

/**
 * Labels and paperwork.
 *
 * Two outputs: QR labels to tape onto crates, and a printed packlist with tick
 * boxes and a signature line. Paper is still the fallback when a phone dies at
 * an aid station, so the print layout is a first-class feature rather than a
 * browser afterthought.
 */
export default function LabelsScreen() {
  const { packlistId } = useParams();
  const toast = useToast();
  const packlist = usePacklist(packlistId);
  const lines = usePacklistLines(packlistId);
  const items = useLiveQuery(async () => byId(alive(await db.items.toArray())), []);
  const event = useLiveQuery(
    async () => (packlist ? db.events.get(packlist.eventId) : undefined),
    [packlist?.eventId],
  );
  const containers = useLiveQuery(
    async () => (packlistId ? liveWhere(db.containers, 'packlistId', packlistId) : []),
    [packlistId],
  );
  const [removing, setRemoving] = useState<Container>();

  if (!packlist) {
    return (
      <Screen title="Labels" back="-1">
        <p className="muted">Loading…</p>
      </Screen>
    );
  }

  const label = { name: packlist.name, event: event?.name };
  const url = scanUrl(packlist.code, label);

  const addContainer = async () => {
    const index = (containers?.length ?? 0) + 1;
    await create(db.containers, {
      packlistId: packlist.id,
      code: makeContainerCode(packlist.code, index),
      type: 'crate',
      sealed: false,
      notes: '',
    });
    toast('Crate label added');
  };

  const exportCsv = () => {
    const rows: string[][] = [
      ['Item', 'SKU', 'Bin', 'Required', 'Packed', 'Must-have', 'Note'],
      ...(lines ?? []).map((line) => {
        const item = items?.get(line.itemId);
        return [
          item?.name ?? 'Unknown',
          item?.sku ?? '',
          item?.bin ?? '',
          String(line.qtyRequired),
          String(line.qtyPacked),
          line.mandatory ? 'yes' : '',
          line.note,
        ];
      }),
    ];
    downloadCsv(rows, `${slugify(packlist.name)}-packlist.csv`);
    toast('CSV saved to downloads');
  };

  return (
    <Screen title="Labels & print" back={`/packlists/${packlist.id}`}>
      <div className="card card-pad mb-4 no-print">
        <div className="row-flex" style={{ gap: 'var(--space-4)' }}>
          <QrCode value={url} size={128} alt={`QR code for ${packlist.code}`} />
          <div className="grow">
            <h3>{packlist.name}</h3>
            <p className="mono strong" style={{ fontSize: 'var(--text-xl)', margin: '4px 0' }}>
              {packlist.code}
            </p>
            <p className="tiny muted">
              Scanning this in the app opens the packlist. Read the code out over the radio if the
              camera will not play along.
            </p>
          </div>
        </div>
        <div className="btn-row mt-3">
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            🖨 Print
          </button>
          <button type="button" className="btn btn-outline" onClick={exportCsv}>
            ⬇ CSV
          </button>
        </div>
      </div>

      <section className="section no-print">
        <div className="section-head">
          <h2>Crate labels</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void addContainer()}>
            + Add crate
          </button>
        </div>
        {containers?.length ? (
          <div className="label-sheet">
            {containers.map((container) => (
              <div key={container.id} className="qr-label">
                <QrCode
                  value={scanUrl(container.code, label)}
                  size={96}
                  alt={`QR code for ${container.code}`}
                />
                <div className="grow">
                  <div className="name">{packlist.name}</div>
                  <div className="code">{container.code}</div>
                  <div className="meta">
                    {event?.name} · {container.type}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm mt-2 no-print"
                    onClick={() => setRemoving(container)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted">
            Add one label per crate, tub or pallet. Each gets its own QR so a scan tells you which
            list it belongs to.
          </p>
        )}
      </section>

      {/* Printed packlist — hidden on screen, laid out for A4 when printed. */}
      <div className="print-only">
        <h1 style={{ marginBottom: 4 }}>{packlist.name}</h1>
        <p style={{ marginBottom: 12 }}>
          {event?.name} · {event ? formatDate(event.startDate) : ''} · Code {packlist.code} ·{' '}
          {PACKLIST_STATUS_LABELS[packlist.status]}
        </p>
        <table className="print-table">
          <thead>
            <tr>
              <th style={{ width: '4%' }}>✓</th>
              <th>Item</th>
              <th style={{ width: '12%' }}>Bin</th>
              <th style={{ width: '12%' }}>Required</th>
              <th style={{ width: '12%' }}>Packed</th>
              <th style={{ width: '14%' }}>Returned</th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((line) => {
              const item = items?.get(line.itemId);
              return (
                <tr key={line.id}>
                  <td>☐</td>
                  <td>
                    {item?.name ?? 'Unknown'}
                    {line.mandatory ? ' *' : ''}
                  </td>
                  <td>{item?.bin ?? ''}</td>
                  <td>{formatQty(line.qtyRequired, item?.unit ?? 'each')}</td>
                  <td>{line.qtyPacked || ''}</td>
                  <td />
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ marginTop: 24 }}>
          Packed by ______________________ &nbsp;&nbsp; Received by ______________________ &nbsp;&nbsp;
          Time __________
        </p>
        <p style={{ marginTop: 8, fontSize: 12 }}>* must-have item — do not leave the warehouse without it.</p>
      </div>

      {removing ? (
        <ConfirmSheet
          title={`Remove ${removing.code}?`}
          body="The label is deleted. Items assigned to it stay on the packlist."
          confirmLabel="Remove"
          tone="danger"
          onCancel={() => setRemoving(undefined)}
          onConfirm={() => {
            void softDelete(db.containers, removing.id);
            setRemoving(undefined);
            toast('Crate label removed');
          }}
        />
      ) : null}
    </Screen>
  );
}
