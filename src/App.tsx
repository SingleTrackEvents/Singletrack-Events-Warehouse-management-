import { Suspense, lazy, useEffect } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AccountChip } from './components/AccountChip';
import { ToastProvider } from './components/ui';
import { SessionProvider } from './hooks/useSession';
import { useSession } from './hooks/sessionContext';
import { can } from './sync/permissions';
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

export default function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <SessionProvider>
          <ThemeSync />
          <div className="app">
          <Suspense fallback={<div className="app-main muted">Loading…</div>}>
            <Routes>
              <Route path="/" element={<HomeScreen />} />
              <Route path="/events" element={<EventsScreen />} />
              <Route path="/events/:eventId" element={<EventDetailScreen />} />
              <Route path="/events/:eventId/warehouse" element={<WarehouseScreen />} />
              <Route path="/packlists/:packlistId" element={<PacklistScreen />} />
              <Route path="/packlists/:packlistId/labels" element={<LabelsScreen />} />
              <Route path="/stock" element={<StockScreen />} />
              <Route path="/stock/:itemId" element={<ItemScreen />} />
              <Route path="/stocktake" element={<StocktakeScreen />} />
              <Route path="/stocktake/:stocktakeId" element={<StocktakeDetailScreen />} />
              <Route path="/transport" element={<TransportScreen />} />
              <Route path="/transport/:loadId" element={<LoadScreen />} />
              <Route path="/templates" element={<TemplatesScreen />} />
              <Route path="/templates/:templateId" element={<TemplateDetailScreen />} />
              <Route path="/more" element={<SettingsScreen />} />
              <Route path="/scan" element={<ScanScreen />} />
              <Route path="/scan/:code" element={<ScanScreen />} />
              <Route path="/access" element={<AccessScreen />} />
              <Route path="/join/:token" element={<JoinScreen />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
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
