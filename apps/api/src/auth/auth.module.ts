import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { TenantSetupService } from './tenant-setup.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, TenantSetupService],
  // Approving a sign-up request (subscriptions module) creates the business through AuthService.
  exports: [AuthService],
})
export class AuthModule {}
