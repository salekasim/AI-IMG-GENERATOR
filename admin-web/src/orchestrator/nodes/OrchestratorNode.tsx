import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getNodeDefinition, CATEGORY_META } from '../nodeRegistry';
import { FieldEditor } from '../fields/FieldEditor';
import { useWorkflowStore, statusColor, type NodeStatus, type NodeData } from '../store/workflowStore';

function StatusPill({ status }: { status?: NodeStatus }) {
  if (!status) return null;
  const labels: Record<NodeStatus, string> = {
    running: 'running',
    success: 'ok',
    error: 'error',
    waiting: 'waiting',
    retrying: 'retry',
    skipped: 'skip',
  };
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
      style={{ color: statusColor[status], backgroundColor: `${statusColor[status]}1a` }}
    >
      {labels[status]}
    </span>
  );
}

export const OrchestratorNode = memo(function OrchestratorNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as NodeData;
  const def = getNodeDefinition(d.type);
  const meta = CATEGORY_META[def.category];
  const status = useWorkflowStore((s) => s.nodeStatuses[id]);
  const enabled = d.config.enabled !== false;
  const comment = String(d.config.comment ?? '');
  const runtimeMs = status?.runtimeMs;
  const [expanded, setExpanded] = useState(false);

  const toggleNodeEnabled = useWorkflowStore((s) => s.toggleNodeEnabled);
  const duplicateNodes = useWorkflowStore((s) => s.duplicateNodes);
  const deleteNodes = useWorkflowStore((s) => s.deleteNodes);
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);

  const configSummary = () => {
    if (['chatModel', 'imageModel', 'videoModel', 'audioModel', 'embeddingModel', 'speechToText', 'textToSpeech', 'ocr'].includes(d.type)) {
      return `${String(d.config.provider ?? '')} · ${String(d.config.model ?? '')}`;
    }
    if (d.type === 'trigger' || d.type === 'logger') {
      return String(d.config.name ?? def.label);
    }
    if (d.type === 'storage') return String(d.config.storage ?? '');
    return def.description;
  };

  return (
    <div
      className={`orchestrator-node group relative w-[230px] rounded-xl border bg-elevated shadow-[0_4px_20px_rgba(0,0,0,0.35)] transition-all duration-200 ${
        selected ? 'border-cyan-400 ring-2 ring-cyan-400/25' : 'border-line hover:border-line/80'
      } ${enabled ? '' : 'opacity-50'}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-0 !bg-cyan-400" />
      {def.outputHandles === 'if' ? (
        <>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            className="!top-[38%] !h-2.5 !w-2.5 !border-0 !bg-emerald-400"
          />
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            className="!top-[66%] !h-2.5 !w-2.5 !border-0 !bg-rose-400"
          />
        </>
      ) : (
        <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-0 !bg-blue-400" />
      )}

      <div className="flex items-center gap-2.5 p-3 pb-2">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-base ${def.color}`}>
          {def.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-inktext">{d.name || def.label}</span>
            <StatusPill status={status?.status} />
          </div>
          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider" style={{ color: meta.color }}>
            {def.category} · {def.label}
          </div>
        </div>
      </div>

      <div className="px-3 pb-2.5">
        <div className="truncate text-[11px] leading-snug text-muted">{configSummary()}</div>
        {comment && (
          <div className="mt-1 flex items-start gap-1 text-[10px] text-yellow-200/60">
            <span>💬</span>
            <span className="line-clamp-2">{comment}</span>
          </div>
        )}
        {runtimeMs ? (
          <div className="mt-1 text-[10px] text-faint">{runtimeMs} ms</div>
        ) : null}

        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className={`mt-2 w-full rounded-md border px-2 py-1 text-[10px] font-medium transition-colors ${
            expanded
              ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300'
              : 'border-line text-faint hover:border-blue/40 hover:text-muted'
          }`}
        >
          {expanded ? '▴ hide settings' : '▾ expand settings'}
        </button>

        {expanded && def.fields.length > 0 && (
          <div className="mt-2 space-y-2 border-t border-line/60 pt-2">
            {def.fields.map((field) => (
              <label key={field.key} className="block">
                <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wider text-faint">
                  {field.label}
                </span>
                <FieldEditor
                  field={field}
                  value={d.config[field.key]}
                  onChange={(value) => updateNodeConfig(id, { [field.key]: value })}
                />
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="glass-strong absolute -top-3 right-2 flex items-center gap-0.5 rounded-full border border-line p-1 opacity-0 shadow-lg transition-all duration-150 group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleNodeEnabled(id);
          }}
          title={enabled ? 'Disable node' : 'Enable node'}
          className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] transition-colors ${
            enabled ? 'text-emerald hover:bg-emerald/15' : 'text-faint hover:bg-elevated hover:text-inktext'
          }`}
        >
          {enabled ? '◉' : '○'}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            duplicateNodes([id]);
          }}
          title="Duplicate node"
          className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] text-muted transition-colors hover:bg-elevated hover:text-inktext"
        >
          ⧉
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            deleteNodes([id]);
          }}
          title="Delete node"
          className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] text-muted transition-colors hover:bg-red/15 hover:text-red"
        >
          ✕
        </button>
      </div>
    </div>
  );
});
