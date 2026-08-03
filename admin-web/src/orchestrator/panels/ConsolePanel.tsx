import { useEffect, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';

const LEVEL_COLOR: Record<string, string> = {
  info: 'text-sky-300',
  success: 'text-emerald-400',
  error: 'text-red-400',
  warn: 'text-amber-400',
  api: 'text-cyan-300',
};

type Filter = 'all' | 'success' | 'error' | 'warn' | 'api';

export function ConsolePanel() {
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState(true);
  const lines = useWorkflowStore((s) => s.consoleLines);
  const runState = useWorkflowStore((s) => s.runState);
  const executionId = useWorkflowStore((s) => s.executionId);
  const clearConsole = useWorkflowStore((s) => s.clearConsole);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const visible = filter === 'all' ? lines : lines.filter((l) => l.level === filter);

  return (
    <section className="flex shrink-0 flex-col border-t border-line bg-ink/95">
      <div className="flex items-center gap-3 px-4 py-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-[11px] font-semibold uppercase tracking-widest text-muted hover:text-inktext"
        >
          {open ? '▾' : '▸'} Console
        </button>
        {runState === 'running' && (
          <span className="flex items-center gap-1.5 text-[11px] text-blue-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" /> live stream
          </span>
        )}
        {runState === 'done' && <span className="text-[11px] text-emerald-400">● finished</span>}
        {runState === 'error' && <span className="text-[11px] text-red-400">● failed</span>}
        {executionId && (
          <span className="font-mono text-[10px] text-faint">exec {executionId.slice(0, 8)}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {(['all', 'success', 'error', 'warn', 'api'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors ${
                filter === f ? 'bg-elevated text-inktext' : 'text-faint hover:text-muted'
              }`}
            >
              {f}
            </button>
          ))}
          <button
            onClick={clearConsole}
            className="ml-2 rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-faint hover:text-red-400"
          >
            Clear
          </button>
        </div>
      </div>
      {open && (
        <div ref={scrollRef} className="h-44 overflow-y-auto border-t border-line px-4 py-2 font-mono text-[11px] leading-relaxed">
          {!visible.length ? (
            <p className="py-4 text-center text-faint">No output yet — hit ▶ Run to execute the workflow.</p>
          ) : (
            visible.map((line) => (
              <div key={line.id} className="flex gap-2 py-0.5">
                <span className="shrink-0 text-faint">{line.time}</span>
                <span className={`shrink-0 w-12 ${LEVEL_COLOR[line.level]}`}>{line.level.toUpperCase()}</span>
                <span className="shrink-0 text-cyan-300/80">[{line.source}]</span>
                <span className="min-w-0 text-slate-300">{line.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
