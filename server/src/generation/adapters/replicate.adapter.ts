import { Injectable } from '@nestjs/common';
import { AiProvider } from '@prisma/client';
import { GenerationImage, GenerationRequest, ProviderAdapter } from './provider.adapter';
import { CryptoService } from '../../common/crypto.service';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string[];
  error?: string;
}

/** Replicate — create prediction, poll until succeeded, download outputs. */
@Injectable()
export class ReplicateAdapter implements ProviderAdapter {
  readonly providerName = 'replicate';
  readonly costPerImage = 0.003;

  constructor(private readonly crypto: CryptoService) {}

  async generate(
    provider: AiProvider,
    request: GenerationRequest,
  ): Promise<GenerationImage[]> {
    const apiKey = provider.apiKeyEnc
      ? this.crypto.decrypt(provider.apiKeyEnc)
      : null;
    if (!apiKey) {
      throw new Error('Replicate API key is not configured');
    }
    const model = request.model ?? 'black-forest-labs/flux-schnell';
    const base = provider.baseUrl.replace(/\/+$/, '');
    const [owner, modelName] = model.split('/');
    if (!owner || !modelName) {
      throw new Error(`Invalid Replicate model '${model}' — expected owner/name`);
    }

    const createRes = await fetch(
      `${base}/models/${owner}/${modelName}/predictions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          input: {
            prompt: request.prompt,
            width: request.size.width,
            height: request.size.height,
            ...(request.seed ? { seed: request.seed } : {}),
          },
        }),
        signal: AbortSignal.timeout(provider.timeoutMs || 120000),
      },
    );
    if (!createRes.ok) {
      const detail = await createRes.text().catch(() => '');
      throw new Error(`Replicate create failed with ${createRes.status}: ${detail}`.slice(0, 500));
    }
    const created = (await createRes.json()) as ReplicatePrediction;

    const deadline = Date.now() + (provider.timeoutMs || 120000);
    let prediction = created;
    while (Date.now() < deadline) {
      if (prediction.status === 'succeeded') break;
      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        throw new Error(`Replicate prediction failed: ${prediction.error ?? prediction.status}`);
      }
      await sleep(1000);
      const pollRes = await fetch(`${base}/predictions/${prediction.id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30000),
      });
      if (!pollRes.ok) {
        throw new Error(`Replicate poll failed with ${pollRes.status}`);
      }
      prediction = (await pollRes.json()) as ReplicatePrediction;
    }
    if (prediction.status !== 'succeeded' || !prediction.output?.length) {
      throw new Error(`Replicate prediction timed out or produced no output`);
    }

    const images: GenerationImage[] = [];
    for (const url of prediction.output.slice(0, request.imageCount)) {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) {
        throw new Error(`Replicate output download failed with ${res.status}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      images.push({
        b64: buffer.toString('base64'),
        width: request.size.width,
        height: request.size.height,
      });
    }
    return images;
  }
}
