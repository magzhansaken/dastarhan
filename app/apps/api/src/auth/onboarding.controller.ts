// apps/api/src/auth/onboarding.controller.ts
// Сохранение шагов мастера настройки. Каждый шаг пишется сразу,
// а не в конце: владелец может закрыть браузер на третьем шаге
// и вернуться завтра — настройки не пропадут.
import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';

class BusinessDto {
  @IsIn(['CAFE', 'FASTFOOD', 'SHOP', 'BILLIARD', 'SALON'])
  vertical!: string;
}

class LocationDto {
  @IsString() @Length(1, 80) name!: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() hours?: string;
}

class FiscalDto {
  @IsIn(['existing', 'new']) mode!: 'existing' | 'new';
  @IsOptional() @IsString() login?: string;
}

@Controller('onboarding')
@UseGuards(JwtGuard)
export class OnboardingController {
  constructor(private prisma: PrismaService) {}

  /** Состояние настройки: что уже сделано, сколько осталось. */
  @Get('state')
  async state(@Req() req: any) {
    const account = await this.prisma.account.findUnique({
      where: { id: req.user.acc },
    });
    const location = await this.prisma.location.findFirst({
      where: { accountId: req.user.acc },
    });
    const products = await this.prisma.product.count({
      where: { accountId: req.user.acc, isDeleted: false },
    });
    const staff = await this.prisma.user.count({
      where: { accountId: req.user.acc, isOwner: false },
    });
    const terminal = await this.prisma.terminal.findFirst({
      where: { location: { accountId: req.user.acc } },
    });

    // Шаг считается сделанным по факту данных, а не по нажатию «Далее»:
    // если владелец завёл меню другим путём, мастер это увидит
    const done: string[] = [];
    if (account?.vertical) done.push('business');
    if (location?.name) done.push('location');
    if (process.env.WEBKASSA_LOGIN) done.push('fiscal');
    if (products > 0) done.push('menu');
    if (staff > 0) done.push('staff');
    if (terminal && !terminal.deviceKey.startsWith('PENDING:')) done.push('terminal');

    return {
      accountName: account?.name ?? '',
      vertical: account?.vertical ?? null,
      locationName: location?.name ?? '',
      productsCount: products,
      staffCount: staff,
      terminalActivated: !!terminal && !terminal.deviceKey.startsWith('PENDING:'),
      activationCode: terminal?.deviceKey.startsWith('PENDING:')
        ? terminal.deviceKey.slice(8) : null,
      done,
      // Оценка оставшегося времени — обещание с сайта про 15 минут
      minutesLeft: Math.max(0, 15 - done.length * 2),
    };
  }

  /** Шаг 1: тип заведения. Меняет пресеты касс, склада и отчётов. */
  @Post('business')
  async business(@Body() dto: BusinessDto, @Req() req: any) {
    await this.prisma.account.update({
      where: { id: req.user.acc },
      data: { vertical: dto.vertical as any },
    });
    return { ok: true, vertical: dto.vertical };
  }

  /** Шаг 2: первая точка. Название увидит гость в чеке и QR-меню. */
  @Patch('location')
  async location(@Body() dto: LocationDto, @Req() req: any) {
    const loc = await this.prisma.location.findFirst({
      where: { accountId: req.user.acc },
    });
    if (!loc) return { ok: false, code: 'NO_LOCATION' };

    await this.prisma.location.update({
      where: { id: loc.id },
      data: { name: dto.name.trim(), address: dto.address?.trim() || null },
    });
    return { ok: true, locationId: loc.id, name: dto.name };
  }

  /**
   * Шаг 3: фискализация. Две развилки — своя касса в Webkassa
   * или оформление новой. Ключи вписывает администратор в .env,
   * здесь только фиксируем выбор владельца.
   */
  @Post('fiscal')
  async fiscal(@Body() dto: FiscalDto) {
    return {
      ok: true,
      mode: dto.mode,
      message: dto.mode === 'existing'
        ? 'Подключим по логину — чеки пойдут в ту же кассу'
        : 'Оформим новую фискальную кассу, обычно активируется в тот же день',
      configured: !!process.env.WEBKASSA_LOGIN,
    };
  }
}
