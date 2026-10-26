"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Banknote, Coins, Percent, Printer, ReceiptText, ShoppingBag, TrendingUp, Undo2, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { methodLabel } from "@/components/sales";
import { StoreSelect } from "@/components/stock";
import { Button, Field, FormError, Input, PageHeader, Select, Spinner, StatCard, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, Currency } from "@/lib/api";
import { dateTime, money, qty } from "@/lib/format";
import { useSession } from "@/lib/session";

const todayStr = () => new Date().toLocaleDateString("en-CA");
const monthStart = () => `${todayStr().slice(0, 8)}01`;
const longDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

function Print() {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden /> Print
    </Button>
  );
}

/** Period and store filters shared by the sales reports. */
function useRange(opts: { store?: "optional" | "required" | "none" } = {}) {
  const { storeId: current } = useSession();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayStr());
  // The Cash Balance cards link here with ?store=<id>.
  const [storeId, setStoreId] = useState(() => {
    const linked = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("store");
    return linked ?? (opts.store === "required" ? (current ?? "") : "");
  });
  const controls = (
    <div className="mb-6 flex flex-wrap items-end gap-3 print:hidden">
      <Field label="From">{(id) => <Input id={id} type="date" className="w-44" max={to} value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
      <Field label="To">{(id) => <Input id={id} type="date" className="w-44" min={from} value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
      {opts.store !== "none" && <Field label="Store">{(id) => <StoreSelect id={id} allowAll={opts.store !== "required"} className="w-52" value={storeId} onChange={setStoreId} />}</Field>}
    </div>
  );
  return { query: { from, to, storeId: storeId || undefined }, controls, period: `${longDay(from)} – ${longDay(to)}` };
}

function Body<T>({ q, children }: { q: { isLoading: boolean; error: Error | null; data?: T }; children: (d: T) => React.ReactNode }) {
  if (q.isLoading) return <Spinner />;
  if (q.error) return <FormError message={q.error.message} />;
  return <>{children(q.data!)}</>;
}

const marginTone = (m: string | null) => (m === null ? "text-ink-faint" : Number(m) < 0 ? "text-danger" : Number(m) < 15 ? "text-amber-ink" : "text-ledger-700");

// ----- Profitability (item, category, cashier, shop) ------------------------------------

interface Profit {
  rows: { id: string; name: string; quantity: string; sales: number; revenue: string; tax: string; cost: string; profit: string; margin: string | null }[];
  totals: { revenue: string; cost: string; tax: string; profit: string; margin: string | null };
}

const PROFIT_TITLES = {
  item: ["Item profitability", "Item", "What each item earned over its cost, after returns. Revenue excludes VAT."],
  category: ["Category profitability", "Category", "Profit per item group, after returns. Revenue excludes VAT."],
  cashier: ["Cashier profitability", "Cashier", "Sales and profit made by each cashier or salesperson."],
  store: ["Shop profitability", "Store", "Revenue, cost and profit for each store or branch."],
} as const;

export function ProfitabilityReport({ by }: { by: keyof typeof PROFIT_TITLES }) {
  const { session } = useSession();
  const r = useRange({ store: by === "store" ? "none" : "optional" });
  const q = useQuery({
    queryKey: ["sales", "reports", "profit", by, r.query],
    queryFn: () => api<Profit>("/sales/reports/profitability", { query: { ...r.query, by } }),
    placeholderData: keepPreviousData,
  });
  const [title, col, blurb] = PROFIT_TITLES[by];
  const top = q.data?.rows[0];
  return (
    <div>
      <PageHeader title={title} description={blurb} actions={<Print />} />
      {r.controls}
      <Body q={q}>
        {(d) => (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <StatCard label="Revenue" value={money(d.totals.revenue, session.tenant.baseCurrency)} icon={TrendingUp} tone="blue" note="Excluding VAT" />
              <StatCard label="Cost of goods" value={money(d.totals.cost)} icon={ShoppingBag} tone="amber" note="At cost price" />
              <StatCard label="Profit" value={money(d.totals.profit)} icon={Coins} tone={Number(d.totals.profit) < 0 ? "rose" : "green"} note={r.period} />
              <StatCard label="Margin" value={d.totals.margin === null ? "—" : `${d.totals.margin}%`} icon={Percent} tone="violet" note={top ? `Best: ${top.name}` : "No sales yet"} />
            </div>
            <div className="card overflow-hidden">
              <Table>
                <thead>
                  <tr>
                    <Th>{col}</Th>
                    {by === "item" ? (
                      <Th align="right">Qty sold</Th>
                    ) : (
                      <Th align="right" className="hidden sm:table-cell">
                        Sales
                      </Th>
                    )}
                    <Th align="right">Revenue</Th>
                    <Th align="right" className="hidden md:table-cell">
                      Cost
                    </Th>
                    <Th align="right">Profit</Th>
                    <Th align="right">Margin</Th>
                    <Th className="hidden w-40 lg:table-cell" />
                  </tr>
                </thead>
                <tbody>
                  {!d.rows.length && <TableMessage colSpan={7}>No sales in this period.</TableMessage>}
                  {d.rows.map((row) => {
                    const share = Number(d.totals.revenue) ? (Number(row.revenue) / Number(d.totals.revenue)) * 100 : 0;
                    return (
                      <tr key={row.id ?? row.name}>
                        <Td className="font-medium">{row.name}</Td>
                        {by === "item" ? (
                          <Td align="right" className="tabular-nums">
                            {qty(row.quantity)}
                          </Td>
                        ) : (
                          <Td align="right" className="hidden tabular-nums sm:table-cell">
                            {row.sales}
                          </Td>
                        )}
                        <Td align="right" className="tabular-nums">
                          {money(row.revenue)}
                        </Td>
                        <Td align="right" className="hidden text-ink-soft tabular-nums md:table-cell">
                          {money(row.cost)}
                        </Td>
                        <Td align="right" className={`font-semibold tabular-nums ${Number(row.profit) < 0 ? "text-danger" : ""}`}>
                          {money(row.profit)}
                        </Td>
                        <Td align="right" className={`font-medium tabular-nums ${marginTone(row.margin)}`}>
                          {row.margin === null ? "—" : `${row.margin}%`}
                        </Td>
                        <Td className="hidden lg:table-cell">
                          <span className="block h-2 overflow-hidden rounded-full bg-paper" title={`${share.toFixed(1)}% of revenue`}>
                            <span className="block h-full rounded-full bg-gradient-to-r from-emerald-400 to-ledger-600" style={{ width: `${Math.max(2, share)}%` }} />
                          </span>
                        </Td>
                      </tr>
                    );
                  })}
                  {d.rows.length > 0 && (
                    <tr className="bg-ledger-50/60 font-semibold">
                      <Td>Total</Td>
                      <Td className={by === "item" ? "" : "hidden sm:table-cell"} />
                      <Td align="right" className="tabular-nums">
                        {money(d.totals.revenue)}
                      </Td>
                      <Td align="right" className="hidden tabular-nums md:table-cell">
                        {money(d.totals.cost)}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {money(d.totals.profit)}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {d.totals.margin === null ? "—" : `${d.totals.margin}%`}
                      </Td>
                      <Td className="hidden lg:table-cell" />
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </Body>
    </div>
  );
}

// ----- VAT on sales and purchases -------------------------------------------------------

export function SalesTaxReport() {
  const r = useRange();
  const q = useQuery({
    queryKey: ["sales", "reports", "sales-tax", r.query],
    queryFn: () =>
      api<{ groups: { rateName: string; net: string; tax: string; gross: string; items: { variantId: string; name: string; quantity: string; net: string; tax: string; gross: string }[] }[]; totals: { net: string; tax: string; gross: string } }>(
        "/sales/reports/sales-tax",
        { query: r.query },
      ),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader title="Sales item tax report" description="VAT charged on sales, by tax rate and item, after returns. Use it with your fiscal device reports for the VAT return." actions={<Print />} />
      {r.controls}
      <Body q={q}>
        {(d) => (
          <>
            <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
              <StatCard label="Sales before VAT" value={money(d.totals.net)} icon={ShoppingBag} tone="blue" />
              <StatCard label="Output VAT" value={money(d.totals.tax)} icon={ReceiptText} tone="amber" note={r.period} />
              <StatCard label="Sales with VAT" value={money(d.totals.gross)} icon={TrendingUp} tone="green" />
            </div>
            {!d.groups.length && <div className="card px-6 py-16 text-center text-sm text-ink-faint">No sales in this period.</div>}
            <div className="flex flex-col gap-4">
              {d.groups.map((g) => (
                <section key={g.rateName} className="card overflow-hidden">
                  <h2 className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line/70 px-6 py-4">
                    <span className="font-semibold">{g.rateName}</span>
                    <span className="text-sm text-ink-soft">
                      VAT <strong className="text-ink">{money(g.tax)}</strong> on {money(g.net)}
                    </span>
                  </h2>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Item</Th>
                        <Th align="right">Qty</Th>
                        <Th align="right">Before VAT</Th>
                        <Th align="right">VAT</Th>
                        <Th align="right" className="hidden sm:table-cell">
                          With VAT
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.items.map((i) => (
                        <tr key={i.variantId}>
                          <Td className="font-medium">{i.name}</Td>
                          <Td align="right" className="tabular-nums">
                            {qty(i.quantity)}
                          </Td>
                          <Td align="right" className="tabular-nums">
                            {money(i.net)}
                          </Td>
                          <Td align="right" className="tabular-nums">
                            {money(i.tax)}
                          </Td>
                          <Td align="right" className="hidden tabular-nums sm:table-cell">
                            {money(i.gross)}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </section>
              ))}
            </div>
          </>
        )}
      </Body>
    </div>
  );
}

export function PurchasesTaxReport() {
  const r = useRange({ store: "none" });
  const q = useQuery({
    queryKey: ["sales", "reports", "purchases-tax", r.query],
    queryFn: () =>
      api<{ rows: { date: string; number: string; supplier: string; description: string; account: string; rateName: string; net: string; tax: string; gross: string }[]; totals: { net: string; tax: string; gross: string } }>(
        "/sales/reports/purchases-tax",
        { query: r.query },
      ),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader title="Purchases item tax report" description="VAT on supplier bills and expenses: the input VAT you can claim back." actions={<Print />} />
      {r.controls}
      <Body q={q}>
        {(d) => (
          <>
            <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
              <StatCard label="Purchases before VAT" value={money(d.totals.net)} icon={ShoppingBag} tone="blue" />
              <StatCard label="Input VAT" value={money(d.totals.tax)} icon={ReceiptText} tone="teal" note={r.period} />
              <StatCard label="Purchases with VAT" value={money(d.totals.gross)} icon={Wallet} tone="violet" />
            </div>
            <div className="card overflow-hidden">
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Document</Th>
                    <Th>Supplier</Th>
                    <Th className="hidden lg:table-cell">What</Th>
                    <Th className="hidden md:table-cell">Rate</Th>
                    <Th align="right">Before VAT</Th>
                    <Th align="right">VAT</Th>
                  </tr>
                </thead>
                <tbody>
                  {!d.rows.length && <TableMessage colSpan={7}>No bills or expenses in this period.</TableMessage>}
                  {d.rows.map((row, i) => (
                    <tr key={`${row.number}-${i}`}>
                      <Td className="whitespace-nowrap text-ink-soft">{row.date}</Td>
                      <Td className="font-medium">{row.number}</Td>
                      <Td>{row.supplier}</Td>
                      <Td className="hidden text-ink-soft lg:table-cell">
                        {row.description}
                        <span className="block text-xs text-ink-faint">{row.account}</span>
                      </Td>
                      <Td className="hidden text-ink-soft md:table-cell">{row.rateName}</Td>
                      <Td align="right" className="tabular-nums">
                        {money(row.net)}
                      </Td>
                      <Td align="right" className="font-medium tabular-nums">
                        {money(row.tax)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </Body>
    </div>
  );
}

// ----- Daily sales ---------------------------------------------------------------------------

interface Daily {
  rows: { day: string; sales: number; returns: number; gross: string; net: string; tax: string; profit: string; cash: string; card: string; mobile: string; bank: string }[];
  totals: { sales: number; returns: number; gross: string; net: string; tax: string; profit: string; cash: string; card: string; mobile: string; bank: string };
}

export function DailySalesReport() {
  const { session } = useSession();
  const r = useRange();
  const q = useQuery({ queryKey: ["sales", "reports", "daily", r.query], queryFn: () => api<Daily>("/sales/reports/daily", { query: r.query }), placeholderData: keepPreviousData });
  const methods = ["cash", "card", "mobile", "bank"] as const;
  return (
    <div>
      <PageHeader title="Daily sales" description={`Takings per day, after returns, in ${session.tenant.baseCurrency}, and how customers paid.`} actions={<Print />} />
      {r.controls}
      <Body q={q}>
        {(d) => {
          const peak = Math.max(1, ...d.rows.map((x) => Number(x.gross)));
          return (
            <>
              <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <StatCard label="Takings" value={money(d.totals.gross, session.tenant.baseCurrency)} icon={TrendingUp} tone="green" note="With VAT" />
                <StatCard label="Sales" value={d.totals.sales} icon={ShoppingBag} tone="blue" note={`${d.totals.returns} return${d.totals.returns === 1 ? "" : "s"}`} />
                <StatCard label="Average a day" value={money(d.rows.length ? Number(d.totals.gross) / d.rows.length : 0)} icon={Coins} tone="violet" note={`${d.rows.length} trading days`} />
                <StatCard label="Profit" value={money(d.totals.profit)} icon={Percent} tone="amber" note="Before expenses" />
              </div>
              {d.rows.length > 1 && (
                <div className="card mb-6 p-6 print:hidden">
                  <div className="flex h-40 items-end gap-1.5" role="img" aria-label="Takings per day">
                    {d.rows.map((x) => (
                      <div key={x.day} className="group relative flex h-full flex-1 flex-col justify-end">
                        <div className="rounded-t-md bg-gradient-to-t from-ledger-700 to-emerald-400 transition-opacity group-hover:opacity-80" style={{ height: `${(Number(x.gross) / peak) * 100}%` }} />
                        <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 rounded-md bg-ink px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white group-hover:block">
                          {x.day.slice(5)} · {money(x.gross)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="card overflow-hidden">
                <Table>
                  <thead>
                    <tr>
                      <Th>Day</Th>
                      <Th align="right">Sales</Th>
                      <Th align="right">Takings</Th>
                      <Th align="right" className="hidden md:table-cell">
                        VAT
                      </Th>
                      {methods.map((m) => (
                        <Th key={m} align="right" className="hidden lg:table-cell">
                          {methodLabel(m)}
                        </Th>
                      ))}
                      <Th align="right" className="hidden sm:table-cell">
                        Profit
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {!d.rows.length && <TableMessage colSpan={9}>No sales in this period.</TableMessage>}
                    {d.rows.map((x) => (
                      <tr key={x.day}>
                        <Td className="font-medium whitespace-nowrap">{longDay(x.day)}</Td>
                        <Td align="right" className="tabular-nums">
                          {x.sales}
                          {x.returns > 0 && <span className="block text-xs text-amber-ink">{x.returns} returned</span>}
                        </Td>
                        <Td align="right" className="font-semibold tabular-nums">
                          {money(x.gross)}
                        </Td>
                        <Td align="right" className="hidden text-ink-soft tabular-nums md:table-cell">
                          {money(x.tax)}
                        </Td>
                        {methods.map((m) => (
                          <Td key={m} align="right" className={`hidden tabular-nums lg:table-cell ${Number(x[m]) ? "" : "text-ink-faint"}`}>
                            {Number(x[m]) ? money(x[m]) : "—"}
                          </Td>
                        ))}
                        <Td align="right" className="hidden tabular-nums sm:table-cell">
                          {money(x.profit)}
                        </Td>
                      </tr>
                    ))}
                    {d.rows.length > 0 && (
                      <tr className="bg-ledger-50/60 font-semibold">
                        <Td>Total</Td>
                        <Td align="right" className="tabular-nums">
                          {d.totals.sales}
                        </Td>
                        <Td align="right" className="tabular-nums">
                          {money(d.totals.gross)}
                        </Td>
                        <Td align="right" className="hidden tabular-nums md:table-cell">
                          {money(d.totals.tax)}
                        </Td>
                        {methods.map((m) => (
                          <Td key={m} align="right" className="hidden tabular-nums lg:table-cell">
                            {money(d.totals[m])}
                          </Td>
                        ))}
                        <Td align="right" className="hidden tabular-nums sm:table-cell">
                          {money(d.totals.profit)}
                        </Td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </div>
            </>
          );
        }}
      </Body>
    </div>
  );
}

// ----- Returns -----------------------------------------------------------------------------

export function ReturnsReport() {
  const { session } = useSession();
  const r = useRange();
  const q = useQuery({
    queryKey: ["sales", "reports", "returns", r.query],
    queryFn: () =>
      api<{ rows: { id: string; number: string; soldAt: string; customerName: string; reason: string | null; currencyCode: string; total: string; originalNumber: string | null; originalId: string | null; storeName: string; by: string | null; items: string; method: string }[]; totalBase: string }>(
        "/sales/reports/returns",
        { query: r.query },
      ),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader title="Sales returns" description="Every refund in the period: what came back, why, and how the money went back." actions={<Print />} />
      {r.controls}
      <Body q={q}>
        {(d) => (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4">
              <StatCard label="Returns" value={d.rows.length} icon={Undo2} tone="amber" note={r.period} />
              <StatCard label="Refunded" value={money(d.totalBase, session.tenant.baseCurrency)} icon={Banknote} tone="rose" />
            </div>
            <div className="card overflow-hidden">
              <Table>
                <thead>
                  <tr>
                    <Th>Return</Th>
                    <Th>When</Th>
                    <Th>Of sale</Th>
                    <Th className="hidden lg:table-cell">Items</Th>
                    <Th className="hidden md:table-cell">Reason</Th>
                    <Th align="right">Refunded</Th>
                  </tr>
                </thead>
                <tbody>
                  {!d.rows.length && <TableMessage colSpan={6}>No returns in this period.</TableMessage>}
                  {d.rows.map((x) => (
                    <tr key={x.id}>
                      <Td>
                        <Link href={`/sales/invoices/${x.id}`} className="font-medium hover:text-ledger-700 hover:underline">
                          {x.number}
                        </Link>
                        <span className="block text-xs text-ink-faint">{x.customerName}</span>
                      </Td>
                      <Td className="whitespace-nowrap text-ink-soft">{dateTime(x.soldAt)}</Td>
                      <Td>
                        {x.originalId ? (
                          <Link href={`/sales/invoices/${x.originalId}`} className="text-ledger-700 hover:underline">
                            {x.originalNumber}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td className="hidden text-ink-soft lg:table-cell">{x.items}</Td>
                      <Td className="hidden md:table-cell">{x.reason ?? "—"}</Td>
                      <Td align="right" className="font-semibold whitespace-nowrap tabular-nums">
                        {x.currencyCode} {money(x.total)}
                        <span className="block text-xs font-normal text-ink-faint">{methodLabel(x.method)}</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </Body>
    </div>
  );
}

// ----- Cash ------------------------------------------------------------------------------------

export function CashBalanceReport() {
  const q = useQuery({
    queryKey: ["sales", "reports", "cash-balance"],
    queryFn: () => api<{ stores: { storeId: string; storeName: string; balances: { currencyCode: string; balance: string }[] }[]; totals: { currencyCode: string; balance: string }[] }>("/sales/reports/cash-balance"),
  });
  return (
    <div>
      <PageHeader title="Cash balance" description="Cash that should be in each store's tills right now: cash taken from sales, less refunds and cash sent away, plus cash received from other stores. Floats are not included." actions={<Print />} />
      <Body q={q}>
        {(d) => (
          <>
            <section className="relative mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-ledger-700 via-ledger-800 to-ledger-950 p-6 text-white shadow-[var(--shadow-lift)]">
              <p className="flex items-center gap-2 text-sm text-ledger-100/80">
                <Wallet className="size-4" aria-hidden /> All stores
              </p>
              <div className="mt-2 flex flex-wrap gap-8">
                {d.totals.length === 0 && <p className="text-2xl font-semibold">No cash yet</p>}
                {d.totals.map((t) => (
                  <p key={t.currencyCode} className="text-3xl font-semibold tracking-tight tabular-nums">
                    <span className="mr-1.5 text-base font-medium text-ledger-100/80">{t.currencyCode}</span>
                    {money(t.balance)}
                  </p>
                ))}
              </div>
            </section>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {d.stores.map((s) => (
                <Link key={s.storeId} href={`/sales/reports/cashbook?store=${s.storeId}`} className="card p-5 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
                  <p className="font-semibold">{s.storeName}</p>
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {s.balances.map((b) => (
                      <li key={b.currencyCode} className="flex justify-between text-sm">
                        <span className="text-ink-soft">{b.currencyCode}</span>
                        <span className={`font-semibold tabular-nums ${Number(b.balance) < 0 ? "text-danger" : ""}`}>{money(b.balance)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-ledger-700">Open cashbook →</p>
                </Link>
              ))}
            </div>
          </>
        )}
      </Body>
    </div>
  );
}

export function CashbookReport() {
  const { session } = useSession();
  const r = useRange({ store: "required" });
  const [currency, setCurrency] = useState(session.tenant.baseCurrency);
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: () => api<Currency[]>("/currencies") });
  const storeId = r.query.storeId;
  const q = useQuery({
    queryKey: ["sales", "reports", "cashbook", r.query, currency],
    queryFn: () =>
      api<{ opening: string; cashIn: string; cashOut: string; closing: string; rows: { at: string; refId: string; number: string; kind: string; detail: string | null; in: string | null; out: string | null; balance: string }[] }>(
        "/sales/reports/cashbook",
        { query: { ...r.query, currencyCode: currency } },
      ),
    enabled: !!storeId,
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader title="Store cashbook" description="Every cash movement in one store's tills, in one currency, with the running balance." actions={<Print />} />
      <div className="flex flex-wrap items-end gap-3">
        {r.controls}
        <div className="mb-6 print:hidden">
          <Field label="Currency">
            {(id) => (
              <Select id={id} className="w-32" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {currencies.data
                  ?.filter((c) => c.active)
                  .map((c) => (
                    <option key={c.code}>{c.code}</option>
                  ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
      <Body q={q}>
        {(d) => (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <StatCard label="Opening" value={money(d.opening)} icon={Wallet} tone="blue" note={`${currency} at the start`} />
              <StatCard label="Cash in" value={money(d.cashIn)} icon={TrendingUp} tone="green" note="Cash sales and cash received" />
              <StatCard label="Cash out" value={money(d.cashOut)} icon={Banknote} tone="amber" note="Refunds and cash sent away" />
              <StatCard label="Closing" value={money(d.closing)} icon={Coins} tone="violet" note={`${currency} at the end`} />
            </div>
            <div className="card overflow-hidden">
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>What</Th>
                    <Th className="hidden md:table-cell">Number</Th>
                    <Th align="right">In</Th>
                    <Th align="right">Out</Th>
                    <Th align="right">Balance</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-paper/60 text-ink-soft">
                    <Td />
                    <Td>Opening balance</Td>
                    <Td className="hidden md:table-cell" />
                    <Td />
                    <Td />
                    <Td align="right" className="font-medium tabular-nums">
                      {money(d.opening)}
                    </Td>
                  </tr>
                  {!d.rows.length && <TableMessage colSpan={6}>No cash moved in this period.</TableMessage>}
                  {d.rows.map((x) => (
                    <tr key={`${x.refId}-${x.kind}`}>
                      <Td className="whitespace-nowrap text-ink-soft">{dateTime(x.at)}</Td>
                      <Td>
                        <span className="font-medium">{x.kind}</span>
                        {x.detail && <span className="block text-xs text-ink-faint">{x.detail}</span>}
                      </Td>
                      <Td className="hidden md:table-cell">
                        {x.kind === "Cash sale" || x.kind === "Refund" ? (
                          <Link href={`/sales/invoices/${x.refId}`} className="text-ledger-700 hover:underline">
                            {x.number}
                          </Link>
                        ) : (
                          x.number
                        )}
                      </Td>
                      <Td align="right" className="text-ledger-700 tabular-nums">
                        {x.in ? money(x.in) : ""}
                      </Td>
                      <Td align="right" className="text-danger tabular-nums">
                        {x.out ? money(x.out) : ""}
                      </Td>
                      <Td align="right" className="font-medium tabular-nums">
                        {money(x.balance)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </Body>
    </div>
  );
}
