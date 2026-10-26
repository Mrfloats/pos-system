"use client";

import { ChevronDown, Store } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { StockArt } from "@/components/module-art";
import type { Role } from "@/lib/api";
import { STOCK_WRITERS, useSession } from "@/lib/session";

export interface MenuItem {
  href: string;
  label: string;
  hint: string;
  roles?: Role[];
}

export const STOCK_READERS: Role[] = [...STOCK_WRITERS, "accountant"];

/** The Stock module's menus. Every stock screen lives under one of these. */
export const STOCK_MENUS: { label: string; items: MenuItem[] }[] = [
  {
    label: "Master",
    items: [
      { href: "/stock/products", label: "Products", hint: "Everything you sell or stock" },
      { href: "/stock/attributes", label: "Variant Attributes", hint: "Size, colour, flavour…" },
      { href: "/stock/price-lists", label: "Pricelists", hint: "Wholesale and quantity-break prices" },
      { href: "/stock/store-prices", label: "Store Prices", hint: "A different price in one store" },
      { href: "/stock/categories", label: "Item Groups / Categories", hint: "How products are grouped" },
      { href: "/stock/units", label: "UOM", hint: "Units of measure" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/stock/adjustments", label: "Stock Adjustment", hint: "Receive, count, adjust or write off", roles: STOCK_WRITERS },
      { href: "/stock/transfers", label: "Stock Transfers", hint: "Move stock between stores", roles: STOCK_WRITERS },
    ],
  },
  {
    label: "Reports",
    items: [
      { href: "/stock/reports/valuation", label: "Stock Valuation", hint: "What your stock is worth now", roles: STOCK_READERS },
      { href: "/stock/reports/ledger", label: "Stock Ledger", hint: "Every movement in a period", roles: STOCK_READERS },
      { href: "/stock/reports/valuation-by-date", label: "Stock Valuation By Date", hint: "What it was worth on a past day", roles: STOCK_READERS },
      { href: "/stock/reports/item-ledger", label: "Item Detailed Ledger", hint: "One item's movements and balance", roles: STOCK_READERS },
      { href: "/stock/reports/item-summary", label: "Item Summary Ledger", hint: "Opening, in, out and closing per item", roles: STOCK_READERS },
    ],
  },
];

export function ModuleMenuBar({ title, home, art: Art, menus: allMenus }: { title: string; home: string; art: React.ComponentType<{ className?: string }>; menus: { label: string; items: MenuItem[] }[] }) {
  const pathname = usePathname();
  const { can, stores, storeId } = useSession();
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const store = stores.find((s) => s.id === storeId);

  // Close after navigating (adjusting state during render).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(null);
  }

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => !bar.current?.contains(e.target as Node) && setOpen(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menus = allMenus.map((m) => ({ ...m, items: m.items.filter((i) => !i.roles || can(...i.roles)) })).filter((m) => m.items.length);

  return (
    <div ref={bar} className="relative z-20 mb-7 flex flex-wrap items-center gap-1 rounded-2xl bg-gradient-to-r from-ledger-700 via-ledger-800 to-ledger-900 p-2 pr-3 text-white shadow-[var(--shadow-lift)] print:hidden">
      <Link href={home} className="mr-2 flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-white/10">
        <span className="flex size-9 items-center justify-center rounded-xl bg-white shadow-sm">
          <Art className="size-7" />
        </span>
        <span className="text-lg font-semibold tracking-tight">{title}</span>
      </Link>
      <nav aria-label={title} className="flex flex-wrap items-center gap-1">
        {menus.map((menu) => {
          const active = menu.items.some((i) => pathname.startsWith(i.href));
          const expanded = open === menu.label;
          return (
            <div key={menu.label} className="relative">
              <button
                type="button"
                aria-expanded={expanded}
                aria-haspopup="true"
                onClick={() => setOpen(expanded ? null : menu.label)}
                className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
                  expanded || active ? "bg-white/15 text-white" : "text-ledger-50/90 hover:bg-white/10 hover:text-white"
                }`}
              >
                {menu.label}
                <ChevronDown className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
              </button>
              {expanded && (
                <ul className="card absolute top-full left-0 mt-2 w-72 p-1.5 text-ink">
                  {menu.items.map((item) => {
                    const here = pathname.startsWith(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={here ? "page" : undefined}
                          className={`block rounded-xl px-3 py-2 transition-colors ${here ? "bg-ledger-50" : "hover:bg-paper"}`}
                        >
                          <span className={`block text-sm ${here ? "font-semibold text-ledger-800" : "font-medium"}`}>{item.label}</span>
                          <span className="block text-xs text-ink-faint">{item.hint}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
      {store && (
        <span className="ml-auto hidden items-center gap-2 rounded-xl bg-white/10 px-3 py-1.5 text-sm text-ledger-50 sm:flex" title="Change store in the sidebar">
          <Store className="size-4" aria-hidden /> {store.name}
        </span>
      )}
    </div>
  );
}

export function StockMenuBar() {
  return <ModuleMenuBar title="Stock" home="/stock/products" art={StockArt} menus={STOCK_MENUS} />;
}
