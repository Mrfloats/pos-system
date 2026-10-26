import { Boxes, LayoutGrid, Receipt, Settings, Truck, Users, Wallet } from "lucide-react";
import {
  AccountsArt,
  DashboardArt,
  SalesArt,
  SuppliersArt,
  SettingsArt,
  StaffArt,
  StockArt,
} from "@/components/module-art";
import type { Role } from "@/lib/api";
import { BOOKKEEPERS, MANAGERS } from "@/lib/session";

const SALES_ROLES: Role[] = [...MANAGERS, "cashier", "waiter", "accountant"];

/** Every area of the backoffice: the home launcher tiles and the sidebar both read this list. */
export const MODULES = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid, art: DashboardArt },
  // Products, categories, prices, stock operations and stock reports all live inside Stock.
  { href: "/stock", label: "Stock", icon: Boxes, art: StockArt },
  // Sales, quotations, kitchen orders, cash, customers and sales reports.
  { href: "/sales", label: "Sales Invoices", icon: Receipt, art: SalesArt, roles: SALES_ROLES },
  // Purchases of stock, supplier list, purchase bill import.
  { href: "/suppliers", label: "Suppliers", icon: Truck, art: SuppliersArt, roles: [...BOOKKEEPERS, "stock_clerk"] as Role[] },
  { href: "/accounts", label: "Accounts", icon: Wallet, art: AccountsArt, roles: BOOKKEEPERS },
  { href: "/staff", label: "Staff", icon: Users, art: StaffArt, roles: MANAGERS },
  { href: "/settings", label: "Settings", icon: Settings, art: SettingsArt },
];
