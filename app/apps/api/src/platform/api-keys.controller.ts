// apps/api/src/platform/api-keys.controller.ts
// Ключи доступа к API для интеграторов.
//
// У iiko API открывается через партнёрскую программу с лицензией.
// Мы даём ключ владельцу сразу: его сайт, его данные, его решение.
// Но с ограничениями по правам и скорости — чужая ошибка не должна
// класть сервер остальным.
import {
  Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

/** Что можно разрешить интегратору. Гранулярно, а не «всё или ничего». */
export const API_SCOPES: Record<string, { label: string; risk: 'low' | 'medium' | 'high' }> = {
  'menu:read':     { label: 'Читать меню и цены',           risk: 'low' },
  'stock:read':    { label: 'Читать остатки',               risk: 'low' },
  'orders:create': { label: 'Создавать заказы',             risk: 'medium' },
  'orders:read':   { label: 'Читать заказы',                risk: 'medium' },
  'guests:read':   { label: 'Читать гостей',                risk: 'medium' },
  'guests:write':  { label: 'Изменять гостей и бонусы',     risk: 'high' },
  'reports:read':  { label: 'Читать отчёты',                risk: 'high' },
};

class KeyDto {
  @IsString() @Length(3, 60) name!: string;
  @IsArray() scopes!: string[];
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsInt() @Min(10) rateLimit?: number;
  @IsOptional() @IsInt() @Min(1) expiresInDays?: number;
}

@Controller('api-keys')
@UseGuards(JwtGuard, PermissionsGuard)
export class ApiKeysController {
  constructor(private prisma: PrismaService) {}

  /** Справочник прав — для экрана выдачи ключа. */
  @Get('scopes')
  @RequirePermission('admin.settings')
  scopes() {
    return {
      scopes: Object.entries(API_SCOPES).map(([key, v]) => ({ key, ...v })),
      // Подсказка по типовым случаям: владелец не разбирается
      // в правах, ему проще выбрать готовый набор
      presets: [
        {
          key: 'website',
          label: 'Сайт с меню',
          scopes: ['menu:read', 'stock:read'],
          hint: 'Только чтение — сайт показывает меню и стоп-лист',
        },
        {
          key: 'delivery',
          label: 'Приложение доставки',
          scopes: ['menu:read', 'stock:read', 'orders:create', 'orders:read'],
          hint: 'Может создавать заказы, но не видит выручку',
        },
        {
          key: 'loyalty',
          label: 'Программа лояльности',
          scopes: ['guests:read', 'guests:write', 'orders:read'],
          hint: 'Работает с гостями и бонусами',
        },
      ],
    };
  }

  /**
   * Создать ключ. Показываем его один раз — дальше только хеш.
   * Потерял ключ, значит выпускай новый: так безопаснее для всех.
   */
  @Post()
  @RequirePermission('admin.settings')
  async create(@Body() dto: KeyDto, @Req() req: any) {
    const unknown = dto.scopes.filter((s) => !API_SCOPES[s]);
    if (unknown.length) {
      throw new BadRequestException({
        code: 'UNKNOWN_SCOPE',
        message: `Неизвестные права: ${unknown.join(', ')}`,
      });
    }
    if (!dto.scopes.length) {
      throw new BadRequestException({
        code: 'NO_SCOPES',
        message: 'Выберите хотя бы одно право — ключ без прав бесполезен',
      });
    }

    // Ключ с понятным префиксом: видно в логах, что это наш
    const raw = `dstr_${randomBytes(24).toString('base64url')}`;
    const hash = createHash('sha256').update(raw).digest('hex');

    const expiresAt = dto.expiresInDays
      ? new Date(Date.now() + dto.expiresInDays * 86400_000)
      : null;

    const key = await this.prisma.apiKey.create({
      data: {
        accountId: req.user.acc,
        name: dto.name.trim(),
        keyHash: hash,
        keyPrefix: raw.slice(0, 12),
        scopes: dto.scopes,
        locationId: dto.locationId ?? null,
        rateLimit: dto.rateLimit ?? 60,
        expiresAt,
        createdBy: req.user.sub,
      },
    });

    const highRisk = dto.scopes.filter((s) => API_SCOPES[s]?.risk === 'high');

    return {
      keyId: key.id,
      name: key.name,
      // Единственный раз, когда ключ виден целиком
      key: raw,
      scopes: dto.scopes,
      expiresAt,
      warning: 'Сохраните ключ — второй раз он не покажется',
      riskNote: highRisk.length
        ? `Выданы права высокого риска: ${highRisk.map((s) => API_SCOPES[s].label.toLowerCase()).join(', ')}`
        : null,
    };
  }

  /** Список ключей с активностью — видно, кто пользуется, а кто забыт. */
  @Get()
  @RequirePermission('admin.settings')
  async list(@Req() req: any) {
    const keys = await this.prisma.apiKey.findMany({
      where: { accountId: req.user.acc },
      orderBy: { createdAt: 'desc' },
    });

    const now = Date.now();
    const out = [];
    for (const k of keys) {
      const calls24h = await this.prisma.apiCall.count({
        where: { keyId: k.id, at: { gte: new Date(now - 86400_000) } },
      });
      const errors24h = await this.prisma.apiCall.count({
        where: { keyId: k.id, at: { gte: new Date(now - 86400_000) }, status: { gte: 400 } },
      });

      const idleDays = k.lastUsedAt
        ? Math.floor((now - k.lastUsedAt.getTime()) / 86400_000) : null;

      out.push({
        id: k.id,
        name: k.name,
        prefix: k.keyPrefix + '...',
        scopes: k.scopes.map((s) => ({ key: s, label: API_SCOPES[s]?.label ?? s })),
        isActive: k.isActive,
        expiresAt: k.expiresAt,
        expired: k.expiresAt ? k.expiresAt.getTime() < now : false,
        lastUsedAt: k.lastUsedAt,
        idleDays,
        calls24h,
        errors24h,
        // Забытый ключ — дыра в безопасности. Никто им не пользуется,
        // но украсть его можно
        warning: idleDays !== null && idleDays > 60
          ? 'Не используется больше двух месяцев — отзовите'
          : k.lastUsedAt === null && (now - k.createdAt.getTime()) > 7 * 86400_000
          ? 'Ни разу не использован — возможно, интеграция не заработала'
          : errors24h > calls24h * 0.3 && calls24h > 10
          ? `Много ошибок: ${errors24h} из ${calls24h} — интегратор что-то делает не так`
          : null,
      });
    }
    return out;
  }

  /** Отозвать ключ — интеграция сломалась или партнёр ушёл. */
  @Delete(':id')
  @RequirePermission('admin.settings')
  async revoke(@Param('id') id: string, @Req() req: any) {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, accountId: req.user.acc },
    });
    if (!key) throw new NotFoundException({ code: 'KEY_NOT_FOUND' });

    // Не удаляем, а отключаем: журнал вызовов должен остаться
    // для разбора, если что-то утекло
    await this.prisma.apiKey.update({
      where: { id }, data: { isActive: false },
    });

    return {
      ok: true,
      name: key.name,
      hint: 'Ключ отключён. Журнал вызовов сохранён для разбора',
    };
  }

  /** Журнал вызовов ключа: что делал интегратор. */
  @Get(':id/calls')
  @RequirePermission('admin.settings')
  async calls(@Param('id') id: string, @Query('hours') hours = '24') {
    const from = new Date(Date.now() - Number(hours) * 3600_000);

    const rows = await this.prisma.apiCall.findMany({
      where: { keyId: id, at: { gte: from } },
      orderBy: { at: 'desc' },
      take: 200,
    });

    const byPath = new Map<string, { count: number; errors: number; totalMs: number }>();
    for (const r of rows) {
      const cur = byPath.get(r.path) ?? { count: 0, errors: 0, totalMs: 0 };
      cur.count++;
      if (r.status >= 400) cur.errors++;
      cur.totalMs += r.durationMs;
      byPath.set(r.path, cur);
    }

    return {
      periodHours: Number(hours),
      total: rows.length,
      errors: rows.filter((r) => r.status >= 400).length,
      byPath: [...byPath.entries()].map(([path, v]) => ({
        path,
        count: v.count,
        errors: v.errors,
        avgMs: Math.round(v.totalMs / v.count),
        // Медленный эндпоинт у интегратора — часто его же ошибка:
        // тянет весь каталог вместо страницы
        slow: v.totalMs / v.count > 1000,
      })).sort((a, b) => b.count - a.count),
      recent: rows.slice(0, 50).map((r) => ({
        at: r.at, method: r.method, path: r.path,
        status: r.status, ms: r.durationMs,
      })),
    };
  }
}
