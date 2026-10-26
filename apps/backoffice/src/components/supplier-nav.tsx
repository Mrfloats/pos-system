"use client";

import { SuppliersArt } from "@/components/module-art";
import { MenuItem, ModuleMenuBar } from "@/components/stock-nav";
import type { Role } from "@/lib/api";
import { BOOKKEEPERS } from "@/lib/session";

/** Bookkeepers and stock clerks record goods bought from suppliers. */
export const PURCHASERS: Role[] = [...BOOKKEEPERS, "stock_clerk"];

export const SUPPLIER_MENUS: { label: string; items: MenuItem[] }[] = [
  { label: "Master", items: [{ href: "/suppliers/list", label: "Suppliers", hint: "Who you buy from, and what you owe each" }] },
  {
    label: "Operations",
    items: [
      { href: "/suppliers/purchases", label: "Purchases", hint: "Goods bought: received into stock, owed or paid" },
      { href: "/suppliers/import", label: "Import Purchase Bills", hint: "Bring in supplier bills from a spreadsheet" },
    ],
  },
  {
    label: "Reports",
    items: [{ href: "/suppliers/reports/purchases-tax", label: "Purchases Item Tax Report", hint: "VAT paid on purchases, bills and expenses", roles: BOOKKEEPERS }],
  },
];

export function SupplierMenuBar() {
  return <ModuleMenuBar title="Suppliers" home="/suppliers/purchases" art={SuppliersArt} menus={SUPPLIER_MENUS} />;
}
