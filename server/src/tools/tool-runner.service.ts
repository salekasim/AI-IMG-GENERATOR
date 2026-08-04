import { Injectable, Logger } from '@nestjs/common';
import { AiProvider, Capability } from '@prisma/client';
import { CryptoService } from '../common/crypto.service';
import { PlatformConfigService } from '../common/platform-config.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  RoutingService,
  RoutingAttempt,
  RoutingSink,
} from '../orchestrator/execution/routing.service';
import { ToolsService } from './tools.service';
import { VideoAdapter } from './video.adapter';
import { ChatAdapter } from '../orchestrator/execution/chat.adapter';

export interface ToolOutputItem {
  kind: 'image' | 'video' | 'file' | 'text';
  dataUrl?: string;
  url?: string;
  mime?: string;
  width?: number;
  height?: number;
  text?: string;
}

export interface ToolRunResult {
  tool: string;
  items: ToolOutputItem[];
  providerUsed: string | null;
  modelUsed: string | null;
  costUsd: number;
  attempts: RoutingAttempt[];
  tokensIn?: number;
  tokensOut?: number;
}

export interface ToolRunRequest {
  toolKey: string;
  nodeId: string;
  config: Record<string, unknown>;
  payload: Record<string, unknown>;
  userId?: string | null;
  sink: RoutingSink;
}

const PROMPT_STYLE: Record<string, string> = {
  icon: 'minimal flat vector app icon design, bold simple shapes, high contrast, vibrant colors, centered composition',
  logo: 'professional logo design, clean minimal vector mark, distinctive symbol, centered on solid background',
  object3d:
    'high-quality 3D render, isometric product view, soft studio lighting, detailed materials, octane render',
};

const TRANSFORM_MODEL_PATTERNS: Record<string, RegExp> = {
  backgroundRemover:
    /rembg|remove[_-]?background|background[_-]?remov|deeplab/i,
  upscaler: /esrgan|upscal|realesrgan|srmd|gfpgan/i,
};

function toDataUrl(b64: string): string {
  if (!b64) return '';
  return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
}

@Injectable()
export class ToolRunnerService {
  private readonly logger = new Logger(ToolRunnerService.name);

  constructor(
    private readonly tools: ToolsService,
    private readonly routing: RoutingService,
    private readonly video: VideoAdapter,
    private readonly chat: ChatAdapter,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: PlatformConfigService,
  ) {}

  async execute(req: ToolRunRequest): Promise<ToolRunResult> {
    const tool = await this.tools.findByKey(req.toolKey);
    if (!tool) {
      throw new Error(
        `Tool '${req.toolKey}' is not registered — enable it in Admin → Tools`,
      );
    }
    if (!tool.enabled) {
      throw new Error(`Tool '${tool.name}' is disabled in Admin → Tools`);
    }

    switch (req.toolKey) {
      case 'image':
      case 'icon':
      case 'logo':
      case 'object3d':
        return this.runImage(tool, req);
      case 'video':
        return this.runVideo(tool, req);
      case 'backgroundRemover':
      case 'upscaler':
        return this.runTransform(tool, req);
      case 'textGeneration':
        return this.runText(tool, req);
      case 'summarization':
        return this.runText(tool, req, {
          systemPrompt:
            'You are a summarization engine. Summarize the text the user provides, keeping the key facts. Respond with the summary only.',
          maxTokens: 300,
          temperature: 0.3,
        });
      case 'translation':
        return this.runText(tool, req, {
          systemPrompt: `You are a translation engine. Translate the text the user provides into ${String(req.config.targetLanguage ?? 'English')}. Respond with the translation only.`,
          maxTokens: 600,
          temperature: 0.2,
        });
      default:
        throw new Error(`No runtime handler for tool '${req.toolKey}'`);
    }
  }

