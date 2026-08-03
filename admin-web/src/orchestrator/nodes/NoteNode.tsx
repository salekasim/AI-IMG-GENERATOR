import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';
import { useWorkflowStore, type NodeData } from '../store/workflowStore';

export const NoteNode = memo(function NoteNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as NodeData;
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const text = String(d.config.text ?? 'Type a note…');
  const comment = String(d.config.comment ?? '');

  return (
    <div
      className={`w-[220px] rotate-[-1.5deg] rounded-md border border-yellow-500/30 bg-yellow-400/10 p-3 shadow-[0_6px_18px_rgba(0,0,0,0.25)] backdrop-blur transition-all ${
        selected ? 'border-yellow-400 ring-2 ring-yellow-400/30' : 'hover:border-yellow-400/40'
      }`}
    >
      <textarea
        value={text}
        onChange={(e) => updateNodeConfig(id, { text: e.target.value })}
        onClick={(e) => e.stopPropagation()}
        rows={3}
        className="w-full resize-none bg-transparent text-[12px] leading-snug text-yellow-100/90 outline-none placeholder:text-yellow-100/40"
        placeholder="Type a note…"
      />
      {comment && (
        <div className="mt-2 flex items-start gap-1 border-t border-yellow-500/20 pt-1.5 text-[10px] text-yellow-200/60">
          <span>💬</span>
          <span className="line-clamp-2">{comment}</span>
        </div>
      )}
    </div>
  );
});
