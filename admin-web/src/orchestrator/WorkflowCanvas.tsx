import { useCallback, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  Controls,
  useReactFlow,
  type NodeTypes,
  type EdgeTypes,
  type OnSelectionChangeParams,
  type ConnectionMode,
} from '@xyflow/react';
import { OrchestratorNode } from './nodes/OrchestratorNode';
import { NoteNode } from './nodes/NoteNode';
import { GroupNode } from './nodes/GroupNode';
import { StatusEdge } from './edges/StatusEdge';
import { useWorkflowStore, type FlowNode } from './store/workflowStore';

const nodeTypes: NodeTypes = { orchestrator: OrchestratorNode, note: NoteNode, group: GroupNode };
const edgeTypes: EdgeTypes = { status: StatusEdge };

const DRAG_TYPE = 'application/lumina-node';

export function WorkflowCanvas() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const setSelected = useWorkflowStore((s) => s.setSelected);
  const addNode = useWorkflowStore((s) => s.addNode);
  const deleteNodes = useWorkflowStore((s) => s.deleteNodes);
  const duplicateNodes = useWorkflowStore((s) => s.duplicateNodes);
  const copySelection = useWorkflowStore((s) => s.copySelection);
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(DRAG_TYPE);
      if (!type) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(type, position);
    },
    [addNode, screenToFlowPosition],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      setSelected(selectedNodes.map((n) => n.id));
    },
    [setSelected],
  );

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: FlowNode) => {
      event.preventDefault();
      if (!node.selected) setSelected([node.id]);
      setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
    },
    [setSelected],
  );

  const onPaneClick = useCallback(() => {
    setContextMenu(null);
    setSelected([]);
  }, [setSelected]);

  const contextNode = contextMenu ? nodes.find((n) => n.id === contextMenu.nodeId) : null;

  return (
    <div ref={wrapperRef} className="relative flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onSelectionChange={onSelectionChange}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1.1 }}
        snapToGrid
        snapGrid={[8, 8]}
        connectionMode={'strict' as ConnectionMode}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode={['Meta', 'Control']}
        selectionKeyCode={['Shift']}
        selectionOnDrag
        panOnScroll
        zoomOnDoubleClick={false}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'status',
          animated: false,
          markerEnd: { type: 'arrowclosed', width: 14, height: 14, color: '#1e2633' },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#1e2633" />
        <MiniMap
          nodeColor={(n) => {
            const status = useWorkflowStore.getState().nodeStatuses[n.id];
            if (status) {
              if (status.status === 'success') return '#10b981';
              if (status.status === 'error') return '#f4686c';
              if (status.status === 'running') return '#3b82f6';
              if (status.status === 'waiting') return '#f59e0b';
            }
            return '#151a24';
          }}
          nodeStrokeColor="#3b82f6"
          maskColor="rgba(10,12,16,0.75)"
          bgColor="#0a0c10"
        />
        <Controls
          showInteractive={false}
          position="bottom-left"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            background: 'transparent',
            border: 'none',
            boxShadow: 'none',
          }}
        />
      </ReactFlow>

      {contextMenu && contextNode && (
        <div
          className="fixed z-50 w-44 overflow-hidden rounded-xl border border-line bg-elevated py-1 text-xs shadow-2xl"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 200), top: Math.min(contextMenu.y, window.innerHeight - 140) }}
        >
          <div className="border-b border-line px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            {contextNode.data.name}
          </div>
          <button
            onClick={() => {
              duplicateNodes([contextNode.id]);
              setContextMenu(null);
            }}
            className="block w-full px-3 py-1.5 text-left text-inktext hover:bg-ink"
          >
            ⧉ Duplicate
          </button>
          <button
            onClick={() => {
              copySelection();
              setContextMenu(null);
            }}
            className="block w-full px-3 py-1.5 text-left text-inktext hover:bg-ink"
          >
            ⧉ Copy
          </button>
          <button
            onClick={() => {
              deleteNodes([contextNode.id]);
              setContextMenu(null);
            }}
            className="block w-full px-3 py-1.5 text-left text-red-400 hover:bg-ink"
          >
            ✕ Delete
          </button>
        </div>
      )}
    </div>
  );
}
