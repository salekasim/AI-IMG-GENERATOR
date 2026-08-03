import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createWorkflow,
  deleteWorkflow,
  duplicateWorkflow,
  fetchWorkflows,
  updateWorkflow,
} from '../api/workflows';
import { errorMessage } from '../api/client';
import { ActionButton, Badge, ConfirmDialog, Spinner, formatDate } from '../components/ui';

const TILE_GRADIENTS = [
  'from-blue to-cyan',
  'from-violet to-cyan',
  'from-emerald to-cyan',
  'from-amber to-red',
  'from-blue to-violet',
  'from-cyan to-emerald',
];

function timeAgo(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
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

type StatusFilter = 'all' | 'enabled' | 'disabled';

export function WorkflowListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const { data: workflows, isLoading, error } = useQuery({
    queryKey: ['workflows'],
    queryFn: fetchWorkflows,
  });

  const createMutation = useMutation({
    mutationFn: () => createWorkflow({ name: 'Untitled workflow', graph: { nodes: [], edges: [] } }),
    onSuccess: (wf) => navigate(`/workflows/${wf.id}`),
    onError: (err) => setNotice(errorMessage(err)),
  });

  const duplicateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => duplicateWorkflow(id, name),
    onSuccess: (wf) => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      navigate(`/workflows/${wf.id}`);
    },
    onError: (err) => setNotice(errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteWorkflow(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setPendingDelete(null);
    },
    onError: (err) => {
      setNotice(errorMessage(err));
      setPendingDelete(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateWorkflow(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
    onError: (err) => setNotice(errorMessage(err)),
  });

  const filtered = useMemo(() => {
    if (!workflows) return [];
    const needle = query.trim().toLowerCase();
    return workflows.filter((wf) => {
      if (status === 'enabled' && !wf.enabled) return false;
      if (status === 'disabled' && wf.enabled) return false;
      if (!needle) return true;
      return (
        wf.name.toLowerCase().includes(needle) ||
        (wf.description ?? '').toLowerCase().includes(needle)
      );
    });
  }, [workflows, query, status]);

  const totalNodes = workflows?.reduce((sum, wf) => sum + (wf.nodeCount ?? 0), 0) ?? 0;
  const enabledCount = workflows?.filter((wf) => wf.enabled).length ?? 0;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <header className="relative overflow-hidden rounded-3xl border border-line bg-surface/60 p-6 sm:p-8">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-blue/15 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 right-40 h-56 w-56 rounded-full bg-cyan/10 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-blue">
              <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald" />
              Orchestrator
            </div>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
              Workflows <span className="text-gradient">Studio</span>
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted">
              Build visual AI pipelines on the node canvas — drag, connect, run.
            </p>
          </div>
          <div className="flex w-full items-center gap-3 sm:w-auto">
            <div className="relative w-full sm:w-64">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-faint">
                ⌕
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search workflows…"
                className="w-full rounded-xl border border-line bg-ink/70 py-2 pl-8 pr-3 text-sm text-inktext placeholder:text-faint outline-none transition-colors focus:border-blue/60"
              />
            </div>
            <ActionButton
              tone="primary"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating…' : '+ New workflow'}
            </ActionButton>
          </div>
        </div>
      </header>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total workflows', value: workflows?.length ?? 0, icon: '≋', color: 'text-blue' },
          { label: 'Enabled', value: enabledCount, icon: '●', color: 'text-emerald' },
          { label: 'Disabled', value: (workflows?.length ?? 0) - enabledCount, icon: '○', color: 'text-faint' },
          { label: 'Total nodes', value: totalNodes, icon: '✦', color: 'text-cyan' },
        ].map((s) => (
          <div
            key={s.label}
            className="glass rounded-2xl border border-line px-4 py-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">{s.label}</span>
              <span className={`${s.color} text-base`}>{s.icon}</span>
            </div>
            <div className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight">
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      {workflows && workflows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { value: 'all', label: 'All' },
              { value: 'enabled', label: 'Enabled' },
              { value: 'disabled', label: 'Disabled' },
            ] as Array<{ value: StatusFilter; label: string }>
          ).map((pill) => (
            <button
              key={pill.value}
              onClick={() => setStatus(pill.value)}
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
            {filtered.length} of {workflows.length}
          </span>
        </div>
      )}

      {notice && (
        <div className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-sm text-red">
          {notice}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-sm text-red">
          Failed to load workflows: {errorMessage(error)}
        </div>
      ) : !workflows?.length ? (
        /* Empty state */
        <div className="relative overflow-hidden rounded-3xl border border-dashed border-line bg-ink/60 py-20 text-center">
          <div
            className="pointer-events-none absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-blue/10 blur-3xl"
            aria-hidden
          />
          <div className="relative flex flex-col items-center gap-3">
            <span className="text-gradient text-5xl font-extrabold">≋</span>
            <div>
              <p className="font-semibold text-inktext">No workflows yet</p>
              <p className="mt-1 text-sm text-muted">
                Create your first visual AI pipeline, or use the seeded templates.
              </p>
            </div>
            <ActionButton tone="primary" onClick={() => createMutation.mutate()}>
              Create your first workflow
            </ActionButton>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        /* No search/filter results */
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-ink/60 py-16 text-center">
          <span className="text-3xl">⌕</span>
          <div>
            <p className="font-semibold text-inktext">No workflows match</p>
            <p className="mt-1 text-sm text-muted">Try a different search or filter.</p>
          </div>
          <ActionButton
            onClick={() => {
              setQuery('');
              setStatus('all');
            }}
          >
            Clear filters
          </ActionButton>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((wf, index) => (
            <div
              key={wf.id}
              className="group relative overflow-hidden rounded-2xl border border-line bg-surface/70 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue/40 hover:shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
            >
              <div
                className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue/60 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
              <div className="flex items-start justify-between gap-2">
                <Link to={`/workflows/${wf.id}`} className="flex min-w-0 items-center gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-base font-extrabold text-ink shadow-lg ${TILE_GRADIENTS[index % TILE_GRADIENTS.length]}`}
                  >
                    {wf.name.trim()[0]?.toUpperCase() ?? '?'}
                  </span>
                  <h3 className="min-w-0 truncate font-semibold text-inktext transition-colors group-hover:text-blue-400">
                    {wf.name}
                  </h3>
                </Link>
                <button
                  onClick={() => toggleMutation.mutate({ id: wf.id, enabled: !wf.enabled })}
                  title={wf.enabled ? 'Disable workflow' : 'Enable workflow'}
                  className="shrink-0"
                >
                  <Badge tone={wf.enabled ? 'emerald' : 'neutral'}>
                    <span
                      className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${
                        wf.enabled ? 'bg-emerald' : 'bg-faint'
                      }`}
                    />
                    {wf.enabled ? 'enabled' : 'disabled'}
                  </Badge>
                </button>
              </div>
              <p className="mt-3 line-clamp-2 min-h-8 text-xs text-muted">
                {wf.description || 'No description yet — open the builder to add one.'}
              </p>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-faint">
                <span className="inline-flex items-center gap-1 rounded-md border border-line/70 bg-elevated/50 px-1.5 py-0.5">
                  ✦ {wf.nodeCount ?? 0} nodes
                </span>
                <span className="inline-flex items-center gap-1 rounded-md border border-line/70 bg-elevated/50 px-1.5 py-0.5">
                  v{wf.version}
                </span>
                <span className="ml-auto">{timeAgo(wf.updatedAt)}</span>
              </div>
              <div className="mt-4 flex gap-2">
                <Link
                  to={`/workflows/${wf.id}`}
                  className="flex-1 rounded-lg bg-blue px-3 py-1.5 text-center text-xs font-semibold text-ink shadow-[0_2px_14px_rgba(59,130,246,0.3)] transition-all hover:bg-blue/85 hover:shadow-[0_2px_18px_rgba(59,130,246,0.45)]"
                >
                  Open builder
                </Link>
                <button
                  onClick={() =>
                    duplicateMutation.mutate({ id: wf.id, name: `${wf.name} copy` })
                  }
                  className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-blue/40 hover:text-inktext"
                  title="Duplicate"
                >
                  ⧉
                </button>
                <button
                  onClick={() => setPendingDelete(wf.id)}
                  className="rounded-lg border border-red/30 px-3 py-1.5 text-xs text-red transition-colors hover:bg-red/10"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

        <ConfirmDialog
          open={!!pendingDelete}
          title="Delete workflow"
          description={
            <span>
              Delete workflow '<span className="font-semibold text-inktext">
                {workflows?.find((w) => w.id === pendingDelete)?.name}
              </span>
              '? Its executions and graph are permanently removed. This cannot
              be undone.
            </span>
          }
          confirmLabel="Yes, delete"
          onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete)}
          onClose={() => setPendingDelete(null)}
          pending={deleteMutation.isPending}
        />
      </div>
    );
}
