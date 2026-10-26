import { Module } from '@nestjs/common';
import {
  DevicesController,
  StaffController,
  StoresController,
  TenantController,
} from './organization.controller.js';
import { DevicesService, StaffService, StoresService, TenantService } from './organization.service.js';

@Module({
  controllers: [TenantController, StoresController, StaffController, DevicesController],
  providers: [TenantService, StoresService, StaffService, DevicesService],
  exports: [StoresService],
})
export class OrganizationModule {}
