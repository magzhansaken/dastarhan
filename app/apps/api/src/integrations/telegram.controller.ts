// apps/api/src/integrations/telegram.controller.ts
// Вебхук Telegram-бота: гость заказывает доставку прямо в переписке.
//
// Состояние диалога держим в памяти процесса, а не в базе:
// заказ занимает две минуты, а лишняя таблица с мусором от
// брошенных диалогов не нужна. При перезапуске гость начнёт заново —
// это лучше, чем хранить тысячи мёртвых корзин.
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { botStep } from './telegram.bot';

type ChatState = Parameters<typeof botStep>[0];

@Controller('telegram')
export class TelegramController {
  private chats = new Map<number, ChatState>();
  private menuCache: { at: number; data: any } | null = null;

  constructor(private prisma: PrismaService) {}

  private get token(): string | null {
    return process.env.TELEGRAM_BOT_TOKEN ?? null;
  }

  /** Меню для бота. Кешируем на минуту: гостей много, меню меняется редко. */
  private async menu() {
    if (this.menuCache && Date.now() - this.menuCache.at < 60_000) {
      return this.menuCache.data;
    }
    const [cats, products] = await Promise.all([
      this.prisma.menuCategory.findMany({
        where: { isDeleted: false }, orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.product.findMany({
        where: { isDeleted: false, type: { in: ['DISH', 'GOODS'] } },
        select: { id: true, name: true, categoryId: true, basePrice: true },
      }),
    ]);
    const data = {
      categories: cats,
      items: products.filter((p) => p.basePrice > 0).map((p) => ({
        id: p.id, name: p.name, categoryId: p.categoryId, price: p.basePrice,
      })),
    };
    this.menuCache = { at: Date.now(), data };
    return data;
  }

  private async send(chatId: number, reply: any) {
    if (!this.token) return;
    const body: any = { chat_id: chatId, text: reply.text, parse_mode: 'HTML' };
    if (reply.keyboard?.length) {
      body.reply_markup = {
        inline_keyboard: reply.keyboard.map((row: any[]) =>
          row.map((b) => ({ text: b.label, callback_data: b.data })),
        ),
      };
    }
    await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
  }

  /** Точка, куда Telegram шлёт сообщения. */
  @Post('webhook')
  async webhook(@Body() update: any) {
    const msg = update?.message ?? update?.callback_query?.message;
    const chatId = msg?.chat?.id;
    if (!chatId) return { ok: true };

    const input = update?.callback_query?.data ?? update?.message?.text ?? '/start';
    const state: ChatState = this.chats.get(chatId) ?? { step: 'MENU', cart: [] } as any;

    const menu = await this.menu();
    const { state: next, reply } = botStep(state, input, menu);
    this.chats.set(chatId, next);

    // Заказ оформлен — пишем событие, кассир увидит его в списке
    if ((next as any).step === 'DONE') {
      await this.prisma.eventLog.create({
        data: {
          eventId: `tg-${chatId}-${Date.now()}`,
          accountId: '',
          terminalId: null,
          type: 'telegram.order',
          payload: {
            chatId,
            cart: (next as any).cart,
            phone: (next as any).phone ?? null,
            address: (next as any).address ?? null,
          },
          createdAt: new Date(),
        },
      }).catch(() => null);
    }

    await this.send(chatId, reply);
    return { ok: true };
  }

  /** Проверка настройки: бот подключён или нет. */
  @Get('status')
  status() {
    return {
      configured: !!this.token,
      activeChats: this.chats.size,
      hint: this.token ? null : 'Впишите TELEGRAM_BOT_TOKEN в .env — токен даёт @BotFather',
    };
  }

  /** Регистрация вебхука в Telegram. Вызывается один раз после настройки. */
  @Post('setup')
  async setup(@Query('url') url: string) {
    if (!this.token) return { ok: false, code: 'NO_TOKEN' };
    const r = await fetch(
      `https://api.telegram.org/bot${this.token}/setWebhook?url=${encodeURIComponent(url)}`,
    ).then((x) => x.json() as Promise<{ ok?: boolean; description?: string }>)
     .catch(() => null);
    return { ok: !!r?.ok, result: r };
  }
}
