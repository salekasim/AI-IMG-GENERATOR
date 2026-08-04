import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto.service';
import { PlatformConfigService } from '../../common/platform-config.service';
import { assertSafeWebhookUrl } from '../../common/url-safety.util';
import { ProviderAdapterFactory } from '../../generation/adapters/provider-adapter.factory';
import { ChatAdapter } from './chat.adapter';
import {
  RoutingService,
  RoutingAttempt,
  ChainStep,
  RoutingSink,
} from './routing.service';
import { SseService } from '../sse.service';
import { StorageService } from '../../storage/storage.service';
import { TOOL_NODE_TYPES, toolKeyForNodeType } from '../../tools/tool-registry';
import {
  ToolRunnerService,
  ToolRunResult,
} from '../../tools/tool-runner.service';
import { WorkflowGraph, WorkflowNode, WorkflowEdge } from './graph.types';
import { RegistryService } from '../../registry/registry.service';

interface ExecutionContext {
  currentId: string;
  payload: Record<string, unknown>;
  logs: Array<{ ts: string; level: string; source: string; message: string }>;
  tokensIn: number;
  tokensOut: number;
  images: number;
  costUsd: number;
  attempts: RoutingAttempt[];
  providerUsed: string | null;
  modelUsed: string | null;
  chat: {
    text: string;
    model: string;
    provider: string;
    tokensIn: number;
    tokensOut: number;
  } | null;
  userId: string | null;
  visited: Set<string>;
  /** Per-node tool results, consumed by storage nodes. */
  outputs: Map<string, ToolRunResult>;
  persistedNodeIds: Set<string>;
  /** Per-node model bindings emitted by modelNode/modelRoute nodes. */
  bindings: Map<string, ModelBinding>;
  /** Edge list per target node, used for dataflow resolution. */
  incoming: Map<string, WorkflowEdge[]>;
}

export type ModelBinding =
  | { provider: string; model: string }
  | { routeId: string };

export interface ExecutionStartOptions {
  source?: 'admin' | 'client';
  projectId?: string | null;
  createdBy?: string | null;
  webhookUrl?: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();

@Injectable()
export class ExecutionEngine implements OnModuleInit {
  private readonly logger = new Logger(ExecutionEngine.name);
  private readonly queue: string[] = [];
  private running = 0;
  private readonly MAX_CONCURRENT = 2;
  private readonly buckets = new Map<
    string,
    { tokens: number; lastRefill: number }
  >();
  private readonly DEFAULT_RPM = 10;
  private readonly webhookOverrides = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly sse: SseService,
    private readonly chat: ChatAdapter,
    private readonly adapterFactory: ProviderAdapterFactory,
    private readonly routing: RoutingService,
    private readonly tools: ToolRunnerService,
    private readonly storage: StorageService,
    private readonly config: PlatformConfigService,
    private readonly registry: RegistryService,
  ) {}

  async onModuleInit() {
    // Executions interrupted by a crash/restart would stay stuck forever —
    // reconcile them to a terminal state so the queue stays honest.
    const stale = await this.prisma.workflowExecution.updateMany({
      where: { status: { in: ['pending', 'running'] } },
      data: {
        status: 'error',
        error: 'Server restarted — execution was interrupted',
        finishedAt: new Date(),
      },
    });
    if (stale.count > 0) {
      this.logger.warn(
        `reconciled ${stale.count} stale execution(s) to 'error'`,
      );
    }
    this.webhookOverrides.clear();
  }

