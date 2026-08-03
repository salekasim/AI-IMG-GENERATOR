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
const RECONNECT_DELAY_MS = 1_500;
const MAX_RECONNECTS = 8;

/**
 * Opens a live SSE stream for an execution and mirrors engine events
 * into the workflow store (console lines, node statuses, run state).
 * Uses fetch + ReadableStream instead of EventSource so the JWT can be
 * sent in the Authorization header (EventSource cannot set headers, and a
 * `?token=` query param would leak the token into access logs).
 * Returns a cleanup function that closes the stream.
 */
export function connectExecutionStream(
  executionId: string,
  store: WorkflowActions,
  onFinish?: (status: 'success' | 'error') => void,
): () => void {
  const token = tokenStore.get() ?? '';
  const url = `${API_BASE}/orchestrator/executions/${executionId}/stream`;
  let finished = false;
  let closed = false;
  let reconnects = 0;
  let controller: AbortController | null = null;

  const finish = (status: 'success' | 'error') => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    controller?.abort();
    store.setRunState(status === 'success' ? 'done' : 'error');
    onFinish?.(status);
  };

  const timeout = setTimeout(() => {
    if (finished) return;
    store.pushConsole(
      'warn',
      'engine',
      'SSE stream timed out — execution may still be running server-side',
    );
    finish('error');
  }, STREAM_TIMEOUT_MS);

  const handleEvent = (evt: SseEnvelope) => {
    if (finished) return;
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
        if (
          nodeId &&
          ['running', 'success', 'error', 'waiting', 'retrying', 'skipped'].includes(
            status,
          )
        ) {
          store.setNodeStatus(
            nodeId,
            status as
              | 'running'
              | 'success'
              | 'error'
              | 'waiting'
              | 'retrying'
              | 'skipped',
            Number(evt.runtimeMs ?? 0),
          );
        }
        break;
      }
      case 'done': {
        const summary = (evt.summary ?? {}) as {
          status?: string;
          tokensIn?: number;
          tokensOut?: number;
          images?: number;
          durationMs?: number;
        };
        const ok = summary.status === 'success';
        store.pushConsole(
          ok ? 'success' : 'error',
          'engine',
          `finished: ${summary.status ?? '?'} · ${summary.tokensIn ?? 0}+${
            summary.tokensOut ?? 0
          } tokens · ${summary.images ?? 0} images · ${
            summary.durationMs ?? 0
          }ms`,
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

  async function open(): Promise<void> {
    if (closed || finished) return;
    controller = new AbortController();
    try {
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
      if (!finished) store.pushConsole('info', 'engine', 'live stream connected');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (!raw) continue;
            let evt: SseEnvelope;
            try {
              evt = JSON.parse(raw) as SseEnvelope;
            } catch {
              continue;
            }
            handleEvent(evt);
          }
        }
      }
    } catch {
      if (closed || finished) return;
      if (reconnects < MAX_RECONNECTS) {
        reconnects += 1;
        store.pushConsole('warn', 'engine', 'stream interrupted — reconnecting…');
        setTimeout(open, RECONNECT_DELAY_MS);
      } else {
        store.pushConsole('warn', 'engine', 'stream unavailable after retries');
        finish('error');
      }
    }
  }

  void open();

  return () => {
    closed = true;
    clearTimeout(timeout);
    controller?.abort();
  };
}
