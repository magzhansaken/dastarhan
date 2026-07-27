// apps/api/src/auth/permissions.guard.ts
// Guard ЧЕТЫРЁХ состояний права: allowed / self_pin / elevated_pin / denied.
// Модель QuickResto («состояние права»), разделённая точно:
//   self_pin     — подтверждение СВОИМ кодом: терминал мог остаться без
//                  присмотра, действие должно доказать, что это тот же человек
//   elevated_pin — подтверждение кодом СТАРШЕГО: контроль злоупотреблений
//                  (удаление позиции, возврат, изъятие наличных)
// Касса присылает соответствующий токен подтверждения; без него — 403
// с кодом, по которому UI открывает нужное окно ввода PIN.
import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey, PermissionState } from '@dastarhan/shared';

export const RequirePermission = (p: PermissionKey) => SetMetadata('perm', p);

/** Заголовки подтверждения. Раздельные — чтобы токен «своего» PIN нельзя
 *  было предъявить там, где нужен старший. */
export const SELF_PIN_HEADER = 'x-self-pin-token';
export const ELEVATED_PIN_HEADER = 'x-manager-pin-token';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const perm = this.reflector.get<PermissionKey>('perm', ctx.getHandler());
    if (!perm) return true;
    const req = ctx.switchToHttp().getRequest();
    const state: PermissionState = req.user?.perms?.[perm] ?? 'denied';

    if (state === 'allowed') return true;

    if (state === 'self_pin') {
      if (req.headers[SELF_PIN_HEADER]) return true;
      throw new ForbiddenException({ code: 'SELF_PIN_REQUIRED', permission: perm });
    }

    if (state === 'elevated_pin') {
      if (req.headers[ELEVATED_PIN_HEADER]) return true;
      throw new ForbiddenException({ code: 'ELEVATED_PIN_REQUIRED', permission: perm });
    }

    throw new ForbiddenException({ code: 'DENIED', permission: perm });
  }
}
