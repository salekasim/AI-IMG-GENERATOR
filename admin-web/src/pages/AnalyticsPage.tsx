import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, errorMessage } from '../api/client';
import { Spinner } from '../components/ui';

interface AnalyticsOverview {
  runs: number;
  successRate: number;
  costUsd: number;
  avgLatencyMs: number;
  images: number;
  tokensIn: number;
  tokensOut: number;
  clientRuns: number;
  adminRuns: number;
}

interface DayPoint {
  date: string;
  runs: number;
  errors: number;
  costUsd: number;
}

interface RowStat {
  runs: number;
  ok: number;
  fail: number;
  latencyMs: number;
  costUsd: number;
}

interface AnalyticsResponse {
  days: number;
  from: string;
  overview: AnalyticsOverview;
  series: DayPoint[];
  providers: Array<RowStat & { name: string }>;
  models: Array<RowStat & { name: string }>;
  workflows: Array<{ name: string } & RowStat>;
  projects: Array<{
    name: string;
    runs: number;
    client: number;
    ok: number;
    costUsd: number;
    clientRate: number;
  }>;
  users: Array<{ email: string; runs: number; ok: number; costUsd: number }>;
  providerHealth: Array<{
    name: string;
    displayName: string;
    healthStatus: string;
    failureStreak: number;
  }>;
  usage: Array<{ name: string; calls: number; ok: number; images: number; costUsd: number }>;
}

const RANGES = [7, 30, 90] as const;

const fmtUsd = (v: number) => `$${v.toFixed(v >= 1 ? 2 : 4)}`;

