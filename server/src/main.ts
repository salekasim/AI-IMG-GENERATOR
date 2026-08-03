import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { assertProductionSecrets } from './common/env.util';

async function bootstrap() {
  assertProductionSecrets(process.env);

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');

  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors(
    origins.length > 0
      ? {
          origin: origins,
          credentials: true,
          methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
          allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
        }
      : undefined,
  );

  app.use(helmet());
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ limit: '5mb', extended: true }));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`Intellix API ready at http://localhost:${port}/v1`);
}
void bootstrap();
