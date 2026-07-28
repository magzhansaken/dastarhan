// Корневой модуль API. Этап 1: Core (health, sync) + Auth.
// Этап 2 добавит: Menu, Orders, Stock, Finance, Guests, Delivery, AI, Verticals, Platform.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { SignupController } from './auth/signup.controller';
import { OnboardingController } from './auth/onboarding.controller';
import { PermissionsGuard } from './auth/permissions.guard';
import { JwtGuard } from './auth/jwt.guard';
import { PrismaService } from './core/prisma.service';
import { OrderMaterializer } from './core/order-materializer';
import { FiscalService } from './payments/fiscal.service';
import { StockWriteoffService } from './stock/stock-writeoff.service';
import { FiscalController } from './payments/fiscal.controller';
import { ShiftController } from './cash/shift.controller';
import { HealthController } from './core/health.controller';
import { SyncController } from './core/sync.controller';
import { ReportsController } from './reports/reports.controller';
import { MenuController } from './menu/menu.controller';
import { GuestController } from './menu/guest.controller';
import { HallController } from './menu/hall.controller';
import { ModifiersController } from './menu/modifiers.controller';
import { ScalesController } from './verticals/scales.controller';
import { PayrollController } from './staff/payroll.controller';
import { InventoryController } from './stock/inventory.controller';
import { PromoController } from './menu/promo.controller';
import { RefundsController } from './orders/refunds.controller';
import { AuditController } from './staff/audit.controller';
import { BackupController } from './core/backup.controller';
import { OwnerDigestController } from './reports/owner-digest.controller';
import { ShelfLifeController } from './stock/shelf-life.controller';
import { AttendanceController } from './staff/attendance.controller';
import { BanquetController } from './orders/banquet.controller';
import { ProductionController } from './stock/production.controller';
import { TransferController } from './stock/transfer.controller';
import { ApiKeysController } from './platform/api-keys.controller';
import { NotifyController } from './core/notify.controller';
import { NotifyService } from './core/notify.service';
import { ReservationsController } from './stock/reservations.controller';
import { StaffController } from './staff/staff.controller';
import { SupplyController } from './stock/supply.controller';
import { ButcheringController } from './stock/butchering.controller';
import { DepositsController } from './guests/deposits.controller';
import { LoyaltyController } from './guests/loyalty.controller';
import { DealerController } from './dealer/dealer.controller';
import { TelegramController } from './integrations/telegram.controller';
import { AggregatorsController } from './integrations/aggregators.controller';
import { ExportController } from './reports/export.controller';
import { KdsController } from './kds/kds.controller';
import { BillingController } from './billing/billing.controller';
import { StockController } from './stock/stock.controller';
import { OrdersController } from './orders/orders.controller';
import { FinanceController } from './finance/finance.controller';
import { GuestsController } from './guests/guests.controller';
import { PlatformController } from './platform/platform.controller';
import { TerminalsController } from './platform/terminals.controller';
import { AdminController } from './platform/admin.controller';
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
    PlatformController, TerminalsController, DeliveryController, VerticalsController, FiscalController, ShiftController, SignupController, GuestController, KdsController, BillingController, AdminController, OnboardingController, HallController, TelegramController, ReservationsController, StaffController, DealerController, SupplyController, ButcheringController, DepositsController, AggregatorsController, ExportController, LoyaltyController, ModifiersController, ScalesController, PayrollController, InventoryController, PromoController, RefundsController, AuditController, BackupController, OwnerDigestController, ShelfLifeController, AttendanceController, BanquetController, ProductionController, TransferController, ApiKeysController, NotifyController],
  providers: [NotifyService, AuthService, PermissionsGuard, JwtGuard, PrismaService, OrderMaterializer, FiscalService, StockWriteoffService],
})
export class AppModule {}
