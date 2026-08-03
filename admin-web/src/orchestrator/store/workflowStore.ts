import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type XYPosition,
  type NodePositionChange,
} from '@xyflow/react';
import dagre from 'dagre';
import { getNodeDefinition } from '../nodeRegistry';

export type NodeStatus = 'running' | 'success' | 'error' | 'waiting' | 'retrying' | 'skipped';
export type RunState = 'idle' | 'running' | 'done' | 'error';

export interface NodeData extends Record<string, unknown> {
  type: string;
  name: string;
  config: Record<string, unknown>;
}

export type FlowNode = Node<NodeData>;
export type FlowEdge = Edge<Record<string, never>>;

export interface ConsoleLine {
  id: string;
  time: string;
  level: 'info' | 'success' | 'error' | 'warn' | 'api';
  source: string;
  message: string;
}

interface HistoryEntry {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface WorkflowState {
  workflowId: string | null;
  workflowName: string;
  workflowDescription: string;
  workflowEnabled: boolean;
  workflowWebhookUrl: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  selected: string[];
  clipboard: { nodes: FlowNode[]; edges: FlowEdge[] } | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  dirty: boolean;
  saving: boolean;
  runState: RunState;
  nodeStatuses: Record<string, { status: NodeStatus; runtimeMs: number }>;
  consoleLines: ConsoleLine[];
  favorites: string[];
  recent: string[];
  executionId: string | null;
  lastSavedGraph: { nodes: FlowNode[]; edges: FlowEdge[] } | null;
}

export const statusColor: Record<NodeStatus, string> = {
  running: '#3b82f6',
  success: '#10b981',
  error: '#f4686c',
  waiting: '#f59e0b',
  retrying: '#8b5cf6',
  skipped: '#64748b',
};

const CANVAS_TYPES = new Set(['note', 'group']);

let idCounter = 0;
export function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function nowTime(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function loadLocal(key: string, fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export const useWorkflowStore = create<WorkflowState & WorkflowActions>((set, get) => ({
  workflowId: null,
  workflowName: 'Untitled workflow',
  workflowDescription: '',
  workflowEnabled: true,
  workflowWebhookUrl: '',
  nodes: [],
  edges: [],
  selected: [],
  clipboard: null,
  past: [],
  future: [],
  dirty: false,
  saving: false,
  runState: 'idle',
  nodeStatuses: {},
  consoleLines: [],
  favorites: loadLocal('lumina-node-favorites', []),
  recent: loadLocal('lumina-node-recent', []),
  executionId: null,
  lastSavedGraph: null,

  loadWorkflow(detail) {
    const nodes: FlowNode[] = (detail.graph?.nodes ?? []).map((n) => {
      const def = getNodeDefinition(n.type);
      return {
        id: n.id,
        type: CANVAS_TYPES.has(n.type) ? n.type : 'orchestrator',
        position: n.position ?? { x: 120, y: 120 },
        data: {
          type: n.type,
          name: (n.config?.name as string) ?? def.label,
          config: { ...def.defaults, ...n.config },
        },
      };
    });
    const edges: FlowEdge[] = (detail.graph?.edges ?? []).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      type: 'status',
    }));
    const past = get().past.length ? get().past : [{ nodes: get().nodes, edges: get().edges }];
    set({
      workflowId: detail.id,
      workflowName: detail.name,
      workflowDescription: detail.description ?? '',
      workflowEnabled: detail.enabled,
      workflowWebhookUrl: detail.webhookUrl ?? '',
      nodes,
      edges,
      selected: [],
      past,
      future: [],
      dirty: false,
      runState: 'idle',
      nodeStatuses: {},
      consoleLines: [],
      lastSavedGraph: { nodes, edges },
    });
  },

  setSelected(ids) {
    set({ selected: ids });
  },

  setWorkflowId(id) {
    set({ workflowId: id, dirty: true });
  },

  setWorkflowName(name) {
    set({ workflowName: name, dirty: true });
  },
  setWorkflowDescription(description) {
    set({ workflowDescription: description, dirty: true });
  },
  setWorkflowEnabled(enabled) {
    set({ workflowEnabled: enabled, dirty: true });
  },
  setWorkflowWebhookUrl(webhookUrl) {
    set({ workflowWebhookUrl: webhookUrl, dirty: true });
  },

  snapshot() {
    const { nodes, edges, past } = get();
    set({ past: [...past.slice(-59), { nodes, edges }], future: [] });
  },

  onNodesChange(changes: NodeChange<FlowNode>[]) {
    const nodes = applyNodeChanges(changes, get().nodes);
    const selected = changes
      .filter((c) => c.type === 'select')
      .map((c) => c.id);
    const positionMoves = changes.filter(
      (c): c is NodePositionChange => c.type === 'position' && c.position !== undefined,
    );
    if (positionMoves.length > 0) set({ dirty: true });
    set((s) => ({ nodes, selected: selected.length ? selected : s.selected }));
  },

  onEdgesChange(changes: EdgeChange<FlowEdge>[]) {
    const edges = applyEdgeChanges(changes, get().edges);
    if (changes.some((c) => c.type === 'remove')) set({ dirty: true });
    set({ edges });
  },

  onConnect(connection: Connection) {
    const edge: FlowEdge = {
      id: `e-${makeId('')}`,
      source: connection.source!,
      target: connection.target!,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      type: 'status',
    };
    set({ edges: [...get().edges, edge], dirty: true });
  },

  addNode(type, position) {
    const def = getNodeDefinition(type);
    const id = makeId(type);
    const node: FlowNode = {
      id,
      type: CANVAS_TYPES.has(type) ? type : 'orchestrator',
      position: position ?? { x: 120, y: 120 },
      data: { type, name: def.label, config: { ...def.defaults } },
    };
    get().snapshot();
    const recent = [type, ...get().recent.filter((t) => t !== type)].slice(0, 12);
    localStorage.setItem('lumina-node-recent', JSON.stringify(recent));
    set((s) => ({ nodes: [...s.nodes, node], selected: [id], recent, dirty: true }));
    return id;
  },

  updateNodeConfig(id, patch) {
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } }
          : n,
      ),
      dirty: true,
    }));
  },

  renameNode(id, name) {
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, name } } : n)),
      dirty: true,
    }));
  },

  toggleNodeEnabled(id) {
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                ...n.data,
                config: { ...n.data.config, enabled: !(n.data.config.enabled !== false) },
              },
            }
          : n,
      ),
      dirty: true,
    }));
  },

  deleteNodes(ids) {
    const idSet = new Set(ids);
    get().snapshot();
    set((s) => ({
      nodes: s.nodes.filter((n) => !idSet.has(n.id)),
      edges: s.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
      selected: [],
      dirty: true,
    }));
  },

  duplicateNodes(ids) {
    const { nodes, edges } = get();
    const idMap = new Map<string, string>();
    const newNodes: FlowNode[] = nodes
      .filter((n) => ids.includes(n.id))
      .map((n) => {
        const newId = makeId(n.data.type);
        idMap.set(n.id, newId);
        return {
          ...n,
          id: newId,
          position: { x: n.position.x + 32, y: n.position.y + 32 },
        };
      });
    if (!newNodes.length) return;
    get().snapshot();
    const newEdges: FlowEdge[] = edges
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e) => ({
        ...e,
        id: `e-${makeId('')}`,
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
      }));
    set((s) => ({
      nodes: [...s.nodes, ...newNodes],
      edges: [...s.edges, ...newEdges],
      selected: newNodes.map((n) => n.id),
      dirty: true,
    }));
  },

  copySelection() {
    const { nodes, edges } = get();
    const ids = new Set(get().selected);
    if (!ids.size) return;
    const copiedNodes = nodes.filter((n) => ids.has(n.id)).map((n) => ({ ...n }));
    const copiedEdges = edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ ...e }));
    set({ clipboard: { nodes: copiedNodes, edges: copiedEdges } });
  },

  pasteSelection() {
    const clip = get().clipboard;
    if (!clip?.nodes.length) return;
    const idMap = new Map<string, string>();
    get().snapshot();
    const offset: XYPosition = { x: 40, y: 40 };
    const newNodes: FlowNode[] = clip.nodes.map((n) => {
      const newId = makeId(n.data.type);
      idMap.set(n.id, newId);
      return { ...n, id: newId, position: { x: n.position.x + offset.x, y: n.position.y + offset.y } };
    });
    const newEdges: FlowEdge[] = clip.edges
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e) => ({
        ...e,
        id: `e-${makeId('')}`,
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
      }));
    set((s) => ({
      nodes: [...s.nodes, ...newNodes],
      edges: [...s.edges, ...newEdges],
      selected: newNodes.map((n) => n.id),
      dirty: true,
    }));
  },

  undo() {
    const { past, nodes, edges } = get();
    if (!past.length) return;
    const previous = past[past.length - 1];
    set({
      nodes: previous.nodes,
      edges: previous.edges,
      past: past.slice(0, -1),
      future: [{ nodes, edges }, ...get().future].slice(0, 60),
      dirty: true,
    });
  },

  redo() {
    const { future, nodes, edges } = get();
    if (!future.length) return;
    const next = future[0];
    set({
      nodes: next.nodes,
      edges: next.edges,
      future: future.slice(1),
      past: [...get().past, { nodes, edges }],
      dirty: true,
    });
  },

  toggleFavorite(type) {
    const favorites = get().favorites.includes(type)
      ? get().favorites.filter((t) => t !== type)
      : [...get().favorites, type];
    localStorage.setItem('lumina-node-favorites', JSON.stringify(favorites));
    set({ favorites });
  },

  autoArrange() {
    const { nodes, edges } = get();
    if (!nodes.length) return;
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'LR', nodesep: 56, ranksep: 110, marginx: 32, marginy: 32 });
    nodes.forEach((n) => g.setNode(n.id, { width: 230, height: 92 }));
    edges.forEach((e) => g.setEdge(e.source, e.target));
    dagre.layout(g);
    set({
      nodes: nodes.map((n) => {
        const p = g.node(n.id);
        return { ...n, position: { x: p.x - 115, y: p.y - 46 } };
      }),
      dirty: true,
    });
  },

  setSaving(saving) {
    set({ saving });
  },
  markSaved() {
    const { nodes, edges } = get();
    set({ dirty: false, lastSavedGraph: { nodes, edges } });
  },

  setRunState(runState) {
    set({ runState });
  },
  setNodeStatus(id, status, runtimeMs) {
    set((s) => ({
      nodeStatuses: {
        ...s.nodeStatuses,
        [id]: { status, runtimeMs: runtimeMs ?? s.nodeStatuses[id]?.runtimeMs ?? 0 },
      },
    }));
  },
  clearRun() {
    set({ runState: 'idle', nodeStatuses: {}, consoleLines: [], executionId: null });
  },
  setExecutionId(executionId) {
    set({ executionId });
  },
  pushConsole(level, source, message) {
    const line: ConsoleLine = { id: makeId('c'), time: nowTime(), level, source, message };
    set((s) => ({ consoleLines: [...s.consoleLines.slice(-499), line] }));
  },
  clearConsole() {
    set({ consoleLines: [] });
  },
}));

