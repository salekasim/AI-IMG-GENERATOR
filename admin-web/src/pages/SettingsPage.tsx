import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api/client';
import { clearAuditLogs } from '../api/admin';
import type { SettingsMap } from '../api/types';
import { InlineMessage, Spinner, ConfirmDialog } from '../components/ui';

const settingsKey = ['admin', 'settings'] as const;

interface ControlDef {
  key: string;
  label: string;
  hint: string;
  kind: 'number' | 'boolean' | 'select' | 'days' | 'json';
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  default: unknown;
  defaultLabel: string;
  /** stored = display value × scale (e.g. seconds → milliseconds) */
  scale?: number;
}

const CONTROLS: ControlDef[] = [
  // Audit
  {
    key: 'audit.retentionDays',
    label: 'Audit log retention',
    hint: 'Auto-delete audit logs older than this many days. Empty / 0 = keep forever.',
    kind: 'days',
    min: 1,
    max: 3650,
    default: null,
    defaultLabel: 'never (keep forever)',
  },
  // User defaults & limits
  {
    key: 'users.defaultDailyQuota',
    label: 'Default daily quota',
    hint: 'How many images a newly registered user can generate per day.',
    kind: 'number',
    min: 1,
    max: 10000,
    default: 20,
    defaultLabel: '20',
  },
  {
    key: 'users.maxImagesPerRun',
    label: 'Max images per run',
    hint: 'Maximum imageCount a single generation request may ask for.',
    kind: 'number',
    min: 1,
    max: 8,
    default: 4,
    defaultLabel: '4',
  },
  {
    key: 'users.defaultResolution',
    label: 'Default resolution tier',
    hint: 'Used when a request does not specify a resolution.',
    kind: 'select',
    options: [
      { value: 'high', label: 'High' },
      { value: 'medium', label: 'Medium' },
      { value: 'low', label: 'Low' },
    ],
    default: 'medium',
    defaultLabel: 'medium',
  },
  {
    key: 'users.allowHighResolution',
    label: 'Free users: high resolution',
    hint: 'Allow non-admin users to request the high tier.',
    kind: 'boolean',
    default: true,
    defaultLabel: 'allowed',
  },
  {
    key: 'users.allowMediumResolution',
    label: 'Free users: medium resolution',
    hint: 'Allow non-admin users to request the medium tier.',
    kind: 'boolean',
    default: true,
    defaultLabel: 'allowed',
  },
  {
    key: 'users.allowLowResolution',
    label: 'Free users: low resolution',
    hint: 'Allow non-admin users to request the low tier.',
    kind: 'boolean',
    default: true,
    defaultLabel: 'allowed',
  },
  {
    key: 'users.defaultRatio',
    label: 'Default image ratio',
    hint: 'Default aspect ratio for new generations.',
    kind: 'select',
    options: [
      { value: '1:1', label: '1:1 (square)' },
      { value: '16:9', label: '16:9 (landscape)' },
      { value: '9:16', label: '9:16 (portrait)' },
      { value: '4:3', label: '4:3' },
      { value: '3:4', label: '3:4' },
      { value: '21:9', label: '21:9 (ultrawide)' },
    ],
    default: '1:1',
    defaultLabel: '1:1',
  },
  // Health & routing
  {
    key: 'health.pingMs',
    label: 'Health check interval (seconds)',
    hint: 'How often providers are pinged for health status.',
    kind: 'number',
    min: 5,
    max: 86400,
    default: 300,
    defaultLabel: '300s (5 min)',
    scale: 1000,
  },
  {
    key: 'provider.cooldownMs',
    label: 'Provider cooldown (seconds)',
    hint: 'How long a provider stays in cooldown after a failed health check.',
    kind: 'number',
    min: 0,
    max: 3600,
    default: 30,
    defaultLabel: '30s',
    scale: 1000,
  },
  {
    key: 'routing.maxChainDepth',
    label: 'Chain failover depth',
    hint: 'Maximum number of steps a routing chain may contain.',
    kind: 'number',
    min: 1,
    max: 10,
    default: 4,
    defaultLabel: '4',
  },
  {
    key: 'execution.timeoutMs',
    label: 'Execution timeout (seconds)',
    hint: 'Maximum time a single workflow run may take.',
    kind: 'number',
    min: 10,
    max: 3600,
    default: 300,
    defaultLabel: '300s (5 min)',
    scale: 1000,
  },
];

