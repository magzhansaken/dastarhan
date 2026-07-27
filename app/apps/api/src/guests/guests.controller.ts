// apps/api/src/guests/guests.controller.ts
// Гости и лояльность. Телефон — единственный надёжный идентификатор
// в казахстанском общепите: карты теряют, приложения не ставят,
// а номер человек помнит и называет сам.
import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

@Controller('guests')
@UseGuards(JwtGuard, PermissionsGuard)
export class GuestsController {
  constructor(private prisma: PrismaService) {}

  /** Поиск гостя по телефону — то, что кассир делает у стойки за 3 секунды. */
  @Get('search')
  @RequirePermission('crm.customer.view')
  async search(@Query('phone') phone: string, @Req() req: any) {
    if (!phone || phone.length < 4) return [];

    // Ищем по последним цифрам: гость называет «...45 67», а не весь номер
    const digits = phone.replace(/\D/g, '');
    const customers = await this.prisma.customer.findMany({
      where: {
        accountId: req.user.acc,
        isActive: true,
        phone: { contains: digits.slice(-7) },
      },
      take: 10,
      select: { id: true, phone: true, name: true, cardNumber: true, groupId: true },
    });

    // Бонусный баланс считаем по транзакциям, а не храним полем:
    // поле рассинхронизируется, история — нет
    const balances = await Promise.all(
      customers.map(async (c) => {
        const txs = await this.prisma.bonusTx.findMany({
          where: { customerId: c.id },
          select: { amount: true, expiresAt: true },
        });
        const now = new Date();
        const active = txs.filter((t) => !t.expiresAt || t.expiresAt > now);
        return active.reduce((s, t) => s + t.amount, 0);
      }),
    );

    return customers.map((c, i) => ({
      id: c.id,
      phone: c.phone,
      name: c.name,
      cardNumber: c.cardNumber,
      bonusBalance: balances[i],
    }));
  }

  /** Карточка гостя: история визитов и бонусы. */
  @Get('card')
  @RequirePermission('crm.customer.view')
  async card(@Query('customerId') customerId: string) {
    const [customer, bonuses] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: customerId } }),
      this.prisma.bonusTx.findMany({
        where: { customerId },
        orderBy: { at: 'desc' },
        take: 50,
      }),
    ]);

    if (!customer) return null;

    const now = new Date();
    const active = bonuses.filter((t) => !t.expiresAt || t.expiresAt > now);

    return {
      id: customer.id,
      phone: customer.phone,
      name: customer.name,
      birthday: customer.birthday,
      note: customer.note,
      bonusBalance: active.reduce((s, t) => s + t.amount, 0),
      history: bonuses.map((t) => ({
        type: t.type, amount: t.amount, at: t.at, note: t.note,
      })),
    };
  }
}