  private async resolveChain(
    tool: Capability,
    req: ToolRunRequest,
  ): Promise<Array<{ provider: string; model: string }>> {
    const maxDepth = await this.config.getNumber('routing.maxChainDepth', 4);
    const config = req.config;

    const nodeChain = Array.isArray(config.chain)
      ? (config.chain as Array<Record<string, unknown>>)
      : [];
    if (nodeChain.length) {
      const steps = nodeChain
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
        req.sink.log(
          'info',
          tool.name,
          `routing variable '${variable}' → ${steps.map((s) => s.provider + '/' + s.model).join(' → ')}`,
        );
        return steps;
      }
    }

    const binding = await this.tools.resolveBinding(tool.key, undefined);
    if (binding.length) {
      req.sink.log(
        'info',
        tool.name,
        `tool default binding → ${binding.map((s) => s.provider + '/' + s.model).join(' → ')}`,
      );
      return binding.slice(0, maxDepth);
    }

    const provider = String(config.provider ?? '');
    const model = String(config.model ?? '');
    if (provider.trim() && model.trim()) {
      return [{ provider: provider.trim(), model: model.trim() }];
    }
    return [];
  }

  private aliasFor(provider: string): string {
    const p = provider.trim().toLowerCase();
    if (['flux', 'ideogram'].includes(p)) return 'pollinations';
    return p;
  }

  private async findProvider(name: string): Promise<AiProvider | null> {
    return this.prisma.aiProvider.findUnique({
      where: { name: this.aliasFor(name) },
    });
  }

  private async resolveKey(provider: AiProvider): Promise<string | null> {
    return provider.apiKeyEnc ? this.crypto.decrypt(provider.apiKeyEnc) : null;
  }

  // ── Image family (image / icon / logo / object3d) ──────────────

  private async runImage(
    tool: Capability,
    req: ToolRunRequest,
  ): Promise<ToolRunResult> {
    const chain = await this.resolveChain(tool, req);
    if (!chain.length) {
      throw new Error(
        `'${tool.name}' has no provider chain — bind providers/models in the node chain, a routing variable, or the tool default binding`,
      );
    }

    const config = req.config;
    const rawPrompt = String(req.payload.prompt ?? config.prompt ?? '');
    if (!rawPrompt.trim()) {
      throw new Error(`'${tool.name}' needs a prompt`);
    }
    const style = PROMPT_STYLE[tool.key];
    const prompt = style ? `${rawPrompt.trim()}, ${style}` : rawPrompt.trim();

    const size = this.parseSize(String(config.size ?? '1024x1024'));
    const count = Math.min(
      4,
      Math.max(1, Number(config.count ?? req.payload.imageCount ?? 1)),
    );

    const result = await this.routing.routeImage(
      {
        nodeId: req.nodeId,
        chain,
        prompt,
        negativePrompt: config.negativePrompt
          ? String(config.negativePrompt)
          : undefined,
        imageCount: count,
        size,
        seed: config.seed ? Number(config.seed) : undefined,
      },
      req.sink,
      { userId: req.userId },
    );

    return {
      tool: tool.key,
      items: result.images.map((image) => ({
        kind: 'image' as const,
        dataUrl: toDataUrl(image.b64),
        width: image.width,
        height: image.height,
      })),
      providerUsed: result.providerUsed,
      modelUsed: result.modelUsed,
      costUsd: result.costUsd,
      attempts: result.attempts,
    };
  }

  // ── Video ──────────────────────────────────────────────────────

  private async runVideo(
    tool: Capability,
    req: ToolRunRequest,
  ): Promise<ToolRunResult> {
    const chain = await this.resolveChain(tool, req);
    if (!chain.length) {
      throw new Error(
        `'${tool.name}' has no provider chain — bind a video-capable provider/model (e.g. fal + minimax-video-01) in the node chain or tool default binding`,
      );
    }

    const config = req.config;
    const prompt = String(req.payload.prompt ?? config.prompt ?? '');
    if (!prompt.trim()) {
      throw new Error(`'${tool.name}' needs a prompt`);
    }
    const attempts: RoutingAttempt[] = [];
    const lastErrors: string[] = [];

    for (const step of chain) {
      const attemptNumber = attempts.length + 1;
      const row = await this.findProvider(step.provider);
      if (!row || !row.enabled) {
        attempts.push(
          this.attempt(
            step,
            attemptNumber,
            'skipped',
            0,
            `provider '${step.provider}' missing or disabled`,
          ),
        );
        req.sink.log(
          'warn',
          tool.name,
          `↷ skipped ${step.provider} (disabled)`,
        );
        continue;
      }
      if (!row.supportsVideo) {
        attempts.push(
          this.attempt(
            step,
            attemptNumber,
            'skipped',
            0,
            `provider '${step.provider}' has no video capability`,
          ),
        );
        req.sink.log(
          'warn',
          tool.name,
          `↷ skipped ${step.provider} (no video capability)`,
        );
        continue;
      }
      const startedAt = Date.now();
      req.sink.log(
        'info',
        tool.name,
        `→ video attempt ${attemptNumber}: ${step.provider}/${step.model}`,
      );
      try {
        // Use the provider's best credential (pool) when configured.
        const best = await this.routing.bestCredentialFor(step.provider);
        const rowForCall: AiProvider =
          best.apiKeyEnc !== null && best.label !== null
            ? { ...row, apiKeyEnc: best.apiKeyEnc }
            : row;
        const videoResult = await this.video.generate(rowForCall, {
          prompt,
          model: step.model,
          duration: Number(config.duration ?? 5),
        });
        const latencyMs = Date.now() - startedAt;
        attempts.push(this.attempt(step, attemptNumber, 'success', latencyMs));
        req.sink.log(
          'success',
          tool.name,
          `✔ video via ${step.provider}/${step.model} in ${latencyMs}ms${best.label ? ` via '${best.label}'` : ''}`,
        );
        return {
          tool: tool.key,
          items: [
            { kind: 'video', url: videoResult.url, mime: videoResult.mime },
          ],
          providerUsed: step.provider,
          modelUsed: step.model,
          costUsd: 0,
          attempts,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push(
          this.attempt(
            step,
            attemptNumber,
            'error',
            Date.now() - startedAt,
            message,
          ),
        );
        req.sink.log(
          'error',
          tool.name,
          `✗ ${step.provider}/${step.model}: ${message.slice(0, 200)}`,
        );
        lastErrors.push(message);
      }
    }

    throw new Error(
      `Video failed on all binding steps: ${(lastErrors.join(' | ') || 'no usable providers').slice(0, 300)}`,
    );
  }

  // ── Text runtimes (text generation / summarization / translation) ──

  private async runText(
    tool: Capability,
    req: ToolRunRequest,
    overrides?: { systemPrompt?: string; maxTokens?: number; temperature?: number },
  ): Promise<ToolRunResult> {
    const chain = await this.resolveChain(tool, req);
    if (!chain.length) {
      throw new Error(
        `'${tool.name}' has no provider chain — bind a text-capable provider/model (e.g. Pollinations) in the node chain or tool default binding`,
      );
    }

    const config = req.config;
    const prompt = String(
      req.payload.inputText ?? req.payload.prompt ?? config.prompt ?? '',
    );
    if (!prompt.trim()) {
      throw new Error(`'${tool.name}' needs a prompt`);
    }
    const attempts: RoutingAttempt[] = [];
    const lastErrors: string[] = [];

    for (const step of chain) {
      const attemptNumber = attempts.length + 1;
      const row = await this.findProvider(step.provider);
      if (!row || !row.enabled) {
        attempts.push(
          this.attempt(
            step,
            attemptNumber,
            'skipped',
            0,
            `provider '${step.provider}' missing or disabled`,
          ),
        );
        req.sink.log(
          'warn',
          tool.name,
          `↷ skipped ${step.provider} (disabled)`,
        );
        continue;
      }
      const startedAt = Date.now();
      req.sink.log(
        'info',
        tool.name,
        `→ text attempt ${attemptNumber}: ${step.provider}/${step.model}`,
      );
      try {
        const best = await this.routing.bestCredentialFor(step.provider);
        const apiKey = best.apiKeyEnc ? this.crypto.decrypt(best.apiKeyEnc) : null;
        const result = await this.chat.call({
          provider: step.provider,
          model: step.model,
          prompt,
          systemPrompt: overrides?.systemPrompt ?? (config.systemPrompt ? String(config.systemPrompt) : undefined),
          temperature: Number(overrides?.temperature ?? config.temperature ?? 0.7),
          maxTokens: Number(overrides?.maxTokens ?? config.maxTokens ?? 1024),
          apiKey,
        });
        const latencyMs = Date.now() - startedAt;
        attempts.push(this.attempt(step, attemptNumber, 'success', latencyMs));
        req.sink.log(
          'success',
          tool.name,
          `✔ text via ${step.provider}/${result.model} in ${latencyMs}ms (${result.tokensIn}+${result.tokensOut} tokens)`,
        );
        return {
          tool: tool.key,
          items: [{ kind: 'text', text: result.text }],
          providerUsed: step.provider,
          modelUsed: result.model,
          costUsd: 0,
          attempts,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push(
          this.attempt(
            step,
            attemptNumber,
            'error',
            Date.now() - startedAt,
            message,
          ),
        );
        req.sink.log(
          'error',
          tool.name,
          `✗ ${step.provider}/${step.model}: ${message.slice(0, 200)}`,
        );
        lastErrors.push(message);
      }
    }

    throw new Error(
      `Text failed on all binding steps: ${(lastErrors.join(' | ') || 'no usable providers').slice(0, 300)}`,
    );
  }

  // ── Image transforms (background remover / upscaler) ───────────

  private async runTransform(
    tool: Capability,
    req: ToolRunRequest,
  ): Promise<ToolRunResult> {
    const config = req.config;
    const input = String(
      config.image ?? req.payload.image ?? req.payload.inputImage ?? '',
    );
    if (!input || !input.startsWith('data:image')) {
      throw new Error(
        `'${tool.name}' needs an input image (data URL) — pass one via the node config, the workflow payload, or upload on the site`,
      );
    }

    let chain = await this.resolveChain(tool, req);
    if (!chain.length) {
      const auto = await this.findTransformModel(tool.key);
      if (auto) chain = [auto];
    }
    if (!chain.length) {
      throw new Error(
        `'${tool.name}' has no bound model — add a step (e.g. replicate + rembg) in the node chain or tool default binding`,
      );
    }

    const attempts: RoutingAttempt[] = [];
    const lastErrors: string[] = [];
    const mime = input.match(/^data:([^;,]+)/)?.[1] ?? 'image/png';

    for (const step of chain) {
      const attemptNumber = attempts.length + 1;
      const row = await this.findProvider(step.provider);
      if (!row || !row.enabled || !row.imageEndpoint) {
        attempts.push(
          this.attempt(
            step,
            attemptNumber,
            'skipped',
            0,
            `provider '${step.provider}' missing, disabled, or has no image endpoint`,
          ),
        );
        req.sink.log('warn', tool.name, `↷ skipped ${step.provider}`);
        continue;
      }
      const apiKey = await this.resolveKey(row);
      const startedAt = Date.now();
      try {
        const base = row.baseUrl.replace(/\/+$/, '');
        const body =
          tool.key === 'upscaler'
            ? { input: { image: input, scale: 2 } }
            : { input: { image: input } };
        const response = await fetch(`${base}${row.imageEndpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90_000),
        });
        if (!response.ok) {
          const detail = (await response.text().catch(() => '')).slice(0, 300);
          throw new Error(`Transform failed (${response.status}): ${detail}`);
        }
        // Read the body once — endpoints return JSON (replicate-style URLs) or
        // raw image bytes (some image-capable providers) depending on the model.
        const buffer = Buffer.from(await response.arrayBuffer());
        let data: any = null;
        try {
          data = JSON.parse(buffer.toString('utf8'));
        } catch {
          const contentType =
            response.headers.get('content-type') ?? 'image/png';
          if (!contentType.toLowerCase().startsWith('image/')) {
            throw new Error(
              `Transform returned unparseable response (${contentType})`,
            );
          }
          const latencyMs = Date.now() - startedAt;
          attempts.push(
            this.attempt(step, attemptNumber, 'success', latencyMs),
          );
          req.sink.log(
            'success',
            tool.name,
            `✔ ${tool.name} via ${step.provider}/${step.model} in ${latencyMs}ms (inline image)`,
          );
          return {
            tool: tool.key,
            items: [
              {
                kind: 'image',
                dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
                mime: contentType,
              },
            ],
            providerUsed: step.provider,
            modelUsed: step.model,
            costUsd: 0,
            attempts,
          };
        }
        const outputUrl = this.extractOutputUrl(data);
        const latencyMs = Date.now() - startedAt;
        attempts.push(this.attempt(step, attemptNumber, 'success', latencyMs));
        req.sink.log(
          'success',
          tool.name,
          `✔ ${tool.name} via ${step.provider}/${step.model} in ${latencyMs}ms`,
        );
        return {
          tool: tool.key,
          items: [{ kind: 'image', url: outputUrl, mime }],
          providerUsed: step.provider,
          modelUsed: step.model,
          costUsd: 0,
          attempts,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push(
          this.attempt(
            step,
            attemptNumber,
            'error',
            Date.now() - startedAt,
            message,
          ),
        );
        req.sink.log(
          'error',
          tool.name,
          `✗ ${step.provider}/${step.model}: ${message.slice(0, 200)}`,
        );
        lastErrors.push(message);
      }
    }

    throw new Error(
      `Transform failed on all steps: ${(lastErrors.join(' | ') || 'no usable providers').slice(0, 300)}`,
    );
  }

  private async findTransformModel(
    toolKey: string,
  ): Promise<{ provider: string; model: string } | null> {
    const pattern = TRANSFORM_MODEL_PATTERNS[toolKey];
    if (!pattern) return null;
    const candidates = await this.prisma.aiModel.findMany({
      where: { enabled: true },
      include: { provider: true },
      take: 50,
    });
    const hit = candidates.find((m) => pattern.test(m.internalName));
    if (!hit) return null;
    return { provider: hit.provider.name, model: hit.internalName };
  }

  private extractOutputUrl(data: any): string {
    if (typeof data === 'string') return data;
    const candidates = [
      data.url,
      data.image_url,
      data.output_url,
      data.output,
      data.data,
      data.video_url,
      data.result,
      Array.isArray(data.output) ? data.output[0] : null,
      Array.isArray(data.urls) ? data.urls[0] : null,
      data.input?.image_url,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') return candidate;
      if (candidate && typeof candidate === 'object') {
        const nested = this.extractOutputUrl(candidate);
        if (nested) return nested;
      }
    }
    throw new Error(
      `Transform completed but no output url found in response: ${JSON.stringify(data).slice(0, 300)}`,
    );
  }

  private attempt(
    step: { provider: string; model: string },
    attempt: number,
    status: RoutingAttempt['status'],
    latencyMs: number,
    error?: string,
  ): RoutingAttempt {
    return {
      nodeId: '',
      provider: step.provider,
      model: step.model,
      attempt,
      status,
      latencyMs,
      error,
      costUsd: 0,
    };
  }

  private parseSize(size: string): { width: number; height: number } {
    const match = size.toLowerCase().match(/(\d+)\s*x\s*(\d+)/);
    if (!match) return { width: 1024, height: 1024 };
    return { width: Number(match[1]), height: Number(match[2]) };
  }
}
