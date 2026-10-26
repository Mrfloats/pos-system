/**
 * The chart of accounts every business starts with. Accounts with a systemKey
 * are the ones the API posts to automatically; they can be renamed but not
 * removed. Everything else can be edited, deactivated or added to.
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export type SystemKey =
  | 'cash'
  | 'bank'
  | 'mobile_money'
  | 'receivables'
  | 'inventory'
  | 'vat_input'
  | 'payables'
  | 'grni'
  | 'vat_output'
  | 'retained_earnings'
  | 'opening_balance'
  | 'sales'
  | 'cogs'
  | 'stock_loss'
  | 'fx';

export interface ChartAccount {
  code: string;
  name: string;
  type: AccountType;
  systemKey?: SystemKey;
  isBank?: boolean;
  description?: string;
}

export const DEFAULT_CHART: ChartAccount[] = [
  // Assets
  { code: '1000', name: 'Cash on hand', type: 'asset', systemKey: 'cash', isBank: true, description: 'Till takings and petty cash' },
  { code: '1100', name: 'Bank account', type: 'asset', systemKey: 'bank', isBank: true },
  { code: '1150', name: 'Mobile money', type: 'asset', systemKey: 'mobile_money', isBank: true, description: 'EcoCash, OneMoney, InnBucks' },
  { code: '1200', name: 'Customers who owe us', type: 'asset', systemKey: 'receivables', description: 'Accounts receivable. Posted by invoices and receipts only' },
  { code: '1300', name: 'Stock', type: 'asset', systemKey: 'inventory', description: 'Value of goods on hand at cost' },
  { code: '1400', name: 'VAT we can claim back', type: 'asset', systemKey: 'vat_input', description: 'Input tax on purchases' },
  { code: '1500', name: 'Equipment and fittings', type: 'asset' },
  { code: '1510', name: 'Vehicles', type: 'asset' },
  // Liabilities
  { code: '2000', name: 'Suppliers we owe', type: 'liability', systemKey: 'payables', description: 'Accounts payable. Posted by bills and payments only' },
  { code: '2100', name: 'Stock received, not yet billed', type: 'liability', systemKey: 'grni', description: 'Goods received in stock before the supplier bill is entered. Use this account on the bill to clear it' },
  { code: '2200', name: 'VAT owed to ZIMRA', type: 'liability', systemKey: 'vat_output', description: 'Output tax on sales' },
  { code: '2300', name: 'Wages owed', type: 'liability' },
  { code: '2400', name: 'Loans', type: 'liability' },
  // Equity
  { code: '3000', name: "Owner's capital", type: 'equity' },
  { code: '3100', name: "Owner's drawings", type: 'equity' },
  { code: '3200', name: 'Retained earnings', type: 'equity', systemKey: 'retained_earnings' },
  { code: '3900', name: 'Opening balances', type: 'equity', systemKey: 'opening_balance', description: 'Balances brought in when the books were started' },
  // Income
  { code: '4000', name: 'Sales', type: 'income', systemKey: 'sales' },
  { code: '4100', name: 'Delivery and service income', type: 'income' },
  { code: '4900', name: 'Other income', type: 'income' },
  // Cost of sales
  { code: '5000', name: 'Cost of goods sold', type: 'expense', systemKey: 'cogs' },
  { code: '5100', name: 'Stock losses and waste', type: 'expense', systemKey: 'stock_loss', description: 'Waste, breakages and stock-take differences' },
  // Expenses
  { code: '6000', name: 'Rent', type: 'expense' },
  { code: '6010', name: 'Electricity and water', type: 'expense' },
  { code: '6020', name: 'Wages and salaries', type: 'expense' },
  { code: '6030', name: 'Transport and fuel', type: 'expense' },
  { code: '6040', name: 'Bank and mobile money charges', type: 'expense' },
  { code: '6050', name: 'Phone and internet', type: 'expense' },
  { code: '6060', name: 'Repairs and maintenance', type: 'expense' },
  { code: '6070', name: 'Licences, levies and fees', type: 'expense' },
  { code: '6080', name: 'Office and general', type: 'expense' },
  { code: '6090', name: 'Advertising', type: 'expense' },
  { code: '6900', name: 'Exchange rate gains and losses', type: 'expense', systemKey: 'fx', description: 'Differences when a foreign-currency invoice or bill is paid at a different rate' },
];

/** Control accounts kept in step with invoices and bills; manual journals and document lines can't post to them. */
export const CONTROL_ACCOUNTS: SystemKey[] = ['receivables', 'payables'];
