// apps/api/src/auth/auth.service.ts
// Два контура входа (решение этапа 0):
//  1) Бэк-офис: email+пароль → JWT access (15м) + refresh (30д, в Session).
//  2) Касса: deviceKey терминала + PIN сотрудника → короткий POS-токен.
// Урок всех 5: у стойки вход должен быть за 2 секунды (PIN), в офисе — полноценный.

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../core/prisma.service';
import { RolePermissions } from '@dastarhan/shared';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  // ── Бэк-офис ────────────────────────────────────────────────
  async loginBackoffice(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !user.isActive)
      throw new UnauthorizedException('Неверный email или пароль');
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('Неверный email или пароль');

    const access = await this.jwt.signAsync(
      { sub: user.id, acc: user.accountId, kind: 'backoffice' },
      { expiresIn: '15m' },
    );
    const refreshRaw = crypto.randomUUID();
    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshHash: await argon2.hash(refreshRaw),
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    });
    return { access, refresh: refreshRaw };
  }

  // ── Касса: PIN на привязанном терминале ─────────────────────
  async loginPos(deviceKey: string, pin: string) {
    const terminal = await this.prisma.terminal.findUnique({
      where: { deviceKey },
      include: { location: true },
    });
    if (!terminal?.isActive) throw new UnauthorizedException('Терминал не активирован');

    // Сотрудники, назначенные на точку терминала (урок Poster:
    // доступ по заведениям — чужой сотрудник не войдёт на этой кассе)
    const candidates = await this.prisma.user.findMany({
      where: {
        isActive: true,
        pinHash: { not: null },
        assignments: { some: { locationId: terminal.locationId } },
      },
      include: {
        assignments: {
          where: { locationId: terminal.locationId },
          include: { role: true },
        },
      },
    });
    for (const u of candidates) {
      if (await argon2.verify(u.pinHash!, pin)) {
        const role = u.assignments[0]?.role;
        const token = await this.jwt.signAsync(
          {
            sub: u.id, acc: u.accountId, kind: 'pos',
            loc: terminal.locationId, term: terminal.id,
            perms: (role?.permissions ?? {}) as RolePermissions,
          },
          { expiresIn: '14h' }, // рабочая смена; офлайн-кэш токена на кассе
        );
        return { token, user: { id: u.id, name: u.fullName, role: role?.name } };
      }
    }
    throw new UnauthorizedException('Неверный PIN');
  }
}
