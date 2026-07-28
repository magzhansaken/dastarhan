// apps/api/src/staff/staff.controller.ts
// Сотрудники, роли и права. Владелец решает, кто что видит.
//
// Ключевое: PIN хранится хешем, как пароль. Кассир может забыть его,
// но никто не может подсмотреть — включая владельца и нас.
import {
  Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches } from 'class-validator';
import * as argon2 from 'argon2';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { ROLE_PRESETS, PERMISSIONS } from '../../../../packages/shared/src';

class CreateStaffDto {
  @IsString() @Length(2, 80) fullName!: string;
  @IsString() roleId!: string;
  @IsString() locationId!: string;

  // PIN из четырёх цифр: кассир вводит его десятки раз за смену,
  // длиннее — потеря времени на каждом входе
  @Matches(/^\d{4}$/, { message: 'PIN — четыре цифры' })
  pin!: string;

  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
}

class UpdateRoleDto {
  @IsString() name!: string;
  permissions!: Record<string, string>;
}

@Controller('staff')
@UseGuards(JwtGuard, PermissionsGuard)
export class StaffController {
  constructor(private prisma: PrismaService) {}

  /** Список сотрудников с ролями и активностью. */
  @Get()
  @RequirePermission('admin.employees')
  async list(@Req() req: any) {
    const users = await this.prisma.user.findMany({
      where: { accountId: req.user.acc },
      orderBy: { createdAt: 'asc' },
    });

    const assignments = await this.prisma.employeeAssignment.findMany({
      where: { userId: { in: users.map((u) => u.id) } },
      include: { role: { select: { name: true, preset: true } },
                 location: { select: { name: true } } },
    });
    const byUser = new Map<string, typeof assignments>();
    for (const a of assignments) {
      const arr = byUser.get(a.userId) ?? [];
      arr.push(a);
      byUser.set(a.userId, arr);
    }

    const now = Date.now();
    return users.map((u) => {
      const roles = byUser.get(u.id) ?? [];
      return {
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        phone: u.phone,
        isOwner: u.isOwner,
        isActive: u.isActive,
        since: u.createdAt,
        hasPin: !!u.pinHash,
        // Роль на каждой точке своя: в сети один человек бывает
        // менеджером на одной и кассиром на другой
        roles: roles.map((a) => ({
          locationName: a.location.name,
          roleName: a.role.name,
          preset: a.role.preset,
        })),
      };
    });
  }

  /** Добавить сотрудника с PIN и ролью на точке. */
  @Post()
  @RequirePermission('admin.employees')
  async create(@Body() dto: CreateStaffDto, @Req() req: any) {
    // PIN не должен повторяться на точке: иначе двое войдут
    // под одним кодом, и разбор смены станет невозможен
    const existing = await this.prisma.user.findMany({
      where: { accountId: req.user.acc, pinHash: { not: null } },
      select: { pinHash: true },
    });
    for (const e of existing) {
      if (e.pinHash && await argon2.verify(e.pinHash, dto.pin).catch(() => false)) {
        throw new BadRequestException({
          code: 'PIN_TAKEN',
          message: 'Такой PIN уже используется — выберите другой',
        });
      }
    }

    const user = await this.prisma.user.create({
      data: {
        accountId: req.user.acc,
        fullName: dto.fullName.trim(),
        phone: dto.phone?.trim() || null,
        email: dto.email?.trim().toLowerCase() || null,
        pinHash: await argon2.hash(dto.pin),
      },
    });

    await this.prisma.employeeAssignment.create({
      data: { userId: user.id, roleId: dto.roleId, locationId: dto.locationId },
    });

    return { id: user.id, fullName: user.fullName };
  }

  /** Сброс PIN: кассир забыл, владелец выдаёт новый. */
  @Patch(':id/pin')
  @RequirePermission('admin.employees')
  async resetPin(@Param('id') id: string, @Body() body: { pin: string }) {
    if (!/^\d{4}$/.test(body.pin)) {
      throw new BadRequestException({ code: 'BAD_PIN', message: 'PIN — четыре цифры' });
    }
    await this.prisma.user.update({
      where: { id }, data: { pinHash: await argon2.hash(body.pin) },
    });
    return { ok: true };
  }

  /**
   * Блокировка сотрудника. Не удаляем: его чеки и смены остаются
   * в отчётах, и по ним потом разбирают спорные ситуации.
   */
  @Patch(':id/block')
  @RequirePermission('admin.employees')
  async block(@Param('id') id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    if (u.isOwner) {
      throw new ForbiddenException({
        code: 'OWNER_PROTECTED',
        message: 'Владельца заблокировать нельзя',
      });
    }
    await this.prisma.user.update({ where: { id }, data: { isActive: false } });
    return { ok: true, fullName: u.fullName };
  }

  // ═══════════════ РОЛИ И ПРАВА ═══════════════

  /** Роли аккаунта с их правами. */
  @Get('roles')
  @RequirePermission('admin.employees')
  async roles(@Req() req: any) {
    const roles = await this.prisma.role.findMany({
      where: { accountId: req.user.acc },
      orderBy: { name: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id, name: r.name, preset: r.preset,
      permissions: r.permissions as Record<string, string>,
    }));
  }

  /** Справочник всех прав с описаниями — для экрана настройки. */
  @Get('permissions')
  @RequirePermission('admin.employees')
  catalog() {
    return {
      permissions: PERMISSIONS,
      // Четыре состояния вместо галочки: «под PIN старшего» —
      // то, чего нет у большинства систем, а в кафе нужно каждый день
      states: [
        { key: 'allowed', label: 'Разрешено' },
        { key: 'self_pin', label: 'Свой PIN' },
        { key: 'elevated_pin', label: 'PIN старшего' },
        { key: 'denied', label: 'Скрыто' },
      ],
      presets: Object.entries(ROLE_PRESETS).map(([key, v]: any) => ({
        key, name: v.name,
      })),
    };
  }

  /** Изменение прав роли. */
  @Patch('roles/:id')
  @RequirePermission('admin.employees')
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    await this.prisma.role.update({
      where: { id },
      data: { name: dto.name, permissions: dto.permissions as any },
    });
    return { ok: true };
  }

  /** Возврат роли к пресету: владелец запутался в правах и хочет откатить. */
  @Post('roles/:id/reset')
  @RequirePermission('admin.employees')
  async resetRole(@Param('id') id: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role?.preset) throw new BadRequestException({ code: 'NO_PRESET' });

    const preset = (ROLE_PRESETS as any)[role.preset];
    if (!preset) throw new BadRequestException({ code: 'UNKNOWN_PRESET' });

    await this.prisma.role.update({
      where: { id }, data: { permissions: preset.permissions },
    });
    return { ok: true, preset: role.preset };
  }
}
