"use client";

import { SalesArt } from "@/components/module-art";
import { MenuItem, ModuleMenuBar } from "@/components/stock-nav";
import type { Role } from "@/lib/api";
import { BOOKKEEPERS, MANAGERS } from "@/lib/session";

const SELLERS: Role[] = [...MANAGERS, "cashier", "waiter"];

/** The Sales Invoices module's menus. */
export const SALES_MENUS: { label: string; items: MenuItem[] }[] = [
  {
    label: "Master",
    items: [
      { href: "/sales/customers", label: "Customers", hint: "Buyers, their tax details and credit" },
      { href: "/sales/categories", label: "Item Groups / Categories", hint: "How products are grouped" },
      { href: "/sales/customer-groups", label: "Customer Groups", hint: "Staff, schools, wholesale… with discounts" },
      { href: "/sales/staff", label: "Cashiers & Staff", hint: "Who can sell, with till PINs", roles: MANAGERS },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/sales/invoices", label: "Sales Invoices", hint: "Every sale, from the till or here", roles: [...SELLERS, "accountant"] },
      { href: "/sales/quotations", label: "Quotations", hint: "Prices given to a customer, not yet sold", roles: SELLERS },
      { href: "/sales/kitchen", label: "Kitchen Orders", hint: "Dishes waiting to be made and served", roles: SELLERS },
      { href: "/sales/shifts", label: "Shifts & Cash-up", hint: "Open a till, count the cash at close", roles: [...SELLERS, "accountant"] },
      { href: "/sales/cash-transfers", label: "Cash Transfers", hint: "Cash banked or moved between stores", roles: BOOKKEEPERS },
      { href: "/sales/import", label: "Import Sales Invoices", hint: "Bring in sales from a spreadsheet", roles: MANAGERS },
    ],
  },
  {
    label: "Reports",
    items: [
      { href: "/sales/reports/item-profitability", label: "Item Profitability", hint: "Revenue, cost and profit per item", roles: BOOKKEEPERS },
      { href: "/sales/reports/shift-reconciliation", label: "Shift Reconciliation Report", hint: "Expected against counted cash", roles: BOOKKEEPERS },
      { href: "/sales/reports/category-profitability", label: "Category Profitability", hint: "Profit per item group", roles: BOOKKEEPERS },
      { href: "/sales/reports/sales-tax", label: "Sales Item Tax Report", hint: "VAT charged on sales", roles: BOOKKEEPERS },
      { href: "/sales/reports/purchases-tax", label: "Purchases Item Tax Report", hint: "VAT paid on bills and expenses", roles: BOOKKEEPERS },
      { href: "/sales/reports/cashier-profitability", label: "Cashier Profitability", hint: "Sales and profit per cashier", roles: BOOKKEEPERS },
      { href: "/sales/reports/cashbook", label: "Store Cashbook", hint: "Every cash movement in a store", roles: BOOKKEEPERS },
      { href: "/sales/reports/shop-profitability", label: "Shop Profitability", hint: "Profit per store", roles: BOOKKEEPERS },
      { href: "/sales/reports/cash-balance", label: "Cash Balance", hint: "Cash in each store's tills now", roles: BOOKKEEPERS },
      { href: "/sales/reports/daily-sales", label: "Daily Sales", hint: "Takings per day and how people paid", roles: BOOKKEEPERS },
      { href: "/sales/reports/returns", label: "Sales Returns", hint: "Refunds and why", roles: BOOKKEEPERS },
    ],
  },
];

export function SalesMenuBar() {
  return <ModuleMenuBar title="Sales Invoices" home="/sales/invoices" art={SalesArt} menus={SALES_MENUS} />;
}
