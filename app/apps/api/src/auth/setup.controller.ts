// apps/api/src/auth/setup.controller.ts
// Первый запуск: от регистрации до первого чека.
//
// У конкурентов настройка занимает дни: заводят номенклатуру,
// техкарты, склады, права. Владелец бросает на середине.
//
// Мы даём готовые наборы под тип заведения — меню, категории,
// техкарты и роли создаются одной кнопкой, дальше правится.
import {
  Body, Controller, Get, Post, Req, UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

/**
 * Стартовые наборы. Не «пример меню», а рабочая основа:
 * реальные блюда казахстанского общепита с техкартами.
 */
const TEMPLATES: Record<string, {
  label: string;
  categories: { name: string; nameKk: string }[];
  products: {
    name: string; nameKk: string; cat: number; price: number;
    unit?: string; type?: string;
  }[];
  ingredients: { name: string; nameKk: string; unit: string; price: number }[];
  cards: { dish: string; lines: { ing: string; qty: number }[] }[];
}> = {
  CAFE: {
    label: 'Кафе и ресторан',
    categories: [
      { name: 'Салаты', nameKk: 'Салаттар' },
      { name: 'Горячее', nameKk: 'Ыстық тағамдар' },
      { name: 'Напитки', nameKk: 'Сусындар' },
    ],
    products: [
      { name: 'Бешбармак', nameKk: 'Бесбармақ', cat: 1, price: 280000 },
      { name: 'Плов', nameKk: 'Палау', cat: 1, price: 250000 },
      { name: 'Лагман', nameKk: 'Лағман', cat: 1, price: 220000 },
      { name: 'Салат Ачичук', nameKk: 'Ашшы-чучук', cat: 0, price: 90000 },
      { name: 'Чай', nameKk: 'Шай', cat: 2, price: 50000 },
      { name: 'Капучино', nameKk: 'Капучино', cat: 2, price: 150000 },
    ],
    ingredients: [
      { name: 'Конина', nameKk: 'Жылқы еті', unit: 'KG', price: 280000 },
      { name: 'Говядина', nameKk: 'Сиыр еті', unit: 'KG', price: 250000 },
      { name: 'Рис', nameKk: 'Күріш', unit: 'KG', price: 60000 },
      { name: 'Морковь', nameKk: 'Сәбіз', unit: 'KG', price: 35000 },
      { name: 'Лук', nameKk: 'Пияз', unit: 'KG', price: 25000 },
      { name: 'Мука', nameKk: 'Ұн', unit: 'KG', price: 30000 },
      { name: 'Помидоры', nameKk: 'Қызанақ', unit: 'KG', price: 60000 },
      { name: 'Масло растительное', nameKk: 'Өсімдік майы', unit: 'L', price: 90000 },
    ],
    cards: [
      { dish: 'Бешбармак', lines: [
        { ing: 'Конина', qty: 0.25 }, { ing: 'Мука', qty: 0.12 },
        { ing: 'Лук', qty: 0.08 },
      ]},
      { dish: 'Плов', lines: [
        { ing: 'Говядина', qty: 0.125 }, { ing: 'Рис', qty: 0.12 },
        { ing: 'Морковь', qty: 0.08 }, { ing: 'Масло растительное', qty: 0.03 },
      ]},
      { dish: 'Лагман', lines: [
        { ing: 'Говядина', qty: 0.1 }, { ing: 'Мука', qty: 0.1 },
        { ing: 'Помидоры', qty: 0.08 }, { ing: 'Лук', qty: 0.05 },
      ]},
      { dish: 'Салат Ачичук', lines: [
        { ing: 'Помидоры', qty: 0.15 }, { ing: 'Лук', qty: 0.05 },
      ]},
    ],
  },
  FASTFOOD: {
    label: 'Фастфуд и столовая',
    categories: [
      { name: 'Бургеры', nameKk: 'Бургерлер' },
      { name: 'Гарниры', nameKk: 'Гарнирлер' },
      { name: 'Напитки', nameKk: 'Сусындар' },
    ],
    products: [
      { name: 'Чизбургер', nameKk: 'Чизбургер', cat: 0, price: 120000 },
      { name: 'Донер', nameKk: 'Донер', cat: 0, price: 150000 },
      { name: 'Картофель фри', nameKk: 'Фри картобы', cat: 1, price: 70000 },
      { name: 'Кола 0.5', nameKk: 'Кола 0.5', cat: 2, price: 60000, type: 'GOODS' },
    ],
    ingredients: [
      { name: 'Говядина фарш', nameKk: 'Тартылған ет', unit: 'KG', price: 220000 },
      { name: 'Булочка', nameKk: 'Бөлке', unit: 'PC', price: 12000 },
      { name: 'Сыр', nameKk: 'Ірімшік', unit: 'KG', price: 350000 },
      { name: 'Картофель', nameKk: 'Картоп', unit: 'KG', price: 40000 },
      { name: 'Лаваш', nameKk: 'Лаваш', unit: 'PC', price: 15000 },
    ],
    cards: [
      { dish: 'Чизбургер', lines: [
        { ing: 'Говядина фарш', qty: 0.1 }, { ing: 'Булочка', qty: 1 },
        { ing: 'Сыр', qty: 0.02 },
      ]},
      { dish: 'Донер', lines: [
        { ing: 'Говядина фарш', qty: 0.15 }, { ing: 'Лаваш', qty: 1 },
      ]},
      { dish: 'Картофель фри', lines: [{ ing: 'Картофель', qty: 0.2 }]},
    ],
  },
  SHOP: {
    label: 'Магазин',
    categories: [
      { name: 'Продукты', nameKk: 'Азық-түлік' },
      { name: 'Напитки', nameKk: 'Сусындар' },
      { name: 'Хозтовары', nameKk: 'Тұрмыстық заттар' },
    ],
    products: [
      { name: 'Хлеб', nameKk: 'Нан', cat: 0, price: 20000, type: 'GOODS' },
      { name: 'Молоко 1л', nameKk: 'Сүт 1л', cat: 0, price: 45000, type: 'GOODS' },
      { name: 'Вода 1.5л', nameKk: 'Су 1.5л', cat: 1, price: 25000, type: 'GOODS' },
    ],
    ingredients: [],
    cards: [],
  },
};

class ApplyDto {
  @IsIn(['CAFE', 'FASTFOOD', 'SHOP']) template!: string;
  @IsString() locationId!: string;
  @IsOptional() @IsString() warehouseId?: string;
}

@Controller('setup')
@UseGuards(JwtGuard, PermissionsGuard)
export class SetupController {
  constructor(private prisma: PrismaService) {}

  /** Какие наборы доступны и что внутри. */
  @Get('templates')
  @RequirePermission('menu.edit')
  templates() {
    return Object.entries(TEMPLATES).map(([key, t]) => ({
      key,
      label: t.label,
      dishes: t.products.length,
      ingredients: t.ingredients.length,
      techCards: t.cards.length,
      // Честно про то, что это основа, а не готовое меню
      note: 'Основа для старта — цены и состав поправите под себя',
    }));
  }

  /**
   * Применить набор. Идемпотентно: повторный вызов не создаст
   * дубли, а дополнит недостающее.
   */
  @Post('apply-template')
  @RequirePermission('menu.edit')
  async apply(@Body() dto: ApplyDto, @Req() req: any) {
    const tpl = TEMPLATES[dto.template];
    if (!tpl) throw new BadRequestException({ code: 'UNKNOWN_TEMPLATE' });

    const existing = await this.prisma.product.count({
      where: { accountId: req.user.acc, isDeleted: false },
    });
    if (existing > 20) {
      throw new BadRequestException({
        code: 'MENU_NOT_EMPTY',
        message: `В меню уже ${existing} позиций — набор применяют на пустое меню`,
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Категории
      const catIds: string[] = [];
      for (let i = 0; i < tpl.categories.length; i++) {
        const c = tpl.categories[i];
        const found = await tx.menuCategory.findFirst({
          where: { accountId: req.user.acc, name: c.name },
        });
        if (found) { catIds.push(found.id); continue; }
        const created = await tx.menuCategory.create({
          data: {
            accountId: req.user.acc,
            name: c.name, nameKk: c.nameKk, sortOrder: i,
          },
        });
        catIds.push(created.id);
      }

      // Сырьё: без него техкарты не создать
      const ingIds = new Map<string, string>();
      for (const ing of tpl.ingredients) {
        const found = await tx.product.findFirst({
          where: { accountId: req.user.acc, name: ing.name },
        });
        if (found) { ingIds.set(ing.name, found.id); continue; }
        const created = await tx.product.create({
          data: {
            accountId: req.user.acc,
            name: ing.name, nameKk: ing.nameKk,
            type: 'INGREDIENT',
            unit: ing.unit as any,
            basePrice: 0,
          },
        });
        ingIds.set(ing.name, created.id);
      }

      // Блюда
      const dishIds = new Map<string, string>();
      for (const p of tpl.products) {
        const found = await tx.product.findFirst({
          where: { accountId: req.user.acc, name: p.name },
        });
        if (found) { dishIds.set(p.name, found.id); continue; }
        const created = await tx.product.create({
          data: {
            accountId: req.user.acc,
            name: p.name, nameKk: p.nameKk,
            categoryId: catIds[p.cat],
            type: (p.type ?? 'DISH') as any,
            unit: (p.unit ?? 'PC') as any,
            basePrice: p.price,
          },
        });
        dishIds.set(p.name, created.id);
      }

      // Техкарты — то, ради чего всё затевалось: без них
      // не считается себестоимость и не работает списание
      let cardsCreated = 0;
      for (const card of tpl.cards) {
        const productId = dishIds.get(card.dish);
        if (!productId) continue;
        const exists = await tx.techCard.findFirst({ where: { productId } });
        if (exists) continue;

        await tx.techCard.create({
          data: {
            productId,
            version: 1,
            effectiveFrom: new Date(),
            outputQty: 1 as any,
            lines: {
              create: card.lines
                .filter((l) => ingIds.has(l.ing))
                .map((l, i) => ({
                  componentId: ingIds.get(l.ing)!,
                  bruttoQty: l.qty as any,
                  nettoQty: l.qty as any,
                  sortOrder: i,
                })),
            },
          },
        });
        cardsCreated++;
      }

      return {
        categories: catIds.length,
        ingredients: ingIds.size,
        dishes: dishIds.size,
        techCards: cardsCreated,
      };
    });

    return {
      ok: true,
      ...result,
      // Следующий шаг называем явно: владелец не должен гадать,
      // что делать дальше
      nextStep: 'Примите первую поставку — тогда заработает себестоимость',
      hint: 'Цены в меню поставлены примерные — поправьте под свои',
    };
  }

  /**
   * Готовность к работе: что осталось сделать до первого чека.
   * Список короткий и в порядке, в котором надо делать.
   */
  @Get('readiness')
  @RequirePermission('menu.edit')
  async readiness(@Req() req: any) {
    const acc = req.user.acc;

    const [products, cards, staff, terminal, warehouse, stock] = await Promise.all([
      this.prisma.product.count({ where: { accountId: acc, isDeleted: false, type: { in: ['DISH', 'GOODS'] } } }),
      this.prisma.techCard.count(),
      this.prisma.user.count({ where: { accountId: acc, isOwner: false } }),
      this.prisma.terminal.findFirst({ where: { location: { accountId: acc } } }),
      this.prisma.warehouse.findFirst({ where: { location: { accountId: acc } } }),
      this.prisma.stockBalance.count({ where: { qty: { gt: 0 } } }),
    ]);

    const steps = [
      {
        key: 'menu', label: 'Меню',
        done: products > 0,
        text: products > 0 ? `${products} позиций` : 'Добавьте блюда или примените готовый набор',
        blocking: true,
      },
      {
        key: 'terminal', label: 'Касса',
        done: !!terminal && !terminal.deviceKey.startsWith('PENDING:'),
        text: !terminal ? 'Создайте терминал'
          : terminal.deviceKey.startsWith('PENDING:')
          ? `Активируйте кассу кодом ${terminal.deviceKey.slice(8)}`
          : 'Активирована',
        blocking: true,
      },
      {
        key: 'staff', label: 'Сотрудники',
        done: staff > 0,
        text: staff > 0 ? `${staff} человек` : 'Добавьте кассира — владельцу неудобно стоять за кассой',
        blocking: false,
      },
      {
        key: 'stock', label: 'Остатки на складе',
        done: stock > 0,
        text: stock > 0 ? `${stock} позиций` : 'Примите поставку — иначе списание не заработает',
        blocking: false,
      },
      {
        key: 'techcards', label: 'Техкарты',
        done: cards > 0,
        text: cards > 0 ? `${cards} карт` : 'Без них не считается себестоимость и фудкост',
        blocking: false,
      },
    ];

    const blockers = steps.filter((s) => s.blocking && !s.done);
    const done = steps.filter((s) => s.done).length;

    return {
      progress: Math.round((done / steps.length) * 100),
      canSell: blockers.length === 0,
      steps,
      // Первое незакрытое дело — то, чем заняться прямо сейчас
      nextStep: steps.find((s) => !s.done)?.text ?? null,
      verdict: blockers.length
        ? `До первого чека: ${blockers.map((b) => b.label.toLowerCase()).join(', ')}`
        : done === steps.length
        ? 'Всё настроено'
        : 'Можно продавать — остальное настроите по ходу',
    };
  }
}
