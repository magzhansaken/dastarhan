// apps/api/src/auth/jwt.guard.ts
// Разбирает Bearer-токен и кладёт полезную нагрузку в req.user,
// чтобы PermissionsGuard мог проверять права.
//
// Отдельный guard, а не логика внутри PermissionsGuard: аутентификация
// (кто ты) и авторизация (что тебе можно) — разные вопросы, и смешивать
// их в одном месте потом дорого.
import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../core/prisma.service';
import { ROLE_PRESETS } from '@dastarhan/shared';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private jwt: JwtService, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'NO_TOKEN' });
    }

    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(header.slice(7));
    } catch {
      throw new UnauthorizedException({ code: 'BAD_TOKEN' });
    }

    // Токен кассы уже несёт права — они зафиксированы при входе по PIN,
    // чтобы касса могла проверять их офлайн теми же значениями.
    if (payload.kind === 'pos') {
      req.user = payload;
      return true;
    }

    // Токен бэк-офиса компактный: права подтягиваем из базы, потому что
    // владелец может менять роли, и токен не должен «замораживать» их на 15 минут.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, accountId: true, isOwner: true, isActive: true },
    });

    if (!user?.isActive) throw new UnauthorizedException({ code: 'USER_INACTIVE' });

    req.user = {
      ...payload,
      // Владелец аккаунта имеет все права по определению: это тот, кто платит
      // за подписку и отвечает за заведение. Ограничивать его нельзя —
      // иначе он не сможет вернуть себе доступ, если ошибётся с ролями.
      perms: user.isOwner ? ROLE_PRESETS.OWNER.permissions : await this.loadPerms(user.id),
      isOwner: user.isOwner,
    };
    return true;
  }

  /** Права сотрудника: из роли, назначенной ему на точке. */
  private async loadPerms(userId: string) {
    const link = await this.prisma.employeeAssignment.findFirst({
      where: { userId },
      include: { role: true },
    }).catch(() => null);
    return ((link as any)?.role?.permissions as Record<string, string>) ?? {};
  }
}
