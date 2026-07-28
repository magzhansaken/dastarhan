// apps/api/src/payments/fiscal.controller.ts
// Состояние фискализации: касса показывает его в шапке, супер-админка —
// в списке клиентов. Кассиру важен не технический статус, а ответ
// на вопрос «чеки уходят или нет».
import { Controller, Get, Post, UseGuards, Req } from '@nestjs/common';
import { FiscalService } from './fiscal.service';
import { JwtGuard } from '../auth/jwt.guard';

@Controller('fiscal')
export class FiscalController {
  constructor(private fiscal: FiscalService) {}

  /** Сводка для кассы: сколько чеков ждёт ОФД. */
  @Get('status')
  @UseGuards(JwtGuard)
  async status(@Req() req: any) {
    return this.fiscal.status(req.user.acc);
  }

  /**
   * Разбор очереди. Вызывается по расписанию (cron на сервере)
   * или вручную, когда связь с ОФД восстановилась.
   */
  @Post('process')
  async process() {
    return this.fiscal.processQueue();
  }
}
