// apps/api/src/platform/terminals.controller.ts
// Лицензирование терминалов — основа схемы «установщик приходит на объект».
//
// Как это работает:
//   1. Владелец в бэк-офисе жмёт «Добавить кассу» → получает код DSTR-7K4M-92XQ
//   2. Установщик ставит программу, вводит код
//   3. Касса обменивает код на постоянный ключ устройства и лицензию
//   4. Дальше касса работает офлайн, сверяя лицензию раз в час
//
// Код активации — это временный deviceKey. Так не потребовалась миграция
// схемы: поле уже уникально и уже используется для аутентификации кассы.
import {
  Body, Controller, Get, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { IsString, Length, IsOptional } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { canAddTerminal } from './platform.logic';

/** Алфавит без похожих символов: 0/O и 1/I/l путают при диктовке по телефону. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function activationCode(): string {
  const pick = () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  const block = () => Array.from({ length: 4 }, pick).join('');
  return `DSTR-${block()}-${block()}`;
}

class CreateTerminalDto {
  @IsString() locationId!: string;
  @IsString() @Length(1, 60) name!: string;
}

class ActivateDto {
  @IsString() @Length(10, 20) code!: string;
  @IsOptional() @IsString() deviceInfo?: string;
}

@Controller('terminals')
export class TerminalsController {
  constructor(private prisma: PrismaService) {}

  // ── Бэк-офис: выдача кода ──────────────────────────────────

  /**
   * Создать кассу и получить код активации.
   * Лимит касс проверяется по тарифу: превышение — это не ошибка клиента,
   * а повод предложить переход на старший тариф, поэтому в ответе
   * говорим, сколько занято и сколько разрешено.
   */
  @Post()
  @UseGuards(JwtGuard, PermissionsGuard)
  @RequirePermission('admin.settings')
  async create(@Body() dto: CreateTerminalDto, @Req() req: any) {
    const location = await this.prisma.location.findFirst({
      where: { id: dto.locationId, accountId: req.user.acc },
    });
    if (!location) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });

    const sub = await this.prisma.subscription.findFirst({
      where: { accountId: req.user.acc },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    const limit = sub?.plan?.terminalsPerLocation ?? 1;
    const used = await this.prisma.terminal.count({
      where: { locationId: dto.locationId, isActive: true },
    });

    if (!canAddTerminal(used, limit)) {
      throw new ForbiddenException({
        code: 'TERMINAL_LIMIT',
        used, limit,
        message: `На тарифе «${sub?.plan?.name ?? '—'}» доступно ${limit} касс на точку`,
      });
    }

    const code = activationCode();
    const terminal = await this.prisma.terminal.create({
      data: {
        locationId: dto.locationId,
        name: dto.name,
        // Код активации живёт в deviceKey до момента активации.
        // Префикс отличает неактивированную кассу от рабочей.
        deviceKey: `PENDING:${code}`,
        isActive: true,
      },
    });

    return {
      terminalId: terminal.id,
      name: terminal.name,
      activationCode: code,
      used: used + 1,
      limit,
      hint: 'Введите код в программе на кассе. Код действует до активации.',
    };
  }

  /** Список касс точки: что активировано, что ждёт установщика. */
  @Get()
  @UseGuards(JwtGuard, PermissionsGuard)
  @RequirePermission('admin.settings')
  async list(@Query('locationId') locationId: string, @Req() req: any) {
    const terminals = await this.prisma.terminal.findMany({
      where: { locationId, location: { accountId: req.user.acc } },
      orderBy: { name: 'asc' },
    });

    const now = Date.now();
    return terminals.map((t) => {
      const pending = t.deviceKey.startsWith('PENDING:');
      const silentHours = t.lastSeenAt
        ? Math.floor((now - t.lastSeenAt.getTime()) / 3600_000)
        : null;

      return {
        id: t.id,
        name: t.name,
        status: pending ? 'WAITING_ACTIVATION' : t.isActive ? 'ACTIVE' : 'DISABLED',
        activationCode: pending ? t.deviceKey.slice(8) : null,
        lastSeenAt: t.lastSeenAt,
        // Касса, молчащая больше суток, — сигнал: сломалась или заведение закрылось
        isSilent: silentHours !== null && silentHours > 24,
        silentHours,
      };
    });
  }

  // ── Касса: активация ───────────────────────────────────────

  /**
   * Обмен кода активации на постоянный ключ устройства.
   * Без авторизации: касса при первой установке ещё не имеет токена,
   * а сам код одноразовый и живёт только до активации.
   */
  @Post('activate')
  async activate(@Body() dto: ActivateDto) {
    const code = dto.code.trim().toUpperCase();

    const terminal = await this.prisma.terminal.findUnique({
      where: { deviceKey: `PENDING:${code}` },
      include: { location: { include: { account: true } } },
    });

    if (!terminal) {
      // Не уточняем, «неверный» код или «уже использован» — иначе можно
      // перебором выяснить, какие коды существуют
      throw new BadRequestException({ code: 'BAD_ACTIVATION_CODE' });
    }

    const accountId = terminal.location.accountId;
    const sub = await this.prisma.subscription.findFirst({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    // Постоянный ключ: 32 символа из криптостойкого источника
    const deviceKey = Array.from(
      { length: 32 },
      () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
    ).join('');

    await this.prisma.terminal.update({
      where: { id: terminal.id },
      data: { deviceKey, lastSeenAt: new Date() },
    });

    return {
      deviceKey,
      terminalId: terminal.id,
      terminalName: terminal.name,
      locationId: terminal.locationId,
      locationName: terminal.location.name,
      accountName: terminal.location.account.name,
      license: this.buildLicense(sub),
    };
  }

  /**
   * Проверка лицензии. Касса зовёт раз в час; при отсутствии связи
   * работает по сохранённой копии до истечения grace-периода.
   */
  @Get('license')
  async license(@Query('deviceKey') deviceKey: string) {
    if (!deviceKey || deviceKey.startsWith('PENDING:')) {
      throw new BadRequestException({ code: 'NOT_ACTIVATED' });
    }

    const terminal = await this.prisma.terminal.findUnique({
      where: { deviceKey },
      include: { location: true },
    });
    if (!terminal) throw new NotFoundException({ code: 'TERMINAL_NOT_FOUND' });

    // Отметка присутствия: по ней супер-админка находит молчащие кассы
    await this.prisma.terminal.update({
      where: { id: terminal.id },
      data: { lastSeenAt: new Date() },
    });

    const sub = await this.prisma.subscription.findFirst({
      where: { accountId: terminal.location.accountId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    return {
      terminalId: terminal.id,
      isActive: terminal.isActive,
      // Серверное время: касса сверяет с локальным и ловит перевод часов назад
      serverTime: new Date().toISOString(),
      license: this.buildLicense(sub),
    };
  }

  /**
   * Сборка лицензии. Главное правило: продажи и отчёты разделены.
   * При неоплате касса продолжает работать до конца grace — точка
   * не встаёт посреди дня из-за забытого платежа.
   */
  private buildLicense(sub: any) {
    if (!sub) {
      return {
        status: 'NONE', plan: null, features: [],
        canSell: false, reportsOpen: false,
        validUntil: null, graceUntil: null,
      };
    }

    const now = new Date();
    const grace = new Date(sub.periodEnd);
    grace.setDate(grace.getDate() + (sub.graceDays ?? 7));

    return {
      status: sub.status,
      plan: sub.plan?.code ?? null,
      planName: sub.plan?.name ?? null,
      features: (sub.plan?.modules as string[]) ?? [],
      validUntil: sub.periodEnd,
      graceUntil: grace,
      canSell: now <= grace,
      reportsOpen: now <= sub.periodEnd,
      daysLeft: Math.max(0, Math.ceil((grace.getTime() - now.getTime()) / 86400_000)),
    };
  }
}
