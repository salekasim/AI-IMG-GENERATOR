import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ChainStep } from './routing.service';

export interface FailoverRequest {
  chain: ChainStep[];
  failedIndex: number;
  provider: string;
  model: string;
}

/**
 * Evaluates enabled failover rules after a routing step fails and returns
 * chain steps to inject right after the failed step (switch_provider /
 * switch_model). Rules with action disable_provider are applied as a real
 * side effect, matching the configured intent.
 */
@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async applyFailover(req: FailoverRequest): Promise<ChainStep[]> {
    const rules = await this.prisma.routingRule.findMany({
      where: {
        enabled: true,
        trigger: { in: ['provider_failed', 'image_request'] },
      },
      orderBy: { priority: 'asc' },
      include: {
        targetProvider: true,
        targetModel: true,
      },
    });
    if (!rules.length) return [];

    const inserts: ChainStep[] = [];
    for (const rule of rules) {
      if (rule.trigger === 'image_request' && rule.action !== 'switch_provider')
        continue;

      if (rule.action === 'disable_provider') {
        await this.prisma.aiProvider
          .update({ where: { name: req.provider }, data: { enabled: false } })
          .then(() =>
            this.logger.warn(
              `rule '${rule.name}' disabled provider ${req.provider}`,
            ),
          )
          .catch(() => undefined);
        continue;
      }

      if (rule.action === 'switch_model' && rule.targetModel) {
        const already = req.chain[req.failedIndex + 1];
        if (
          already?.provider === req.provider &&
          already.model === rule.targetModel.internalName
        )
          continue;
        inserts.push({
          provider: req.provider,
          model: rule.targetModel.internalName,
        });
        continue;
      }

      if (rule.action === 'switch_provider' && rule.targetProvider) {
        const target = rule.targetProvider;
        if (!target.enabled) continue;
        if (req.chain[req.failedIndex + 1]?.provider === target.name) continue;
        const model =
          rule.targetModel?.internalName ??
          (await this.firstModel(target.name));
        if (!model) continue;
        inserts.push({ provider: target.name, model });
      }
    }

    if (inserts.length) {
      this.logger.log(
        `failover for ${req.provider}/${req.model}: ${inserts.map((s) => s.provider + '/' + s.model).join(', ')}`,
      );
    }
    return inserts;
  }

  private async firstModel(providerName: string): Promise<string | null> {
    const provider = await this.prisma.aiProvider.findUnique({
      where: { name: providerName },
      include: {
        models: {
          where: { enabled: true, hidden: false },
          orderBy: { priority: 'asc' },
          take: 1,
        },
      },
    });
    return provider?.models[0]?.internalName ?? null;
  }
}