  async start(
    workflowId: string,
    payload: Record<string, unknown> | undefined,
    opts?: ExecutionStartOptions,
  ) {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
    });
    if (!workflow) throw new NotFoundException('Workflow not found');
    if (!workflow.enabled) {
      throw new BadRequestException(`Workflow '${workflow.name}' is disabled`);
    }

    // Phase 4: typed-port validation — unknown node types and incompatible
    // edge ports are hard errors before anything is enqueued.
    const validation = this.registry.validateGraph(
      workflow.graph as unknown as WorkflowGraph,
    );
    if (!validation.valid) {
      throw new BadRequestException({
        message: `Workflow '${workflow.name}' graph is invalid`,
        code: 'INVALID_GRAPH',
        errors: validation.errors,
      });
    }

    if (opts?.webhookUrl) {
      await assertSafeWebhookUrl(opts.webhookUrl);
    }

    const rpm = this.rateLimitFor(workflow.graph as unknown as WorkflowGraph);
    if (!this.consume(workflowId, rpm)) {
      throw new HttpException(
        {
          message: `Rate limit exceeded — at most ${rpm} executions/minute for this workflow`,
          code: 'RATE_LIMIT',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const execution = await this.prisma.workflowExecution.create({
      data: {
        workflowId,
        status: 'pending',
        source: opts?.source ?? 'admin',
        projectId: opts?.projectId ?? null,
        createdBy: opts?.createdBy ?? null,
        input: (payload ?? {}) as Prisma.InputJsonValue,
        logs: [],
      },
    });

    if (opts?.webhookUrl) {
      this.webhookOverrides.set(execution.id, opts.webhookUrl);
    }

    this.enqueue(execution.id);
    return execution;
  }

  private enqueue(id: string) {
    this.queue.push(id);
    void this.drain();
  }

  private async drain() {
    while (this.running < this.MAX_CONCURRENT && this.queue.length) {
      const id = this.queue.shift()!;
      this.running += 1;
      void this.run(id).finally(() => {
        this.running -= 1;
        void this.drain();
      });
    }
  }

  private async run(executionId: string) {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: { workflow: true },
    });
    if (!execution) return;
    const startedAt = Date.now();

    await this.prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: 'running' },
    });
    this.sse.publish(executionId, { type: 'status', status: 'running' });

    const graph = execution.workflow.graph as unknown as WorkflowGraph;
    const input = (execution.input ?? {}) as Record<string, unknown>;
    const ctx: ExecutionContext = {
      currentId: executionId,
      payload: { prompt: 'Hello world', plan: 'free', tier: 'free', ...input },
      logs: [],
      tokensIn: 0,
      tokensOut: 0,
      images: 0,
      costUsd: 0,
      attempts: [],
      providerUsed: null,
      modelUsed: null,
      chat: null,
      userId: execution.createdBy ?? null,
      visited: new Set(),
      outputs: new Map(),
      persistedNodeIds: new Set(),
      bindings: new Map(),
      incoming: new Map(),
    };

    try {
      const timeoutMs = await this.config.getNumber(
        'execution.timeoutMs',
        300_000,
      );
      await Promise.race([
        this.interpret(graph, ctx),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new Error(
                  `Execution timed out after ${Math.round(timeoutMs / 1000)}s`,
                ),
              ),
            timeoutMs,
          );
          timer.unref?.();
        }),
      ]);
      const durationMs = Date.now() - startedAt;
      await this.prisma.workflowExecution.update({
        where: { id: executionId },
        data: {
          status: 'success',
          logs: ctx.logs,
          attempts: ctx.attempts as unknown as Prisma.InputJsonValue,
          tokensIn: ctx.tokensIn,
          tokensOut: ctx.tokensOut,
          images: ctx.images,
          costUsd: ctx.costUsd,
          providerUsed: ctx.providerUsed,
          modelUsed: ctx.modelUsed,
          durationMs,
          finishedAt: new Date(),
          output: {
            chat: ctx.chat,
            images: ctx.images,
          },
        },
      });
      this.sse.publish(executionId, {
        type: 'done',
        summary: {
          status: 'success',
          tokensIn: ctx.tokensIn,
          tokensOut: ctx.tokensOut,
          images: ctx.images,
          costUsd: ctx.costUsd,
          provider: ctx.providerUsed,
          model: ctx.modelUsed,
          durationMs,
        },
      });
      this.sse.end(executionId);
      void this.notifyWebhook(executionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startedAt;
      this.sse.publish(executionId, {
        type: 'log',
        level: 'error',
        source: 'engine',
        message,
      });
      await this.prisma.workflowExecution.update({
        where: { id: executionId },
        data: {
          status: 'error',
          logs: ctx.logs,
          attempts: ctx.attempts as unknown as Prisma.InputJsonValue,
          tokensIn: ctx.tokensIn,
          tokensOut: ctx.tokensOut,
          images: ctx.images,
          costUsd: ctx.costUsd,
          providerUsed: ctx.providerUsed,
          modelUsed: ctx.modelUsed,
          durationMs,
          error: message,
          finishedAt: new Date(),
        },
      });
      this.sse.publish(executionId, { type: 'error', message });
      this.sse.end(executionId);
      void this.notifyWebhook(executionId);
    }
  }

  /** POST the execution summary to the workflow webhook (Discord / custom). */
  private async notifyWebhook(executionId: string): Promise<void> {
    try {
      const execution = await this.prisma.workflowExecution.findUnique({
        where: { id: executionId },
        include: {
          workflow: { select: { id: true, name: true, webhookUrl: true } },
        },
      });
      if (!execution) return;
      const webhookUrl =
        this.webhookOverrides.get(executionId) ?? execution.workflow.webhookUrl;
      this.webhookOverrides.delete(executionId);
      if (!webhookUrl) return;
      try {
        await assertSafeWebhookUrl(webhookUrl);
      } catch (error) {
        this.logger.warn(
          `webhook skipped (unsafe URL): ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }

      const body = {
        id: execution.id,
        workflowId: execution.workflow.id,
        workflowName: execution.workflow.name,
        status: execution.status,
        source: execution.source,
        error: execution.error ?? null,
        summary: {
          tokensIn: execution.tokensIn,
          tokensOut: execution.tokensOut,
          images: execution.images,
          costUsd: execution.costUsd,
          provider: execution.providerUsed,
          model: execution.modelUsed,
          durationMs: execution.durationMs,
        },
        finishedAt: execution.finishedAt?.toISOString() ?? null,
      };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'intellix-webhook',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        this.logger.warn(`webhook ${webhookUrl} responded ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `webhook notify failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async interpret(graph: WorkflowGraph, ctx: ExecutionContext) {
    const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    const outgoing = this.outgoingMap(graph.edges);
    const incoming = new Map<string, WorkflowEdge[]>();
    graph.edges.forEach((e) => {
      incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);
    });
    ctx.incoming = incoming;

    const entries = graph.nodes
      .filter((n) => !incoming.has(n.id))
      .map((n) => n.id);
    if (!entries.length && graph.nodes.length) entries.push(graph.nodes[0].id);
    if (!entries.length) return;

    this.sse.publish(ctx.currentId, {
      type: 'log',
      level: 'info',
      source: 'engine',
      message: 'Execution started',
    });
    for (const entry of entries) {
      await this.walk(entry, nodes, outgoing, ctx);
    }
  }

  private async walk(
    id: string,
    nodes: Map<string, WorkflowNode>,
    outgoing: Map<string, Array<{ target: string; handle?: string }>>,
    ctx: ExecutionContext,
  ): Promise<void> {
    const node = nodes.get(id);
    if (!node || ctx.visited.has(id)) return;
    ctx.visited.add(id);
    const outs = outgoing.get(id) ?? [];

    if (node.type === 'note' || node.type === 'group') {
      this.sse.publish(ctx.currentId, {
        type: 'log',
        level: 'info',
        source: this.nameOf(node),
        message: `↷ canvas element (${node.type}) — no execution`,
      });
      for (const out of outs) {
        await this.walk(out.target, nodes, outgoing, ctx);
      }
      return;
    }

    if (node.type === 'retry') {
      await this.handleRetry(id, node, nodes, outgoing, ctx);
      return;
    }

    if (node.type === 'if' || node.type === 'subscriptionCheck') {
      const passed =
        node.type === 'subscriptionCheck'
          ? String(ctx.payload.plan ?? 'free') !== 'free'
          : this.evaluateIf(node, ctx);
      const follow = passed ? 'true' : 'false';
      this.sse.publish(ctx.currentId, {
        type: 'log',
        level: passed ? 'success' : 'warn',
        source: this.nameOf(node),
        message: passed ? '✔ condition TRUE' : '✗ condition FALSE',
      });
      ctx.logs.push({
        ts: nowIso(),
        level: passed ? 'success' : 'warn',
        source: this.nameOf(node),
        message: passed ? 'condition TRUE' : 'condition FALSE',
      });
      this.sse.publish(ctx.currentId, {
        type: 'node',
        nodeId: id,
        status: 'success',
        runtimeMs: 0,
      });
      for (const out of outs) {
        if ((out.handle ?? 'true') === follow)
          await this.walk(out.target, nodes, outgoing, ctx);
      }
      return;
    }

    if (node.type === 'switch') {
      const field = String(node.config?.field ?? 'tier');
      const value = String(ctx.payload[field] ?? 'free');
      let matched = false;
      for (const out of outs) {
        if (out.target === value) {
          matched = true;
          await this.walk(out.target, nodes, outgoing, ctx);
        }
      }
      this.sse.publish(ctx.currentId, {
        type: 'log',
        level: matched ? 'success' : 'warn',
        source: this.nameOf(node),
        message: matched
          ? `routing to branch '${value}'`
          : `no branch matches '${value}'`,
      });
      ctx.logs.push({
        ts: nowIso(),
        level: matched ? 'success' : 'warn',
        source: this.nameOf(node),
        message: matched
          ? `routing to branch '${value}'`
          : `no branch matches '${value}'`,
      });
      this.sse.publish(ctx.currentId, {
        type: 'node',
        nodeId: id,
        status: 'success',
        runtimeMs: 0,
      });
      return;
    }

    await this.executeNode(id, node, ctx);
    for (const out of outs) {
      await this.walk(out.target, nodes, outgoing, ctx);
    }
  }

  private async handleRetry(
    id: string,
    node: WorkflowNode,
    nodes: Map<string, WorkflowNode>,
    outgoing: Map<string, Array<{ target: string; handle?: string }>>,
    ctx: ExecutionContext,
  ) {
    const config = node.config ?? {};
    const attempts = Math.max(1, Number(config.attempts ?? 2));
    const delayMs = Math.max(0, Number(config.delayMs ?? 500));
    const onError = String(config.onError ?? 'next');
    const targets = outgoing.get(id) ?? [];
    const target = targets[0];
    if (!target) return;

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      this.sse.publish(ctx.currentId, {
        type: 'log',
        level: 'warn',
        source: this.nameOf(node),
        message: `↺ attempt ${attempt}/${attempts} on '${this.nameOf(nodes.get(target.target)!)}'`,
      });
      try {
        await this.executeNode(target.target, nodes.get(target.target)!, ctx);
        ctx.visited.add(target.target);
        this.sse.publish(ctx.currentId, {
          type: 'log',
          level: 'success',
          source: this.nameOf(node),
          message: `✔ success on attempt ${attempt}`,
        });
        const targetOuts = outgoing.get(target.target) ?? [];
        for (const out of targetOuts)
          await this.walk(out.target, nodes, outgoing, ctx);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) await sleep(delayMs);
      }
    }

    const message =
      lastError instanceof Error ? lastError.message : String(lastError);
    if (onError === 'stop') {
      throw new Error(`Retry exhausted after ${attempts} attempts: ${message}`);
    }
    this.sse.publish(ctx.currentId, {
      type: 'log',
      level: 'warn',
      source: this.nameOf(node),
      message: 'all attempts failed — falling back to next node',
    });
    const targetOuts = outgoing.get(target.target) ?? [];
    for (const out of targetOuts)
      await this.walk(out.target, nodes, outgoing, ctx);
  }

  private async executeNode(
    id: string,
    node: WorkflowNode,
    ctx: ExecutionContext,
  ): Promise<void> {
    const name = this.nameOf(node);
    const started = Date.now();
    this.sse.publish(ctx.currentId, {
      type: 'node',
      nodeId: id,
      status: 'running',
      runtimeMs: 0,
    });
    this.sse.publish(ctx.currentId, {
      type: 'log',
      level: 'info',
      source: name,
      message: `▶ running ${node.type}`,
    });

    try {
      const config = node.config ?? {};
      switch (node.type) {
        case 'trigger': {
          const keys = Object.keys(ctx.payload).join(', ') || '(empty payload)';
          this.sse.publish(ctx.currentId, {
            type: 'log',
            level: 'info',
            source: name,
            message: `payload fields: ${keys}`,
          });
          break;
        }
        case 'chatModel': {
          let provider = String(config.provider ?? 'Pollinations');
          let model = String(config.model ?? 'openai');
          const binding = this.bindingFor(id, ctx);
          if (binding) {
            const chain = await this.modelBindingChain(binding);
            if (chain.length) {
              provider = chain[0].provider;
              model = chain[0].model;
            }
          }
          const apiKey = await this.resolveKey(provider, config.apiKey);
          const result = await this.chat.call({
            provider,
            model,
            prompt: String(ctx.payload.prompt ?? 'Hello world'),
            systemPrompt: config.systemPrompt
              ? String(config.systemPrompt)
              : undefined,
            temperature: Number(config.temperature ?? 0.7),
            maxTokens: Number(config.maxTokens ?? 1024),
            apiKey,
          });
          ctx.tokensIn += result.tokensIn;
          ctx.tokensOut += result.tokensOut;
          ctx.chat = result;
          this.sse.publish(ctx.currentId, {
            type: 'log',
            level: 'success',
            source: name,
            message: `✔ ${result.model} replied in ${Date.now() - started}ms (${result.tokensIn}+${result.tokensOut} tokens)`,
          });
          this.sse.publish(ctx.currentId, {
            type: 'log',
            level: 'api',
            source: name,
            message: result.text.slice(0, 200),
          });
          break;
        }
        case 'imageModel':
        case 'iconModel':
        case 'logoModel':
        case 'object3dModel':
        case 'videoModel':
        case 'backgroundRemover':
        case 'upscaler':
        case 'imageGeneration':
        case 'iconGeneration':
        case 'logoGeneration':
        case 'object3dGeneration':
        case 'videoGeneration':
        case 'backgroundRemoval':
        case 'imageUpscaling':
        case 'textGeneration': {
          const toolKey = toolKeyForNodeType(node.type) ?? 'image';
          const sink: RoutingSink = {
            emit: (event) => {
              this.sse.publish(ctx.currentId, {
                type: 'node',
                nodeId: id,
                status: event.status,
                runtimeMs: event.latencyMs,
                attempt: event.attempt,
                provider: event.provider,
                model: event.model,
                message: event.message,
              });
            },
            log: (level, source, message) => {
              this.sse.publish(ctx.currentId, {
                type: 'log',
                level,
                source,
                message,
              });
              ctx.logs.push({ ts: nowIso(), level, source, message });
            },
          };
          // Phase 5 dataflow: a connected modelNode/modelRoute binding
          // overrides the node's config chain / default binding.
          const binding = this.bindingFor(id, ctx);
          let effectiveConfig = config;
          if (binding) {
            const boundChain = await this.modelBindingChain(binding);
            if (boundChain.length) {
              effectiveConfig = { ...config, chain: boundChain };
              this.sse.publish(ctx.currentId, {
                type: 'log',
                level: 'info',
                source: name,
                message: `model binding → ${boundChain.map((s) => `${s.provider}/${s.model}`).join(' → ')}`,
              });
            }
          }
          // Phase 9 dataflow: upstream artifacts/text flow into the tool call
          // through the node's incoming ports (input/image/video/audio/prompt).
          const upstreamImage = this.upstreamArtifact(id, ctx, 'image');
          const upstreamVideo = this.upstreamArtifact(id, ctx, 'video');
          const upstreamText = this.upstreamText(id, ctx);
          const toolPayload: Record<string, unknown> = {
            ...ctx.payload,
            prompt: ctx.payload.prompt ?? 'A beautiful landscape',
          };
          const promptPort = (ctx.incoming.get(id) ?? []).some(
            (e) => e.targetHandle === 'prompt',
          );
          if (upstreamText && promptPort) toolPayload.prompt = upstreamText;
          if (upstreamImage?.dataUrl) toolPayload.inputImage = upstreamImage.dataUrl;
          if (upstreamVideo?.url) toolPayload.inputVideo = upstreamVideo.url;
          if (upstreamText && !promptPort) toolPayload.inputText = upstreamText;
          if (upstreamImage || upstreamVideo || upstreamText) {
            const parts = [
              upstreamImage ? 'image' : null,
              upstreamVideo ? 'video' : null,
              upstreamText ? 'text' : null,
            ].filter(Boolean);
            this.sse.publish(ctx.currentId, {
              type: 'log',
              level: 'info',
              source: name,
              message: `dataflow: ← ${parts.join(', ')} from upstream node(s)`,
            });
          }
          const result = await this.tools.execute({
            toolKey,
            nodeId: id,
            config: effectiveConfig,
            payload: toolPayload,
            userId: ctx.userId,
            sink,
          });
          ctx.outputs.set(id, result);
          ctx.images += result.items.filter((i) => i.kind === 'image').length;
          ctx.costUsd += result.costUsd;
          ctx.attempts.push(...result.attempts);
          if (result.providerUsed) ctx.providerUsed = result.providerUsed;
          if (result.modelUsed) ctx.modelUsed = result.modelUsed;
          const textItem = result.items.find((i) => i.kind === 'text');
          if (textItem?.text) {
            ctx.chat = {
              text: textItem.text,
              model: result.modelUsed ?? '',
              provider: result.providerUsed ?? '',
              tokensIn: result.tokensIn ?? 0,
              tokensOut: result.tokensOut ?? 0,
            };
          }
          this.sse.publish(ctx.currentId, {
            type: 'node',
            nodeId: id,
            status: 'success',
            runtimeMs: Date.now() - started,
            provider: result.providerUsed ?? undefined,
            model: result.modelUsed ?? undefined,
            message: `✔ ${result.items.length} asset(s) via ${result.providerUsed}/${result.modelUsed} ($${result.costUsd.toFixed(4)})`,
          });
          this.sse.publish(ctx.currentId, {
            type: 'log',
            level: 'success',
            source: name,
            message: `✔ ${result.items.length} asset(s) via ${result.providerUsed}/${result.modelUsed} ($${result.costUsd.toFixed(4)})`,
          });
          ctx.logs.push({
            ts: nowIso(),
            level: 'success',
            source: name,
            message: `✔ ${result.items.length} asset(s) via ${result.providerUsed}/${result.modelUsed} ($${result.costUsd.toFixed(4)})`,
          });
          break;
        }
        case 'logger': {
          const message = String(
            config.message ?? `log ${config.level ?? 'info'}`,
          );
          this.sse.publish(ctx.currentId, {
            type: 'log',
            level: config.level ?? 'info',
            source: name,
            message,
          });
          break;
        }
        case 'analytics':
          this.sse.publish(ctx.currentId, {
            type: 'log',
            level: 'info',
            source: name,
            message: `tracking '${String(config.track ?? 'request')}'`,
          });
          break;
        case 'notification':
          this.sse.publish(ctx.currentId, {
            type: 'log',
            level: 'info',
            source: name,
            message: `sending ${String(config.channel ?? 'webhook')} notification to ${String(config.target ?? '(unset)')}`,
          });
          break;
        case 'rateLimiter':
          this.sse.publish(ctx.currentId, {
            type: 'log',
            level: 'info',
            source: name,
            message: `enforcing ${String(config.rpm ?? '?')} rpm budget`,
          });
          break;
        case 'storage':
        case 'storageNode': {
          // Phase 5 dataflow: a storage node with incoming edges persists ONLY
          // artifacts from connected source nodes, filtered by the target
          // handle (image/video/audio/file) when present. No incoming edges →
          // legacy behavior: persist every tool output of the execution.
          const inEdges = ctx.incoming.get(id) ?? [];
          const connectedSources = new Map<string, WorkflowEdge[]>();
          for (const edge of inEdges) {
            connectedSources.set(edge.source, [
              ...(connectedSources.get(edge.source) ?? []),
              edge,
            ]);
          }
          const storageRoute = config.storage ? String(config.storage) : null;
          const storagePath = config.path ? String(config.path) : null;

          const persistItem = async (
            sourceId: string,
            result: ToolRunResult,
            item: ToolRunResult['items'][number],
          ) => {
            let buffer: Buffer | null = null;
            let mime: string | null = null;
            if (item.dataUrl) {
              const [header, body] = item.dataUrl.split(',');
              mime = (header.match(/^data:([^;]+)/)?.[1] ?? 'image/png').trim();
              buffer = Buffer.from(body ?? '', 'base64');
            } else if (item.url) {
              try {
                const response = await fetch(item.url, {
                  signal: AbortSignal.timeout(60_000),
                });
                if (!response.ok) {
                  this.sse.publish(ctx.currentId, {
                    type: 'log',
                    level: 'error',
                    source: name,
                    message: `storage: fetch ${item.url} failed (HTTP ${response.status})`,
                  });
                  return;
                }
                buffer = Buffer.from(await response.arrayBuffer());
                mime =
                  response.headers.get('content-type') ??
                  (item.url.match(
                    /\.(mp4|webm|mov|png|jpe?g|webp)(\?|$)/i,
                  )?.[1] === 'mp4'
                    ? 'video/mp4'
                    : item.url.match(/\.webm(\?|$)/i)
                      ? 'video/webm'
                      : 'image/png');
              } catch (error) {
                this.sse.publish(ctx.currentId, {
                  type: 'log',
                  level: 'error',
                  source: name,
                  message: `storage: fetch ${item.url} failed (${error instanceof Error ? error.message : String(error)})`,
                });
                return;
              }
            }
            if (!buffer) return;
            const ext = this.extForMime(mime);
            try {
              await this.storage.persist({
                executionId: ctx.currentId,
                workflowId: null,
                nodeId: sourceId,
                tool: result.tool ?? 'asset',
                provider: result.providerUsed,
                model: result.modelUsed,
                kind: item.kind === 'video' ? 'video' : 'image',
                mime,
                buffer,
                ext,
                createdBy: ctx.userId,
                route: storageRoute,
                path: storagePath,
              });
              return true;
            } catch (error) {
              this.sse.publish(ctx.currentId, {
                type: 'log',
                level: 'error',
                source: name,
                message: `storage: persist failed (${error instanceof Error ? error.message : String(error)})`,
              });
              return;
            }
          };

          let saved = 0;
          if (connectedSources.size > 0) {
            for (const [sourceId, edges] of connectedSources) {
              const result = ctx.outputs.get(sourceId);
              if (!result || ctx.persistedNodeIds.has(sourceId)) continue;
              let targetAll = false;
              const targetKinds = new Set<string>();
              for (const edge of edges) {
                const handle = edge.targetHandle ?? '';
                if (!handle) {
                  targetAll = true;
                  break;
                }
                if (['image', 'video', 'audio', 'file'].includes(handle)) {
                  targetKinds.add(handle);
                }
              }
              for (const item of result.items) {
                if (!targetAll && !targetKinds.has(item.kind)) continue;
                const ok = await persistItem(sourceId, result, item);
                if (ok) saved += 1;
              }
              ctx.persistedNodeIds.add(sourceId);
            }
          } else {
            if (!ctx.outputs.size) {
              this.sse.publish(ctx.currentId, {
                type: 'log',
                level: 'warn',
                source: name,
                message: 'storage: no tool outputs to persist yet',
              });
              break;
            }
            for (const [sourceId, result] of ctx.outputs) {
              if (ctx.persistedNodeIds.has(sourceId)) continue;
              for (const item of result.items) {
                const ok = await persistItem(sourceId, result, item);
                if (ok) saved += 1;
              }
              ctx.persistedNodeIds.add(sourceId);
            }
          }
          this.sse.publish(ctx.currentId, {
            type: 'log',
            level: saved ? 'success' : 'warn',
            source: name,
            message: saved
              ? `✔ ${saved} asset(s) persisted to ${String(config.storage ?? 'Local')}${String(config.path ?? '')}`
              : 'storage: nothing persisted',
          });
          break;
        }
        case 'wait': {
          const seconds = Math.min(5, Number(config.seconds ?? 0));
          if (seconds > 0) await sleep(seconds * 1000);
          this.sse.publish(ctx.currentId, {
            type: 'log',
            level: 'info',
            source: name,
            message: `resumed after ${seconds}s`,
          });
          break;
        }
        case 'delay': {
          const ms = Math.min(5000, Number(config.ms ?? 0));
          if (ms > 0) await sleep(ms);
          break;
        }
        // ── Phase 5 dataflow: provider/model binding nodes ────────────────
        case 'modelNode': {
          const provider = String(config.provider ?? '').trim();
          const model = String(config.model ?? '').trim();
          const upstream = this.bindingFor(id, ctx);
          if (provider && model) {
            ctx.bindings.set(id, { provider, model });
            this.sse.publish(ctx.currentId, {
              type: 'log',
              level: 'success',
              source: name,
              message: `model bound: ${provider}/${model}`,
            });
          } else if (upstream) {
            ctx.bindings.set(id, upstream);
            this.sse.publish(ctx.currentId, {
              type: 'log',
              level: 'info',
              source: name,
              message:
                'provider' in upstream
                  ? `model passthrough: ${upstream.provider}/${upstream.model}`
                  : 'route passthrough',
            });
          } else {
            this.sse.publish(ctx.currentId, {
              type: 'log',
              level: 'warn',
              source: name,
              message: 'modelNode has no provider/model and no upstream binding',
            });
          }
          break;
        }
        case 'modelRoute': {
          const routeId = String(config.routeId ?? '').trim();
          const upstream = this.bindingFor(id, ctx);
          if (routeId) {
            const route = await this.prisma.modelRoute.findFirst({
              where: { OR: [{ id: routeId }, { name: routeId }] },
            });
            if (route?.enabled) {
              ctx.bindings.set(id, { routeId });
              const steps = await this.modelBindingChain({ routeId });
              this.sse.publish(ctx.currentId, {
                type: 'log',
                level: 'success',
                source: name,
                message: `route bound: '${route.name}' → ${steps.map((s) => `${s.provider}/${s.model}`).join(' → ') || 'no usable steps'}`,
              });
            } else {
              this.sse.publish(ctx.currentId, {
                type: 'log',
                level: 'warn',
                source: name,
                message: `route '${routeId}' missing or disabled`,
              });
            }
          } else if (upstream) {
            ctx.bindings.set(id, upstream);
            this.sse.publish(ctx.currentId, {
              type: 'log',
              level: 'info',
              source: name,
              message: 'route passthrough',
            });
          } else {
            this.sse.publish(ctx.currentId, {
              type: 'log',
              level: 'warn',
              source: name,
              message: 'modelRoute has no routeId and no upstream binding',
            });
          }
          break;
        }
        default: {
          if (config.apiKey !== undefined && node.type !== 'chatModel') {
            this.sse.publish(ctx.currentId, {
              type: 'log',
              level: 'info',
              source: name,
              message: `provider configured (key ${config.apiKey ? 'present' : 'absent'})`,
            });
          } else {
            this.sse.publish(ctx.currentId, {
              type: 'log',
              level: 'info',
              source: name,
              message: 'M2 passthrough — execution wired in M3',
            });
          }
        }
      }
      if (!TOOL_NODE_TYPES[node.type]) {
        this.sse.publish(ctx.currentId, {
          type: 'node',
          nodeId: id,
          status: 'success',
          runtimeMs: Date.now() - started,
        });
      }
    } catch (error) {
      this.sse.publish(ctx.currentId, {
        type: 'node',
        nodeId: id,
        status: 'error',
        runtimeMs: Date.now() - started,
      });
      this.sse.publish(ctx.currentId, {
        type: 'log',
        level: 'error',
        source: name,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private async resolveKey(
    provider: string,
    nodeKey: unknown,
  ): Promise<string | null> {
    if (typeof nodeKey === 'string' && nodeKey.trim()) return nodeKey.trim();
    const rowName = this.imageProviderRow(provider);
    try {
      const row = await this.prisma.aiProvider.findUnique({
        where: { name: rowName },
      });
      if (row?.enabled && row.apiKeyEnc) {
        return this.crypto.decrypt(row.apiKeyEnc);
      }
    } catch {
      // no provider row — fall through
    }
    return null;
  }

  private imageProviderRow(provider: string): string {
    const p = provider.trim().toLowerCase();
    if (['flux', 'ideogram', 'pollinations'].includes(p)) return 'pollinations';
    if (p === 'openai') return 'openai';
    if (p === 'stability') return 'stability';
    return p;
  }

  private imageModelFor(provider: string, model: string): string {
    const p = provider.trim().toLowerCase();
    if (p === 'flux') return 'flux';
    if (p === 'ideogram') return 'ideogram-v2';
    if (p === 'pollinations') return model.trim() || 'flux';
    return model.trim();
  }

  /**
   * Phase 5 dataflow: resolve a model binding to an ordered provider/model
   * chain. A `routeId` binding expands the admin ModelRoute's steps (JSON,
   * priority-ordered); a direct binding is a single-step chain.
   */
  private async modelBindingChain(
    binding: ModelBinding,
  ): Promise<Array<{ provider: string; model: string }>> {
    if ('provider' in binding) {
      return [{ provider: binding.provider, model: binding.model }];
    }
    const route = await this.prisma.modelRoute.findFirst({
      where: { OR: [{ id: binding.routeId }, { name: binding.routeId }] },
    });
    if (!route || !route.enabled) return [];
    const steps = Array.isArray(route.steps) ? route.steps : [];
    return (steps as Array<Record<string, unknown>>)
      .sort(
        (a, b) =>
          (Number(a.priority ?? 0) || 0) - (Number(b.priority ?? 0) || 0),
      )
      .filter(
        (s) =>
          typeof s?.provider === 'string' &&
          s.provider.trim() !== '' &&
          typeof s?.model === 'string' &&
          s.model.trim() !== '',
      )
      .map((s) => ({
        provider: String(s.provider).trim(),
        model: String(s.model).trim(),
      }));
  }

  /**
   * Phase 9 dataflow: find the model binding a node receives. Direct
   * modelNode/modelRoute edges win; otherwise the binding is inherited from
   * upstream nodes (so a chain like modelNode → imageGeneration →
   * backgroundRemoval gives every step the same model binding). Bindings only
   * ever exist on modelNode/modelRoute rows, so any incoming edge can carry
   * inheritance; the `visited` set guards against cycles.
   */
  private bindingFor(
    nodeId: string,
    ctx: ExecutionContext,
    seen?: Set<string>,
  ): ModelBinding | null {
    const visited = seen ?? new Set<string>();
    if (visited.has(nodeId)) return null;
    visited.add(nodeId);
    const inEdges = ctx.incoming.get(nodeId) ?? [];
    for (const edge of inEdges) {
      const binding = ctx.bindings.get(edge.source);
      if (binding) return binding;
      const inherited = this.bindingFor(edge.source, ctx, visited);
      if (inherited) return inherited;
    }
    return null;
  }

  /**
   * Phase 9 dataflow: upstream tool results that flow into a node through its
   * incoming edges. `targetHandle` filters to the matching input port
   * (input/image/video/audio/prompt) when the edge is handle-qualified.
   */
  private upstreamItems(
    nodeId: string,
    ctx: ExecutionContext,
  ): Array<{ edge: WorkflowEdge; result: ToolRunResult }> {
    const items: Array<{ edge: WorkflowEdge; result: ToolRunResult }> = [];
    for (const edge of ctx.incoming.get(nodeId) ?? []) {
      const result = ctx.outputs.get(edge.source);
      if (result) items.push({ edge, result });
    }
    return items;
  }

  private upstreamArtifact(
    nodeId: string,
    ctx: ExecutionContext,
    kind: 'image' | 'video' | 'audio',
  ): ToolRunResult['items'][number] | null {
    for (const { edge, result } of this.upstreamItems(nodeId, ctx)) {
      const handle = edge.targetHandle ?? '';
      if (handle && handle !== 'input' && handle !== kind) continue;
      const item = result.items.find((i) => i.kind === kind && (i.dataUrl || i.url));
      if (item) return item;
    }
    return null;
  }

  private upstreamText(nodeId: string, ctx: ExecutionContext): string | null {
    for (const { edge, result } of this.upstreamItems(nodeId, ctx)) {
      const handle = edge.targetHandle ?? '';
      if (handle && handle !== 'prompt' && handle !== 'text' && handle !== 'data') {
        continue;
      }
      const item = result.items.find((i) => i.kind === 'text' && i.text);
      if (item?.text) return item.text;
    }
    return null;
  }

  /** Resolve the ordered model chain for an image node: explicit chain → routing variable → legacy single step. */
  private async resolveImageChain(
    node: WorkflowNode,
    ctx: ExecutionContext,
  ): Promise<ChainStep[]> {
    const config = node.config ?? {};
    const maxDepth = await this.config.getNumber('routing.maxChainDepth', 4);
    const chainRaw = Array.isArray(config.chain)
      ? (config.chain as Array<Record<string, unknown>>)
      : [];
    if (chainRaw.length) {
      const steps: ChainStep[] = chainRaw
        .filter(
          (s) =>
            typeof s?.provider === 'string' &&
            s.provider.trim() !== '' &&
            typeof s?.model === 'string' &&
            s.model.trim() !== '',
        )
        .map((s) => ({
          provider: String(s.provider).trim(),
          model: String(s.model).trim(),
        }))
        .slice(0, maxDepth);
      if (steps.length) return steps;
    }
    const variable = config.routingVariable
      ? String(config.routingVariable)
      : undefined;
    if (variable) {
      const steps = (await this.routing.resolveVariable(variable)).slice(
        0,
        maxDepth,
      );
      if (steps.length) {
        this.sse.publish(ctx.currentId, {
          type: 'log',
          level: 'info',
          source: this.nameOf(node),
          message: `routing variable '${variable}' → ${steps.map((s) => s.provider + '/' + s.model).join(' → ')}`,
        });
        return steps;
      }
    }
    const provider = String(config.provider ?? 'Pollinations');
    return [
      {
        provider: this.imageProviderRow(provider),
        model: this.imageModelFor(provider, String(config.model ?? '')),
      },
    ];
  }

  private parseSize(size: string): { width: number; height: number } {
    const match = size.toLowerCase().match(/(\d+)\s*x\s*(\d+)/);
    if (!match) return { width: 1024, height: 1024 };
    return { width: Number(match[1]), height: Number(match[2]) };
  }

  private extForMime(mime: string | null): string {
    const m = (mime ?? '').toLowerCase();
    if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
    if (m.includes('webp')) return '.webp';
    if (m.includes('gif')) return '.gif';
    if (m.includes('mp4')) return '.mp4';
    if (m.includes('webm')) return '.webm';
    if (m.includes('mov')) return '.mov';
    if (m.includes('png')) return '.png';
    return '.bin';
  }

  private evaluateIf(node: WorkflowNode, ctx: ExecutionContext): boolean {
    const config = node.config ?? {};
    const field = String(config.field ?? 'plan');
    const left = field.startsWith('payload.')
      ? String(ctx.payload[field.slice(8)] ?? '(unset)')
      : String(ctx.payload[field] ?? '(unset)');
    const right = String(config.value ?? '');
    switch (config.condition) {
      case 'contains':
        return left.includes(right);
      case 'greaterThan':
        return Number(left) > Number(right);
      case 'lessThan':
        return Number(left) < Number(right);
      case 'isSet':
        return left !== '(unset)' && left !== '';
      default:
        return left === right;
    }
  }

  private rateLimitFor(graph: WorkflowGraph): number {
    const limiter = graph.nodes?.find((n) => n.type === 'rateLimiter');
    if (limiter) {
      const rpm = Number(limiter.config?.rpm);
      if (Number.isFinite(rpm) && rpm > 0) return Math.min(60, rpm);
    }
    return this.DEFAULT_RPM;
  }

  private consume(workflowId: string, rpm: number): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(workflowId);
    if (!bucket) {
      bucket = { tokens: rpm, lastRefill: now };
      this.buckets.set(workflowId, bucket);
    }
    bucket.tokens = Math.min(
      rpm,
      bucket.tokens + ((now - bucket.lastRefill) / 1000) * (rpm / 60),
    );
    bucket.lastRefill = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  private outgoingMap(
    edges: WorkflowEdge[],
  ): Map<string, Array<{ target: string; handle?: string }>> {
    const map = new Map<string, Array<{ target: string; handle?: string }>>();
    edges.forEach((e) => {
      const list = map.get(e.source) ?? [];
      list.push({ target: e.target, handle: e.sourceHandle ?? undefined });
      map.set(e.source, list);
    });
    return map;
  }

  private nameOf(node: WorkflowNode): string {
    const config = node.config;
    return typeof config?.name === 'string' ? config.name : node.type;
  }
}
