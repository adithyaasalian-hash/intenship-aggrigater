import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth.js';

const linkClass = ({ isActive }) =>
  `rounded-chip px-3 py-1.5 text-sm transition-colors ${
    isActive ? 'bg-brand-soft font-medium text-brand-dark' : 'text-ink-soft hover:text-ink'
  }`;

export default function Layout() {
  const { user, status, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <header className="border-b border-paper-rule bg-paper-card">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <NavLink to="/" className="mr-2 font-semibold tracking-tight">
            Internship<span className="text-brand">Match</span>
          </NavLink>

          {status === 'signedIn' && (
            <nav className="flex items-center gap-1">
              <NavLink to="/feed" className={linkClass}>Feed</NavLink>
              <NavLink to="/insights" className={linkClass}>Insights</NavLink>
              <NavLink to="/tracker" className={linkClass}>Tracker</NavLink>
            </nav>
          )}

          <div className="ml-auto flex items-center gap-2">
            {status === 'signedIn' ? (
              <>
                <NavLink to="/profile" className={linkClass}>
                  {user?.name ?? user?.email}
                </NavLink>
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-xs"
                  onClick={async () => { await signOut(); navigate('/'); }}
                >
                  Sign out
                </button>
              </>
            ) : (
              status === 'signedOut' && (
                <NavLink to="/auth" className="btn-primary px-3 py-1.5 text-xs">Sign in</NavLink>
              )
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
