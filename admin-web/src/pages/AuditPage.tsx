import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { AuditEntry } from '../api/types';
import {
  Badge,
  ErrorBlock,
  formatDate,
  LoadingBlock,
} from '../components/ui';

const auditKey = ['admin', 'audit'] as const;

function toneFor(action: string): 'neutral' | 'emerald' | 'amber' | 'red' | 'blue' {
  if (action.startsWith('users.')) return action.endsWith('update') ? 'amber' : 'neutral';
  if (action.startsWith('providers.')) return 'blue';
  if (action.startsWith('settings.')) return 'emerald';
  return 'neutral';
}

export default function AuditPage() {
  const [limit, setLimit] = useState(100);

  const audit = useQuery({
    queryKey: [...auditKey, limit],
    queryFn: async () =>
      (await api.get<AuditEntry[]>('/admin/audit', { params: { limit } })).data,
  });

  if (audit.isPending) return <LoadingBlock label="Loading audit log…" />;
  if (audit.isError)
    return <ErrorBlock message="Failed to load audit log" onRetry={() => audit.refetch()} />;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Audit Log</h1>
          <p className="mt-1 text-sm text-muted">
            Every admin action is recorded here
          </p>
        </div>
        <select
          value={limit}
          onChange={(event) => setLimit(Number(event.target.value))}
          className="rounded-xl border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-blue"
        >
          <option value={50}>50 entries</option>
          <option value={100}>100 entries</option>
          <option value={300}>300 entries</option>
        </select>
      </div>

      {audit.data.length === 0 && (
        <div className="mt-10 rounded-2xl border border-line bg-surface p-10 text-center text-sm text-faint">
          No audit entries yet.
        </div>
      )}

      <div className="mt-5 space-y-3">
        {audit.data.map((entry) => (
          <div
            key={entry.id}
            className="rounded-xl border border-line bg-surface p-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={toneFor(entry.action)}>{entry.action}</Badge>
              <span className="text-sm font-semibold">
                {entry.actorEmail ?? 'system'}
              </span>
              <span className="ml-auto text-xs text-faint">
                {formatDate(entry.createdAt)}
              </span>
            </div>
            {entry.detail && (
              <pre className="mt-3 overflow-x-auto rounded-lg bg-ink p-3 font-mono text-[11px] leading-relaxed text-muted">
                {JSON.stringify(entry.detail, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
