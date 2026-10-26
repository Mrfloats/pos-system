import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ACCOUNTANTS, type AuthContext, BOOKKEEPERS, Ctx, Roles } from '../common/auth-context.js';
import { ListQuery } from '../common/validation.js';
import { IdParam } from '../organization/organization.dto.js';
import {
  AsOfQuery,
  CloseBooksDto,
  CreateAccountDto,
  CreateBillDto,
  CreateExpenseDto,
  CreateInvoiceDto,
  CreateJournalDto,
  CreateSupplierDto,
  CreateTransferDto,
  DocumentQuery,
  ExpenseQuery,
  JournalQuery,
  LedgerQuery,
  PaymentDto,
  RangeQuery,
  ReverseDto,
  UpdateAccountDto,
  UpdateSupplierDto,
} from './accounting.dto.js';
import { AccountingService } from './accounting.service.js';
import { DocumentsService, SuppliersService } from './documents.service.js';
import { ReportsService } from './reports.service.js';

@ApiTags('suppliers')
@ApiBearerAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly svc: SuppliersService) {}

  @Get()
  list(@Ctx() ctx: AuthContext, @Query() q: ListQuery) {
    return this.svc.page(ctx, q);
  }

  @Get(':id')
  get(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.get(ctx, p.id);
  }

  @Roles(...BOOKKEEPERS)
  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: CreateSupplierDto) {
    return this.svc.create(ctx, dto);
  }

  @Roles(...BOOKKEEPERS)
  @Patch(':id')
  update(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: UpdateSupplierDto) {
    return this.svc.update(ctx, p.id, dto);
  }

  /** Suppliers with bills are kept for the records, so this switches them off. */
  @Roles(...BOOKKEEPERS)
  @Delete(':id')
  deactivate(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.update(ctx, p.id, { active: false });
  }
}

