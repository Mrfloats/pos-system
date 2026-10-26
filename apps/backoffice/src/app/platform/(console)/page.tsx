"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Building2, Search, Sparkles, Store, TrendingUp, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, FormError, Input, Select, Spinner, StatCard, Table, TableMessage, Td, Th } from "@/components/ui";
import { longDay, SubscriptionBadge } from "@/components/plans";
import { api, PlatformBilling, PlatformBusiness, PlatformOverview } from "@/lib/api";
import { BUSINESS_LABELS, money } from "@/lib/format";
import { activity, ago } from "@/lib/platform";

type Sort = "newest" | "takings" | "active" | "name";

export default function PlatformOverviewPage() {
  const overview = useQuery({ queryKey: ["platform", "overview"], queryFn: () => api<PlatformOverview>("/platform/overview", { platform: true }) });
  const list = useQuery({ queryKey: ["platform", "businesses"], queryFn: () => api<PlatformBusiness[]>("/platform/businesses", { platform: true }) });
  const billing = useQuery({ queryKey: ["platform", "billing"], queryFn: () => api<PlatformBilling>("/platform/billing", { platform: true }) });
  const subs = new Map((billing.data?.subscriptions ?? []).map((s) => [s.tenantId, s]));
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState<Sort>("newest");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (list.data ?? []).filter(
      (b) => (!type || b.businessType === type) && (!q || [b.name, b.ownerName, b.ownerEmail, b.ownerPhone].some((v) => v?.toLowerCase().includes(q))),
    );
    const by: Record<Sort, (a: PlatformBusiness, b: PlatformBusiness) => number> = {
      newest: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      takings: (a, b) => Number(b.takings30d) - Number(a.takings30d),
      active: (a, b) => (activity(b).last ?? 0) - (activity(a).last ?? 0),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...filtered].sort(by[sort]);
  }, [list.data, search, type, sort]);

  if (overview.error) return <FormError message={overview.error.message} />;
  const o = overview.data;
  const peak = Math.max(1, ...(o?.signups.map((s) => Number(s.count)) ?? [1]));

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="text-sm text-ink-soft">Everyone using Floatly</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Businesses</h1>
      </header>

      {!o ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard label="Businesses" value={o.businesses} icon={Building2} tone="blue" note={`${o.newThisMonth} new this month`} />
            <StatCard label="Active this week" value={o.activeLast7Days} icon={Activity} tone="green" note={`${o.businesses ? Math.round((o.activeLast7Days / o.businesses) * 100) : 0}% signed in within 7 days`} />
            <StatCard
              label="Monthly recurring revenue"
              value={billing.data?.mrr.length ? billing.data.mrr.map((m) => `${m.currency} ${money(m.amount)}`).join(" · ") : "—"}
              icon={Users}
              tone="violet"
              note={billing.data ? `${billing.data.pendingRequests} waiting for approval · ${billing.data.lapsed} overdue` : ""}
            />
            <StatCard
              label="Sales, last 30 days"
              value={o.salesLast30Days}
              icon={TrendingUp}
              tone="amber"
              note={o.takingsLast30Days.length ? o.takingsLast30Days.map((t) => `${t.currency} ${money(t.amount)}`).join(" · ") : "No sales yet"}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <section className="card p-6">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Sparkles className="size-4 text-ledger-700" aria-hidden /> Sign-ups per month
              </h2>
              {o.signups.length === 0 ? (
                <p className="mt-6 text-sm text-ink-faint">No sign-ups in the last year.</p>
              ) : (
                <div className="mt-6 flex h-36 items-end gap-2" role="img" aria-label="Sign-ups per month">
                  {o.signups.map((s) => (
                    <div key={s.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                      <span className="text-xs font-semibold tabular-nums">{s.count}</span>
                      <div className="w-full rounded-t-lg bg-gradient-to-t from-sky-600 to-sky-400" style={{ height: `${(Number(s.count) / peak) * 80}%` }} />
                      <span className="text-[11px] text-ink-faint">{new Date(`${s.month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short" })}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="card p-6">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Store className="size-4 text-ledger-700" aria-hidden /> Kinds of business
              </h2>
              <ul className="mt-4 flex flex-col gap-3">
                {Object.entries(o.byType).map(([t, n]) => (
                  <li key={t}>
                    <div className="flex justify-between text-sm">
                      <span>{BUSINESS_LABELS[t] ?? t}</span>
                      <span className="font-semibold tabular-nums">{n}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper">
                      <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-ledger-600" style={{ width: `${(Number(n) / Math.max(1, o.businesses)) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute top-3 left-3.5 size-4 text-ink-faint" aria-hidden />
            <Input aria-label="Search businesses" placeholder="Business, owner, email or phone" className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Kind of business" className="w-48" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All kinds</option>
            {Object.entries(BUSINESS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select aria-label="Sort" className="w-48" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="newest">Newest first</option>
            <option value="active">Recently active</option>
            <option value="takings">Highest takings</option>
            <option value="name">Name A–Z</option>
          </Select>
        </div>
        <div className="card overflow-hidden">
          {list.isLoading ? (
            <div className="px-6">
              <Spinner />
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Business</Th>
                  <Th className="hidden md:table-cell">Owner</Th>
                  <Th className="hidden lg:table-cell">Joined</Th>
                  <Th align="right" className="hidden xl:table-cell">
                    Staff · Stores · Products
                  </Th>
                  <Th align="right">Takings, 30 days</Th>
                  <Th className="hidden md:table-cell">Subscription</Th>
                  <Th>Activity</Th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <TableMessage colSpan={7}>No businesses match.</TableMessage>}
                {rows.map((b) => {
                  const a = activity(b);
                  return (
                    <tr key={b.id}>
                      <Td>
                        <Link href={`/platform/businesses/${b.id}`} className="font-semibold hover:text-ledger-700 hover:underline">
                          {b.name}
                        </Link>
                        <span className="block text-xs text-ink-faint">
                          {BUSINESS_LABELS[b.businessType] ?? b.businessType} · {b.country}
                          {b.vatNumber && " · VAT registered"}
                        </span>
                      </Td>
                      <Td className="hidden md:table-cell">
                        <span className="block">{b.ownerName ?? "—"}</span>
                        <span className="block text-xs text-ink-faint">{b.ownerEmail}</span>
                      </Td>
                      <Td className="hidden whitespace-nowrap text-ink-soft lg:table-cell">{ago(b.createdAt)}</Td>
                      <Td align="right" className="hidden text-ink-soft tabular-nums xl:table-cell">
                        {b.staff} · {b.stores} · {b.products}
                      </Td>
                      <Td align="right" className="whitespace-nowrap tabular-nums">
                        <span className="font-semibold">
                          {b.baseCurrency} {money(b.takings30d)}
                        </span>
                        <span className="block text-xs text-ink-faint">{b.sales30d} sales</span>
                      </Td>
                      <Td className="hidden whitespace-nowrap md:table-cell">
                        {(() => {
                          const s = subs.get(b.id);
                          return s ? (
                            <>
                              <SubscriptionBadge state={s.state} />
                              <span className="mt-0.5 block text-xs text-ink-faint">
                                {s.planName ?? "No plan"}
                                {s.currentPeriodEnd ? ` · to ${longDay(s.currentPeriodEnd)}` : ""}
                              </span>
                            </>
                          ) : null;
                        })()}
                      </Td>
                      <Td>
                        <Badge tone={a.tone}>{a.label}</Badge>
                        <span className="mt-0.5 block text-xs text-ink-faint">{a.last ? ago(a.last) : ""}</span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </div>
      </section>
    </div>
  );
}
