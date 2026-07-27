// apps/api/src/main.ts
// Точка входа API Dastarhan.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true });

  app.use(helmet({ contentSecurityPolicy: false }));
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,            // выкидываем поля, которых нет в DTO
    forbidNonWhitelisted: true, // и сообщаем об этом
    transform: true,            // приводим типы (строка "5" → число 5)
    transformOptions: { enableImplicitConversion: true },
  }));

  // Касса шлёт пачки событий из офлайн-очереди — стандартного лимита мало
  app.useBodyParser('json', { limit: '5mb' });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  const log = new Logger('Dastarhan');
  log.log(`API слушает http://localhost:${port}/api/v1`);
  log.log(`Проверка: curl http://localhost:${port}/api/v1/health`);
}

bootstrap().catch((e) => {
  console.error('Не удалось запустить API:', e);
  process.exit(1);
});
