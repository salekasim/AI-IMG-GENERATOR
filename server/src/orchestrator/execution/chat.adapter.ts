import { Injectable } from '@nestjs/common';

export interface ChatCallOptions {
  provider: string;
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string | null;
}

export interface ChatCallResult {
  text: string;
  model: string;
  provider: string;
  tokensIn: number;
  tokensOut: number;
}

const POLLINATIONS_CHAT_BASE = 'https://text.pollinations.ai/openai';

const BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  together: 'https://api.together.xyz/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  anthropic: 'https://api.anthropic.com/v1',
  pollinations: POLLINATIONS_CHAT_BASE,
};

const POLLINATIONS_MODELS = [
  'openai',
  'mistral',
  'claude',
  'llama',
  'gemini',
  'deepseek',
  'qwen',
  'kimi',
  'command-r',
];

// Pollinations free tier is IP-throttled and occasionally returns transient
// 402/429/5xx responses — retry these server-side so graph runs are resilient.
const RETRYABLE_STATUS = new Set([402, 408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 2500];

class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

class UpstreamTimeout extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamTimeout';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase().replace(/\s+/g, '');
}

function modelForPollinations(model: string): string {
  const id = model.trim().toLowerCase();
  if (POLLINATIONS_MODELS.includes(id)) return id;
  if (id.includes('flash') || id.includes('gemini')) return 'gemini';
  if (
    id.includes('claude') ||
    id.includes('sonnet') ||
    id.includes('opus') ||
    id.includes('haiku')
  )
    return 'claude';
  if (id.includes('llama')) return 'llama';
  if (id.includes('deepseek')) return 'deepseek';
  if (id.includes('qwen')) return 'qwen';
  if (id.includes('mistral')) return 'mistral';
  return 'openai';
}

const estimateTokens = (text: string): number =>
  Math.max(1, Math.ceil(text.length / 4));

@Injectable()
export class ChatAdapter {
  async call(options: ChatCallOptions): Promise<ChatCallResult> {
    const provider = normalizeProvider(options.provider);
    const messages: Array<{ role: string; content: string }> = [];
    if (options.systemPrompt?.trim()) {
      messages.push({ role: 'system', content: options.systemPrompt.trim() });
    }
    messages.push({ role: 'user', content: options.prompt });

    const baseUrl = BASE_URLS[provider];
    if (!baseUrl) {
      throw new Error(
        `Chat provider '${options.provider}' is not supported by the M2 executor`,
      );
    }

    const apiKey = options.apiKey?.trim() || null;
    if (provider !== 'pollinations' && !apiKey) {
      throw new Error(
        `No API key configured for chat provider '${options.provider}' — add one in Providers or on the node`,
      );
    }

    const model =
      provider === 'pollinations'
        ? modelForPollinations(options.model)
        : options.model.trim() || undefined;

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 1024,
    };

    const attempts = provider === 'pollinations' ? MAX_ATTEMPTS : 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.post(baseUrl, body, model, apiKey, options, provider);
      } catch (error) {
        lastError = error;
        const retryable =
          (error instanceof UpstreamError &&
            RETRYABLE_STATUS.has(error.status)) ||
          error instanceof UpstreamTimeout;
        if (!retryable || attempt >= attempts) throw error;
        await sleep(BACKOFF_MS[attempt - 1] ?? 3000);
      }
    }
    throw lastError;
  }

  private async post(
    baseUrl: string,
    body: Record<string, unknown>,
    model: string | undefined,
    apiKey: string | null,
    options: ChatCallOptions,
    provider: string,
  ): Promise<ChatCallResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Pollinations is keyless by design — it 402-rejects authenticated
          // requests (legacy text API deprecation).
          ...(apiKey && provider !== 'pollinations'
            ? { Authorization: `Bearer ${apiKey}` }
            : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        throw new UpstreamError(
          `Chat ${provider}/${model} failed with ${response.status}: ${detail}`.trim(),
          response.status,
        );
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content?.trim() ?? '';
      const tokensIn =
        data.usage?.prompt_tokens ?? estimateTokens(options.prompt);
      const tokensOut = data.usage?.completion_tokens ?? estimateTokens(text);

      return {
        text,
        model: data.model ?? model ?? 'openai',
        provider: provider === 'pollinations' ? 'pollinations' : provider,
        tokensIn,
        tokensOut,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new UpstreamTimeout(
          `Chat ${provider}/${model} timed out after 30s`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
