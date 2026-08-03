import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { fetchExecutions, fetchExecution } from '../../api/workflows';
import type { WorkflowExecution } from '../../api/types';
import { errorMessage } from '../../api/client';
import { useWorkflowStore } from '../store/workflowStore';
import { Spinner } from '../../components/ui';

const STATUS_META: Record<WorkflowExecution['status'], { dot: string; label: string; text: string }> = {
  success: { dot: 'bg-emerald', label: 'succeeded', text: 'text-emerald' },
  error: { dot: 'bg-red', label: 'failed', text: 'text-red' },
  running: { dot: 'bg-blue animate-pulse', label: 'running', text: 'text-blue' },
  pending: { dot: 'bg-amber', label: 'queued', text: 'text-amber' },
};

const ATTEMPT_META = {
  success: { label: '✓ ok', cls: 'text-emerald border-emerald-500/30 bg-emerald-500/10' },
  error: { label: '✗ failed', cls: 'text-red border-red-500/30 bg-red-500/10' },
  skipped: { label: '↷ skipped', cls: 'text-faint border-line bg-elevated' },
} as const;

function AttemptList({ execution }: { execution: WorkflowExecution }) {
  const attempts = execution.attempts ?? [];
  return (
    <div className="mt-2 space-y-1 border-t border-line/60 pt-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">
        Routing attempts {execution.providerUsed ? `→ ${execution.providerUsed}/${execution.modelUsed}` : ''}
      </p>
      {attempts.length === 0 && (
        <p className="text-[10px] text-faint">No provider routing attempts recorded.</p>
      )}
      {attempts.map((a, i) => {
        const meta = ATTEMPT_META[a.status] ?? ATTEMPT_META.skipped;
        return (
          <div key={`${a.provider}-${a.model}-${i}`} className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 ${meta.cls}`}>
            <span className="mt-0.5 shrink-0 text-[10px]">{meta.label}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-medium">
                {a.provider}/{a.model}
              </p>
              {a.error && <p className="mt-0.5 line-clamp-2 text-[9px] leading-snug opacity-80">{a.error}</p>}
            </div>
            <span className="shrink-0 text-[9px] tabular-nums opacity-70">{a.latencyMs}ms</span>
            {a.costUsd > 0 && <span className="shrink-0 text-[9px] tabular-nums opacity-70">${a.costUsd.toFixed(4)}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function ExecutionsDrawer({
  open,
  workflowId,
  onClose,
}: {
  open: boolean;
  workflowId: string | null;
  onClose: () => void;
}) {
  const pushConsole = useWorkflowStore((s) => s.pushConsole);
  const clearRun = useWorkflowStore((s) => s.clearRun);
  const setRunState = useWorkflowStore((s) => s.setRunState);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['executions', workflowId],
    queryFn: () => fetchExecutions(workflowId!, 30),
    enabled: open && !!workflowId,
  });

  const replay = async (id: string) => {
    clearRun();
    try {
      const detail = await fetchExecution(id);
      (detail.logs ?? []).forEach((line) => {
        const level = line.level === 'error' ? 'error' : line.level === 'warn' ? 'warn' : line.level === 'success' ? 'success' : line.level === 'api' ? 'api' : 'info';
        pushConsole(level, line.source, line.message);
      });
      pushConsole(
        detail.status === 'success' ? 'success' : 'error',
        'engine',
        `replay of ${id.slice(0, 8)} — ${detail.status}${detail.error ? `: ${detail.error}` : ''}`,
      );
      setRunState(detail.status === 'success' ? 'done' : 'error');
    } catch (err) {
      pushConsole('error', 'engine', `failed to load execution: ${errorMessage(err)}`);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 bg-black/50"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: 360 }}
            animate={{ x: 0 }}
            exit={{ x: 360 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="glass-strong fixed right-0 top-0 z-50 flex h-full w-[360px] flex-col border-l border-line"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h3 className="text-sm font-bold text-inktext">Execution history</h3>
                <p className="text-[11px] text-faint">Past runs · attempts &amp; cost per run</p>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-elevated hover:text-inktext"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {isLoading ? (
                <div className="flex justify-center py-16">
                  <Spinner />
                </div>
              ) : isError ? (
                <div className="rounded-xl border border-red/30 bg-red/10 p-4 text-center">
                  <p className="text-xs text-red">{errorMessage(error)}</p>
                  <button
                    onClick={() => refetch()}
                    className="mt-2 rounded-lg border border-line px-3 py-1 text-xs hover:bg-elevated"
                  >
                    Retry
                  </button>
                </div>
              ) : !data?.length ? (
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                  <span className="text-2xl opacity-40">◷</span>
                  <p className="text-xs text-faint">
                    No executions yet.
                    <br />
                    Hit ▶ Run to start one.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.map((exec) => {
                    const meta = STATUS_META[exec.status];
                    const expanded = expandedId === exec.id;
                    return (
                      <div
                        key={exec.id}
                        className="rounded-xl border border-line bg-surface/60 p-3 text-left transition-all hover:border-blue/40 hover:bg-elevated"
                      >
                        <button onClick={() => setExpandedId(expanded ? null : exec.id)} className="w-full text-left">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                            <span className={`text-xs font-semibold ${meta.text}`}>{meta.label}</span>
                            <span className="ml-auto font-mono text-[10px] text-faint">{exec.id.slice(0, 8)}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                            <span>{new Date(exec.startedAt).toLocaleString()}</span>
                            {exec.status !== 'pending' && (
                              <span className="tabular-nums">{exec.durationMs} ms</span>
                            )}
                            {(exec.tokensIn > 0 || exec.tokensOut > 0) && (
                              <span className="tabular-nums text-cyan-300">
                                {exec.tokensIn}+{exec.tokensOut} tok
                              </span>
                            )}
                            {exec.images > 0 && <span>🖼 {exec.images}</span>}
                            {exec.costUsd > 0 && (
                              <span className="tabular-nums text-emerald-300">${exec.costUsd.toFixed(4)}</span>
                            )}
                            {exec.providerUsed && (
                              <span className="truncate text-faint">
                                {exec.providerUsed}/{exec.modelUsed}
                              </span>
                            )}
                          </div>
                          {exec.error && (
                            <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-red-400/90">
                              {exec.error}
                            </p>
                          )}
                          <span className="mt-1 inline-block text-[10px] font-medium text-blue">
                            {expanded ? '▴ hide attempts' : '▾ attempts'}
                          </span>
                        </button>
                        {expanded && <AttemptList execution={exec} />}
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => replay(exec.id)}
                            className="flex-1 rounded-lg border border-line px-2 py-1 text-[10px] text-muted hover:border-blue/40 hover:text-inktext"
                          >
                            Replay logs
                          </button>
                          <button
                            onClick={() => setExpandedId(expanded ? null : exec.id)}
                            className="flex-1 rounded-lg border border-line px-2 py-1 text-[10px] text-muted hover:border-blue/40 hover:text-inktext"
                          >
                            {expanded ? 'Hide attempts' : 'Show attempts'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
