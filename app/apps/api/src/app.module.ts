// Корневой модуль API. Этап 1: Core (health, sync) + Auth.
// Этап 2 добавит: Menu, Orders, Stock, Finance, Guests, Delivery, AI, Verticals, Platform.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth/auth.service';
import { PermissionsGuard } from './auth/permissions.guard';
import { PrismaService } from './core/prisma.service';
import { HealthController } from './core/health.controller';
import { SyncController } from './core/sync.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [HealthController, SyncController],
  providers: [AuthService, PermissionsGuard, PrismaService],
})
export class AppModule {}
