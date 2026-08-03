import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api/client';
import type { AuditEntry, Stats } from '../api/types';
import { ErrorBlock, formatDate, LoadingBlock, StatCard } from '../components/ui';

const statsKey = ['admin', 'stats'] as const;
const auditKey = ['admin', 'audit'] as const;

export default function DashboardPage() {
  const stats = useQuery({
    queryKey: statsKey,
    queryFn: async () => (await api.get<Stats>('/admin/stats')).data,
  });
  const audit = useQuery({
    queryKey: auditKey,
    queryFn: async () =>
      (await api.get<AuditEntry[]>('/admin/audit', { params: { limit: 6 } }))
        .data,
  });

  if (stats.isPending) return <LoadingBlock label="Loading dashboard…" />;
  if (stats.isError)
    return <ErrorBlock message="Failed to load stats" onRetry={() => stats.refetch()} />;
  const data = stats.data;

  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">Intellix AI platform overview</p>

      <div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          label="Total users"
          value={data.totalUsers}
          hint={`${data.admins} admin · ${data.banned} banned`}
          icon="◉"
        />
        <StatCard
          label="Generations today"
          value={data.todayGenerations}
          hint={`${data.activeToday} active today`}
          icon="⚡"
          color="text-emerald"
        />
        <StatCard
          label="All-time generations"
          value={data.totalGenerations}
          icon="✦"
          color="text-cyan"
        />
        <StatCard
          label="Active today"
          value={data.activeToday}
          hint="users with login today"
          icon="●"
          color="text-blue"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <div className="rounded-2xl border border-line bg-surface p-5 xl:col-span-3">
          <h2 className="mb-4 text-sm font-bold text-muted">
            Generations — last 7 days
          </h2>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={data.last7Days}>
              <CartesianGrid stroke="#292d38" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#9b9da8', fontSize: 11 }}
                axisLine={{ stroke: '#292d38' }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: '#9b9da8', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={30}
              />
              <Tooltip
                cursor={{ fill: '#191c25' }}
                contentStyle={{
                  backgroundColor: '#191c25',
                  border: '1px solid #292d38',
                  borderRadius: 10,
                  color: '#f7f7fa',
                }}
              />
              <Bar dataKey="count" fill="#3b82f6" radius={[6, 6, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 xl:col-span-2">
          <h2 className="mb-4 text-sm font-bold text-muted">By provider</h2>
          <div className="space-y-3">
            {data.perProvider.length === 0 && (
              <div className="text-sm text-faint">No usage recorded yet.</div>
            )}
            {data.perProvider.map((entry) => {
              const max = Math.max(1, ...data.perProvider.map((p) => p.count));
              return (
                <div key={entry.provider}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-semibold">{entry.displayName}</span>
                    <span className="text-muted">{entry.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-elevated">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue to-cyan"
                      style={{ width: `${(entry.count / max) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-muted">Recent activity</h2>
          <Link to="/audit" className="text-xs font-semibold text-blue hover:underline">
            View all →
          </Link>
        </div>
        {audit.isPending && <LoadingBlock label="Loading activity…" />}
        {audit.data && audit.data.length === 0 && (
          <div className="py-6 text-center text-sm text-faint">No activity yet.</div>
        )}
        {audit.data && audit.data.length > 0 && (
          <div className="divide-y divide-line">
            {audit.data.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="w-44 shrink-0 font-mono text-[11px] text-faint">
                  {formatDate(entry.createdAt)}
                </span>
                <span className="w-40 shrink-0 truncate font-semibold text-blue">
                  {entry.action}
                </span>
                <span className="truncate text-muted">
                  {entry.actorEmail ?? 'system'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
