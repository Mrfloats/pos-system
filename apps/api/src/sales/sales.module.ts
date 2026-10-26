import { Body, Controller, Delete, Get, HttpCode, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccountingModule } from '../accounting/accounting.module.js';
import { type AuthContext, BOOKKEEPERS, Ctx, FRONT_OF_HOUSE, MANAGERS, Roles } from '../common/auth-context.js';
import { IdParam } from '../organization/organization.dto.js';
import { SalesOpsService, CustomerGroupsService } from './sales-ops.service.js';
import { SalesReportsService } from './sales-reports.service.js';
import {
  CashbookQuery,
  CashTransferDto,
  CashTransferQuery,
  CloseShiftDto,
  ConvertQuotationDto,
  CreateQuotationDto,
  CreateReturnDto,
  CreateSaleDto,
  CustomerGroupDto,
  ImportSalesDto,
  KitchenQuery,
  KitchenUpdateDto,
  OpenShiftDto,
  PreviewSaleDto,
  ProfitQuery,
  SaleQuery,
  SalesRangeQuery,
  ShiftQuery,
  UpdateCustomerGroupDto,
} from './sales.dto.js';
import { SalesService } from './sales.service.js';

/** Reports also open to accountants, who keep the books but don't sell. */
const REPORT_READERS = BOOKKEEPERS;

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales')
export class SalesController {
  constructor(
    private readonly svc: SalesService,
    private readonly ops: SalesOpsService,
  ) {}

  @Roles(...FRONT_OF_HOUSE, 'accountant')
  @Get()
  list(@Ctx() ctx: AuthContext, @Query() q: SaleQuery) {
    return this.svc.list(ctx, q);
  }

  @Roles(...FRONT_OF_HOUSE)
  @Get('kitchen')
  kitchen(@Ctx() ctx: AuthContext, @Query() q: KitchenQuery) {
    return this.svc.kitchen(ctx, q);
  }

  @Roles(...FRONT_OF_HOUSE, 'accountant')
  @Get(':id')
  get(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.get(ctx, p.id);
  }

  @Roles(...FRONT_OF_HOUSE)
  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: CreateSaleDto) {
    return this.svc.createSale(ctx, dto);
  }

  @Roles(...FRONT_OF_HOUSE)
  @Post('preview')
  @HttpCode(200)
  preview(@Ctx() ctx: AuthContext, @Body() dto: PreviewSaleDto) {
    return this.svc.preview(ctx, dto);
  }

  @Roles(...FRONT_OF_HOUSE)
  @Post('quotations')
  quote(@Ctx() ctx: AuthContext, @Body() dto: CreateQuotationDto) {
    return this.svc.createQuotation(ctx, dto);
  }

  @Roles(...FRONT_OF_HOUSE)
  @Post(':id/convert')
  convert(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: ConvertQuotationDto) {
    return this.svc.convertQuotation(ctx, p.id, dto);
  }

  @Roles(...FRONT_OF_HOUSE)
  @Post(':id/cancel')
  cancel(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.cancelQuotation(ctx, p.id);
  }

  /** Refunds need a manager, so a cashier can't refund their own sales unchecked. */
  @Roles(...MANAGERS)
  @Post(':id/returns')
  createReturn(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: CreateReturnDto) {
    return this.svc.createReturn(ctx, p.id, dto);
  }

  @Roles(...MANAGERS)
  @Post(':id/void')
  void(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.voidSale(ctx, p.id);
  }

  @Roles(...FRONT_OF_HOUSE)
  @Patch(':id/kitchen')
  updateKitchen(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: KitchenUpdateDto) {
    return this.svc.updateKitchen(ctx, p.id, dto);
  }

  @Roles(...MANAGERS)
  @Post('import')
  import(@Ctx() ctx: AuthContext, @Body() dto: ImportSalesDto) {
    return this.ops.importSales(ctx, dto);
  }
}

@ApiTags('sales')
@ApiBearerAuth()
@Roles(...REPORT_READERS)
@Controller('sales/reports')
export class SalesReportsController {
  constructor(private readonly svc: SalesReportsService) {}

  @Get('profitability')
  profitability(@Ctx() ctx: AuthContext, @Query() q: ProfitQuery) {
    return this.svc.profitability(ctx, q);
  }

  @Get('sales-tax')
  salesTax(@Ctx() ctx: AuthContext, @Query() q: SalesRangeQuery) {
    return this.svc.salesTax(ctx, q);
  }

  @Get('purchases-tax')
  purchasesTax(@Ctx() ctx: AuthContext, @Query() q: SalesRangeQuery) {
    return this.svc.purchasesTax(ctx, q);
  }

  @Get('daily')
  daily(@Ctx() ctx: AuthContext, @Query() q: SalesRangeQuery) {
    return this.svc.dailySales(ctx, q);
  }

  @Get('returns')
  returns(@Ctx() ctx: AuthContext, @Query() q: SalesRangeQuery) {
    return this.svc.returns(ctx, q);
  }

  @Get('cash-balance')
  cashBalance(@Ctx() ctx: AuthContext) {
    return this.svc.cashBalance(ctx);
  }

  @Get('cashbook')
  cashbook(@Ctx() ctx: AuthContext, @Query() q: CashbookQuery) {
    return this.svc.cashbook(ctx, q);
  }
}

@ApiTags('shifts')
@ApiBearerAuth()
@Roles(...FRONT_OF_HOUSE)
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly ops: SalesOpsService) {}

  @Roles(...FRONT_OF_HOUSE, 'accountant')
  @Get()
  list(@Ctx() ctx: AuthContext, @Query() q: ShiftQuery) {
    return this.ops.listShifts(ctx, q);
  }

  @Roles(...FRONT_OF_HOUSE, 'accountant')
  @Get(':id')
  get(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.ops.getShift(ctx, p.id);
  }

  @Post()
  open(@Ctx() ctx: AuthContext, @Body() dto: OpenShiftDto) {
    return this.ops.openShift(ctx, dto);
  }

  @Post(':id/close')
  close(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: CloseShiftDto) {
    return this.ops.closeShift(ctx, p.id, dto);
  }
}

@ApiTags('cash-transfers')
@ApiBearerAuth()
@Controller('cash-transfers')
export class CashTransfersController {
  constructor(private readonly ops: SalesOpsService) {}

  @Roles(...BOOKKEEPERS)
  @Get()
  list(@Ctx() ctx: AuthContext, @Query() q: CashTransferQuery) {
    return this.ops.listTransfers(ctx, q);
  }

  @Roles(...MANAGERS)
  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: CashTransferDto) {
    return this.ops.createTransfer(ctx, dto);
  }
}

@ApiTags('customer-groups')
@ApiBearerAuth()
@Controller('customer-groups')
export class CustomerGroupsController {
  constructor(private readonly svc: CustomerGroupsService) {}

  @Get()
  list(@Ctx() ctx: AuthContext) {
    return this.svc.listWithCounts(ctx);
  }

  @Roles(...MANAGERS)
  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: CustomerGroupDto) {
    return this.svc.create(ctx, dto);
  }

  @Roles(...MANAGERS)
  @Patch(':id')
  update(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: UpdateCustomerGroupDto) {
    return this.svc.update(ctx, p.id, dto);
  }

  @Roles(...MANAGERS)
  @Delete(':id')
  remove(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.remove(ctx, p.id);
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [SalesReportsController, SalesController, ShiftsController, CashTransfersController, CustomerGroupsController],
  providers: [SalesService, SalesOpsService, SalesReportsService, CustomerGroupsService],
})
export class SalesModule {}
