import { Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { asc, count, ilike, or, SQL } from 'drizzle-orm';
import { AuditService } from '../common/audit.service.js';
import { type AuthContext, Ctx, FRONT_OF_HOUSE, MANAGERS, Roles } from '../common/auth-context.js';
import { assertOwned } from '../common/ownership.js';
import { TenantCrud } from '../common/tenant-crud.js';
import { IsMoney, likeEscape, ListQuery, Page, ToDecimalString, Trim } from '../common/validation.js';
import { DbService } from '../db/db.service.js';
import { customerGroups, customers, priceLists } from '../db/schema.js';
import { IdParam } from '../organization/organization.dto.js';

export class CreateCustomerDto {
  @Trim() @IsString() @Length(1, 160) name: string;
  @IsOptional() @Trim() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @Trim() @IsEmail() email?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(300) address?: string;
  /** Taxpayer Identification Number (needed on fiscal tax invoices). */
  @IsOptional() @Trim() @IsString() @MaxLength(30) tin?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(30) vatNumber?: string;
  /** Wholesale customers: which price list applies to them. */
  @IsOptional() @IsUUID() priceListId?: string | null;
  @IsOptional() @ToDecimalString() @IsMoney() creditLimit?: string | null;
  /** Customer group, e.g. Staff or Schools, which can carry a discount. */
  @IsOptional() @IsUUID() groupId?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}

@Injectable()
export class CustomersService extends TenantCrud<typeof customers> {
  constructor(dbs: DbService, audit: AuditService) {
    super(dbs, audit, customers, { entity: 'Customer', orderBy: [customers.name] });
  }

  page(ctx: AuthContext, q: ListQuery): Promise<Page<typeof customers.$inferSelect>> {
    return this.dbs.withTenant(ctx, async (tx) => {
      let where: SQL | undefined;
      if (q.search) {
        const p = likeEscape(q.search);
        where = or(ilike(customers.name, p), ilike(customers.phone, p), ilike(customers.email, p), ilike(customers.tin, p));
      }
      const [{ total }] = await tx.select({ total: count() }).from(customers).where(where);
      const items = await tx
        .select()
        .from(customers)
        .where(where)
        .orderBy(asc(customers.name))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  override async create(ctx: AuthContext, dto: CreateCustomerDto) {
    await this.dbs.withTenant(ctx, async (tx) => {
      await assertOwned(tx, priceLists, [dto.priceListId], 'price list');
      await assertOwned(tx, customerGroups, [dto.groupId], 'customer group');
    });
    return super.create(ctx, dto);
  }

  override async update(ctx: AuthContext, id: string, dto: UpdateCustomerDto) {
    await this.dbs.withTenant(ctx, async (tx) => {
      await assertOwned(tx, priceLists, [dto.priceListId], 'price list');
      await assertOwned(tx, customerGroups, [dto.groupId], 'customer group');
    });
    return super.update(ctx, id, dto);
  }

  deactivate(ctx: AuthContext, id: string) {
    return super.update(ctx, id, { active: false });
  }
}

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  @Get()
  list(@Ctx() ctx: AuthContext, @Query() q: ListQuery) {
    return this.svc.page(ctx, q);
  }

  @Get(':id')
  get(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.get(ctx, p.id);
  }

  /** Cashiers can add customers at the till (e.g. buyer details for a tax invoice). */
  @Roles(...FRONT_OF_HOUSE)
  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: CreateCustomerDto) {
    return this.svc.create(ctx, dto);
  }

  @Roles(...FRONT_OF_HOUSE)
  @Patch(':id')
  update(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: UpdateCustomerDto) {
    return this.svc.update(ctx, p.id, dto);
  }

  @Roles(...MANAGERS)
  @Delete(':id')
  deactivate(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.deactivate(ctx, p.id);
  }
}

@Module({
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
