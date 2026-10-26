"use client";

import { useQuery } from "@tanstack/react-query";
import { Boxes, FileText, Mail, MapPin, Phone, Receipt, ShoppingBag, Store, Truck, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PlatformSubscription } from "@/components/platform-subscription";
import { Badge, FormError, Spinner, StatCard, Table, Td, Th } from "@/components/ui";
import { api, BusinessType } from "@/lib/api";
import { BUSINESS_LABELS, money, ROLE_LABELS } from "@/lib/format";
import { ago } from "@/lib/platform";

interface Detail {
  business: {
    id: string;
    name: string;
    businessType: BusinessType;
    country: string;
    baseCurrency: string;
    timezone: string;
    tin: string | null;
    vatNumber: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    booksClosedThrough: string | null;
    createdAt: string;
  };
  stores: { id: string; name: string; code: string; type: string; active: boolean }[];
  staff: { name: string; email: string; phone: string | null; role: string; active: boolean; lastLoginAt: string | null }[];
  counts: { products: number; customers: number; suppliers: number; tills: number; sales: number; invoices: number; purchases: number; journalEntries: number };
  salesByDay: { day: string; sales: number; takings: number }[];
}

export default function PlatformBusinessPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["platform", "business", id], queryFn: () => api<Detail>(`/platform/businesses/${id}`, { platform: true }) });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <FormError message={q.error.message} />;
  const d = q.data!;
  const b = d.business;
  const takings = d.salesByDay.reduce((t, x) => t + Number(x.takings), 0);
  const peak = Math.max(1, ...d.salesByDay.map((x) => Number(x.takings)));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/platform" className="text-sm text-ink-soft hover:text-ink">
          ← All businesses
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{b.name}</h1>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
          <span>{BUSINESS_LABELS[b.businessType]}</span>
          <span>Joined {ago(b.createdAt)}</span>
          <span>
            {b.country} · {b.baseCurrency} · {b.timezone}
          </span>
          {b.booksClosedThrough && <span>Books closed to {b.booksClosedThrough}</span>}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Takings, 30 days" value={`${b.baseCurrency} ${money(takings)}`} icon={Receipt} tone="green" note={`${d.counts.sales} sales all time`} />
        <StatCard label="Products" value={d.counts.products} icon={ShoppingBag} tone="blue" note={`${d.counts.customers} customers`} />
        <StatCard label="Staff" value={d.staff.filter((s) => s.active).length} icon={Users} tone="violet" note={`${d.stores.filter((s) => s.active).length} stores · ${d.counts.tills} tills`} />
        <StatCard label="Purchases" value={d.counts.purchases} icon={Truck} tone="amber" note={`${d.counts.suppliers} suppliers · ${d.counts.invoices} invoices`} />
      </div>

      <PlatformSubscription tenantId={id} businessName={b.name} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="card p-6">
          <h2 className="text-base font-semibold">Takings, last 30 days</h2>
          {d.salesByDay.length === 0 ? (
            <p className="mt-6 text-sm text-ink-faint">No sales in the last 30 days.</p>
          ) : (
            <div className="mt-6 flex h-40 items-end gap-1.5" role="img" aria-label="Takings per day">
              {d.salesByDay.map((x) => (
                <div key={x.day} className="group relative flex h-full flex-1 flex-col justify-end">
                  <div className="rounded-t-md bg-gradient-to-t from-ledger-700 to-emerald-400" style={{ height: `${(Number(x.takings) / peak) * 100}%` }} />
                  <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 rounded-md bg-ink px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white group-hover:block">
                    {x.day.slice(5)} · {money(x.takings)} · {x.sales} sales
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="card flex flex-col gap-3 p-6 text-sm">
          <h2 className="text-base font-semibold">Contact and tax</h2>
          <p className="flex items-start gap-2">
            <Mail className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden /> {b.email ?? "—"}
          </p>
          <p className="flex items-start gap-2">
            <Phone className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden /> {b.phone ?? "—"}
          </p>
          <p className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden /> {b.address ?? "—"}
          </p>
          <p className="flex items-start gap-2">
            <FileText className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
            TIN {b.tin ?? "—"} · VAT {b.vatNumber ?? "not registered"}
          </p>
        </section>
      </div>

      <section className="card overflow-hidden">
        <h2 className="flex items-center gap-2 border-b border-line/70 px-6 py-4 text-base font-semibold">
          <Users className="size-4 text-ledger-700" aria-hidden /> People
        </h2>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th className="hidden md:table-cell">Email</Th>
              <Th className="hidden lg:table-cell">Phone</Th>
              <Th>Role</Th>
              <Th>Last signed in</Th>
            </tr>
          </thead>
          <tbody>
            {d.staff.map((s) => (
              <tr key={s.email} className={s.active ? "" : "text-ink-faint"}>
                <Td className="font-medium">
                  {s.name}
                  {!s.active && <span className="ml-2 text-xs">(removed)</span>}
                </Td>
                <Td className="hidden md:table-cell">{s.email}</Td>
                <Td className="hidden lg:table-cell">{s.phone ?? "—"}</Td>
                <Td>
                  <Badge tone={s.role === "owner" ? "green" : "neutral"}>{ROLE_LABELS[s.role] ?? s.role}</Badge>
                </Td>
                <Td className="whitespace-nowrap text-ink-soft">{ago(s.lastLoginAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section className="card p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Store className="size-4 text-ledger-700" aria-hidden /> Stores and warehouses
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {d.stores.map((s) => (
            <li key={s.id} className={`flex items-center gap-3 rounded-2xl bg-paper px-4 py-3 ${s.active ? "" : "opacity-60"}`}>
              <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 text-white">
                {s.type === "warehouse" ? <Boxes className="size-4" aria-hidden /> : <Store className="size-4" aria-hidden />}
              </span>
              <span>
                <span className="block font-medium">{s.name}</span>
                <span className="block text-xs text-ink-faint">
                  {s.code} · {s.type}
                  {!s.active && " · closed"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-ink-faint">You are viewing this business as Floatly staff. The visit is recorded in the business&apos;s own audit log. Nothing here can change their data.</p>
    </div>
  );
}
