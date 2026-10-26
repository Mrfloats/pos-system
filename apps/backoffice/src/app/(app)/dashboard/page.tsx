"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, FileText, Package, PackagePlus, Store, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { Badge, Section, Spinner, StatCard, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, Page, Product, StaffMember, StockLevel } from "@/lib/api";
import { qty } from "@/lib/format";
import { BOOKKEEPERS, MANAGERS, STOCK_WRITERS, useSession } from "@/lib/session";

/** "Good morning" etc. by the browser's clock. */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const { session, stores, storeId, can } = useSession();
  const store = stores.find((s) => s.id === storeId);

  const products = useQuery({
    queryKey: ["products", "count"],
    queryFn: () => api<Page<Product>>("/products", { query: { active: true, pageSize: 1 } }),
  });
  const low = useQuery({
    queryKey: ["inventory", storeId, "low"],
    queryFn: () => api<Page<StockLevel>>("/inventory/levels", { query: { storeId, lowStock: true, pageSize: 8 } }),
    enabled: !!storeId,
  });
  const staff = useQuery({
    queryKey: ["staff"],
    queryFn: () => api<StaffMember[]>("/staff"),
    enabled: can(...MANAGERS),
  });

  const lowCount = low.data?.total;
  const actions = [
    { href: "/stock/products/new", label: "Add a product", icon: PackagePlus, show: can(...MANAGERS) },
    { href: "/stock/adjustments", label: "Receive stock", icon: Package, show: can(...STOCK_WRITERS) },
    { href: "/accounts/invoices/new", label: "New invoice", icon: FileText, show: can(...BOOKKEEPERS) },
    { href: "/sales/customers", label: "Add a customer", icon: UserPlus, show: true },
  ].filter((a) => a.show);

  return (
    <div className="flex flex-col gap-8">
      {/* Welcome banner */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-ledger-700 via-ledger-800 to-ledger-950 p-7 text-white shadow-[var(--shadow-lift)] sm:p-9">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-80 rounded-full bg-emerald-300/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 size-72 rounded-full bg-sky-300/10 blur-3xl" />
        <div className="relative">
          <p className="text-sm text-ledger-100/80">
            {greeting()}, {session.user.fullName.split(" ")[0]} ·{" "}
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{session.tenant.name}</h1>
          <p className="mt-2 max-w-xl text-sm text-ledger-100/80">
            Working in <span className="font-medium text-white">{store?.name ?? "—"}</span>. Here&apos;s what needs your attention today.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {actions.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 text-sm font-medium text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-white/20"
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Products on sale" value={products.data?.total ?? "–"} icon={Package} tone="blue" href="/stock/products" note="Active in your catalogue" />
        <StatCard
          label="Running low"
          value={lowCount ?? "–"}
          icon={AlertTriangle}
          tone={lowCount ? "amber" : "green"}
          href="/stock/reports/valuation"
          note={lowCount ? `At or below reorder level in ${store?.name ?? "this store"}` : "Everything is well stocked"}
        />
        <StatCard label="Stores and warehouses" value={stores.filter((s) => s.active).length} icon={Store} tone="violet" href="/settings" note="Each keeps its own stock" />
        {can(...MANAGERS) && (
          <StatCard label="Active staff" value={staff.data?.filter((s) => s.active).length ?? "–"} icon={Users} tone="teal" href="/staff" note="People who can sign in" />
        )}
      </div>

      <Section
        title="Running low"
        description={`Items at or below their reorder level in ${store?.name ?? "this store"}.`}
        actions={
          <Link href="/stock/products" className="inline-flex items-center gap-1 text-sm font-medium text-ledger-700 hover:gap-2 hover:underline">
            Open stock <ArrowRight className="size-4 transition-all" aria-hidden />
          </Link>
        }
      >
        {low.isLoading ? (
          <div className="px-6">
            <Spinner />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th align="right">On hand</Th>
                <Th align="right">Reorder at</Th>
              </tr>
            </thead>
            <tbody>
              {!low.data?.items.length && (
                <TableMessage colSpan={3}>Nothing is running low. Set reorder levels on products to get alerts here.</TableMessage>
              )}
              {low.data?.items.map((l) => (
                <tr key={l.variantId}>
                  <Td>
                    <span className="font-medium">{l.productName}</span>
                    {l.variantName !== "Default" && <span className="text-ink-soft"> · {l.variantName}</span>}
                  </Td>
                  <Td align="right">
                    <Badge tone={Number(l.onHand) <= 0 ? "red" : "amber"}>{qty(l.onHand)}</Badge>
                  </Td>
                  <Td align="right" className="text-ink-soft">
                    {qty(l.reorderLevel)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <p className="text-center text-sm text-ink-faint">Sales, shifts and cash-up reports appear here once the till app is connected.</p>
    </div>
  );
}
