import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AccountingModule } from './accounting/accounting.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { AuthGuard } from './common/auth.guard.js';
import { CommonModule } from './common/common.module.js';
import { RateLimitGuard } from './common/rate-limit.js';
import { CustomersModule } from './customers/customers.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health.controller.js';
import { InventoryModule } from './inventory/inventory.js';
import { OrganizationModule } from './organization/organization.module.js';
import { PlatformModule } from './platform/platform.js';
import { SalesModule } from './sales/sales.module.js';
import { SubscriptionsModule } from './subscriptions/subscriptions.js';
import { TillModule } from './till/till.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.getOrThrow<string>('JWT_SECRET');
        if (secret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
        return {
          secret,
          signOptions: { expiresIn: (config.get('JWT_EXPIRES_IN') ?? '12h') as any },
        };
      },
    }),
    DbModule,
    CommonModule,
    AuthModule,
    OrganizationModule,
    CatalogModule,
    CustomersModule,
    InventoryModule,
    AccountingModule,
    SalesModule,
    PlatformModule,
    SubscriptionsModule,
    TillModule,
  ],
  controllers: [HealthController],
  providers: [
    // Requests per minute from one address (RATE_LIMIT). A shop's tills often share one address, so production raises it.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
