import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAdminProviders, fetchRoutingVariables } from '../../api/admin';
import type { ProviderAdmin } from '../../api/types';
import { useWorkflowStore } from '../store/workflowStore';

export interface ChainStep {
  provider: string;
  model: string;
}

function providerLabel(providers: ProviderAdmin[], name: string): string {
  const p = providers.find((x) => x.name === name);
  return p ? p.displayName : name;
}

function modelLabel(p: ProviderAdmin | undefined, model: string): string {
  const m = p?.models.find((x) => x.internalName === model);
  return m ? `${m.displayName} (${m.internalName})` : model;
}

export function ChainEditor({ nodeId }: { nodeId: string }) {
  const config = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId)?.data.config ?? {});
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);

  const { data: providers } = useQuery({
    queryKey: ['admin', 'providers'],
    queryFn: fetchAdminProviders,
  });
  const { data: variables } = useQuery({
    queryKey: ['admin', 'routing-variables'],
    queryFn: fetchRoutingVariables,
  });

  const chain: ChainStep[] = Array.isArray(config.chain) ? (config.chain as ChainStep[]) : [];
  const variable = typeof config.routingVariable === 'string' ? config.routingVariable : '';

  const [draftProvider, setDraftProvider] = useState('');
  const [draftModel, setDraftModel] = useState('');

  const imageProviders = (providers ?? []).filter((p) => p.supportsImages);
  const draftProviderRow = (providers ?? []).find((p) => p.name === draftProvider);
  const draftModels = (draftProviderRow?.models ?? []).filter((m) => m.supportsImages && m.enabled);

  const setChain = (next: ChainStep[]) => updateNodeConfig(nodeId, { chain: next });

  const addStep = () => {
    if (!draftProvider || !draftModel) return;
    setChain([...chain, { provider: draftProvider, model: draftModel }]);
    setDraftProvider('');
    setDraftModel('');
  };

  const moveStep = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= chain.length) return;
    const next = [...chain];
    const [step] = next.splice(index, 1);
    next.splice(target, 0, step);
    setChain(next);
  };

  const skipCount = chain.filter((s) => !imageProviders.some((p) => p.name === s.provider)).length;

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] text-muted">Routing variable</span>
          {variable && <span className="text-[10px] text-faint">fallback source</span>}
        </div>
        <select
          value={variable}
          onChange={(e) => updateNodeConfig(nodeId, { routingVariable: e.target.value || null })}
          className="w-full rounded-lg border border-line bg-ink px-2 py-1.5 text-xs text-inktext outline-none focus:border-blue"
        >
          <option value="">— none —</option>
          {(variables ?? []).map((v) => (
            <option key={v.id} value={v.name}>
              {v.name}
              {v.routes.length ? ` · ${v.routes.map((r) => r.model.provider.displayName).join(' → ')}` : ' · (empty)'}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted">Model chain</span>
        <span className="text-[10px] text-faint">{chain.length} step{chain.length === 1 ? '' : 's'}</span>
      </div>

      {chain.length === 0 && !variable && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-300">
          No chain yet — add steps below or pick a routing variable, or the node falls back to the legacy
          single provider/model fields.
        </p>
      )}

      {chain.length > 0 && (
        <ul className="space-y-1.5">
          {chain.map((step, index) => {
            const row = (providers ?? []).find((p) => p.name === step.provider);
            const ok = !!row && row.enabled && imageProviders.some((p) => p.name === step.provider);
            return (
              <li
                key={`${index}-${step.provider}-${step.model}`}
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 ${ok ? 'border-line bg-elevated' : 'border-amber-500/30 bg-amber-500/5'}`}
              >
                <span className="w-4 shrink-0 text-center text-[10px] tabular-nums text-faint">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-inktext">{providerLabel(providers ?? [], step.provider)}</p>
                  <p className="truncate text-[10px] text-faint">{modelLabel(row, step.model)}</p>
                </div>
                {!ok && (
                  <span className="shrink-0 text-[10px] text-amber-400" title="will be skipped at runtime">
                    skip
                  </span>
                )}
                <div className="flex shrink-0 gap-0.5">
                  <button
                    onClick={() => moveStep(index, -1)}
                    disabled={index === 0}
                    className="rounded px-1 text-[11px] text-faint hover:bg-line hover:text-inktext disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveStep(index, 1)}
                    disabled={index === chain.length - 1}
                    className="rounded px-1 text-[11px] text-faint hover:bg-line hover:text-inktext disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => setChain(chain.filter((_, i) => i !== index))}
                    className="rounded px-1 text-[11px] text-red-400 hover:bg-red-500/10"
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {skipCount > 0 && (
        <p className="text-[10px] text-faint">{skipCount} step(s) from non-image providers — engine skips them at runtime</p>
      )}

      <div className="space-y-1.5 rounded-lg border border-dashed border-line p-2">
        <div className="grid grid-cols-2 gap-1.5">
          <select
            value={draftProvider}
            onChange={(e) => {
              setDraftProvider(e.target.value);
              setDraftModel('');
            }}
            className="w-full rounded-lg border border-line bg-ink px-1.5 py-1.5 text-[11px] text-inktext outline-none focus:border-blue"
          >
            <option value="">provider…</option>
            {imageProviders.map((p) => (
              <option key={p.id} value={p.name} disabled={!p.enabled}>
                {p.displayName}
                {!p.enabled ? ' (disabled)' : ''}
              </option>
            ))}
          </select>
          <select
            value={draftModel}
            onChange={(e) => setDraftModel(e.target.value)}
            disabled={!draftModels.length}
            className="w-full rounded-lg border border-line bg-ink px-1.5 py-1.5 text-[11px] text-inktext outline-none focus:border-blue disabled:opacity-40"
          >
            <option value="">model…</option>
            {draftModels.map((m) => (
              <option key={m.id} value={m.internalName}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={addStep}
          disabled={!draftProvider || !draftModel}
          className="w-full rounded-lg border border-blue/40 bg-blue/10 px-2 py-1.5 text-[11px] font-medium text-blue-300 hover:bg-blue/20 disabled:opacity-40"
        >
          + Add step
        </button>
      </div>
    </div>
  );
}
