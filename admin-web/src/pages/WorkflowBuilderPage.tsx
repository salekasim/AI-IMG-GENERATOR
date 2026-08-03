import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWorkflow, startExecution, updateWorkflow } from '../api/workflows';
import { WorkflowCanvas } from '../orchestrator/WorkflowCanvas';
import { NodeLibrary } from '../orchestrator/panels/NodeLibrary';
import { PropertiesPanel } from '../orchestrator/panels/PropertiesPanel';
import { ConsolePanel } from '../orchestrator/panels/ConsolePanel';
import { ExecutionsDrawer } from '../orchestrator/panels/ExecutionsDrawer';
import { useWorkflowStore } from '../orchestrator/store/workflowStore';
import { connectExecutionStream } from '../orchestrator/runner';
import { errorMessage } from '../api/client';
import { Spinner } from '../components/ui';

export function WorkflowBuilderPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const queryClient = useQueryClient();
  const store = useWorkflowStore();
  const [prompt, setPrompt] = useState('Hello world');
  const [historyOpen, setHistoryOpen] = useState(false);
  const streamCleanupRef = useRef<(() => void) | null>(null);

  const { data: detail, isLoading, error } = useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: () => fetchWorkflow(workflowId!),
    enabled: !!workflowId && workflowId !== 'new',
  });

  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (workflowId === 'new' && !creating) {
      setCreating(true);
      store.clearRun();
      store.setWorkflowName('Untitled workflow');
      store.setWorkflowDescription('');
      store.setWorkflowEnabled(true);
    }
  }, [workflowId, creating]);

  useEffect(() => {
    if (detail) store.loadWorkflow(detail);
  }, [detail]);

  useEffect(() => {
    return () => streamCleanupRef.current?.();
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { workflowId: id, workflowName, workflowDescription, workflowEnabled, workflowWebhookUrl, nodes, edges } = store;
      if (!id) return null;
      const graph = {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.data.type,
          position: n.position,
          config: { ...n.data.config, name: n.data.name },
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
          targetHandle: e.targetHandle ?? null,
        })),
      };
      const updated = await updateWorkflow(id, {
        name: workflowName,
        description: workflowDescription || undefined,
        enabled: workflowEnabled,
        webhookUrl: workflowWebhookUrl.trim() || null,
        graph,
      });
      return updated;
    },
    onSuccess: (updated) => {
      if (updated) {
        store.setWorkflowId(updated.id);
        store.markSaved();
        queryClient.invalidateQueries({ queryKey: ['workflows'] });
        queryClient.setQueryData(['workflow', updated.id], updated);
      }
    },
    onError: (err) => {
      store.pushConsole('error', 'engine', `save failed: ${errorMessage(err)}`);
    },
  });

  const save = useCallback(() => {
    saveMutation.mutate();
  }, [saveMutation]);

  const autosaveRef = useRef(save);
  autosaveRef.current = save;
  useEffect(() => {
    const timer = setInterval(() => {
      if (store.workflowId && store.dirty && !store.saving && !saveMutation.isPending) {
        autosaveRef.current();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [store.workflowId, store.dirty, store.saving, saveMutation.isPending]);

  const run = useCallback(async () => {
    const s = useWorkflowStore.getState();
    if (s.runState === 'running') return;
    if (!s.workflowId || s.dirty) {
      store.pushConsole('info', 'engine', 'saving workflow before run…');
      try {
        await saveMutation.mutateAsync();
      } catch {
        return;
      }
    }
    const id = useWorkflowStore.getState().workflowId;
    if (!id) return;

    store.clearRun();
    store.setRunState('running');
    store.pushConsole('info', 'engine', 'starting real execution…');
    streamCleanupRef.current?.();

    try {
      const exec = await startExecution(id, { prompt });
      store.setExecutionId(exec.id);
      store.pushConsole('info', 'engine', `execution ${exec.id.slice(0, 8)} queued — streaming live events`);
      streamCleanupRef.current = connectExecutionStream(
        exec.id,
        useWorkflowStore.getState(),
        () => {
          queryClient.invalidateQueries({ queryKey: ['executions', id] });
        },
      );
    } catch (err) {
      store.setRunState('error');
      store.pushConsole('error', 'engine', `run failed: ${errorMessage(err)}`);
    }
  }, [store, saveMutation, prompt, queryClient]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      } else if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      } else if (e.key.toLowerCase() === 'c') {
        e.preventDefault();
        store.copySelection();
      } else if (e.key.toLowerCase() === 'v') {
        e.preventDefault();
        store.pasteSelection();
      } else if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        store.duplicateNodes(store.selected);
      } else if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        store.setSelected(store.nodes.map((n) => n.id));
      } else if (e.key.toLowerCase() === 'r' && !e.shiftKey) {
        e.preventDefault();
        void run();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save, store, run]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error && workflowId !== 'new') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-400">
        Failed to load workflow: {errorMessage(error)}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col overflow-hidden rounded-2xl border border-line bg-ink">
      <header className="flex items-center gap-3 border-b border-line bg-elevated/60 px-4 py-2.5">
        <Link
          to="/workflows"
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-inktext"
          title="Back to workflows"
        >
          ← Workflows
        </Link>
        <div className="h-5 w-px bg-line" />
        <input
          value={store.workflowName}
          onChange={(e) => store.setWorkflowName(e.target.value)}
          className="w-56 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-inktext outline-none focus:border-blue focus:bg-ink"
        />
        <button
          onClick={() => store.setWorkflowEnabled(!store.workflowEnabled)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${store.workflowEnabled ? 'bg-blue-500' : 'bg-line'}`}
          title="Toggle workflow enabled"
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${store.workflowEnabled ? 'left-[18px]' : 'left-0.5'}`}
          />
        </button>
        <span className="text-[11px] text-faint">
          {store.workflowId ? `id: ${store.workflowId.slice(0, 8)}` : 'unsaved'}
          {store.dirty ? ' · unsaved changes' : ' · saved'}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <input
            value={store.workflowWebhookUrl}
            onChange={(e) => store.setWorkflowWebhookUrl(e.target.value)}
            placeholder="Webhook URL (Discord…)"
            title="Posted on every client execution finish"
            className="w-44 rounded-lg border border-line bg-ink px-2.5 py-1.5 text-[11px] text-inktext outline-none placeholder:text-faint focus:border-blue"
          />
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Run payload prompt…"
            title="Prompt sent as payload.prompt on run"
            className="w-44 rounded-lg border border-line bg-ink px-2.5 py-1.5 text-xs text-inktext outline-none placeholder:text-faint focus:border-blue"
          />
          <button
            onClick={() => store.addNode('note')}
            title="Add sticky note"
            className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1.5 text-xs text-yellow-300 hover:bg-yellow-500/20"
          >
            🗒️ Note
          </button>
          <button
            onClick={() => store.addNode('group')}
            title="Add group frame"
            className="rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-muted hover:border-blue/40 hover:text-inktext"
          >
            🗂️ Group
          </button>
          <button
            onClick={store.undo}
            disabled={!store.past.length}
            title="Undo (Ctrl+Z)"
            className="rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-muted hover:border-blue/40 hover:text-inktext disabled:opacity-40"
          >
            ↶
          </button>
          <button
            onClick={store.redo}
            disabled={!store.future.length}
            title="Redo (Ctrl+Shift+Z)"
            className="rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-muted hover:border-blue/40 hover:text-inktext disabled:opacity-40"
          >
            ↷
          </button>
          <button
            onClick={store.autoArrange}
            title="Auto arrange"
            className="rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-muted hover:border-blue/40 hover:text-inktext"
          >
            ⟳ Arrange
          </button>
          <button
            onClick={() => setHistoryOpen(true)}
            title="Execution history"
            className="rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-muted hover:border-blue/40 hover:text-inktext"
          >
            ◷ History
          </button>
          <button
            onClick={() => void run()}
            disabled={store.runState === 'running' || !store.nodes.length}
            title="Run workflow (Ctrl+R)"
            className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_2px_12px_rgba(59,130,246,0.35)] transition-all hover:bg-blue-400 hover:shadow-[0_2px_18px_rgba(59,130,246,0.5)] disabled:opacity-50"
          >
            {store.runState === 'running' ? (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Running
              </>
            ) : (
              <>▶ Run</>
            )}
          </button>
          <button
            onClick={save}
            disabled={saveMutation.isPending}
            className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-ink transition-all hover:bg-emerald-400 hover:shadow-[0_2px_14px_rgba(16,185,129,0.4)] disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <NodeLibrary />
        <ReactFlowProvider>
          <WorkflowCanvas />
        </ReactFlowProvider>
        <PropertiesPanel />
      </div>

      <ConsolePanel />

      <ExecutionsDrawer
        open={historyOpen}
        workflowId={store.workflowId}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  );
}
