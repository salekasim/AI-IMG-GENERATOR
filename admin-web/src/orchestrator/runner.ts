import { API_BASE, tokenStore } from '../api/client';
import type { ConsoleLine, WorkflowActions } from './store/workflowStore';

interface SseEnvelope {
  type: string;
  ts: string;
  [key: string]: unknown;
}

function mapLevel(level: string): ConsoleLine['level'] {
  if (level === 'error') return 'error';
  if (level === 'warn') return 'warn';
  if (level === 'success') return 'success';
  if (level === 'api') return 'api';
  return 'info';
}

const STREAM_TIMEOUT_MS = 180_000;

/**
 * Opens a live SSE stream for an execution and mirrors engine events
 * into the workflow store (console lines, node statuses, run state).
 * Returns a cleanup function that closes the stream.
 */
export function connectExecutionStream(
  executionId: string,
  store: WorkflowActions,
  onFinish?: (status: 'success' | 'error') => void,
): () => void {
  const token = tokenStore.get() ?? '';
  const url = `${API_BASE}/orchestrator/executions/${executionId}/stream?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  let finished = false;
  let timeoutNoticed = false;

  const finish = (status: 'success' | 'error') => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    es.close();
    store.setRunState(status === 'success' ? 'done' : 'error');
    onFinish?.(status);
  };

  const timeout = setTimeout(() => {
    if (finished) return;
    store.pushConsole('warn', 'engine', 'SSE stream timed out — execution may still be running server-side');
    finish('error');
  }, STREAM_TIMEOUT_MS);

  es.onopen = () => {
    if (!timeoutNoticed) {
      timeoutNoticed = true;
      store.pushConsole('info', 'engine', 'live stream connected');
    }
  };

  es.onmessage = (event) => {
    if (finished) return;
    let evt: SseEnvelope;
    try {
      evt = JSON.parse(event.data as string) as SseEnvelope;
    } catch {
      return;
    }

    switch (evt.type) {
      case 'status':
        if (evt.status === 'running') store.setRunState('running');
        break;
      case 'log':
        store.pushConsole(
          mapLevel(String(evt.level ?? 'info')),
          String(evt.source ?? 'engine'),
          String(evt.message ?? ''),
        );
        break;
      case 'node': {
        const nodeId = String(evt.nodeId ?? '');
        const status = String(evt.status ?? '');
        if (nodeId && ['running', 'success', 'error', 'waiting', 'retrying', 'skipped'].includes(status)) {
          store.setNodeStatus(
            nodeId,
            status as 'running' | 'success' | 'error' | 'waiting' | 'retrying' | 'skipped',
            Number(evt.runtimeMs ?? 0),
          );
        }
        break;
      }
      case 'done': {
        const summary = (evt.summary ?? {}) as { status?: string; tokensIn?: number; tokensOut?: number; images?: number; durationMs?: number };
        const ok = summary.status === 'success';
        store.pushConsole(
          ok ? 'success' : 'error',
          'engine',
          `finished: ${summary.status ?? '?'} · ${summary.tokensIn ?? 0}+${summary.tokensOut ?? 0} tokens · ${summary.images ?? 0} images · ${summary.durationMs ?? 0}ms`,
        );
        finish(ok ? 'success' : 'error');
        break;
      }
      case 'error':
        store.pushConsole('error', 'engine', String(evt.message ?? 'execution failed'));
        finish('error');
        break;
      default:
        break;
    }
  };

  es.onerror = () => {
    if (finished) return;
    store.pushConsole('warn', 'engine', 'stream interrupted — reconnecting…');
  };

  return () => {
    clearTimeout(timeout);
    es.close();
  };
}
