import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAdminExecutions,
  fetchAdminExecution,
  retryAdminExecution,
} from '../api/admin';
import { fetchWorkflows } from '../api/workflows';
import type { AdminExecutionRow } from '../api/types';
import { errorMessage } from '../api/client';
import { Badge, ConfirmDialog, Modal, Spinner, formatDate } from '../components/ui';

const STATUS_TONE: Record<string, 'emerald' | 'red' | 'amber' | 'neutral' | 'blue'> = {
  success: 'emerald',
  error: 'red',
  running: 'blue',
  pending: 'amber',
};

function timeAgo(value: string): string {
  const date = new Date(value);
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

export default function ExecutionsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>('');
  const [source, setSource] = useState<string>('');
  const [workflowId, setWorkflowId] = useState<string>('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [retryTarget, setRetryTarget] = useState<AdminExecutionRow | null>(null);
  const [retryError, setRetryError] = useState('');
  const PAGE = 30;

  const { data: workflows } = useQuery({
    queryKey: ['workflows'],
    queryFn: fetchWorkflows,
  });

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin', 'executions', { status, source, workflowId, q, offset }],
    queryFn: () =>
      fetchAdminExecutions({
        status: status || undefined,
        source: source || undefined,
        workflowId: workflowId || undefined,
        q: q.trim() || undefined,
        limit: PAGE,
        offset,
      }),
  });

  const hasRunning = useMemo(
    () => (data?.rows ?? []).some((r) => r.status === 'running'),
    [data],
  );

  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(() => refetch(), 4000);
    return () => clearInterval(timer);
  }, [hasRunning, refetch]);

  const { data: detail } = useQuery({
    queryKey: ['admin', 'execution', detailId],
    queryFn: () => (detailId ? fetchAdminExecution(detailId) : Promise.resolve(null)),
    enabled: !!detailId,
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? 4000 : false,
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => retryAdminExecution(id),
    onSuccess: (started) => {
      setRetryTarget(null);
      setRetryError('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'executions'] });
      setDetailId(started.id);
    },
    onError: (err) => setRetryError(errorMessage(err)),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const outputImages: string[] = useMemo(() => {
    const out = detail?.output as { images?: unknown[] } | null;
    if (!out || !Array.isArray(out.images)) return [];
    return out.images
      .map((img) => {
        const entry = img as { b64?: string; data?: string } | null;
        const b64 = entry?.b64 ?? entry?.data ?? '';
        return b64 ? (b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`) : '';
      })
      .filter(Boolean) as string[];
  }, [detail]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Executions</h1>
          <p className="mt-1 text-sm text-muted">
            Every workflow run across the platform — admin &amp; client.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-faint">
              ⌕
            </span>
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOffset(0);
              }}
              placeholder="Search workflow…"
              className="w-52 rounded-xl border border-line bg-ink/70 py-2 pl-8 pr-3 text-sm text-inktext placeholder:text-faint outline-none focus:border-blue/60"
            />
          </div>
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setOffset(0);
            }}
            className="rounded-xl border border-line bg-ink/70 px-3 py-2 text-xs text-inktext outline-none focus:border-blue/60"
          >
            <option value="">All sources</option>
            <option value="admin">Admin</option>
            <option value="client">Client</option>
          </select>
          <select
            value={workflowId}
            onChange={(e) => {
              setWorkflowId(e.target.value);
              setOffset(0);
            }}
            className="max-w-52 rounded-xl border border-line bg-ink/70 px-3 py-2 text-xs text-inktext outline-none focus:border-blue/60"
          >
            <option value="">All workflows</option>
            {(workflows ?? []).map((wf) => (
              <option key={wf.id} value={wf.id}>
                {wf.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {[
          { value: '', label: 'All' },
          { value: 'success', label: 'Success' },
          { value: 'error', label: 'Errors' },
          { value: 'running', label: 'Running' },
          { value: 'pending', label: 'Pending' },
        ].map((pill) => (
          <button
            key={pill.value}
            onClick={() => {
              setStatus(pill.value);
              setOffset(0);
            }}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
              status === pill.value
                ? 'bg-blue/20 text-blue ring-1 ring-blue/40'
                : 'border border-line bg-elevated/50 text-muted hover:text-inktext'
            }`}
          >
            {pill.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-faint">
          {total} run{total === 1 ? '' : 's'}
          {isFetching && <Spinner className="ml-2 inline h-3 w-3" />}
        </span>
      </div>

      {retryError && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-400">
          {retryError}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-sm text-red">
          Failed to load executions: {errorMessage(error)}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-line bg-surface/60">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-faint">
                <th className="px-4 py-3 font-semibold">Started</th>
                <th className="px-4 py-3 font-semibold">Workflow</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Provider</th>
                <th className="px-4 py-3 font-semibold">Source</th>
                <th className="px-4 py-3 text-right font-semibold">Img</th>
                <th className="px-4 py-3 text-right font-semibold">Cost</th>
                <th className="px-4 py-3 text-right font-semibold">Duration</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {isLoading && (
                <tr>
                  <td colSpan={9} className="px-4 py-14 text-center">
                    <Spinner className="mx-auto" />
                  </td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-14 text-center text-sm text-faint">
                    No executions match the current filters.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="group hover:bg-elevated/40">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                    <span className="block font-medium text-inktext">{timeAgo(row.startedAt)}</span>
                    <span className="block text-[10px] text-faint">{formatDate(row.startedAt)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/workflows/${row.workflowId}`}
                      className="max-w-44 truncate font-medium text-inktext hover:text-blue-400"
                      title={row.workflow.name}
                    >
                      {row.workflow.name}
                    </Link>
                    <span className="block text-[10px] text-faint">
                      {row.user ? row.user.email : row.source === 'client' ? 'client key' : 'system'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{row.status}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                    {row.providerUsed ? (
                      <>
                        <span className="text-inktext">{row.providerUsed}</span>
                        {row.modelUsed && <span className="text-faint">/{row.modelUsed}</span>}
                      </>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs">
                      {row.source === 'client' ? <span className="text-cyan-300">client</span> : <span className="text-violet-300">admin</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">{row.images}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">
                    ${row.costUsd.toFixed(4)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">
                    {row.status === 'running' ? (
                      <span className="text-blue-300">…</span>
                    ) : row.durationMs > 0 ? (
                      `${(row.durationMs / 1000).toFixed(1)}s`
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => setDetailId(row.id)}
                        className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-muted hover:border-blue/40 hover:text-inktext"
                      >
                        Details
                      </button>
                      <button
                        onClick={() => setRetryTarget(row)}
                        disabled={row.status === 'running' || row.status === 'pending'}
                        className="rounded-lg border border-blue/40 bg-blue/10 px-2.5 py-1 text-[11px] font-medium text-blue-300 hover:bg-blue/20 disabled:opacity-40"
                        title="Replay with the same input"
                      >
                        ⟳ Retry
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > PAGE && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3">
            <span className="text-[11px] text-faint">
              Showing {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
                disabled={offset === 0}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:text-inktext disabled:opacity-40"
              >
                ← Prev
              </button>
              <button
                onClick={() => setOffset((o) => o + PAGE)}
                disabled={offset + PAGE >= total}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:text-inktext disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      <Modal open={!!detailId} title="Execution details" onClose={() => setDetailId(null)}>
        {detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[detail.status] ?? 'neutral'}>{detail.status}</Badge>
              <span className="text-xs text-muted">
                {detail.workflowId ? (
                  <Link to={`/workflows/${detail.workflowId}`} className="text-blue-300 hover:underline">
                    workflow…
                  </Link>
                ) : (
                  'workflow deleted'
                )}
              </span>
              <span className="ml-auto text-[11px] text-faint">{formatDate(detail.startedAt)}</span>
            </div>

            {outputImages.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  Output images ({outputImages.length})
                </p>
                <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                  {outputImages.map((src, i) => (
                    <img
                      key={i}
                      src={src}
                      alt={`output ${i + 1}`}
                      className="aspect-square w-full rounded-lg border border-line object-cover"
                    />
                  ))}
                </div>
              </div>
            )}

            {detail.error && (
              <div className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-xs leading-relaxed text-red">
                {detail.error}
              </div>
            )}

            {Array.isArray(detail.attempts) && detail.attempts.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  Routing attempts
                </p>
                <div className="space-y-1.5">
                  {detail.attempts.map((a, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                        a.status === 'success'
                          ? 'border-emerald/25 bg-emerald/5'
                          : a.status === 'skipped'
                            ? 'border-line/60 bg-elevated/30'
                            : 'border-red/25 bg-red/5'
                      }`}
                    >
                      <span className="w-5 shrink-0 text-center text-[10px] tabular-nums text-faint">{i + 1}</span>
                      <span className="font-medium text-inktext">{a.provider}</span>
                      {a.model && <span className="text-faint">/{a.model}</span>}
                      <span className="ml-auto text-[10px] text-faint">
                        {a.status === 'success'
                          ? `${a.latencyMs} ms`
                          : a.status === 'skipped'
                            ? 'skipped'
                            : a.error ?? 'failed'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.input && (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  Input payload
                </p>
                <pre className="max-h-48 overflow-auto rounded-lg border border-line bg-ink p-3 font-mono text-[11px] leading-relaxed text-muted">
                  {JSON.stringify(detail.input, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}
      </Modal>

      {/* Retry confirm */}
      <ConfirmDialog
        open={!!retryTarget}
        title="Replay execution"
        description={
          <span>
            Re-run with the exact same input{' '}
            <span className="font-mono text-[11px] text-muted">
              {JSON.stringify(retryTarget?.workflow.name)}
            </span>
            ? A new execution will be created and the previous one is kept.
          </span>
        }
        confirmLabel="Yes, replay"
        onConfirm={() => retryTarget && retryMutation.mutate(retryTarget.id)}
        onClose={() => setRetryTarget(null)}
        pending={retryMutation.isPending}
      />
    </div>
  );
}
