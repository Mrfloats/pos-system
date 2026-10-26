"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Boxes, CalendarClock, Coins, Layers, Printer, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { firstOfMonth, itemName, ItemPicker, MovementBadge, MOVEMENT_LABELS, StoreSelect, today } from "@/components/stock";
import { Button, Field, FormError, Input, PageHeader, Pager, Select, Spinner, StatCard, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, Category, Page, StockMovementRow } from "@/lib/api";
import { dateTime, money, qty } from "@/lib/format";
import { useSession } from "@/lib/session";

const PrintButton = () => (
  <Button variant="secondary" onClick={() => window.print()}>
    <Printer className="size-4" aria-hidden /> Print
  </Button>
);

const longDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Store, category and search filters shared by the reports. */
function useFilters() {
  const [storeId, setStoreId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/categories") });
  const controls = (
    <>
      <Field label="Store">{(id) => <StoreSelect id={id} allowAll className="w-52" value={storeId} onChange={setStoreId} />}</Field>
      <Field label="Category">
        {(id) => (
          <Select id={id} className="w-48" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Item" className="min-w-52 flex-1">
        {(id) => (
          <div className="relative">
            <Search className="pointer-events-none absolute top-3 left-3.5 size-4 text-ink-faint" aria-hidden />
            <Input id={id} placeholder="Name, code or barcode" className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
      </Field>
    </>
  );
  return { query: { storeId, categoryId, search: debounced }, controls };
}

function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (r: { from: string; to: string }) => void }) {
  return (
    <>
      <Field label="From">{(id) => <Input id={id} type="date" className="w-44" max={to} value={from} onChange={(e) => onChange({ from: e.target.value, to })} />}</Field>
      <Field label="To">{(id) => <Input id={id} type="date" className="w-44" min={from} value={to} onChange={(e) => onChange({ from, to: e.target.value })} />}</Field>
    </>
  );
}

const Filters = ({ children }: { children: React.ReactNode }) => <div className="mb-6 flex flex-wrap items-end gap-3 print:hidden">{children}</div>;

// ----- Stock valuation (now, or at a past date) --------------------------------------

interface Valuation {
  rows: { variantId: string; productName: string; variantName: string; sku: string | null; category: string | null; unitCost: string; quantity: string; value: string }[];
  totalValue: string;
  items: number;
}

export function ValuationReport({ byDate }: { byDate?: boolean }) {
  const { session, stores } = useSession();
  const f = useFilters();
  const [asOf, setAsOf] = useState(() => {
    const d = new Date();
    d.setDate(0); // end of last month
    return d.toLocaleDateString("en-CA");
  });
  const report = useQuery({
    queryKey: ["inventory", "valuation", f.query, byDate ? asOf : "now"],
    queryFn: () => api<Valuation>("/inventory/reports/valuation", { query: { ...f.query, asOf: byDate ? asOf : undefined } }),
    placeholderData: keepPreviousData,
  });
  const r = report.data;
  const units = r?.rows.reduce((t, x) => t + Number(x.quantity), 0) ?? 0;

  // Group rows by category with subtotals.
  const groups = new Map<string, Valuation["rows"]>();
  for (const row of r?.rows ?? []) groups.set(row.category ?? "No category", [...(groups.get(row.category ?? "No category") ?? []), row]);
  const storeName = stores.find((s) => s.id === f.query.storeId)?.name ?? "All stores";

  return (
    <div>
      <PageHeader
        title={byDate ? "Stock valuation by date" : "Stock valuation"}
        description={
          byDate
            ? "What your stock was worth at the end of a past day, at today's cost prices."
            : "What your stock is worth right now: quantity on hand × cost price."
        }
        actions={<PrintButton />}
      />
      <Filters>
        {byDate && <Field label="At the end of">{(id) => <Input id={id} type="date" className="w-44" max={today()} value={asOf} onChange={(e) => setAsOf(e.target.value)} />}</Field>}
        {f.controls}
      </Filters>
      <p className="mb-4 hidden text-sm print:block">
        {storeName} · {byDate ? `at the end of ${longDay(asOf)}` : `as at ${dateTime(new Date().toISOString())}`}
      </p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard label="Stock value" value={money(r?.totalValue, session.tenant.baseCurrency)} icon={Coins} tone="green" note={storeName} />
        <StatCard label="Items in stock" value={r?.items ?? "–"} icon={Layers} tone="blue" note="Products and variants" />
        <StatCard label="Units on hand" value={qty(units)} icon={byDate ? CalendarClock : Boxes} tone="violet" note={byDate ? `At ${longDay(asOf)}` : "Right now"} />
      </div>
      {report.isLoading ? (
        <Spinner />
      ) : report.error ? (
        <FormError message={report.error.message} />
      ) : (
        <div className="card overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th className="hidden md:table-cell">Code</Th>
                <Th>Item</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Cost each</Th>
                <Th align="right">Value</Th>
              </tr>
            </thead>
            <tbody>
              {!r?.rows.length && <TableMessage colSpan={5}>No stock on hand{byDate ? " on that day" : ""}.</TableMessage>}
              {[...groups.entries()].map(([group, rows]) => (
                <GroupRows key={group} group={group} rows={rows} />
              ))}
              {!!r?.rows.length && (
                <tr className="bg-ledger-50/60 font-semibold">
                  <Td className="hidden md:table-cell" />
                  <Td>Total</Td>
                  <Td align="right" className="tabular-nums">
                    {qty(units)}
                  </Td>
                  <Td />
                  <Td align="right" className="tabular-nums">
                    {money(r.totalValue)}
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}

function GroupRows({ group, rows }: { group: string; rows: Valuation["rows"] }) {
  const subtotal = rows.reduce((t, r) => t + Number(r.value), 0);
  return (
    <>
      <tr>
        <td colSpan={5} className="border-b border-line/60 bg-paper/70 px-4 py-2 text-xs font-semibold tracking-wider text-ink-soft uppercase">
          {group} <span className="font-normal normal-case">· {money(subtotal)}</span>
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.variantId}>
          <Td className="hidden font-mono text-xs text-ink-soft uppercase md:table-cell">{r.sku ?? "—"}</Td>
          <Td className="font-medium">{itemName(r)}</Td>
          <Td align="right" className={`tabular-nums ${Number(r.quantity) < 0 ? "text-danger" : ""}`}>
            {qty(r.quantity)}
          </Td>
          <Td align="right" className={`tabular-nums ${Number(r.unitCost) ? "text-ink-soft" : "text-amber-ink"}`} >
            {Number(r.unitCost) ? money(r.unitCost) : "No cost"}
          </Td>
          <Td align="right" className="font-medium tabular-nums">
            {money(r.value)}
          </Td>
        </tr>
      ))}
    </>
  );
}

// ----- Stock ledger ---------------------------------------------------------------------

export function LedgerReport() {
  const f = useFilters();
  const [range, setRange] = useState({ from: firstOfMonth(), to: today() });
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const report = useQuery({
    queryKey: ["inventory", "ledger", f.query, range, type, page],
    queryFn: () => api<Page<StockMovementRow>>("/inventory/reports/ledger", { query: { ...f.query, ...range, type, page, pageSize: 100 } }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader title="Stock ledger" description="Every stock movement in a period: deliveries, sales, transfers, counts and write-offs, newest first." actions={<PrintButton />} />
      <Filters>
        <DateRange {...range} onChange={(r) => (setRange(r), setPage(1))} />
        <Field label="Type">
          {(id) => (
            <Select id={id} className="w-40" value={type} onChange={(e) => (setType(e.target.value), setPage(1))}>
              <option value="">All types</option>
              {Object.entries(MOVEMENT_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {f.controls}
      </Filters>
      {report.isLoading ? (
        <Spinner />
      ) : report.error ? (
        <FormError message={report.error.message} />
      ) : (
        <div className="card overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Item</Th>
                <Th>Type</Th>
                <Th className="hidden lg:table-cell">Store</Th>
                <Th align="right">Qty</Th>
                <Th align="right" className="hidden md:table-cell">
                  Value
                </Th>
                <Th className="hidden xl:table-cell">Reference</Th>
                <Th className="hidden xl:table-cell">By</Th>
              </tr>
            </thead>
            <tbody>
              {!report.data?.items.length && <TableMessage colSpan={8}>No movements in this period.</TableMessage>}
              {report.data?.items.map((m) => (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap text-ink-soft">{dateTime(m.createdAt)}</Td>
                  <Td>
                    <span className="font-medium">{itemName(m)}</span>
                    {m.sku && <span className="block font-mono text-xs text-ink-faint uppercase">{m.sku}</span>}
                  </Td>
                  <Td>
                    <MovementBadge type={m.type} />
                  </Td>
                  <Td className="hidden text-ink-soft lg:table-cell">{m.storeName}</Td>
                  <Td align="right" className={`font-medium tabular-nums ${Number(m.quantity) < 0 ? "text-danger" : "text-ledger-700"}`}>
                    {Number(m.quantity) > 0 ? "+" : ""}
                    {qty(m.quantity)}
                  </Td>
                  <Td align="right" className="hidden text-ink-soft tabular-nums md:table-cell">
                    {m.value ? money(m.value) : "—"}
                  </Td>
                  <Td className="hidden text-ink-soft xl:table-cell">{m.reference ?? m.note ?? "—"}</Td>
                  <Td className="hidden text-ink-soft xl:table-cell">{m.userName ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {report.data && <Pager page={page} pageSize={report.data.pageSize} total={report.data.total} onPage={setPage} />}
        </div>
      )}
    </div>
  );
}

// ----- Item detailed ledger -------------------------------------------------------------

interface ItemLedger {
  item: { productName: string; variantName: string; sku: string | null; barcode: string | null; unitCost: string };
  opening: string;
  totalIn: string;
  totalOut: string;
  closing: string;
  closingValue: string;
  lines: { id: string; createdAt: string; type: string; quantityIn: string | null; quantityOut: string | null; balance: string; reference: string | null; note: string | null; storeName: string; userName: string | null }[];
}

export function ItemLedgerReport() {
  const { storeId: current } = useSession();
  const [storeId, setStoreId] = useState("");
  const [range, setRange] = useState({ from: firstOfMonth(), to: today() });
  const [variant, setVariant] = useState<{ id: string; name: string } | null>(null);
  const report = useQuery({
    queryKey: ["inventory", "item-ledger", variant?.id, storeId, range],
    queryFn: () => api<ItemLedger>("/inventory/reports/item-ledger", { query: { variantId: variant!.id, storeId, ...range } }),
    enabled: !!variant,
    placeholderData: keepPreviousData,
  });
  const r = report.data;

  return (
    <div>
      <PageHeader title="Item detailed ledger" description="Every movement of one item, with the balance after each one." actions={<PrintButton />} />
      <Filters>
        <Field label="Item" className="min-w-72 flex-1">
          {() =>
            variant ? (
              <div className="flex h-10 items-center justify-between gap-2 rounded-xl border border-ledger-600 bg-ledger-50 px-3.5 text-sm">
                <span className="truncate font-medium text-ledger-900">{variant.name}</span>
                <button type="button" onClick={() => setVariant(null)} className="text-xs font-medium text-ledger-700 hover:underline">
                  Change
                </button>
              </div>
            ) : (
              <ItemPicker storeId={current} autoFocus onPick={(i) => setVariant({ id: i.variantId, name: itemName(i) })} />
            )
          }
        </Field>
        <Field label="Store">{(id) => <StoreSelect id={id} allowAll className="w-52" value={storeId} onChange={setStoreId} />}</Field>
        <DateRange {...range} onChange={setRange} />
      </Filters>

      {!variant ? (
        <div className="card px-6 py-16 text-center text-sm text-ink-faint">Choose an item to see its movements.</div>
      ) : report.isLoading || !r ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard label="Opening" value={qty(r.opening)} icon={CalendarClock} tone="blue" note={`On ${longDay(range.from)}`} />
            <StatCard label="In" value={`+${qty(r.totalIn)}`} icon={Boxes} tone="green" note="Received, transferred in" />
            <StatCard label="Out" value={`−${qty(r.totalOut)}`} icon={Boxes} tone="amber" note="Sold, transferred out, written off" />
            <StatCard label="Closing" value={qty(r.closing)} icon={Coins} tone="violet" note={`Worth ${money(r.closingValue)}`} />
          </div>
          <div className="card overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Type</Th>
                  <Th className="hidden md:table-cell">Store</Th>
                  <Th align="right">In</Th>
                  <Th align="right">Out</Th>
                  <Th align="right">Balance</Th>
                  <Th className="hidden lg:table-cell">Reference</Th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-paper/60 text-ink-soft">
                  <Td>{longDay(range.from)}</Td>
                  <Td>Opening balance</Td>
                  <Td className="hidden md:table-cell" />
                  <Td />
                  <Td />
                  <Td align="right" className="font-medium tabular-nums">
                    {qty(r.opening)}
                  </Td>
                  <Td className="hidden lg:table-cell" />
                </tr>
                {r.lines.length === 0 && <TableMessage colSpan={7}>No movements in this period.</TableMessage>}
                {r.lines.map((l) => (
                  <tr key={l.id}>
                    <Td className="whitespace-nowrap text-ink-soft">{dateTime(l.createdAt)}</Td>
                    <Td>
                      <MovementBadge type={l.type} />
                    </Td>
                    <Td className="hidden text-ink-soft md:table-cell">{l.storeName}</Td>
                    <Td align="right" className="text-ledger-700 tabular-nums">
                      {l.quantityIn ? qty(l.quantityIn) : ""}
                    </Td>
                    <Td align="right" className="text-danger tabular-nums">
                      {l.quantityOut ? qty(l.quantityOut) : ""}
                    </Td>
                    <Td align="right" className="font-medium tabular-nums">
                      {qty(l.balance)}
                    </Td>
                    <Td className="hidden text-ink-soft lg:table-cell">{l.reference ?? l.note ?? "—"}</Td>
                  </tr>
                ))}
                <tr className="bg-ledger-50/60 font-semibold">
                  <Td>{longDay(range.to)}</Td>
                  <Td>Closing balance</Td>
                  <Td className="hidden md:table-cell" />
                  <Td align="right" className="tabular-nums">
                    {qty(r.totalIn)}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {qty(r.totalOut)}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {qty(r.closing)}
                  </Td>
                  <Td className="hidden lg:table-cell" />
                </tr>
              </tbody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

// ----- Item summary ledger -------------------------------------------------------------------

interface ItemSummary {
  rows: {
    variantId: string;
    productName: string;
    variantName: string;
    sku: string | null;
    category: string | null;
    opening: string;
    received: string;
    transfersIn: string;
    sold: string;
    transfersOut: string;
    adjusted: string;
    closing: string;
    closingValue: string;
  }[];
  totalClosingValue: string;
}

export function ItemSummaryReport() {
  const f = useFilters();
  const [range, setRange] = useState({ from: firstOfMonth(), to: today() });
  const report = useQuery({
    queryKey: ["inventory", "item-summary", f.query, range],
    queryFn: () => api<ItemSummary>("/inventory/reports/item-summary", { query: { ...f.query, ...range } }),
    placeholderData: keepPreviousData,
  });
  const rows = report.data?.rows ?? [];
  const total = (k: keyof ItemSummary["rows"][number]) => rows.reduce((t, r) => t + Number(r[k]), 0);
  const cols = [
    ["opening", "Opening"],
    ["received", "Received"],
    ["transfersIn", "Transfer in"],
    ["sold", "Sold"],
    ["transfersOut", "Transfer out"],
    ["adjusted", "Adjusted"],
    ["closing", "Closing"],
  ] as const;

  return (
    <div>
      <PageHeader title="Item summary ledger" description="For each item over a period: what you started with, what came in and went out, and what's left." actions={<PrintButton />} />
      <Filters>
        <DateRange {...range} onChange={setRange} />
        {f.controls}
      </Filters>
      {report.isLoading ? (
        <Spinner />
      ) : report.error ? (
        <FormError message={report.error.message} />
      ) : (
        <div className="card overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                {cols.map(([k, label]) => (
                  <Th key={k} align="right" className={k === "opening" || k === "closing" ? "" : "hidden md:table-cell"}>
                    {label}
                  </Th>
                ))}
                <Th align="right" className="hidden lg:table-cell">
                  Closing value
                </Th>
              </tr>
            </thead>
            <tbody>
              {!rows.length && <TableMessage colSpan={9}>No stock activity in this period.</TableMessage>}
              {rows.map((r) => (
                <tr key={r.variantId}>
                  <Td>
                    <span className="font-medium">{itemName(r)}</span>
                    <span className="block text-xs text-ink-faint">{r.category ?? "No category"}</span>
                  </Td>
                  {cols.map(([k]) => {
                    const n = Number(r[k]);
                    const tone = k === "closing" ? "font-semibold" : n === 0 ? "text-ink-faint" : k === "adjusted" && n < 0 ? "text-danger" : "";
                    return (
                      <Td key={k} align="right" className={`tabular-nums ${tone} ${k === "opening" || k === "closing" ? "" : "hidden md:table-cell"}`}>
                        {n === 0 && k !== "closing" && k !== "opening" ? "—" : qty(r[k])}
                      </Td>
                    );
                  })}
                  <Td align="right" className="hidden tabular-nums lg:table-cell">
                    {money(r.closingValue)}
                  </Td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="bg-ledger-50/60 font-semibold">
                  <Td>Total</Td>
                  {cols.map(([k]) => (
                    <Td key={k} align="right" className={`tabular-nums ${k === "opening" || k === "closing" ? "" : "hidden md:table-cell"}`}>
                      {qty(total(k))}
                    </Td>
                  ))}
                  <Td align="right" className="hidden tabular-nums lg:table-cell">
                    {money(report.data?.totalClosingValue)}
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
