import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
}

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: '◈', end: true },
      { to: '/analytics', label: 'Analytics', icon: '📊' },
      { to: '/executions', label: 'Executions', icon: '▷' },
    ],
  },
  {
    label: 'Build',
    items: [
      { to: '/workflows', label: 'Workflows', icon: '≋' },
      { to: '/projects', label: 'Projects', icon: '🗝️' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { to: '/users', label: 'Users', icon: '◉' },
      { to: '/audit', label: 'Audit Log', icon: '≡' },
    ],
  },
  {
    label: 'System',
    items: [{ to: '/settings', label: 'Settings', icon: '⚙' }],
  },
];

function NavLinkItem({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-150 ${
          isActive
            ? 'bg-blue/15 text-blue'
            : 'text-muted hover:bg-elevated hover:text-inktext'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-blue to-cyan transition-opacity ${
              isActive ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <span
            className={`w-4 text-center transition-transform duration-150 ${
              isActive ? 'scale-110' : 'group-hover:scale-110'
            }`}
          >
            {item.icon}
          </span>
          {item.label}
        </>
      )}
    </NavLink>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen">
      <aside className="glass fixed inset-y-0 left-0 flex w-56 flex-col border-r border-line">
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue via-cyan to-emerald text-lg text-ink shadow-[0_4px_20px_rgba(34,211,238,0.35)]">
            ✦
            <span className="absolute -inset-px rounded-2xl border border-white/20" />
          </span>
          <div>
            <div className="text-base font-extrabold tracking-tight text-gradient">Intellix</div>
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
              AI Orchestrator
            </div>
          </div>
        </div>

        <nav className="mt-1 flex flex-1 flex-col gap-4 overflow-y-auto px-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
                {group.label}
              </div>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <NavLinkItem key={item.to} item={item} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-line p-4">
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-line/70 bg-surface/60 px-2.5 py-2">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald" />
            <span className="text-[10px] font-medium text-muted">All systems operational</span>
          </div>
          <div className="flex items-center gap-3">
            <Avatar email={user?.email ?? '?'} name={user?.name ?? null} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-inktext">
                {user?.name || user?.email}
              </div>
              <div className="truncate text-[11px] text-faint">{user?.email}</div>
            </div>
          </div>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-sm text-muted transition-colors hover:border-red/40 hover:bg-red/10 hover:text-red"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="ml-56 flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}
