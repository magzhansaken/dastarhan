// /health — для Caddy healthcheck и внешнего мониторинга (UptimeRobot)
import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}
  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`; // живость БД
    return { ok: true, ts: new Date().toISOString() };
  }
}
