import { Module } from '@nestjs/common';
import {
  CategoriesController,
  CurrenciesController,
  ModifierGroupsController,
  PriceListsController,
  ProductsController,
  TaxRatesController,
  UnitsController,
} from './catalog.controller.js';
import { ProductsService } from './products.service.js';
import { AttributesController, AttributesService, StorePricesController, StorePricesService } from './stock-masters.js';
import {
  CategoriesService,
  CurrenciesService,
  ModifierGroupsService,
  PriceListsService,
  TaxRatesService,
  UnitsService,
} from './settings.service.js';

@Module({
  controllers: [
    ProductsController,
    CategoriesController,
    TaxRatesController,
    UnitsController,
    CurrenciesController,
    PriceListsController,
    ModifierGroupsController,
    AttributesController,
    StorePricesController,
  ],
  providers: [
    ProductsService,
    CategoriesService,
    TaxRatesService,
    UnitsService,
    CurrenciesService,
    PriceListsService,
    ModifierGroupsService,
    AttributesService,
    StorePricesService,
  ],
  exports: [ProductsService],
})
export class CatalogModule {}
