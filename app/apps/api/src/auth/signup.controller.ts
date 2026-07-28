// apps/api/src/auth/signup.controller.ts
// Регистрация заведения. Одним запросом создаётся всё, что нужно
// для первого чека: аккаунт, точка, склад, роли, владелец, терминал,
// пробная подписка.
//
// Почему так: конкуренты требуют звонка менеджеру и демонстрации.
// Мы обещаем на сайте «первый чек через 15 минут» — значит регистрация
// не может упираться в шаги, которые человек сделает потом.
import { Body, Controller, Post, HttpCode, ConflictException } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, Length, MinLength } from 'class-validator';
import * as argon2 from 'argon2';
import { PrismaService } from '../core/prisma.service';
import { ROLE_PRESETS } from '../../../../packages/shared/src';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

class SignupDto {
  @IsString() @Length(2, 80, { message: 'Название от 2 до 80 символов' })
  companyName!: string;

  @IsEmail({}, { message: 'Проверьте адрес почты' })
  email!: string;

  @IsString() @MinLength(6, { message: 'Пароль от 6 символов' })
  password!: string;

  @IsOptional() @IsString()
  ownerName?: string;

  @IsOptional() @IsString()
  phone?: string;

  @IsOptional()
  // OTHER в схеме нет: пять вертикалей покрывают рынок,
  // а «другое» на старте всё равно настраивается как кафе
  @IsIn(['CAFE', 'FASTFOOD', 'SHOP', 'BILLIARD', 'SALON'])
  vertical?: string;

  @IsOptional() @IsString()
  locationName?: string;
}

@Controller('signup')
export class SignupController {
  constructor(private prisma: PrismaService) {}

  @Post()
  @HttpCode(201)
  async signup(@Body() dto: SignupDto) {
    const email = dto.email.trim().toLowerCase();

    const exists = await this.prisma.user.findFirst({ where: { email } });
    if (exists) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'Такая почта уже зарегистрирована. Войдите или восстановите пароль.',
      });
    }

    const passwordHash = await argon2.hash(dto.password);
    const code = `DSTR-${this.block()}-${this.block()}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          name: dto.companyName.trim(),
          vertical: (dto.vertical ?? 'CAFE') as any,
          language: 'ru',
          currency: 'KZT',
          timezone: 'Asia/Almaty',
        },
      });

      const location = await tx.location.create({
        data: {
          accountId: account.id,
          name: dto.locationName?.trim() || dto.companyName.trim(),
        },
      });

      // Склад создаём сразу: без него не примешь накладную,
      // а владелец не должен искать, где его завести
      await tx.warehouse.create({
        data: { locationId: location.id, name: 'Основной склад', isDefault: true },
      });

      // Роли из пресетов: владелец получает всё, кассир — ограниченный набор
      // с опасными действиями под PIN старшего
      for (const [preset, def] of Object.entries(ROLE_PRESETS)) {
        await tx.role.create({
          data: {
            accountId: account.id,
            name: (def as any).name,
            preset,
            permissions: (def as any).permissions,
          },
        });
      }

      const owner = await tx.user.create({
        data: {
          accountId: account.id,
          fullName: dto.ownerName?.trim() || 'Владелец',
          email,
          passwordHash,
          phone: dto.phone?.trim() || null,
          isOwner: true,
        },
      });

      // Первый терминал с кодом активации: владелец скачает программу
      // и введёт код — искать, где его получить, не придётся
      const terminal = await tx.terminal.create({
        data: {
          locationId: location.id,
          name: 'Касса 1',
          deviceKey: `PENDING:${code}`,
        },
      });

      // Пробный период 14 дней. Карту не спрашиваем — обещание с сайта
      const plan = await tx.plan.findFirst({
        where: { isActive: true },
        orderBy: { pricePerLocationMonth: 'asc' },
      });

      if (plan) {
        const now = new Date();
        const trialEnd = new Date(now);
        trialEnd.setDate(trialEnd.getDate() + 14);
        await tx.subscription.create({
          data: {
            accountId: account.id,
            planId: plan.id,
            status: 'TRIAL',
            locationsCount: 1,
            periodStart: now,
            periodEnd: trialEnd,
            trialEnd,
            graceDays: 7,
          },
        });
      }

      return { account, location, owner, terminal };
    });

    return {
      accountId: result.account.id,
      locationId: result.location.id,
      ownerId: result.owner.id,
      activationCode: code,
      trialDays: 14,
      next: [
        'Войдите в бэк-офис и заведите меню',
        'Скачайте программу кассы и введите код активации',
        'Откройте смену и пробейте первый чек',
      ],
    };
  }

  private block(): string {
    return Array.from({ length: 4 },
      () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  }
}