const SECTIONS: Array<{ title: string; hint: string; keys: string[] }> = [
  {
    title: 'Audit Logs',
    hint: 'Retention + manual cleanup',
    keys: ['audit.retentionDays'],
  },
  {
    title: 'User Defaults & Limits',
    hint: 'What new users get, and what they may use',
    keys: [
      'users.defaultDailyQuota',
      'users.maxImagesPerRun',
      'users.defaultResolution',
      'users.allowHighResolution',
      'users.allowMediumResolution',
      'users.allowLowResolution',
      'users.defaultRatio',
    ],
  },
  {
    title: 'Health & Routing',
    hint: 'Providers, failover and execution limits',
    keys: [
      'health.pingMs',
      'provider.cooldownMs',
      'routing.maxChainDepth',
      'execution.timeoutMs',
    ],
  },
];

function toDisplay(def: ControlDef, stored: unknown): string {
  if (stored === undefined) return '';
  if (def.kind === 'days' && stored === null) return '';
  if (typeof stored === 'number' && def.scale) return String(stored / def.scale);
  return String(stored);
}

function fromDisplay(def: ControlDef, raw: string): unknown {
  if (def.kind === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? (def.scale ? Math.round(n * def.scale) : n) : def.default;
  }
  if (def.kind === 'days') {
    if (raw.trim() === '') return null;
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return raw;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'success' }>({
    text: '',
    tone: 'error',
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [rawOpen, setRawOpen] = useState(false);
  const [rawDraft, setRawDraft] = useState('');
  const [newKey, setNewKey] = useState('');
  const [confirmAuditOpen, setConfirmAuditOpen] = useState(false);

  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: async () => (await api.get<SettingsMap>('/admin/settings')).data,
  });

  useEffect(() => {
    if (settings.data) {
      setDrafts((prev) => {
        const next = { ...prev };
        for (const def of CONTROLS) {
          if (next[def.key] === undefined) {
            next[def.key] = toDisplay(def, settings.data?.[def.key]);
          }
        }
        return next;
      });
      setRawDraft((prev) => (prev === '' ? JSON.stringify(settings.data, null, 2) : prev));
    }
  }, [settings.data]);

  const saveSetting = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      return (await api.patch(`/admin/settings/${key}`, { value })).data;
    },
    onSuccess: () => {
      setMessage({ text: 'Settings saved', tone: 'success' });
      queryClient.invalidateQueries({ queryKey: settingsKey });
    },
    onError: (error) => setMessage({ text: errorMessage(error), tone: 'error' }),
  });

  const saveOne = (def: ControlDef, raw: string) => {
    setSaving((prev) => ({ ...prev, [def.key]: true }));
    saveSetting.mutate(
      { key: def.key, value: fromDisplay(def, raw) },
      {
        onSettled: () =>
          setSaving((prev) => {
            const next = { ...prev };
            delete next[def.key];
            return next;
          }),
      },
    );
  };

  const clearAudit = useMutation({
    mutationFn: clearAuditLogs,
    onSuccess: ({ removed }) => {
      setMessage({ text: `Cleared ${removed} audit log(s)`, tone: 'success' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
    onError: (error) => setMessage({ text: errorMessage(error), tone: 'error' }),
  });

  const saveRaw = () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawDraft);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Root must be a JSON object');
      }
    } catch (error) {
      setMessage({
        text: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      });
      return;
    }
    const entries = Object.entries(parsed);
    if (entries.length === 0) return;
    setSaving((prev) => ({ ...prev, __raw: true }));
    Promise.all(
      entries.map(([key, value]) =>
        api.patch(`/admin/settings/${encodeURIComponent(key)}`, { value }),
      ),
    )
      .then(() => {
        setMessage({ text: `Saved ${entries.length} setting(s)`, tone: 'success' });
        queryClient.invalidateQueries({ queryKey: settingsKey });
      })
      .catch((error) => setMessage({ text: errorMessage(error), tone: 'error' }))
      .finally(() =>
        setSaving((prev) => {
          const next = { ...prev };
          delete next.__raw;
          return next;
        }),
      );
  };

  if (settings.isPending) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  const valueFor = (key: string): string => drafts[key] ?? '';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Platform-wide controls — limits, quotas, resolution tiers, health &amp; routing
        </p>
      </header>

      <InlineMessage message={message.text} tone={message.tone} />

      {SECTIONS.map((section) => (
        <section
          key={section.title}
          className="rounded-2xl border border-line bg-ink p-5"
        >
          <h2 className="text-sm font-bold text-inktext">{section.title}</h2>
          <p className="mb-4 text-[11px] text-faint">{section.hint}</p>
          <div className="space-y-4">
            {section.keys.map((key) => {
              const def = CONTROLS.find((c) => c.key === key);
              if (!def) return null;
              return (
                <div
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line/60 bg-elevated/40 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-inktext">{def.label}</div>
                    <div className="mt-0.5 text-[10px] text-faint">{def.hint}</div>
                    <div className="mt-1 inline-block rounded border border-line/70 bg-elevated/60 px-1.5 py-0.5 text-[9px] font-medium text-faint">
                      Default: {def.defaultLabel}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {def.kind === 'boolean' ? (
                      <button
                        onClick={() =>
                          setDrafts((prev) => ({
                            ...prev,
                            [def.key]: prev[def.key] === 'true' ? 'false' : 'true',
                          }))
                        }
                        className={`relative h-6 w-11 rounded-full transition-colors ${
                          valueFor(def.key) === 'true' ? 'bg-blue-500' : 'bg-elevated'
                        }`}
                        title={valueFor(def.key) === 'true' ? 'Enabled' : 'Disabled'}
                      >
                        <span
                          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                            valueFor(def.key) === 'true' ? 'left-[22px]' : 'left-0.5'
                          }`}
                        />
                      </button>
                    ) : def.kind === 'select' ? (
                      <select
                        value={valueFor(def.key)}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [def.key]: e.target.value }))}
                        className="rounded-lg border border-line bg-ink px-2.5 py-1.5 text-xs text-inktext outline-none focus:border-blue"
                      >
                        {def.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="number"
                        value={valueFor(def.key)}
                        min={def.min}
                        max={def.max}
                        step={def.step ?? 1}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [def.key]: e.target.value }))
                        }
                        className="w-24 rounded-lg border border-line bg-ink px-2.5 py-1.5 text-right font-mono text-xs text-inktext outline-none focus:border-blue"
                      />
                    )}
                    <button
                      onClick={() => saveOne(def, valueFor(def.key))}
                      disabled={saving[def.key]}
                      className="rounded-lg bg-blue-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-400 disabled:opacity-50"
                    >
                      {saving[def.key] ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {section.title === 'Audit Logs' && (
            <div className="mt-4 flex items-center justify-between rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
              <div>
                <div className="text-xs font-semibold text-inktext">Clear all audit logs</div>
                <div className="mt-0.5 text-[10px] text-faint">
                  Permanently deletes every audit entry from the database
                </div>
              </div>
              <button
                onClick={() => setConfirmAuditOpen(true)}
                disabled={clearAudit.isPending}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] font-semibold text-red-400 hover:bg-red-500/20 disabled:opacity-50"
              >
                {clearAudit.isPending ? 'Clearing…' : 'Clear now'}
              </button>
            </div>
          )}
        </section>
      ))}

      <section className="rounded-2xl border border-line bg-ink p-5">
        <button
          onClick={() => setRawOpen((v) => !v)}
          className="flex w-full items-center justify-between"
        >
          <div className="text-left">
            <h2 className="text-sm font-bold text-inktext">Raw JSON settings</h2>
            <p className="text-[11px] text-faint">
              Advanced: edit every setting key directly (power users)
            </p>
          </div>
          <span className="text-xs text-faint">{rawOpen ? '−' : '+'}</span>
        </button>
        {rawOpen && (
          <div className="mt-4">
            <textarea
              value={rawDraft}
              onChange={(e) => setRawDraft(e.target.value)}
              rows={14}
              spellCheck={false}
              className="w-full resize-y rounded-lg border border-line bg-ink px-3 py-2 font-mono text-xs text-inktext outline-none focus:border-blue"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={saveRaw}
                disabled={saving.__raw}
                className="rounded-lg bg-blue-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-400 disabled:opacity-50"
              >
                {saving.__raw ? 'Saving…' : 'Save all'}
              </button>
              <div className="flex-1">
                <input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="new setting key"
                  className="w-full rounded-lg border border-line bg-ink px-3 py-1.5 font-mono text-xs text-inktext outline-none placeholder:text-faint focus:border-blue"
                />
              </div>
              <button
                onClick={() => {
                  if (!newKey.trim()) return;
                  setRawDraft((prev) => {
                    const parsed = (() => {
                      try {
                        return JSON.parse(prev);
                      } catch {
                        return {};
                      }
                    })() as Record<string, unknown>;
                    parsed[newKey.trim()] = null;
                    return JSON.stringify(parsed, null, 2);
                  });
                  setNewKey('');
                }}
                className="rounded-lg border border-line px-3 py-1.5 text-[11px] text-muted hover:text-inktext"
              >
                Add key
              </button>
            </div>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmAuditOpen}
        title="Clear all audit logs"
        description={
          <span>
            Permanently deletes every audit entry from the database. This cannot
            be undone, and no retention rule can recover it.
          </span>
        }
        confirmLabel="Yes, clear everything"
        onConfirm={() => {
          setConfirmAuditOpen(false);
          clearAudit.mutate();
        }}
        onClose={() => setConfirmAuditOpen(false)}
        pending={clearAudit.isPending}
      />
    </div>
  );
}
