// packages/db/seed-demo.ts
// Наполнение демо-кафе живыми данными: смена, заказы за день,
// открытые тикеты на кухне, рейс курьера, брони.
// Нужно, чтобы владелец увидел все экраны заполненными, а не пустыми.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const T = (tenge: number) => tenge * 100;

async function main() {
  const account = await prisma.account.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!account) { console.log('Аккаунта нет — сначала seed.ts'); return; }

  const location = await prisma.location.findFirst({ where: { accountId: account.id } });
  const terminal = await prisma.terminal.findFirst({ where: { locationId: location!.id } });
  const cashier = await prisma.user.findFirst({ where: { accountId: account.id, isOwner: false } });
  const products = await prisma.product.findMany({
    where: { accountId: account.id, type: { in: ['DISH', 'GOODS'] } },
  });
  const table = await prisma.diningTable.findFirst();

  if (!terminal || !products.length) { console.log('Нет терминала или меню'); return; }

  // ── Смена: открыта утром с разменом 40 000 ₸
  const today = new Date(); today.setHours(8, 14, 0, 0);
  let shift = await prisma.cashShift.findFirst({ where: { terminalId: terminal.id, closedAt: null } });
  if (!shift) {
    const last = await prisma.cashShift.findFirst({
      where: { terminalId: terminal.id }, orderBy: { number: 'desc' },
    });
    shift = await prisma.cashShift.create({
      data: {
        accountId: account.id, locationId: location!.id, terminalId: terminal.id,
        number: (last?.number ?? 0) + 1, openedBy: cashier?.id ?? 'demo',
        openedAt: today, openingCash: T(40000),
      },
    });
  }

  // ── Закрытые заказы: разброс по часам, чтобы график был живым
  const hours = [9, 11, 12, 13, 13, 14, 18, 19, 19, 20, 20, 21];
  let created = 0;
  for (let i = 0; i < hours.length; i++) {
    const id = `demo-order-${i}`;
    if (await prisma.order.findUnique({ where: { id } })) continue;

    const at = new Date(); at.setHours(hours[i], (i * 7) % 60, 0, 0);
    const picked = [products[i % products.length], products[(i + 1) % products.length]];
    const items = picked.map((p) => ({ p, qty: 1 + (i % 2) }));
    const total = items.reduce((s, x) => s + x.p.basePrice * x.qty, 0);
    // Наличные и Kaspi примерно поровну — как в реальном кафе
    const isCash = i % 2 === 0;

    await prisma.order.create({
      data: {
        id, accountId: account.id, locationId: location!.id,
        terminalId: terminal.id, shiftId: shift.id,
        number: 1000 + i, mode: 'DINE_IN', status: 'CLOSED',
        tableId: table?.id ?? null, guestsCount: 1 + (i % 3),
        waiterId: cashier?.id ?? null,
        openedAt: at, closedAt: new Date(at.getTime() + 25 * 60000),
        subtotal: total, discount: 0, total,
        items: {
          create: items.map((x) => ({
            productId: x.p.id, nameSnapshot: x.p.name, guestNo: 1,
            qty: x.qty, unitPrice: x.p.basePrice, modifiers: [],
            kitchenStatus: 'READY',
          })),
        },
      },
    });

    await prisma.payment.create({
      data: {
        orderId: id, methodId: isCash ? 'cash' : 'kaspi',
        kind: isCash ? 'CASH' : 'KASPI_QR',
        amount: total, status: 'CAPTURED',
        capturedAt: new Date(at.getTime() + 25 * 60000),
      },
    });
    created++;
  }

  // ── Открытые заказы: чтобы на кухне было что готовить
  let kitchen = 0;
  for (let i = 0; i < 3; i++) {
    const id = `demo-open-${i}`;
    if (await prisma.order.findUnique({ where: { id } })) continue;
    const at = new Date(Date.now() - (5 + i * 8) * 60000);
    const p = products[i % products.length];

    await prisma.order.create({
      data: {
        id, accountId: account.id, locationId: location!.id,
        terminalId: terminal.id, shiftId: shift.id,
        number: 2000 + i, mode: 'DINE_IN', status: 'OPEN',
        tableId: table?.id ?? null, guestsCount: 2,
        openedAt: at, subtotal: p.basePrice, discount: 0, total: p.basePrice,
        items: {
          create: [{
            productId: p.id, nameSnapshot: p.name, guestNo: 1,
            qty: 1 + i, unitPrice: p.basePrice, modifiers: [],
            comment: i === 1 ? 'без лука' : null,
            kitchenStatus: i === 0 ? 'COOKING' : 'NEW',
          }],
        },
      },
    });
    kitchen++;
  }

  // ── Расходы: чтобы в отчёте о прибыли были не только доходы
  const cats = await prisma.finCategory.findMany({ where: { accountId: account.id } });
  const expense = cats.find((c) => c.kind === 'EXPENSE');
  if (expense) {
    const existing = await prisma.finTransaction.count({ where: { accountId: account.id } });
    if (existing === 0) {
      const finAcc = await prisma.finAccount.findFirst({ where: { accountId: account.id } });
      if (finAcc) {
        for (const [label, sum] of [['Аренда', 250000], ['Зарплата', 480000], ['Продукты', 320000]] as const) {
          await prisma.finTransaction.create({
            data: {
              accountId: account.id, finAccountId: finAcc.id, categoryId: expense.id,
              amount: -T(sum), note: label, byUserId: 'demo',
              at: new Date(Date.now() - 3 * 86400_000),
            },
          }).catch(() => null);
        }
      }
    }
  }

  console.log(`Готово: заказов ${created}, на кухне ${kitchen}, смена №${shift.number}`);
  console.log(`Точка: ${location!.name}, терминал: ${terminal.name}`);
}

main().then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
