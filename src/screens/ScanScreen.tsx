import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../App';
import { Scanner } from '../components/Scanner';
import { useToast } from '../components/toastContext';
import { db } from '../db/db';
import { alive } from '../db/repo';
import { normaliseCode, parseScan } from '../domain/codes';
import { PACKLIST_STATUS_LABELS } from '../domain/packlists';
import { useSession } from '../hooks/sessionContext';
import { reachable } from '../sync/permissions';

/**
 * One scanner for everything.
 *
 * A scan resolves in this order: packlist code → item barcode → item SKU. That
 * means the same button works whether someone is holding a packlist code, a
 * carton of gels or a printed run sheet, which is the only way a scanner gets
 * used in the field rather than ignored.
 */

type Resolution =
  | { kind: 'packlist'; id: string; label: string }
  | { kind: 'item'; id: string; label: string }
  | { kind: 'miss'; value: string };

async function resolve(raw: string): Promise<Resolution> {
  const value = raw.trim();
  const parsed = parseScan(value);

  if (parsed) {
    const packlist = alive(await db.packlists.where('code').equals(parsed.code).toArray())[0];
    if (packlist) return { kind: 'packlist', id: packlist.id, label: packlist.name };
  }

  const code = normaliseCode(value);
  const items = alive(await db.items.toArray());
  const byBarcode = items.find((item) => item.barcode && item.barcode.trim() === value);
  if (byBarcode) return { kind: 'item', id: byBarcode.id, label: byBarcode.name };

  const bySku = items.find((item) => item.sku && normaliseCode(item.sku) === code);
  if (bySku) return { kind: 'item', id: bySku.id, label: bySku.name };

  return { kind: 'miss', value };
}

export default function ScanScreen() {
  const { code } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [manual, setManual] = useState('');
  const [missed, setMissed] = useState<string>();
  const [busy, setBusy] = useState(false);
  const { session } = useSession();

  // Offered as a fallback when a code does not resolve on this device. Only
  // lists the account may open, or the fallback becomes a way around the scope.
  const localPacklists = useLiveQuery(
    async () =>
      alive(await db.packlists.toArray())
        .filter((packlist) =>
          reachable(session, { eventId: packlist.eventId, destinationId: packlist.destinationId }),
        )
        .slice(0, 25),
    [session],
  );

  const handle = useCallback(
    async (value: string) => {
      if (busy) return;
      setBusy(true);
      const result = await resolve(value);
      if (result.kind === 'packlist') {
        toast(`Opening ${result.label}`);
        navigate(`/packlists/${result.id}`, { replace: true });
      } else if (result.kind === 'item') {
        toast(`Opening ${result.label}`);
        navigate(`/stock/${result.id}`, { replace: true });
      } else {
        setMissed(result.value);
        setBusy(false);
      }
    },
    [busy, navigate, toast],
  );

  // A QR deep link lands here with the code already in the URL.
  useEffect(() => {
    if (code) void handle(decodeURIComponent(code));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <Screen title="Scan" back="-1">
      <p className="small muted mb-3">
        Point the camera at a barcode on a carton, or type a packlist code in — handy when the lens
        is covered in mud.
      </p>

      <Scanner onDetect={(value) => void handle(value)} />

      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (manual.trim()) void handle(manual.trim());
        }}
      >
        <div className="row-flex">
          <input
            className="input grow mono"
            placeholder="AS3-7K2M"
            value={manual}
            autoCapitalize="characters"
            onChange={(event) => setManual(event.target.value.toUpperCase())}
          />
          <button type="submit" className="btn btn-primary" disabled={!manual.trim()}>
            Go
          </button>
        </div>
      </form>

      {missed ? (
        <div className="card card-pad mt-4">
          <p className="small strong mb-2">Nothing matches that code.</p>
          <p className="tiny muted mono mb-3">{missed}</p>

          <p className="tiny muted">
            Packlists live on the device that built them. If the code came from another phone, sign
            in to sync or import that device's backup from More → Backup &amp; handover.
          </p>

          {localPacklists?.length ? (
            <>
              <p className="small strong mt-4 mb-2">Packlists on this device</p>
              <div className="list">
                {localPacklists.map((packlist) => (
                  <Link key={packlist.id} to={`/packlists/${packlist.id}`} className="row">
                    <span className="row-body">
                      <span className="row-title truncate">{packlist.name}</span>
                      <span className="row-sub mono">
                        {packlist.code} · {PACKLIST_STATUS_LABELS[packlist.status]}
                      </span>
                    </span>
                    <span className="row-chevron">›</span>
                  </Link>
                ))}
              </div>
            </>
          ) : null}

          <button type="button" className="btn btn-outline btn-sm mt-3" onClick={() => setMissed(undefined)}>
            Scan another
          </button>
        </div>
      ) : null}
    </Screen>
  );
}