export interface WorkflowActions {
  loadWorkflow: (detail: {
    id: string;
    name: string;
    description: string | null;
    enabled: boolean;
    webhookUrl?: string | null;
    graph: { nodes: Array<{ id: string; type: string; position: XYPosition; config?: Record<string, unknown> }>; edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }> };
  }) => void;
  setSelected: (ids: string[]) => void;
  setWorkflowId: (id: string | null) => void;
  setWorkflowName: (name: string) => void;
  setWorkflowDescription: (description: string) => void;
  setWorkflowEnabled: (enabled: boolean) => void;
  setWorkflowWebhookUrl: (webhookUrl: string) => void;
  snapshot: () => void;
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (type: string, position?: XYPosition) => string;
  updateNodeConfig: (id: string, patch: Record<string, unknown>) => void;
  renameNode: (id: string, name: string) => void;
  toggleNodeEnabled: (id: string) => void;
  deleteNodes: (ids: string[]) => void;
  duplicateNodes: (ids: string[]) => void;
  copySelection: () => void;
  pasteSelection: () => void;
  undo: () => void;
  redo: () => void;
  toggleFavorite: (type: string) => void;
  autoArrange: () => void;
  setSaving: (saving: boolean) => void;
  markSaved: () => void;
  setRunState: (runState: RunState) => void;
  setNodeStatus: (id: string, status: NodeStatus, runtimeMs?: number) => void;
  clearRun: () => void;
  setExecutionId: (executionId: string | null) => void;
  pushConsole: (level: ConsoleLine['level'], source: string, message: string) => void;
  clearConsole: () => void;
}
