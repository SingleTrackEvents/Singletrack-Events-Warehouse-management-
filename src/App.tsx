import { Suspense, lazy, useEffect } from 'react';
import type { ReactElement } from 'react';
import {
  HashRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { AccountChip } from './components/AccountChip';
import { ToastProvider } from './components/ui';
import { SessionProvider } from './hooks/useSession';
import { useSession } from './hooks/sessionContext';
import { can, isStationOnly } from './sync/permissions';
import type { Action } from './sync/permissions';
import { useSettings } from './hooks/useDb';
import './styles/app.css';

/**
 * App shell.
 *
 * HashRouter rather than BrowserRouter: the app has to deep-link from a QR code
 * while served from an arbitrary path (a subfolder, a file:// copy on a laptop,
 * an offline home-screen install) and hash routes work in all of those without
 * server rewrites.
 */

const HomeScreen = lazy(() => import('./screens/HomeScreen'));
const EventsScreen = lazy(() => import('./screens/EventsScreen'));
const EventDetailScreen = lazy(() => import('./screens/EventDetailScreen'));
const FoodScreen = lazy(() => import('./screens/FoodScreen'));
const WarehouseScreen = lazy(() => import('./screens/WarehouseScreen'));
const PacklistScreen = lazy(() => import('./screens/PacklistScreen'));
const LabelsScreen = lazy(() => import('./screens/LabelsScreen'));
const StockScreen = lazy(() => import('./screens/StockScreen'));
const ItemScreen = lazy(() => import('./screens/ItemScreen'));
const StocktakeScreen = lazy(() => import('./screens/StocktakeScreen'));
const StocktakeDetailScreen = lazy(() => import('./screens/StocktakeDetailScreen'));
const TransportScreen = lazy(() => import('./screens/TransportScreen'));
const LoadScreen = lazy(() => import('./screens/LoadScreen'));
const TemplatesScreen = lazy(() => import('./screens/TemplatesScreen'));
const TemplateDetailScreen = lazy(() => import('./screens/TemplateDetailScreen'));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen'));
const ScanScreen = lazy(() => import('./screens/ScanScreen'));
const AccessScreen = lazy(() => import('./screens/AccessScreen'));
const JoinScreen = lazy(() => import('./screens/JoinScreen'));

/**
 * Bottom tabs, each gated by the permission its screen needs. A volunteer with
 * no business in the warehouse should not be shown a Stock tab that only leads
 * to an empty or refusing screen.
 */
const NAV: Array<{ to: string; icon: string; label: string; end: boolean; needs?: Action }> = [
  { to: '/', icon: '🏠', label: 'Home', end: true },
  { to: '/events', icon: '🏃', label: 'Events', end: false, needs: 'event:read' },
  { to: '/stock', icon: '📦', label: 'Stock', end: false, needs: 'item:read' },
  { to: '/transport', icon: '🚚', label: 'Transport', end: false, needs: 'load:read' },
  { to: '/more', icon: '⚙️', label: 'More', end: false },
];

/** Applies the saved theme preference to the document. */
function ThemeSync() {
  const settings = useSettings();
  useEffect(() => {
    const theme = settings?.theme ?? 'system';
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [settings?.theme]);
  return null;
}

function BottomNav() {
  const { session } = useSession();
  // Someone pinned to one aid station has one screen; a row of tabs leading
  // nowhere they may go is just something to mis-tap.
  if (isStationOnly(session)) return null;
  const visible = NAV.filter((entry) => !entry.needs || can(session, entry.needs));
  return (
    <nav
      className="app-nav no-print"
      aria-label="Main"
      style={{ gridTemplateColumns: `repeat(${visible.length}, 1fr)` }}
    >
      {visible.map((entry) => (
        <NavLink key={entry.to} to={entry.to} end={entry.end}>
          <span className="icon" aria-hidden>
            {entry.icon}
          </span>
          {entry.label}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * A route nobody without the permission can reach by typing its address.
 *
 * The tabs already hide what a role has no business in, but a hidden tab is a
 * suggestion and a URL is not — a shared phone, a bookmark or a stale link all
 * get past it. The server refuses the data either way; this stops someone
 * landing on a screen that can only sit there empty and look broken.
 */
function Guard({ needs, children }: { needs: Action; children: ReactElement }) {
  const { session, ready } = useSession();
  if (!ready) return <div className="app-main muted">Loading…</div>;
  return can(session, needs) ? children : <Navigate to="/" replace />;
}

/**
 * Everything a station-only volunteer may be on, and nothing else.
 *
 * Per-route permissions cannot express this on their own: a volunteer holds
 * event:read because their packlist screen names the race, and a driver holds
 * it because they genuinely browse events. One allowlist in one place says what
 * the tabs already imply — their station, their account, and a scan.
 */
const STATION_ROUTES = [/^\/$/, /^\/packlists\/[^/]+$/, /^\/access$/, /^\/scan/, /^\/join\//];

function StationOnlyGate({ children }: { children: ReactElement }) {
  const { session, ready } = useSession();
  const { pathname } = useLocation();
  if (!ready || !isStationOnly(session)) return children;
  return STATION_ROUTES.some((route) => route.test(pathname)) ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <SessionProvider>
          <ThemeSync />
          <div className="app">
          <Suspense fallback={<div className="app-main muted">Loading…</div>}>
            <StationOnlyGate>
            <Routes>
              <Route path="/" element={<HomeScreen />} />
              <Route path="/events" element={<Guard needs="event:read"><EventsScreen /></Guard>} />
              <Route path="/events/:eventId" element={<Guard needs="event:read"><EventDetailScreen /></Guard>} />
              <Route path="/events/:eventId/warehouse" element={<Guard needs="packlist:manage"><WarehouseScreen /></Guard>} />
              <Route path="/events/:eventId/food" element={<Guard needs="packlist:manage"><FoodScreen /></Guard>} />
              <Route path="/packlists/:packlistId" element={<PacklistScreen />} />
              <Route path="/packlists/:packlistId/labels" element={<Guard needs="packlist:manage"><LabelsScreen /></Guard>} />
              <Route path="/stock" element={<Guard needs="item:read"><StockScreen /></Guard>} />
              <Route path="/stock/:itemId" element={<Guard needs="item:read"><ItemScreen /></Guard>} />
              <Route path="/stocktake" element={<Guard needs="stocktake:read"><StocktakeScreen /></Guard>} />
              <Route path="/stocktake/:stocktakeId" element={<Guard needs="stocktake:read"><StocktakeDetailScreen /></Guard>} />
              <Route path="/transport" element={<Guard needs="load:read"><TransportScreen /></Guard>} />
              <Route path="/transport/:loadId" element={<Guard needs="load:read"><LoadScreen /></Guard>} />
              <Route path="/templates" element={<Guard needs="template:manage"><TemplatesScreen /></Guard>} />
              <Route path="/templates/:templateId" element={<Guard needs="template:manage"><TemplateDetailScreen /></Guard>} />
              <Route path="/more" element={<SettingsScreen />} />
              <Route path="/scan" element={<ScanScreen />} />
              <Route path="/scan/:code" element={<ScanScreen />} />
              <Route path="/access" element={<AccessScreen />} />
              <Route path="/join/:token" element={<JoinScreen />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </StationOnlyGate>
          </Suspense>
          <BottomNav />
        </div>
        </SessionProvider>
      </ToastProvider>
    </HashRouter>
  );
}

/** Shared page chrome: title bar with an optional back button and scan shortcut. */
export function Screen({
  title,
  subtitle,
  back,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  back?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <>
      <header className="app-header no-print">
        {back ? (
          <button
            type="button"
            className="header-btn"
            aria-label="Back"
            onClick={() => (back === '-1' ? navigate(-1) : navigate(back))}
          >
            ‹
          </button>
        ) : null}
        <h1>
          {title}
          {subtitle ? <span className="sub">{subtitle}</span> : null}
        </h1>
        <AccountChip />
        {actions ?? (
          <button
            type="button"
            className="header-btn"
            aria-label="Scan a code"
            onClick={() => navigate('/scan')}
          >
            ⛶
          </button>
        )}
      </header>
      <main className="app-main">{children}</main>
    </>
  );
}
