// Корневой модуль API. Этап 1: Core (health, sync) + Auth.
// Этап 2 добавит: Menu, Orders, Stock, Finance, Guests, Delivery, AI, Verticals, Platform.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { PermissionsGuard } from './auth/permissions.guard';
import { JwtGuard } from './auth/jwt.guard';
import { PrismaService } from './core/prisma.service';
import { OrderMaterializer } from './core/order-materializer';
import { HealthController } from './core/health.controller';
import { SyncController } from './core/sync.controller';
import { ReportsController } from './reports/reports.controller';
import { MenuController } from './menu/menu.controller';
import { StockController } from './stock/stock.controller';
import { OrdersController } from './orders/orders.controller';
import { FinanceController } from './finance/finance.controller';
import { GuestsController } from './guests/guests.controller';
import { PlatformController } from './platform/platform.controller';
import { TerminalsController } from './platform/terminals.controller';
import { DeliveryController } from './delivery/delivery.controller';
import { VerticalsController } from './verticals/verticals.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [HealthController, SyncController, ReportsController, AuthController, MenuController, StockController, OrdersController,
    FinanceController, GuestsController,
    PlatformController, TerminalsController, DeliveryController, VerticalsController],
  providers: [AuthService, PermissionsGuard, JwtGuard, PrismaService, OrderMaterializer],
})
export class AppModule {}
