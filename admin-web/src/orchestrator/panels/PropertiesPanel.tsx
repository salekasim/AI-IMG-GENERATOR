import { useState } from 'react';
import { getNodeDefinition, CATEGORY_META } from '../nodeRegistry';
import { useWorkflowStore, statusColor } from '../store/workflowStore';
import { FieldEditor } from '../fields/FieldEditor';
import { ChainEditor } from './ChainEditor';

export function PropertiesPanel() {
  const selected = useWorkflowStore((s) => s.selected);
  const nodes = useWorkflowStore((s) => s.nodes);
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const renameNode = useWorkflowStore((s) => s.renameNode);
  const deleteNodes = useWorkflowStore((s) => s.deleteNodes);
  const duplicateNodes = useWorkflowStore((s) => s.duplicateNodes);
  const setSelected = useWorkflowStore((s) => s.setSelected);
  const nodeStatuses = useWorkflowStore((s) => s.nodeStatuses);
  const [localName, setLocalName] = useState<string | null>(null);

  const selNodes = nodes.filter((n) => selected.includes(n.id));

  if (!selected.length || !selNodes.length) {
    return (
      <aside className="flex w-72 shrink-0 flex-col border-l border-line bg-ink/90">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted">Properties</h3>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <span className="text-3xl opacity-40">◈</span>
          <p className="text-xs leading-relaxed text-faint">
            Select a node to edit its settings.
            <br />
            Click empty canvas to clear the selection.
          </p>
        </div>
      </aside>
    );
  }

  const node = selNodes[0];
  const def = getNodeDefinition(node.data.type);
  const meta = CATEGORY_META[def.category];
  const status = nodeStatuses[node.id];
  const multiple = selNodes.length > 1;
  const name = localName ?? node.data.name;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-line bg-ink/90">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          {multiple ? `Selection (${selNodes.length})` : 'Properties'}
        </h3>
        {!multiple && (
          <span className={`text-[11px] font-medium ${meta.color}`}>{def.category}</span>
        )}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {multiple ? (
          <p className="text-xs text-muted">
            {selNodes.length} nodes selected. Batch actions below.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-lg border text-lg ${def.color}`}>
                {def.icon}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-inktext">{def.label}</p>
                <p className="text-[10px] text-faint">type: {def.type}</p>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted">{def.description}</p>

            {status && (
              <div className="flex items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-2 text-xs">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: statusColor[status.status] ?? '#3b82f6' }}
                />
                <span className="capitalize text-muted">{status.status}</span>
                <span className="ml-auto tabular-nums text-faint">{status.runtimeMs} ms</span>
              </div>
            )}

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-faint">Name</span>
                <input
                  value={name}
                  onChange={(e) => setLocalName(e.target.value)}
                  onBlur={() => {
                    if (localName !== null && localName.trim() !== node.data.name) {
                      renameNode(node.id, localName.trim() || def.label);
                    }
                    setLocalName(null);
                  }}
                  className="w-full rounded-lg border border-line bg-ink px-2.5 py-1.5 text-xs text-inktext outline-none focus:border-blue"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-faint">💬 Comment</span>
                <textarea
                  value={typeof node.data.config.comment === 'string' ? node.data.config.comment : ''}
                  onChange={(e) => updateNodeConfig(node.id, { comment: e.target.value })}
                  rows={2}
                  placeholder="Notes for collaborators…"
                  className="w-full resize-none rounded-lg border border-line bg-ink px-2.5 py-1.5 text-xs text-inktext outline-none placeholder:text-faint focus:border-blue"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">Enabled</span>
                <button
                  onClick={() => updateNodeConfig(node.id, { enabled: !(node.data.config.enabled !== false) })}
                  className={`relative h-5 w-9 rounded-full transition-colors ${node.data.config.enabled !== false ? 'bg-blue-500' : 'bg-line'}`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${node.data.config.enabled !== false ? 'left-[18px]' : 'left-0.5'}`}
                  />
                </button>
              </label>

              <div>
                <span className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-faint">
                  Settings
                </span>
                <div className="space-y-3">
                  {node.data.type === 'imageModel' ? (
                    <>
                      <ChainEditor nodeId={node.id} />
                      {def.fields
                        .filter((f) => f.key !== 'provider' && f.key !== 'model')
                        .map((field) => (
                          <label key={field.key} className="block">
                            <span className="mb-1 block text-[11px] text-muted">{field.label}</span>
                            <FieldEditor
                              field={field}
                              value={node.data.config[field.key]}
                              onChange={(value) => updateNodeConfig(node.id, { [field.key]: value })}
                            />
                          </label>
                        ))}
                    </>
                  ) : (
                    def.fields.map((field) => (
                      <label key={field.key} className="block">
                        <span className="mb-1 block text-[11px] text-muted">{field.label}</span>
                        <FieldEditor
                          field={field}
                          value={node.data.config[field.key]}
                          onChange={(value) => updateNodeConfig(node.id, { [field.key]: value })}
                        />
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="flex gap-2 border-t border-line pt-4">
          <button
            onClick={() => duplicateNodes(selNodes.map((n) => n.id))}
            className="flex-1 rounded-lg border border-line bg-elevated px-3 py-1.5 text-xs font-medium text-inktext hover:border-blue/40"
          >
            ⧉ Duplicate
          </button>
          <button
            onClick={() => deleteNodes(selNodes.map((n) => n.id))}
            className="flex-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20"
          >
            ✕ Delete
          </button>
        </div>
        <button
          onClick={() => setSelected([])}
          className="w-full rounded-lg px-3 py-1.5 text-[11px] text-faint hover:bg-elevated hover:text-muted"
        >
          Deselect
        </button>
      </div>
    </aside>
  );
}