const TOOLTIP_STYLE = {
  background: '#0b0e14',
  border: '1px solid rgba(148,163,184,0.15)',
  borderRadius: '10px',
  fontSize: '11px',
  color: '#cbd5e1',
};

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-ink p-5">
      <h3 className="text-sm font-bold text-inktext">{title}</h3>
      {subtitle && <p className="mt-0.5 text-[11px] text-faint">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function RowTable({
  rows,
  columns,
  emptyLabel,
}: {
  rows: Array<Record<string, unknown>>;
  columns: Array<{ key: string; label: string; render: (row: Record<string, unknown>) => React.ReactNode; w?: string }>;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-[11px] text-faint">{emptyLabel}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-[11px]">
        <thead>
          <tr className="border-b border-line text-[9px] uppercase tracking-[0.14em] text-faint">
            {columns.map((c) => (
              <th key={c.key} className={`py-1.5 pr-3 font-semibold ${c.w ?? ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line/50 last:border-0">
              {columns.map((c) => (
                <td key={c.key} className={`py-2 pr-3 ${c.w ?? ''}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AnalyticsPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['analytics', days],
    queryFn: async () => (await api.get<AnalyticsResponse>('/admin/analytics', { params: { days } })).data,
  });

  const chartData = (data?.series ?? []).map((d) => ({
    ...d,
    label: d.date.slice(5),
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Analytics</h1>
          <p className="mt-1 text-xs text-muted">
            Usage, cost &amp; performance across providers, workflows, projects and users
          </p>
        </div>
        <div className="flex gap-1 rounded-xl border border-line bg-ink p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                days === r ? 'bg-blue/15 text-blue' : 'text-muted hover:text-inktext'
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-24">
          <Spinner className="h-7 w-7" />
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-red/30 bg-red/10 p-5 text-center text-xs text-red">
          {errorMessage(error)}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            {[
              { label: 'Total runs', value: String(data.overview.runs), accent: 'text-inktext' },
              { label: 'Success rate', value: `${data.overview.successRate}%`, accent: 'text-emerald-300' },
              { label: 'Total cost', value: fmtUsd(data.overview.costUsd), accent: 'text-cyan-300' },
              { label: 'Avg latency', value: `${data.overview.avgLatencyMs}ms`, accent: 'text-inktext' },
              { label: 'Images', value: String(data.overview.images), accent: 'text-inktext' },
              { label: 'Tokens in/out', value: `${data.overview.tokensIn.toLocaleString()} / ${data.overview.tokensOut.toLocaleString()}`, accent: 'text-inktext' },
              { label: 'Admin runs', value: String(data.overview.adminRuns), accent: 'text-blue-300' },
              { label: 'Client runs', value: String(data.overview.clientRuns), accent: 'text-violet-300' },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-line bg-ink p-3.5">
                <div className={`text-lg font-extrabold tabular-nums ${s.accent}`}>{s.value}</div>
                <div className="mt-0.5 text-[10px] font-medium text-faint">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Section title="Runs per day" subtitle={`Last ${data.days} days — green success, red errors`}>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="gRuns" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Area type="monotone" dataKey="runs" name="Runs" stroke="#38bdf8" strokeWidth={2} fill="url(#gRuns)" />
                  <Area type="monotone" dataKey="errors" name="Errors" stroke="#f87171" strokeWidth={1.5} fill="none" strokeDasharray="3 3" />
                </AreaChart>
              </ResponsiveContainer>
            </Section>

            <Section title="Cost per day" subtitle="USD, by execution start date">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData}>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtUsd(Number(v))} />
                  <Bar dataKey="costUsd" name="Cost" fill="#22d3ee" radius={[3, 3, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </Section>
          </div>

          <Section title="Providers" subtitle="Every routing attempt — includes skipped/failed steps inside chains">
            <RowTable
              rows={data.providers as unknown as Array<Record<string, unknown>>}
              emptyLabel="No provider activity in this window."
              columns={[
                { key: 'name', label: 'Provider', render: (r) => <span className="font-semibold text-inktext">{String(r.name)}</span> },
                { key: 'runs', label: 'Attempts', w: 'w-16', render: (r) => <span className="tabular-nums text-muted">{String(r.runs)}</span> },
                { key: 'ok', label: 'Success', render: (r) => <span className="tabular-nums text-emerald-300">{String(r.ok)}</span> },
                { key: 'fail', label: 'Failed', render: (r) => <span className="tabular-nums text-red">{String(r.fail)}</span> },
                { key: 'latencyMs', label: 'Avg latency', render: (r) => <span className="tabular-nums text-muted">{String(r.latencyMs)}ms</span> },
                { key: 'costUsd', label: 'Cost', render: (r) => <span className="tabular-nums text-cyan-300">{fmtUsd(Number(r.costUsd))}</span> },
              ]}
            />
          </Section>

          <Section title="Models" subtitle="Per model inside routing chains">
            <RowTable
              rows={data.models as unknown as Array<Record<string, unknown>>}
              emptyLabel="No model activity in this window."
              columns={[
                { key: 'name', label: 'Model', render: (r) => <span className="font-semibold text-inktext">{String(r.name)}</span> },
                { key: 'runs', label: 'Attempts', w: 'w-16', render: (r) => <span className="tabular-nums text-muted">{String(r.runs)}</span> },
                { key: 'ok', label: 'Success', render: (r) => <span className="tabular-nums text-emerald-300">{String(r.ok)}</span> },
                { key: 'fail', label: 'Failed', render: (r) => <span className="tabular-nums text-red">{String(r.fail)}</span> },
                { key: 'latencyMs', label: 'Avg latency', render: (r) => <span className="tabular-nums text-muted">{String(r.latencyMs)}ms</span> },
                { key: 'costUsd', label: 'Cost', render: (r) => <span className="tabular-nums text-cyan-300">{fmtUsd(Number(r.costUsd))}</span> },
              ]}
            />
          </Section>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Section title="Workflows" subtitle="Runs, success and cost per workflow">
              <RowTable
                rows={data.workflows as unknown as Array<Record<string, unknown>>}
                emptyLabel="No workflow runs in this window."
                columns={[
                  { key: 'name', label: 'Workflow', render: (r) => <span className="font-semibold text-inktext">{String(r.name)}</span> },
                  { key: 'runs', label: 'Runs', w: 'w-14', render: (r) => <span className="tabular-nums text-muted">{String(r.runs)}</span> },
                  { key: 'ok', label: 'Success', w: 'w-14', render: (r) => <span className="tabular-nums text-emerald-300">{String(r.ok)}</span> },
                  { key: 'latencyMs', label: 'Avg', render: (r) => <span className="tabular-nums text-muted">{String(r.latencyMs)}ms</span> },
                  { key: 'costUsd', label: 'Cost', render: (r) => <span className="tabular-nums text-cyan-300">{fmtUsd(Number(r.costUsd))}</span> },
                ]}
              />
            </Section>

            <Section title="Projects" subtitle="Source split — how much came via client keys vs admin">
              <RowTable
                rows={data.projects as unknown as Array<Record<string, unknown>>}
                emptyLabel="No project executions in this window."
                columns={[
                  { key: 'name', label: 'Project', render: (r) => <span className="font-semibold text-inktext">{String(r.name)}</span> },
                  { key: 'runs', label: 'Runs', w: 'w-14', render: (r) => <span className="tabular-nums text-muted">{String(r.runs)}</span> },
                  { key: 'clientRate', label: 'Client %', w: 'w-16', render: (r) => <span className="tabular-nums text-violet-300">{String(r.clientRate)}%</span> },
                  { key: 'costUsd', label: 'Cost', render: (r) => <span className="tabular-nums text-cyan-300">{fmtUsd(Number(r.costUsd))}</span> },
                ]}
              />
            </Section>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Section title="Users" subtitle="Who triggered the runs">
              <RowTable
                rows={data.users as unknown as Array<Record<string, unknown>>}
                emptyLabel="No user-triggered runs in this window."
                columns={[
                  { key: 'email', label: 'User', render: (r) => <span className="font-semibold text-inktext">{String(r.email)}</span> },
                  { key: 'runs', label: 'Runs', w: 'w-14', render: (r) => <span className="tabular-nums text-muted">{String(r.runs)}</span> },
                  { key: 'ok', label: 'Success', w: 'w-16', render: (r) => <span className="tabular-nums text-emerald-300">{String(r.ok)}</span> },
                  { key: 'costUsd', label: 'Cost', render: (r) => <span className="tabular-nums text-cyan-300">{fmtUsd(Number(r.costUsd))}</span> },
                ]}
              />
            </Section>

            <Section title="API usage records" subtitle="Raw provider calls (chat + image), all time in window">
              <RowTable
                rows={data.usage as unknown as Array<Record<string, unknown>>}
                emptyLabel="No usage records in this window."
                columns={[
                  { key: 'name', label: 'Provider', render: (r) => <span className="font-semibold text-inktext">{String(r.name)}</span> },
                  { key: 'calls', label: 'Calls', w: 'w-14', render: (r) => <span className="tabular-nums text-muted">{String(r.calls)}</span> },
                  { key: 'ok', label: 'Success', w: 'w-14', render: (r) => <span className="tabular-nums text-emerald-300">{String(r.ok)}</span> },
                  { key: 'images', label: 'Images', w: 'w-14', render: (r) => <span className="tabular-nums text-muted">{String(r.images)}</span> },
                  { key: 'costUsd', label: 'Cost', render: (r) => <span className="tabular-nums text-cyan-300">{fmtUsd(Number(r.costUsd))}</span> },
                ]}
              />
            </Section>
          </div>
        </>
      ) : null}
    </div>
  );
}
