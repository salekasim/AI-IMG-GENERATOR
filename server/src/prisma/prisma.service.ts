import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const MAX_ATTEMPTS = 10;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this.$connect();
        this.logger.log('database connected');
        return;
      } catch (error) {
        if (attempt === MAX_ATTEMPTS) {
          this.logger.error(
            `database connection failed after ${MAX_ATTEMPTS} attempts`,
          );
          throw error;
        }
        const delayMs = Math.min(1000 * 2 ** (attempt - 1), 15000);
        this.logger.warn(
          `database connection attempt ${attempt}/${MAX_ATTEMPTS} failed — retrying in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
