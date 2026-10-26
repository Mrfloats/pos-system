import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';
import { ADMINS, AllowLapsed, ALL_ROLES, type AuthContext, Ctx, MANAGERS, Roles } from '../common/auth-context.js';
import { devices } from '../db/schema.js';
import {
  CreateDeviceDto,
  CreateStaffDto,
  CreateStoreDto,
  IdParam,
  StoreFilter,
  UpdateDeviceDto,
  UpdateStaffDto,
  UpdateStoreDto,
  UpdateTenantDto,
} from './organization.dto.js';
import { DevicesService, StaffService, StoresService, TenantService } from './organization.service.js';

@ApiTags('business')
@ApiBearerAuth()
@Controller('tenant')
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @Get()
  get(@Ctx() ctx: AuthContext) {
    return this.tenants.get(ctx);
  }

  @Roles(...ADMINS)
  @Patch()
  update(@Ctx() ctx: AuthContext, @Body() dto: UpdateTenantDto) {
    return this.tenants.update(ctx, dto);
  }
}

@ApiTags('stores')
@ApiBearerAuth()
@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  // The app loads the store list before anything else, so it stays open while a subscription has lapsed.
  @AllowLapsed()
  @Roles(...ALL_ROLES)
  @Get()
  list(@Ctx() ctx: AuthContext, @Query() q: StoreFilter) {
    return this.stores.list(ctx, { search: q.search });
  }

  @Get(':id')
  get(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.stores.get(ctx, p.id);
  }

  @Roles(...ADMINS)
  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: CreateStoreDto) {
    return this.stores.create(ctx, dto);
  }

  @Roles(...ADMINS)
  @Patch(':id')
  update(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: UpdateStoreDto) {
    return this.stores.update(ctx, p.id, dto);
  }

  @Roles(...ADMINS)
  @Delete(':id')
  remove(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.stores.remove(ctx, p.id);
  }
}

@ApiTags('staff')
@ApiBearerAuth()
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Roles(...MANAGERS)
  @Get()
  list(@Ctx() ctx: AuthContext) {
    return this.staff.list(ctx);
  }

  @Roles(...ADMINS)
  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: CreateStaffDto) {
    return this.staff.create(ctx, dto);
  }

  @Roles(...ADMINS)
  @Patch(':id')
  update(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: UpdateStaffDto) {
    return this.staff.update(ctx, p.id, dto);
  }
}

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Roles(...MANAGERS)
  @Get()
  async list(@Ctx() ctx: AuthContext, @Query() q: StoreFilter) {
    const rows = await this.devices.list(ctx, {
      search: q.search,
      where: q.storeId ? [eq(devices.storeId, q.storeId)] : [],
    });
    return rows.map(({ tokenHash, ...d }) => ({ ...d, registered: !!tokenHash }));
  }

  @Roles(...ADMINS)
  @Post()
  async create(@Ctx() ctx: AuthContext, @Body() dto: CreateDeviceDto) {
    const { tokenHash, ...d } = await this.devices.create(ctx, dto);
    return { ...d, registered: !!tokenHash };
  }

  @Roles(...ADMINS)
  @Patch(':id')
  async update(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: UpdateDeviceDto) {
    const { tokenHash, ...d } = await this.devices.update(ctx, p.id, dto);
    return { ...d, registered: !!tokenHash };
  }

  /** Returns a one-time secret the till app stores to sign in as this device. */
  @Roles(...ADMINS)
  @Post(':id/token')
  issueToken(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.devices.issueToken(ctx, p.id);
  }

  @Roles(...ADMINS)
  @Delete(':id')
  remove(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.devices.remove(ctx, p.id);
  }
}
