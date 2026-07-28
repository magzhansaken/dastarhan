// packages/db/seed-full.ts
// Демо-данные для всех функций: поставщики, минимумы, партии,
// явки, чаевые, брони, банкет, купоны, уведомления.
//
// Запуск после seed.ts и seed-demo.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const T = (tenge: number) => tenge * 100;

async function main() {
  const acc = await prisma.account.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!acc) { console.log('Нет аккаунта — сначала seed.ts'); return; }

  const loc = await prisma.location.findFirst({ where: { accountId: acc.id } });
  const wh = await prisma.warehouse.findFirst({ where: { locationId: loc!.id } });
  const users = await prisma.user.findMany({ where: { accountId: acc.id } });
  const cashier = users.find((u) => !u.isOwner) ?? users[0];
  const products = await prisma.product.findMany({ where: { accountId: acc.id } });
  const ingredients = products.filter((p) => p.type === 'INGREDIENT');
  const dishes = products.filter((p) => p.type === 'DISH');
  const tables = await prisma.diningTable.findMany({ take: 5 });

  let done: string[] = [];

  // ── Поставщики ──
  if (await prisma.supplier.count({ where: { accountId: acc.id } }) === 0) {
    const sups = await Promise.all([
      prisma.supplier.create({ data: {
        accountId: acc.id, name: 'ИП Ербол · мясо', binIin: '850315300123',
        phone: '+77012223344', contact: 'Ербол', category: 'мясо', deferDays: 7,
      }}),
      prisma.supplier.create({ data: {
        accountId: acc.id, name: 'ТОО Овощбаза', binIin: '090240001234',
        phone: '+77015556677', contact: 'Асель', category: 'овощи', deferDays: 14,
      }}),
      prisma.supplier.create({ data: {
        accountId: acc.id, name: 'Бакалея Алматы', phone: '+77017778899',
        category: 'бакалея', deferDays: 0,
      }}),
    ]);
    done.push(`поставщиков ${sups.length}`);

    // Минимальные остатки: часть позиций ниже нормы
    for (let i = 0; i < ingredients.length; i++) {
      await prisma.stockLimit.create({ data: {
        warehouseId: wh!.id, productId: ingredients[i].id,
        minQty: (i % 3 === 0 ? 20 : 5) as any,
        maxQty: (i % 3 === 0 ? 50 : 15) as any,
        supplierId: sups[i % 3].id,
      }}).catch(() => null);
    }
    done.push(`минимумов ${ingredients.length}`);

    // Заявка поставщику
    const last = await prisma.supplyRequest.findFirst({ orderBy: { number: 'desc' } });
    await prisma.supplyRequest.create({ data: {
      accountId: acc.id, locationId: loc!.id, supplierId: sups[0].id,
      number: (last?.number ?? 0) + 1, status: 'SENT',
      expectedAt: new Date(Date.now() + 86400_000),
      createdBy: cashier.id,
      lines: { create: ingredients.slice(0, 3).map((p) => ({ productId: p.id, qty: 10 as any })) },
    }});
    done.push('заявка');
  }

  // ── Партии со сроками: одна просрочена, одна кончается ──
  if (await prisma.stockBatch.count() === 0 && ingredients.length >= 2) {
    await prisma.product.update({
      where: { id: ingredients[0].id }, data: { shelfLifeHours: 24 },
    });
    await prisma.stockBatch.create({ data: {
      accountId: acc.id, warehouseId: wh!.id, productId: ingredients[0].id,
      qty: 3 as any, unitCost: 280000,
      producedAt: new Date(Date.now() - 30 * 3600_000),
      expiresAt: new Date(Date.now() - 6 * 3600_000),   // просрочена
      byUserId: cashier.id,
    }});
    await prisma.stockBatch.create({ data: {
      accountId: acc.id, warehouseId: wh!.id, productId: ingredients[1].id,
      qty: 5 as any, unitCost: 60000,
      producedAt: new Date(Date.now() - 20 * 3600_000),
      expiresAt: new Date(Date.now() + 4 * 3600_000),   // кончается
      byUserId: cashier.id,
    }});
    done.push('партии со сроками');
  }

  // ── Явки: с опозданием и без ──
  if (await prisma.attendance.count() === 0) {
    for (let d = 1; d <= 10; d++) {
      const day = new Date(); day.setDate(day.getDate() - d);
      day.setHours(9, d === 3 ? 25 : 2, 0, 0);   // на третий день опоздание
      const out = new Date(day); out.setHours(21, 0, 0, 0);
      await prisma.attendance.create({ data: {
        accountId: acc.id, userId: cashier.id, locationId: loc!.id,
        checkIn: day, checkOut: out,
        countedMin: 690,
        status: d === 3 ? 'ISSUE' : 'CLOSED',
        issue: d === 3 ? 'Опоздание 25 мин' : null,
      }});
    }
    done.push('явок 10');
  }

  // ── Чаевые ──
  if (await prisma.tip.count() === 0) {
    for (let i = 0; i < 12; i++) {
      const at = new Date(); at.setDate(at.getDate() - (i % 7));
      await prisma.tip.create({ data: {
        accountId: acc.id, locationId: loc!.id,
        userId: cashier.id,
        amount: T([500, 1000, 300, 2000, 700][i % 5]),
        method: (['CASH', 'CARD', 'QR', 'KASPI'] as const)[i % 4],
        createdAt: at,
      }});
    }
    done.push('чаевых 12');
  }

  // ── Брони: подтверждённая и без подтверждения ──
  if (await prisma.reservation.count() === 0 && tables.length) {
    const tonight = new Date(); tonight.setHours(19, 0, 0, 0);
    await prisma.reservation.create({ data: {
      accountId: acc.id, locationId: loc!.id, tableId: tables[0].id,
      guestName: 'Асель Нурлановна', phone: '+77012345678',
      guests: 4, startAt: tonight, status: 'CONFIRMED',
      prepaid: T(5000), confirmedAt: new Date(),
    }});
    const later = new Date(tonight); later.setHours(20, 30, 0, 0);
    await prisma.reservation.create({ data: {
      accountId: acc.id, locationId: loc!.id, tableId: tables[1]?.id ?? null,
      guestName: 'Данияр', phone: '+77017654321',
      guests: 6, startAt: later, status: 'NEW',
    }});
    done.push('броней 2');
  }

  // ── Банкет ──
  if (await prisma.banquet.count() === 0 && dishes.length) {
    const when = new Date(); when.setDate(when.getDate() + 5); when.setHours(18, 0, 0, 0);
    const items = dishes.slice(0, 3).map((d) => ({
      productId: d.id, name: d.name, qty: 40 as any,
      unitPrice: d.basePrice, course: 1,
    }));
    const total = items.reduce((s, i) => s + i.unitPrice * 40, 0);
    await prisma.banquet.create({ data: {
      accountId: acc.id, locationId: loc!.id, number: 1,
      title: 'Свадьба Ержана', guestName: 'Ержан Смагулов',
      phone: '+77011112233', guestsCount: 40, startAt: when,
      servicePct: 10, total: Math.round(total * 1.1),
      prepaid: T(150000), prepaidAt: new Date(), status: 'CONFIRMED',
      confirmedAt: new Date(), managerId: cashier.id,
      items: { create: items },
    }});
    done.push('банкет');
  }

  // ── Купоны ──
  if (await prisma.coupon.count() === 0) {
    await prisma.coupon.create({ data: {
      accountId: acc.id, code: 'BESH20', title: 'Скидка 20% на всё',
      kind: 'PERCENT', value: 20, minTotal: T(5000), maxUses: 100, perGuest: 1,
      endsAt: new Date(Date.now() + 30 * 86400_000),
    }});
    await prisma.coupon.create({ data: {
      accountId: acc.id, code: 'WELCOME', title: 'Первый визит — 1000 ₸',
      kind: 'AMOUNT', value: T(1000), minTotal: T(3000), perGuest: 1,
    }});
    done.push('купонов 2');
  }

  // ── Акции ──
  if (await prisma.promo.count() === 0) {
    await prisma.promo.create({ data: {
      accountId: acc.id, name: 'Счастливые часы 15:00–17:00',
      type: 'HAPPY_HOURS' as any,
      config: { fromHour: 15, toHour: 17, percent: 20, days: [0, 1, 2, 3, 4] },
      isActive: true,
    }}).catch(() => null);
    done.push('акция');
  }

  // ── Схемы зарплаты ──
  if (await prisma.payrollRule.count() === 0) {
    for (const u of users.filter((x) => !x.isOwner)) {
      await prisma.payrollRule.create({ data: {
        accountId: acc.id, userId: u.id, locationId: loc!.id,
        perShift: T(8000), salesPct: 3 as any,
      }});
    }
    done.push('схемы зарплаты');
  }

  // ── Уведомления ──
  if (await prisma.notification.count() === 0) {
    await prisma.notification.create({ data: {
      accountId: acc.id, kind: 'low_stock', level: 'WARN',
      title: 'Заканчивается конина',
      body: 'Осталось на 2 дня — пора заказать у ИП Ербол',
      actionUrl: '/office/#stock', actionText: 'Открыть склад',
      dedupKey: 'low_stock:demo',
    }});
    await prisma.notification.create({ data: {
      accountId: acc.id, kind: 'expired_products', level: 'URGENT',
      title: 'Просроченные продукты',
      body: 'Одна партия просрочена — списать нельзя подавать',
      actionUrl: '/office/#shelf-life', actionText: 'Посмотреть',
      dedupKey: 'expired:demo',
    }});
    done.push('уведомлений 2');
  }

  // ── Цеха для кухни ──
  if (await prisma.station.count() === 0) {
    const stations = await Promise.all([
      prisma.station.create({ data: { locationId: loc!.id, name: 'Горячий цех', sortOrder: 1 } }),
      prisma.station.create({ data: { locationId: loc!.id, name: 'Холодный цех', sortOrder: 2 } }),
      prisma.station.create({ data: { locationId: loc!.id, name: 'Бар', sortOrder: 3 } }),
    ]);
    for (let i = 0; i < dishes.length; i++) {
      await prisma.product.update({
        where: { id: dishes[i].id },
        data: { stationId: stations[i % 3].id },
      });
    }
    done.push('цехов 3');
  }

  console.log('Создано: ' + (done.length ? done.join(', ') : 'всё уже было'));
}

main().then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
