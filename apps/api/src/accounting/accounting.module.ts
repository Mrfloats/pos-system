import { Module } from '@nestjs/common';
import { AccountingController, SuppliersController } from './accounting.controller.js';
import { AccountingService } from './accounting.service.js';
import { DocumentsService, SuppliersService } from './documents.service.js';
import { LedgerService } from './ledger.service.js';
import { PurchasesController, PurchasesService } from './purchases.js';
import { ReportsService } from './reports.service.js';

@Module({
  controllers: [SuppliersController, AccountingController, PurchasesController],
  providers: [LedgerService, AccountingService, DocumentsService, SuppliersService, ReportsService, PurchasesService],
  // Other modules (stock, and later sales) post to the ledger through LedgerService.
  exports: [LedgerService],
})
export class AccountingModule {}
