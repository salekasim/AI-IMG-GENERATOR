import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';
import { useWorkflowStore, type NodeData } from '../store/workflowStore';

export const GroupNode = memo(function GroupNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as NodeData;
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const title = String(d.config.title ?? d.name ?? 'Group');
  const width = Number(d.config.width ?? 480);
  const height = Number(d.config.height ?? 320);
  const comment = String(d.config.comment ?? '');

  return (
    <div
      style={{ width, height }}
      className={`rounded-xl border-2 border-dashed p-3 transition-all ${
        selected ? 'border-yellow-400/80 bg-yellow-400/5' : 'border-line/70 bg-elevated/30 hover:border-line'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm text-yellow-300/80">🗂️</span>
        <input
          value={title}
          onChange={(e) => updateNodeConfig(id, { title: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          className="w-40 rounded bg-transparent text-xs font-semibold uppercase tracking-wider text-muted outline-none"
        />
        <span className="ml-auto rounded-full border border-line px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-faint">
          group
        </span>
      </div>
      {comment && (
        <div className="mt-2 flex items-start gap-1 text-[10px] text-yellow-200/60">
          <span>💬</span>
          <span className="line-clamp-2">{comment}</span>
        </div>
      )}
    </div>
  );
});