/** Bookkeeping: any bookkeeper can use these unless an endpoint says otherwise. */
@ApiTags('accounting')
@ApiBearerAuth()
@Roles(...BOOKKEEPERS)
@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly accounting: AccountingService,
    private readonly documents: DocumentsService,
    private readonly reports: ReportsService,
  ) {}

  @Get('summary')
  summary(@Ctx() ctx: AuthContext) {
    return this.reports.summary(ctx);
  }

  // ----- Chart of accounts

  @Get('accounts')
  accounts(@Ctx() ctx: AuthContext) {
    return this.accounting.listAccounts(ctx);
  }

  @Roles(...ACCOUNTANTS)
  @Post('accounts')
  createAccount(@Ctx() ctx: AuthContext, @Body() dto: CreateAccountDto) {
    return this.accounting.createAccount(ctx, dto);
  }

  @Roles(...ACCOUNTANTS)
  @Patch('accounts/:id')
  updateAccount(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: UpdateAccountDto) {
    return this.accounting.updateAccount(ctx, p.id, dto);
  }

  // ----- Journal entries

  @Get('journals')
  journals(@Ctx() ctx: AuthContext, @Query() q: JournalQuery) {
    return this.accounting.listJournals(ctx, q);
  }

  @Get('journals/:id')
  journal(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.accounting.getJournal(ctx, p.id);
  }

  @Roles(...ACCOUNTANTS)
  @Post('journals')
  createJournal(@Ctx() ctx: AuthContext, @Body() dto: CreateJournalDto) {
    return this.accounting.createJournal(ctx, dto);
  }

  @Roles(...ACCOUNTANTS)
  @Post('journals/:id/reverse')
  reverseJournal(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: ReverseDto) {
    return this.accounting.reverseJournal(ctx, p.id, dto);
  }

  // ----- Closing periods

  @Get('periods')
  periods(@Ctx() ctx: AuthContext) {
    return this.accounting.periods(ctx);
  }

  @Roles(...ACCOUNTANTS)
  @Post('periods/close')
  close(@Ctx() ctx: AuthContext, @Body() dto: CloseBooksDto) {
    return this.accounting.closeBooks(ctx, dto);
  }

  // ----- Customer invoices

  @Get('invoices')
  invoices(@Ctx() ctx: AuthContext, @Query() q: DocumentQuery) {
    return this.documents.listDocuments(ctx, 'invoice', q);
  }

  @Get('invoices/:id')
  invoice(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.documents.getDocument(ctx, 'invoice', p.id);
  }

  @Post('invoices')
  createInvoice(@Ctx() ctx: AuthContext, @Body() dto: CreateInvoiceDto) {
    return this.documents.createInvoice(ctx, dto);
  }

  @Post('invoices/:id/void')
  voidInvoice(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.documents.voidDocument(ctx, 'invoice', p.id);
  }

  @Post('invoices/:id/payments')
  receive(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: PaymentDto) {
    return this.documents.pay(ctx, 'invoice', p.id, dto);
  }

  // ----- Supplier bills

  @Get('bills')
  bills(@Ctx() ctx: AuthContext, @Query() q: DocumentQuery) {
    return this.documents.listDocuments(ctx, 'bill', q);
  }

  @Get('bills/:id')
  bill(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.documents.getDocument(ctx, 'bill', p.id);
  }

  @Post('bills')
  createBill(@Ctx() ctx: AuthContext, @Body() dto: CreateBillDto) {
    return this.documents.createBill(ctx, dto);
  }

  @Post('bills/:id/void')
  voidBill(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.documents.voidDocument(ctx, 'bill', p.id);
  }

  @Post('bills/:id/payments')
  payBill(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: PaymentDto) {
    return this.documents.pay(ctx, 'bill', p.id, dto);
  }

  @Post('payments/:id/void')
  voidPayment(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.documents.voidPayment(ctx, p.id);
  }

  // ----- Expenses and transfers

  @Get('expenses')
  expenses(@Ctx() ctx: AuthContext, @Query() q: ExpenseQuery) {
    return this.documents.listExpenses(ctx, q);
  }

  @Post('expenses')
  createExpense(@Ctx() ctx: AuthContext, @Body() dto: CreateExpenseDto) {
    return this.documents.createExpense(ctx, dto);
  }

  @Post('expenses/:id/void')
  voidExpense(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.documents.voidExpense(ctx, p.id);
  }

  @Post('transfers')
  transfer(@Ctx() ctx: AuthContext, @Body() dto: CreateTransferDto) {
    return this.documents.transfer(ctx, dto);
  }

  // ----- Reports

  @Get('reports/trial-balance')
  trialBalance(@Ctx() ctx: AuthContext, @Query() q: AsOfQuery) {
    return this.reports.trialBalance(ctx, q.asOf);
  }

  @Get('reports/profit-and-loss')
  profitAndLoss(@Ctx() ctx: AuthContext, @Query() q: RangeQuery) {
    return this.reports.profitAndLoss(ctx, q.from, q.to);
  }

  @Get('reports/balance-sheet')
  balanceSheet(@Ctx() ctx: AuthContext, @Query() q: AsOfQuery) {
    return this.reports.balanceSheet(ctx, q.asOf);
  }

  @Get('reports/general-ledger')
  generalLedger(@Ctx() ctx: AuthContext, @Query() q: LedgerQuery) {
    return this.reports.generalLedger(ctx, q.accountId, q.from, q.to);
  }

  @Get('reports/vat')
  vat(@Ctx() ctx: AuthContext, @Query() q: RangeQuery) {
    return this.reports.vat(ctx, q.from, q.to);
  }

  @Get('reports/aged-receivables')
  agedReceivables(@Ctx() ctx: AuthContext, @Query() q: AsOfQuery) {
    return this.reports.aged(ctx, 'receivables', q.asOf);
  }

  @Get('reports/aged-payables')
  agedPayables(@Ctx() ctx: AuthContext, @Query() q: AsOfQuery) {
    return this.reports.aged(ctx, 'payables', q.asOf);
  }
}
