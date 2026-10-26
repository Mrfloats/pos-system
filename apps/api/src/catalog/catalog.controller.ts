import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { eq } from 'drizzle-orm';
import { ADMINS, ALL_ROLES, type AuthContext, Ctx, MANAGERS, Roles } from '../common/auth-context.js';
import { categories } from '../db/schema.js';
import { IdParam } from '../organization/organization.dto.js';
import {
  CategoryQuery,
  CreateCategoryDto,
  CreateCurrencyDto,
  CreateModifierGroupDto,
  CreatePriceListDto,
  CreateProductDto,
  CreateTaxRateDto,
  CreateUnitDto,
  ProductQuery,
  SetPriceListItemsDto,
  UpdateCategoryDto,
  UpdateCurrencyDto,
  UpdateModifierGroupDto,
  UpdatePriceListDto,
  UpdateProductDto,
  UpdateTaxRateDto,
  UpdateUnitDto,
} from './catalog.dto.js';
import { ProductsService } from './products.service.js';
import {
  CategoriesService,
  CurrenciesService,
  ModifierGroupsService,
  PriceListsService,
  TaxRatesService,
  UnitsService,
} from './settings.service.js';

class BarcodeParam {
  @IsString() @Length(1, 64) code: string;
}

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Roles(...ALL_ROLES)
  @Get()
  list(@Ctx() ctx: AuthContext, @Query() q: ProductQuery) {
    return this.products.list(ctx, q);
  }

  /** Till lookup for a scanned barcode (variant or wholesale pack). */
  @Get('barcode/:code')
  byBarcode(@Ctx() ctx: AuthContext, @Param() p: BarcodeParam) {
    return this.products.lookupBarcode(ctx, p.code);
  }

  @Get(':id')
  get(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.products.get(ctx, p.id);
  }

  @Roles(...MANAGERS)
  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: CreateProductDto) {
    return this.products.create(ctx, dto);
  }

  @Roles(...MANAGERS)
  @Patch(':id')
  update(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: UpdateProductDto) {
    return this.products.update(ctx, p.id, dto);
  }

  /** Archives the product (hidden from the till, history kept). */
  @Roles(...MANAGERS)
  @Delete(':id')
  archive(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.products.archive(ctx, p.id);
  }
}

@ApiTags('categories')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly svc: CategoriesService) {}

  @Get()
  list(@Ctx() ctx: AuthContext, @Query() q: CategoryQuery) {
    return this.svc.list(ctx, { where: q.active !== undefined ? [eq(categories.active, q.active)] : [] });
  }

  @Roles(...MANAGERS)
  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: CreateCategoryDto) {
    return this.svc.create(ctx, dto);
  }

  @Roles(...MANAGERS)
  @Patch(':id')
  update(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: UpdateCategoryDto) {
    return this.svc.update(ctx, p.id, dto);
  }

  @Roles(...MANAGERS)
  @Delete(':id')
  remove(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.remove(ctx, p.id);
  }
}

@ApiTags('tax rates')
@ApiBearerAuth()
@Controller('tax-rates')
export class TaxRatesController {
  constructor(private readonly svc: TaxRatesService) {}

  @Get()
  list(@Ctx() ctx: AuthContext) {
    return this.svc.list(ctx);
  }

  @Roles(...ADMINS)
  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: CreateTaxRateDto) {
    return this.svc.create(ctx, dto);
  }

  @Roles(...ADMINS)
  @Patch(':id')
  update(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: UpdateTaxRateDto) {
    return this.svc.update(ctx, p.id, dto);
  }

  @Roles(...ADMINS)
  @Delete(':id')
  remove(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.remove(ctx, p.id);
  }
}

@ApiTags('units')
@ApiBearerAuth()
@Controller('units')
export class UnitsController {
  constructor(private readonly svc: UnitsService) {}

  @Get()
  list(@Ctx() ctx: AuthContext) {
    return this.svc.list(ctx);
  }

  @Roles(...MANAGERS)
  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: CreateUnitDto) {
    return this.svc.create(ctx, dto);
  }

  @Roles(...MANAGERS)
  @Patch(':id')
  update(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: UpdateUnitDto) {
    return this.svc.update(ctx, p.id, dto);
  }

  @Roles(...MANAGERS)
  @Delete(':id')
  remove(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.remove(ctx, p.id);
  }
}

@ApiTags('currencies')
@ApiBearerAuth()
@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly svc: CurrenciesService) {}

  @Get()
  list(@Ctx() ctx: AuthContext) {
    return this.svc.list(ctx);
  }

  @Roles(...ADMINS)
  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: CreateCurrencyDto) {
    return this.svc.create(ctx, dto);
  }

  /** Update the exchange rate (managers do this daily in multi-currency shops). */
  @Roles(...MANAGERS)
  @Patch(':id')
  update(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: UpdateCurrencyDto) {
    return this.svc.update(ctx, p.id, dto);
  }

  @Roles(...ADMINS)
  @Delete(':id')
  remove(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.remove(ctx, p.id);
  }
}

@ApiTags('price lists')
@ApiBearerAuth()
@Controller('price-lists')
export class PriceListsController {
  constructor(private readonly svc: PriceListsService) {}

  @Get()
  list(@Ctx() ctx: AuthContext) {
    return this.svc.list(ctx);
  }

  @Roles(...MANAGERS)
  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: CreatePriceListDto) {
    return this.svc.create(ctx, dto);
  }

  @Roles(...MANAGERS)
  @Patch(':id')
  update(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: UpdatePriceListDto) {
    return this.svc.update(ctx, p.id, dto);
  }

  @Roles(...MANAGERS)
  @Delete(':id')
  remove(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.remove(ctx, p.id);
  }

  @Get(':id/items')
  items(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.items(ctx, p.id);
  }

  @Roles(...MANAGERS)
  @Put(':id/items')
  setItems(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: SetPriceListItemsDto) {
    return this.svc.setItems(ctx, p.id, dto);
  }
}

@ApiTags('modifier groups')
@ApiBearerAuth()
@Controller('modifier-groups')
export class ModifierGroupsController {
  constructor(private readonly svc: ModifierGroupsService) {}

  @Get()
  list(@Ctx() ctx: AuthContext) {
    return this.svc.list(ctx);
  }

  @Roles(...MANAGERS)
  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: CreateModifierGroupDto) {
    return this.svc.create(ctx, dto);
  }

  @Roles(...MANAGERS)
  @Patch(':id')
  update(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: UpdateModifierGroupDto) {
    return this.svc.update(ctx, p.id, dto);
  }

  @Roles(...MANAGERS)
  @Delete(':id')
  remove(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.remove(ctx, p.id);
  }
}
