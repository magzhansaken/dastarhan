// packages/db/seed-plans.ts
// Тарифы платформы. Цены в тиынах: 12 000 ₸ = 1 200 000.
// Состав функций совпадает с матрицей на сайте и в супер-админке —
// расхождение здесь означало бы, что клиент платит за одно, а получает другое.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const T = (tenge: number) => tenge * 100;

const PLANS = [
  {
    code: 'START',
    name: 'Старт',
    pricePerLocationMonth: T(12000),
    terminalsPerLocation: 1,
    modules: ['pos', 'shifts', 'stock', 'fiscal', 'kaspi', 'offline'],
  },
  {
    code: 'BUSINESS',
    name: 'Бизнес',
    pricePerLocationMonth: T(18000),
    terminalsPerLocation: 3,
    modules: ['pos', 'shifts', 'stock', 'fiscal', 'kaspi', 'offline',
              'reports', 'delivery', 'loyalty', 'ai', 'booking'],
  },
  {
    code: 'NETWORK',
    name: 'Сеть',
    pricePerLocationMonth: T(26000),
    terminalsPerLocation: 10,
    modules: ['pos', 'shifts', 'stock', 'fiscal', 'kaspi', 'offline',
              'reports', 'delivery', 'loyalty', 'ai', 'booking',
              'central_stock', 'franchise'],
  },
];

export async function seedPlans() {
  for (const p of PLANS) {
    await prisma.plan.upsert({
      where: { code: p.code },
      update: {
        name: p.name,
        pricePerLocationMonth: p.pricePerLocationMonth,
        terminalsPerLocation: p.terminalsPerLocation,
        modules: p.modules,
        isActive: true,
      },
      create: { ...p, isActive: true },
    });
  }
  console.log(`Тарифы: ${PLANS.map((p) => p.code).join(', ')}`);
}

/** Пробная подписка демо-аккаунту: 14 дней, тариф Бизнес. */
export async function seedTrial() {
  const account = await prisma.account.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!account) { console.log('Аккаунтов нет — сначала запустите seed.ts'); return; }

  const plan = await prisma.plan.findUnique({ where: { code: 'BUSINESS' } });
  if (!plan) { console.log('Тариф BUSINESS не найден'); return; }

  const exists = await prisma.subscription.findFirst({ where: { accountId: account.id } });
  if (exists) { console.log('Подписка уже есть'); return; }

  const now = new Date();
  const trialEnd = new Date(now); trialEnd.setDate(trialEnd.getDate() + 14);

  await prisma.subscription.create({
    data: {
      accountId: account.id,
      planId: plan.id,
      status: 'TRIAL',
      locationsCount: 1,
      periodStart: now,
      periodEnd: trialEnd,
      trialEnd,
      // 7 дней после окончания оплаты касса продолжает продавать —
      // точка не встаёт посреди дня из-за забытого платежа
      graceDays: 7,
    },
  });
  console.log(`Пробная подписка до ${trialEnd.toISOString().slice(0, 10)}`);
}

if (process.argv[1]?.includes('seed-plans')) {
  seedPlans()
    .then(seedTrial)
    .then(() => prisma.$disconnect())
    .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
}
