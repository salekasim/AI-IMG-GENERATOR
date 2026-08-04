import { Injectable, Logger } from '@nestjs/common';
import { AiProvider } from '@prisma/client';

export interface VideoRequest {
  prompt: string;
  model: string;
  duration?: number;
}

export interface VideoResult {
  url: string;
  mime: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Async-job video generation supporting the two dominant REST patterns:
 *  - fal.ai style: submit → poll {baseUrl}/requests/{id}/status → fetch result
 *  - replicate style: submit /predictions → poll returned status_url → result
 * Providers are resolved by name at runtime; a keyless pollinations has no
 * video endpoint, so video tools only light up after a video-capable provider
 * (fal, runway, replicate + model) is configured in Admin → Providers.
 */
@Injectable()
export class VideoAdapter {
  private readonly logger = new Logger(VideoAdapter.name);

  async generate(
    provider: AiProvider,
    req: VideoRequest,
  ): Promise<VideoResult> {
    const apiKey = provider.apiKeyEnc ?? null;
    if (!apiKey) {
      throw new Error(
        `Video provider '${provider.name}' has no API key configured — add it in Admin → Providers`,
      );
    }
    if (!provider.supportsVideo) {
      throw new Error(`Provider '${provider.name}' does not support video`);
    }

    const base = provider.baseUrl.replace(/\/+$/, '');
    const model = req.model.trim();
    if (!model) {
      throw new Error(
        `Video node has no model — bind a video model (e.g. fal / minimax-video-01) in the chain`,
      );
    }
    const duration = Math.min(20, Math.max(2, req.duration ?? 5));

    if (provider.name === 'replicate') {
      return this.runReplicate(provider, base, apiKey, model, req.prompt);
    }

    // fal-style flow (fal, runway via fal, cloudflare)
    const submitUrl = `${base}/${model}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let submitted: any;
    try {
      const res = await fetch(submitUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Key ${apiKey}`,
        },
        body: JSON.stringify({
          prompt: req.prompt,
          duration,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`Video submit failed (${res.status}): ${detail}`);
      }
      submitted = await res.json();
    } finally {
      clearTimeout(timer);
    }

    const requestId = submitted.request_id ?? submitted.id;
    if (!requestId) {
      throw new Error(
        `Video provider returned no request id: ${JSON.stringify(submitted).slice(0, 200)}`,
      );
    }

    const queueBase = submitted.url ?? `${base.replace('/run', '/queue')}`;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 300_000) {
      await sleep(3000);
      const statusRes = await fetch(
        `${queueBase}/requests/${requestId}/status`,
        {
          headers: { Authorization: `Key ${apiKey}` },
        },
      );
      if (!statusRes.ok) continue;
      const status = await statusRes.json();
      if (status.status === 'COMPLETED') {
        const resultRes = await fetch(`${queueBase}/requests/${requestId}`, {
          headers: { Authorization: `Key ${apiKey}` },
        });
        if (!resultRes.ok) {
          throw new Error(`Video result fetch failed (${resultRes.status})`);
        }
        const result = await resultRes.json();
        const url = this.extractUrl(result);
        if (!url) {
          throw new Error(
            `Video completed but no output url found: ${JSON.stringify(result).slice(0, 300)}`,
          );
        }
        return { url, mime: 'video/mp4' };
      }
      if (status.status === 'FAILED' || status.status === 'ERROR') {
        throw new Error(
          `Video generation failed: ${status.error ?? status.status}`,
        );
      }
    }
    throw new Error('Video generation timed out after 5 minutes');
  }

  private async runReplicate(
    provider: AiProvider,
    base: string,
    apiKey: string,
    version: string,
    prompt: string,
  ): Promise<VideoResult> {
    const res = await fetch(`${base}/predictions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ version, input: { prompt } }),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`Replicate submit failed (${res.status}): ${detail}`);
    }
    const prediction = await res.json();
    const pollUrl: string | undefined =
      prediction.urls?.get ?? prediction.status_url;
    if (!pollUrl) {
      throw new Error('Replicate returned no polling url');
    }
    const pollStart = Date.now();
    while (Date.now() - pollStart < 300_000) {
      await sleep(3000);
      const pollRes = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!pollRes.ok) continue;
      const current = await pollRes.json();
      if (current.status === 'succeeded') {
        const url = this.extractUrl(current.output ?? current);
        if (!url) {
          throw new Error(`Replicate succeeded but no output url found`);
        }
        return { url, mime: 'video/mp4' };
      }
      if (current.status === 'failed' || current.status === 'canceled') {
        throw new Error(`Replicate failed: ${current.error ?? current.status}`);
      }
    }
    throw new Error('Replicate video generation timed out');
  }

  private extractUrl(output: unknown): string | null {
    if (typeof output === 'string') return output;
    if (Array.isArray(output)) {
      for (const entry of output) {
        const url = this.extractUrl(entry);
        if (url) return url;
      }
      return null;
    }
    if (output && typeof output === 'object') {
      const obj = output as Record<string, unknown>;
      const candidates = [
        obj.video,
        obj.url,
        obj.video_url,
        obj.mp4,
        obj.output,
        (obj as any).video?.url,
        (obj as any).data?.url,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === 'string') return candidate;
        const nested = this.extractUrl(candidate);
        if (nested) return nested;
      }
    }
    return null;
  }
}
