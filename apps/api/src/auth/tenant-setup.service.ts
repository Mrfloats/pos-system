import { Injectable } from '@nestjs/common';
import { Tx } from '../db/db.service.js';
import { DEFAULT_CHART } from '../accounting/chart.js';
import { accounts, currencies, priceLists, stores, taxRates, units } from '../db/schema.js';
import { BusinessType } from './auth.dto.js';

/**
 * Creates the starting configuration for a new business so the till can sell
 * immediately: a first store, its base currency, tax rates, units, price lists
 * and a chart of accounts.
 * Everything can be edited afterwards in the backoffice.
 */
@Injectable()
export class TenantSetupService {
  async seedDefaults(
    tx: Tx,
    tenantId: string,
    opts: { businessType: BusinessType; country: string; baseCurrency: string },
  ) {
    const storeType = opts.businessType === 'restaurant' ? 'restaurant' : 'shop';
    await tx.insert(stores).values({
      tenantId,
      name: opts.businessType === 'restaurant' ? 'Main Restaurant' : 'Main Store',
      code: 'MAIN',
      type: storeType,
    });

    await tx.insert(currencies).values({
      tenantId,
      code: opts.baseCurrency,
      name: opts.baseCurrency === 'USD' ? 'US Dollar' : opts.baseCurrency,
      symbol: opts.baseCurrency === 'USD' ? '$' : opts.baseCurrency,
      rateToBase: '1',
      isBase: true,
    });

    if (opts.country === 'ZW') {
      // Zimbabwe standard VAT rate as at 2025 — confirm against ZIMRA before going live.
      await tx.insert(taxRates).values([
        { tenantId, name: 'Standard VAT', code: 'VAT', rate: '15.50', isDefault: true },
        { tenantId, name: 'Zero-rated', code: 'ZERO', rate: '0' },
        { tenantId, name: 'Exempt', code: 'EXEMPT', rate: '0' },
      ]);
    } else {
      await tx
        .insert(taxRates)
        .values({ tenantId, name: 'No tax', code: 'NONE', rate: '0', isDefault: true });
    }

    await tx.insert(units).values([
      { tenantId, name: 'Each', abbreviation: 'ea' },
      { tenantId, name: 'Kilogram', abbreviation: 'kg', allowsDecimal: true },
      { tenantId, name: 'Litre', abbreviation: 'l', allowsDecimal: true },
    ]);

    const lists = [{ tenantId, name: 'Retail', currencyCode: opts.baseCurrency, isDefault: true }];
    if (opts.businessType === 'wholesale' || opts.businessType === 'mixed') {
      lists.push({ tenantId, name: 'Wholesale', currencyCode: opts.baseCurrency, isDefault: false });
    }
    await tx.insert(priceLists).values(lists);

    await tx.insert(accounts).values(DEFAULT_CHART.map((a) => ({ ...a, tenantId, isBank: a.isBank ?? false })));
  }
}
