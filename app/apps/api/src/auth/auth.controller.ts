// apps/api/src/auth/auth.controller.ts
// Два контура входа: офис по email+паролю, касса по PIN на привязанном
// терминале. Сервис уже написан — контроллер только выставляет его наружу
// и валидирует вход.
import { Body, Controller, Post, HttpCode } from '@nestjs/common';
import { IsEmail, IsString, Length, MinLength } from 'class-validator';
import { AuthService } from './auth.service';

class LoginOfficeDto {
  @IsEmail({}, { message: 'Укажите корректный email' })
  email!: string;

  @IsString()
  @MinLength(6, { message: 'Пароль короче 6 символов' })
  password!: string;
}

class LoginPosDto {
  @IsString({ message: 'Не передан ключ терминала' })
  deviceKey!: string;

  // Четыре цифры: компромисс между скоростью у стойки и защитой.
  // Опасные действия всё равно требуют PIN старшего.
  @IsString()
  @Length(4, 6, { message: 'PIN — от 4 до 6 цифр' })
  pin!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  /** Вход в бэк-офис: возвращает access-токен на 15 минут и refresh на 30 дней. */
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginOfficeDto) {
    return this.auth.loginBackoffice(dto.email, dto.password);
  }

  /** Вход на кассе: PIN сотрудника на зарегистрированном терминале. */
  @Post('pos')
  @HttpCode(200)
  async pos(@Body() dto: LoginPosDto) {
    return this.auth.loginPos(dto.deviceKey, dto.pin);
  }
}
