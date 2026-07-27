// packages/db/seed.ts
// Демо-кафе «Дастархан» — данные для: (1) разработки, (2) демо-стендов
// дилеров (Этап 10: DemoAccount создаётся из этого сида по вертикали).
// Казахстанский колорит намеренный: демо продаёт, если узнаваемо.

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { ROLE_PRESETS } from '@dastarhan/shared';

const prisma = new PrismaClient();
const T = (tenge: number) => tenge * 100; // тенге → тиыны

export async function seedDemoCafe() {
  const account = await prisma.account.create({
    data: {
      name: 'Демо-кафе «Дастархан»', vertical: 'CAFE',
      binIin: '990840012345', language: 'ru', currency: 'KZT',
    },
  });
  const location = await prisma.location.create({
    data: { accountId: account.id, name: 'Кафе на Абая', address: 'г. Алматы, пр. Абая 10' },
  });
  const terminal = await prisma.terminal.create({
    data: { locationId: location.id, name: 'Касса 1', deviceKey: 'demo-terminal-key-001' },
  });

  // Роли из пресетов (Этап 0)
  const roles: Record<string, string> = {};
  for (const [preset, def] of Object.entries(ROLE_PRESETS)) {
    const r = await prisma.role.create({
      data: { accountId: account.id, name: def.name, preset, permissions: def.permissions },
    });
    roles[preset] = r.id;
  }

  // Люди: владелец (email) + кассир (PIN 1234) + официант (PIN 5678)
  const owner = await prisma.user.create({
    data: {
      accountId: account.id, fullName: 'Магжан Владелец', isOwner: true,
      email: 'owner@demo.dastarhan.kz', passwordHash: await argon2.hash('demo1234'),
    },
  });
  const cashier = await prisma.user.create({
    data: { accountId: account.id, fullName: 'Айгерим Кассир', pinHash: await argon2.hash('1234') },
  });
  const waiter = await prisma.user.create({
    data: { accountId: account.id, fullName: 'Ербол Официант', pinHash: await argon2.hash('5678') },
  });
  for (const [userId, preset] of [[owner.id, 'OWNER'], [cashier.id, 'CASHIER'], [waiter.id, 'WAITER']] as const) {
    await prisma.employeeAssignment.create({
      data: { userId, locationId: location.id, roleId: roles[preset] },
    });
  }

  // Зал: 6 столов
  const hall = await prisma.hall.create({ data: { locationId: location.id, name: 'Основной зал' } });
  for (let i = 1; i <= 6; i++) {
    await prisma.diningTable.create({
      data: { hallId: hall.id, name: String(i), seats: 4, x: (i - 1) % 3 * 120, y: Math.floor((i - 1) / 3) * 120 },
    });
  }

  // Меню: категории → ингредиенты → ПФ → блюда с техкартами
  const catFood = await prisma.menuCategory.create({ data: { accountId: account.id, name: 'Горячее', nameKk: 'Ыстық тағамдар', color: '#E07A2F' } });
  const catDrink = await prisma.menuCategory.create({ data: { accountId: account.id, name: 'Напитки', nameKk: 'Сусындар', color: '#2F7AE0' } });

  const mk = (data: any) => prisma.product.create({ data: { accountId: account.id, ...data } });
  const rice = await mk({ type: 'INGREDIENT', name: 'Рис', unit: 'KG' });
  const beef = await mk({ type: 'INGREDIENT', name: 'Говядина', unit: 'KG' });
  const carrot = await mk({ type: 'INGREDIENT', name: 'Морковь', unit: 'KG' });
  const oil = await mk({ type: 'INGREDIENT', name: 'Масло', unit: 'L' });
  const beans = await mk({ type: 'INGREDIENT', name: 'Кофе зерно', unit: 'KG' });
  const milk = await mk({ type: 'INGREDIENT', name: 'Молоко', unit: 'L' });
  const cup = await mk({ type: 'GOODS', name: 'Стакан бумажный', unit: 'PCS', basePrice: 0 });
  const cola = await mk({ type: 'GOODS', name: 'Кола 0.5', unit: 'PCS', basePrice: T(600), categoryId: catDrink.id });

  const zirvak = await mk({ type: 'PREPACK', name: 'Зирвак', unit: 'KG' });
  await prisma.techCard.create({
    data: {
      productId: zirvak.id, version: 1, outputQty: 3000, // 3 кг
      lines: { create: [
        { componentId: beef.id, bruttoQty: 1500, nettoQty: 1200 },
        { componentId: carrot.id, bruttoQty: 1000, nettoQty: 900 },
        { componentId: oil.id, bruttoQty: 300, nettoQty: 300 },
      ]},
    },
  });

  const plov = await mk({ type: 'DISH', name: 'Плов', nameKk: 'Палау', unit: 'PORTION', basePrice: T(2500), categoryId: catFood.id });
  await prisma.techCard.create({
    data: {
      productId: plov.id, version: 1, outputQty: 400, // порция 400 г
      lines: { create: [
        { componentId: rice.id, bruttoQty: 120, nettoQty: 110 },
        { componentId: zirvak.id, bruttoQty: 250, nettoQty: 250 },
      ]},
    },
  });

  const capp = await mk({ type: 'DISH', name: 'Капучино', nameKk: 'Капучино', unit: 'PORTION', basePrice: T(1500), categoryId: catDrink.id });
  await prisma.techCard.create({
    data: {
      productId: capp.id, version: 1, outputQty: 250,
      lines: { create: [
        { componentId: beans.id, bruttoQty: 18, nettoQty: 18 },
        { componentId: milk.id, bruttoQty: 180, nettoQty: 150 },
        { componentId: cup.id, bruttoQty: 1, nettoQty: 1 },
      ]},
    },
  });

  // Модификаторы: молоко (обяз. выбор), сиропы (до 2)
  const gMilk = await prisma.modifierGroup.create({
    data: {
      accountId: account.id, name: 'Молоко', nameKk: 'Сүт', minSelect: 1, maxSelect: 1,
      options: { create: [
        { name: 'Обычное', priceDelta: 0, isDefault: true, componentId: milk.id, componentQty: 0 },
        { name: 'Овсяное', priceDelta: T(200) },
      ]},
    },
  });
  await prisma.productModifierGroup.create({ data: { productId: capp.id, groupId: gMilk.id } });

  // Способы оплаты (КЗ-набор) + фискальный провайдер
  await prisma.paymentMethod.createMany({ data: [
    { accountId: account.id, name: 'Наличные', kind: 'CASH', sortOrder: 1 },
    { accountId: account.id, name: 'Kaspi терминал', kind: 'CARD', driver: 'kaspi_terminal', sortOrder: 2 },
    { accountId: account.id, name: 'Kaspi QR', kind: 'KASPI_QR', driver: 'kaspi_qr', sortOrder: 3 },
  ]});
  await prisma.fiscalProvider.create({
    data: { accountId: account.id, type: 'webkassa', isDefault: true,
      credentials: { baseUrl: 'https://devkassa.webkassa.kz', login: 'demo', password: 'demo', cashboxNumber: 'SWK00000001' } },
  });

  // Склад + стартовые остатки приходом
  const wh = await prisma.warehouse.create({ data: { locationId: location.id, name: 'Кухня', isDefault: true } });
  const supply = await prisma.stockDoc.create({
    data: {
      accountId: account.id, locationId: location.id, type: 'SUPPLY', status: 'DRAFT',
      number: 1, warehouseId: wh.id, createdBy: owner.id,
      lines: { create: [
        { productId: rice.id, qty: 20000, unitCost: 60 },   // 600 тг/кг = 60 тиын/грамм
      ]},
    },
  });

  // Бонусная программа + демо-клиент
  await prisma.bonusProgram.create({ data: { accountId: account.id, accrualPct: 5, maxPayPct: 50, expireDays: 180 } });
  await prisma.customer.create({
    data: { accountId: account.id, phone: '+77071234567', name: 'Асель Гость' },
  });

  // Тарифы платформы + trial-подписка
  const plan = await prisma.plan.upsert({
    where: { code: 'standard' },
    create: { code: 'standard', name: 'Стандарт', pricePerLocationMonth: T(15000),
      terminalsPerLocation: 2, modules: { ai: true, delivery: true, loyalty: true } },
    update: {},
  });
  await prisma.subscription.create({
    data: {
      accountId: account.id, planId: plan.id, status: 'TRIAL',
      periodStart: new Date(), periodEnd: new Date(Date.now() + 14 * 864e5),
      trialEnd: new Date(Date.now() + 14 * 864e5),
    },
  });

  console.log('Демо-кафе создано:', { account: account.id, terminal: terminal.deviceKey });
  return { account, location, terminal };
}

if (require.main === module) {
  seedDemoCafe().finally(() => prisma.$disconnect());
}
