"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, ChevronRight, CloudUpload, Download, FileSpreadsheet, LayoutGrid, List, Plus, Search, Trash2, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AccountSelect, StateBadge, useChart, useCurrencies, useInvalidateBooks, useTaxRates } from "@/components/accounts";
import { itemName, ItemPicker, StoreSelect } from "@/components/stock";
import { useToast } from "@/components/toast";
import { Badge, Button, Checkbox, Field, FormError, Input, Select, Spinner, Table, TableMessage, Td, Textarea, Th } from "@/components/ui";
import { api, FinanceDocument, Page, StockLevel, Supplier } from "@/lib/api";
import { money, qty } from "@/lib/format";
import { useSession } from "@/lib/session";

const todayStr = () => new Date().toLocaleDateString("en-CA");
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA");
};
const PERIODS = [
  { id: "today", label: "Today", from: () => todayStr() },
  { id: "week", label: "Last 7 days", from: () => daysAgo(6) },
  { id: "month", label: "Last 30 days", from: () => daysAgo(29) },
  { id: "all", label: "All time", from: () => "" },
] as const;

const button = "inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-medium transition-all active:scale-[0.98]";
const primary = `${button} bg-gradient-to-b from-ledger-700 to-ledger-800 text-white shadow-sm shadow-ledger-900/25 hover:from-ledger-600 hover:to-ledger-700`;
const secondary = `${button} border border-line bg-surface text-ink shadow-sm shadow-ink/5 hover:bg-paper`;

/** An open box: the empty-state picture, drawn in the app's own style. */
function EmptyBox() {
  return (
    <svg viewBox="0 0 120 110" className="h-28 w-32" aria-hidden>
      <ellipse cx="60" cy="100" rx="38" ry="7" fill="#18222b" opacity="0.06" />
      <polygon points="60,28 98,46 60,64 22,46" fill="#cfe2f5" />
      <polygon points="22,46 60,64 60,98 22,80" fill="#3b8fe8" />
      <polygon points="60,64 98,46 98,80 60,98" fill="#1f6fe0" />
      <polygon points="22,46 60,64 46,76 8,58" fill="#5aa8f2" />
      <polygon points="98,46 60,64 74,76 112,58" fill="#4b9bef" />
      <polygon points="60,28 22,46 34,34 60,20" fill="#e3eefa" />
      <polygon points="60,28 98,46 86,34 60,20" fill="#b8cde3" />
      <rect x="30" y="70" width="12" height="7" rx="2" fill="#fff" opacity="0.85" transform="rotate(26 36 73)" />
    </svg>
  );
}

export function PurchasesList() {
  const { session } = useSession();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["id"]>("today");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"list" | "cards">("list");
  const PAGE = 50;
  const p = PERIODS.find((x) => x.id === period)!;

  // Debounce typing without an effect: commit the search on a short timer.
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const onSearch = (v: string) => {
    setSearch(v);
    if (timer) clearTimeout(timer);
    setTimer(setTimeout(() => (setDebounced(v.trim()), setPage(1)), 250));
  };

  const list = useQuery({
    queryKey: ["purchases", { debounced, period, page }],
    queryFn: () => api<Page<FinanceDocument>>("/purchases", { query: { search: debounced, from: p.from() || undefined, to: p.from() ? todayStr() : undefined, page, pageSize: PAGE } }),
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  const first = data?.total ? (page - 1) * PAGE + 1 : 0;
  const last = data ? Math.min(page * PAGE, data.total) : 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const base = session.tenant.baseCurrency;
  const when = (d: FinanceDocument) => new Date(d.createdAt ?? `${d.date}T00:00:00`).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link href="/suppliers/purchases/new" className={primary}>
          <Plus className="size-4" aria-hidden /> New
        </Link>
        <Link href="/suppliers/import" className={secondary}>
          <CloudUpload className="size-4" aria-hidden /> Smart Import Purchases
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Purchases</h1>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-ink-soft tabular-nums">
            {first}–{last} / {data?.total ?? 0}
          </span>
          <div className="flex">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-l-xl border border-line bg-surface p-2.5 text-ink-soft shadow-sm hover:bg-paper disabled:opacity-40" aria-label="Previous page">
              <ChevronLeft className="size-4" />
            </button>
            <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="-ml-px rounded-r-xl border border-line bg-surface p-2.5 text-ink-soft shadow-sm hover:bg-paper disabled:opacity-40" aria-label="Next page">
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="flex rounded-xl border border-line bg-surface p-0.5 shadow-sm" role="group" aria-label="View">
            {(
              [
                ["list", List, "List"],
                ["cards", LayoutGrid, "Cards"],
              ] as const
            ).map(([v, Icon, label]) => (
              <button key={v} type="button" aria-pressed={view === v} aria-label={label} title={label} onClick={() => setView(v)} className={`rounded-lg p-2 ${view === v ? "bg-ledger-800 text-white" : "text-ink-soft hover:bg-paper"}`}>
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
        <div className="flex w-full min-w-0 items-center gap-2 rounded-xl border border-line-strong/80 bg-surface px-2 shadow-sm shadow-ink/[0.03] focus-within:border-ledger-600 focus-within:ring-4 focus-within:ring-ledger-600/10">
          <Search className="ml-1 size-4 shrink-0 text-ink-faint" aria-hidden />
          {period !== "all" && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-ledger-50 py-1 pr-1 pl-2 text-xs font-medium text-ledger-800">
              {p.label}
              <button type="button" onClick={() => (setPeriod("all"), setPage(1))} className="rounded p-0.5 hover:bg-ledger-100" aria-label="Show all dates">
                <X className="size-3" />
              </button>
            </span>
          )}
          <input aria-label="Search purchases" placeholder="Reference, supplier or their invoice number…" value={search} onChange={(e) => onSearch(e.target.value)} className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint" />
          <Select aria-label="Period" value={period} onChange={(e) => (setPeriod(e.target.value as typeof period), setPage(1))} className="h-8 w-32 border-0 bg-paper text-xs shadow-none focus:ring-0">
            {PERIODS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {list.isLoading ? (
        <Spinner />
      ) : !data?.items.length ? (
        <div className="card flex flex-col items-center gap-4 px-6 py-16 text-center">
          <EmptyBox />
          <p className="text-xl font-semibold">Create a new Purchase Record</p>
          <p className="max-w-md text-sm text-ink-soft">
            {period === "all" ? "Record goods bought from a supplier: they go into stock at their cost, and the bill is owed or paid." : `No purchases in ${p.label.toLowerCase()}.`}
          </p>
          <Link href="/suppliers/purchases/new" className={primary}>
            <Plus className="size-4" aria-hidden /> New purchase
          </Link>
        </div>
      ) : view === "list" ? (
        <div className="card overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Datetime</Th>
                <Th>Reference</Th>
                <Th className="hidden md:table-cell">External ref</Th>
                <Th>Supplier</Th>
                <Th className="hidden lg:table-cell">Store</Th>
                <Th>Payment status</Th>
                <Th align="right" className="hidden xl:table-cell">
                  Total
                </Th>
                <Th align="right" className="hidden 2xl:table-cell">
                  Base total
                </Th>
                <Th align="right" className="hidden xl:table-cell">
                  Paid
                </Th>
                <Th align="right">Total incl</Th>
                <Th className="hidden md:table-cell">Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((d) => (
                <tr key={d.id} className={d.status === "void" ? "text-ink-faint" : ""}>
                  <Td className="whitespace-nowrap text-ink-soft">{when(d)}</Td>
                  <Td>
                    <Link href={`/suppliers/purchases/${d.id}`} className="font-medium whitespace-nowrap hover:text-ledger-700 hover:underline">
                      {d.number}
                    </Link>
                  </Td>
                  <Td className="hidden text-ink-soft md:table-cell">{d.supplierReference ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{d.partyName}</Td>
                  <Td className="hidden whitespace-nowrap lg:table-cell">{d.storeName}</Td>
                  <Td>{d.status === "void" ? <span className="text-ink-faint">—</span> : <StateBadge state={d.state} />}</Td>
                  <Td align="right" className="hidden tabular-nums xl:table-cell">
                    {money(d.subtotal)}
                  </Td>
                  <Td align="right" className="hidden text-ink-soft tabular-nums 2xl:table-cell">
                    {money(d.totalBase)} {base}
                  </Td>
                  <Td align="right" className="hidden tabular-nums xl:table-cell">
                    {money(d.amountPaid)}
                  </Td>
                  <Td align="right" className="font-semibold whitespace-nowrap tabular-nums">
                    {d.currencyCode} {money(d.total)}
                  </Td>
                  <Td className="hidden md:table-cell">{d.status === "void" ? <Badge tone="red">Void</Badge> : <Badge tone="green">Received</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data.items.map((d) => (
            <Link key={d.id} href={`/suppliers/purchases/${d.id}`} className="card flex flex-col gap-2 p-4 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{d.number}</span>
                <StateBadge state={d.state} />
              </span>
              <span className="text-sm">{d.partyName}</span>
              <span className="text-xs text-ink-faint">
                {d.supplierReference ?? "No reference"} · {d.storeName}
              </span>
              <span className="mt-auto pt-2 text-right text-lg font-semibold tabular-nums">
                {d.currencyCode} {money(d.total)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ----- New purchase -------------------------------------------------------------------------

interface Line {
  item: StockLevel;
  quantity: string;
  unitCost: string;
  taxRateId: string;
}

export function PurchaseEditor() {
  const { session, storeId: current } = useSession();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = useInvalidateBooks();
  const base = session.tenant.baseCurrency;
  const chart = useChart();
  const taxRates = useTaxRates();
  const currencies = useCurrencies();
  const suppliers = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => api<Page<Supplier>>("/suppliers", { query: { pageSize: 200 } }) });
  const banks = (chart.data ?? []).filter((a) => a.isBank && a.active);
  const activeRates = taxRates.data?.filter((r) => r.active) ?? [];
  const defaultTax = activeRates.find((r) => r.isDefault)?.id ?? "";

  const [form, setForm] = useState({ supplierId: "", storeId: current ?? "", date: todayStr(), supplierReference: "", currencyCode: base, taxInclusive: false, notes: "", paidFrom: "", updateCostPrices: true });
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);

  const lineTotals = (l: Line) => {
    const amount = (Number(l.quantity) || 0) * (Number(l.unitCost) || 0);
    const pct = Number(activeRates.find((r) => r.id === l.taxRateId)?.rate ?? 0);
    if (form.taxInclusive) {
      const tax = (amount * pct) / (100 + pct);
      return { net: amount - tax, tax };
    }
    return { net: amount, tax: (amount * pct) / 100 };
  };
  const totals = lines.reduce((t, l) => {
    const x = lineTotals(l);
    return { net: t.net + x.net, tax: t.tax + x.tax };
  }, { net: 0, tax: 0 });

  const save = useMutation({
    mutationFn: () =>
      api<FinanceDocument>("/purchases", {
        method: "POST",
        body: {
          supplierId: form.supplierId,
          storeId: form.storeId,
          date: form.date,
          supplierReference: form.supplierReference.trim() || undefined,
          currencyCode: form.currencyCode,
          taxInclusive: form.taxInclusive,
          notes: form.notes.trim() || undefined,
          updateCostPrices: form.updateCostPrices,
          payment: form.paidFrom ? { accountId: form.paidFrom } : undefined,
          lines: lines.map((l) => ({ variantId: l.item.variantId, quantity: l.quantity, unitCost: l.unitCost, taxRateId: l.taxRateId || null })),
        },
      }),
    onSuccess: (p) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast(`Purchase ${p.number} received${form.paidFrom ? " and paid" : ""}`);
      router.push(`/suppliers/purchases/${p.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New purchase</h1>
        <p className="mt-1 text-sm text-ink-soft">Copy the supplier&apos;s invoice. The goods go into the store&apos;s stock at this cost, and the bill is owed to the supplier unless you mark it paid.</p>
      </div>

      <div className="card grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Supplier" className="sm:col-span-2">
          {(id) => (
            <Select id={id} required value={form.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
              <option value="">Choose a supplier</option>
              {suppliers.data?.items
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Supplier's invoice number">{(id) => <Input id={id} value={form.supplierReference} onChange={(e) => set({ supplierReference: e.target.value })} />}</Field>
        <Field label="Date">{(id) => <Input id={id} type="date" required value={form.date} onChange={(e) => set({ date: e.target.value })} />}</Field>
        <Field label="Received into" className="sm:col-span-2">
          {(id) => (
            <StoreSelect
              id={id}
              value={form.storeId}
              onChange={(v) => {
                if (lines.length && !confirm("Change store? The items listed will be cleared.")) return;
                setLines([]);
                set({ storeId: v });
              }}
            />
          )}
        </Field>
        <Field label="Currency">
          {(id) => (
            <Select id={id} value={form.currencyCode} onChange={(e) => set({ currencyCode: e.target.value })}>
              {currencies.data
                ?.filter((c) => c.active)
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <div className="flex items-end pb-2.5">
          <Checkbox label="Costs include VAT" checked={form.taxInclusive} onChange={(e) => set({ taxInclusive: e.target.checked })} />
        </div>
      </div>

      <div className="card overflow-visible">
        <div className="p-6 pb-3">
          <ItemPicker
            storeId={form.storeId}
            placeholder="Add an item you bought…"
            onPick={(item) => {
              if (lines.some((l) => l.item.variantId === item.variantId)) return toast(`${itemName(item)} is already listed`, "error");
              setLines([...lines, { item, quantity: "", unitCost: item.costPrice ?? "", taxRateId: defaultTax }]);
            }}
          />
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th align="right" className="hidden sm:table-cell">
                In stock
              </Th>
              <Th align="right">Qty</Th>
              <Th align="right">Cost each</Th>
              <Th>VAT</Th>
              <Th align="right">Amount</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <TableMessage colSpan={7}>Search above to add the items on the invoice.</TableMessage>}
            {lines.map((l, i) => {
              const x = lineTotals(l);
              const setLine = (patch: Partial<Line>) => setLines(lines.map((y, j) => (j === i ? { ...y, ...patch } : y)));
              return (
                <tr key={l.item.variantId}>
                  <Td>
                    <span className="font-medium">{itemName(l.item)}</span>
                    {l.item.costPrice && <span className="block text-xs text-ink-faint">Last cost {money(l.item.costPrice)}</span>}
                  </Td>
                  <Td align="right" className="hidden text-ink-soft tabular-nums sm:table-cell">
                    {qty(l.item.onHand)}
                  </Td>
                  <Td align="right">
                    <Input aria-label={`Quantity of ${itemName(l.item)}`} required autoFocus={i === lines.length - 1} inputMode="decimal" pattern="\d+(\.\d{1,3})?" className="ml-auto w-24 text-right" value={l.quantity} onChange={(e) => setLine({ quantity: e.target.value })} />
                  </Td>
                  <Td align="right">
                    <Input aria-label={`Cost of ${itemName(l.item)}`} required inputMode="decimal" pattern="\d+(\.\d{1,2})?" placeholder="0.00" className="ml-auto w-28 text-right" value={l.unitCost} onChange={(e) => setLine({ unitCost: e.target.value })} />
                  </Td>
                  <Td>
                    <Select aria-label={`VAT on ${itemName(l.item)}`} className="w-36" value={l.taxRateId} onChange={(e) => setLine({ taxRateId: e.target.value })}>
                      <option value="">None</option>
                      {activeRates.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td align="right" className="font-semibold tabular-nums">
                    {money(x.net + x.tax)}
                  </Td>
                  <Td align="right">
                    <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-ink-faint hover:bg-danger-soft hover:text-danger" aria-label={`Remove ${itemName(l.item)}`}>
                      <Trash2 className="size-4" />
                    </button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <div className="flex flex-wrap items-start justify-between gap-6 border-t border-line/70 p-6">
          <div className="flex max-w-md flex-1 flex-col gap-3">
            <Field label="Paid now from" hint="Leave as owed if you'll pay the supplier later.">
              {(id) => <AccountSelect id={id} accounts={banks} placeholder="Not paid yet (owed to the supplier)" value={form.paidFrom} onChange={(v) => set({ paidFrom: v })} />}
            </Field>
            <Checkbox label="Use these costs as the items' cost prices" checked={form.updateCostPrices} onChange={(e) => set({ updateCostPrices: e.target.checked })} />
          </div>
          <dl className="grid min-w-60 grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <dt className="text-ink-soft">Before VAT</dt>
            <dd className="text-right tabular-nums">{money(totals.net)}</dd>
            <dt className="text-ink-soft">VAT</dt>
            <dd className="text-right tabular-nums">{money(totals.tax)}</dd>
            <dt className="mt-1 border-t border-line pt-1 font-semibold">Total</dt>
            <dd className="mt-1 border-t border-line pt-1 text-right text-lg font-semibold tabular-nums">
              {form.currencyCode} {money(totals.net + totals.tax)}
            </dd>
          </dl>
        </div>
      </div>

      <Field label="Notes">{(id) => <Textarea id={id} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" busy={save.isPending} disabled={!lines.length}>
          {form.paidFrom ? "Receive and pay" : "Receive goods"}
        </Button>
        <Link href="/suppliers/purchases" className={`${button} text-ink-soft hover:bg-ledger-50 hover:text-ink`}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

// ----- Import purchase bills -------------------------------------------------------------------

const COLUMNS = [
  { key: "reference", label: "Invoice no.", required: true, names: ["reference", "ref", "invoice", "invoice no", "invoice number", "bill", "bill no"] },
  { key: "date", label: "Date", required: true, names: ["date", "invoice date"] },
  { key: "supplier", label: "Supplier", required: true, names: ["supplier", "supplier name", "vendor"] },
  { key: "store", label: "Store code", required: true, names: ["store", "store code", "shop", "branch"] },
  { key: "item", label: "Item code", required: true, names: ["item", "sku", "barcode", "code", "product code", "item code"] },
  { key: "quantity", label: "Quantity", required: true, names: ["quantity", "qty"] },
  { key: "unitCost", label: "Unit cost", required: true, names: ["unit cost", "cost", "price", "unit price"] },
  { key: "vat", label: "VAT", required: false, names: ["vat", "tax", "vatable"] },
  { key: "currencyCode", label: "Currency", required: false, names: ["currency", "currency code"] },
] as const;
type Key = (typeof COLUMNS)[number]["key"];

const TEMPLATE = "invoice no,date,supplier,store,item,quantity,unit cost,vat,currency\nDB-1042,2026-10-01,Delta Beverages,MAIN,6001067000011,48,0.62,yes,USD\nDB-1042,2026-10-01,Delta Beverages,MAIN,6001067000028,12,3.10,yes,USD\n";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: { reference: string; message: string }[];
}

export function ImportPurchases() {
  const qc = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<Key, string>[]>([]);
  const [mapped, setMapped] = useState<Key[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const load = async (file: File) => {
    setError(null);
    setResult(null);
    setFileName(file.name);
    const [header, ...body] = parseCsv(await file.text());
    if (!header || !body.length) return setError("That file has no rows. Save your spreadsheet as CSV and try again.");
    const index = new Map<Key, number>();
    header.forEach((h, i) => {
      const name = h.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\.$/, "");
      const col = COLUMNS.find((c) => (c.names as readonly string[]).includes(name));
      if (col && !index.has(col.key)) index.set(col.key, i);
    });
    const missing = COLUMNS.filter((c) => c.required && !index.has(c.key));
    if (missing.length) return setError(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.map((m) => m.label).join(", ")}. Download the template to see the layout.`);
    setMapped([...index.keys()]);
    setRows(body.map((r) => Object.fromEntries(COLUMNS.map((c) => [c.key, index.has(c.key) ? (r[index.get(c.key)!] ?? "").trim() : ""])) as Record<Key, string>));
  };

  const run = useMutation({
    mutationFn: () =>
      api<ImportResult>("/purchases/import", {
        method: "POST",
        body: {
          rows: rows.map((r) => ({
            reference: r.reference,
            date: r.date,
            supplier: r.supplier,
            store: r.store,
            item: r.item,
            quantity: r.quantity,
            unitCost: r.unitCost,
            vat: ["yes", "y", "true", "1", "vat", "15.5"].includes(r.vat.toLowerCase()),
            currencyCode: r.currencyCode ? r.currencyCode.toUpperCase() : undefined,
          })),
        },
      }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const bills = new Set(rows.map((r) => `${r.supplier.toLowerCase()}|${r.reference}`)).size;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Import purchase bills</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Rows with the same supplier and invoice number become one purchase, received into stock and owed to the supplier. New supplier names are added for you, and a bill already imported is skipped.
          </p>
        </div>
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="purchase-bills-template.csv" className={secondary}>
          <Download className="size-4" aria-hidden /> Template
        </a>
      </div>

      <label className="card flex cursor-pointer flex-col items-center gap-3 border-2 border-dashed border-line-strong/70 px-6 py-12 text-center transition hover:border-ledger-600 hover:bg-ledger-50/40">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-400 to-violet-600 text-white shadow-sm">
          <CloudUpload className="size-7" aria-hidden />
        </span>
        <span className="font-semibold">{fileName || "Choose a CSV file"}</span>
        <span className="text-sm text-ink-soft">Columns: invoice no., date, supplier, store, item (SKU or barcode), quantity, unit cost — plus VAT (yes/no) and currency if you have them.</span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void load(f);
            e.target.value = "";
          }}
        />
      </label>
      <FormError message={error} />

      {rows.length > 0 && !result && (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-6 py-4">
            <p className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="size-4 text-ledger-700" aria-hidden />
              <strong>{rows.length}</strong> rows · <strong>{bills}</strong> purchase bills
            </p>
            <Button busy={run.isPending} onClick={() => run.mutate()}>
              Import {bills} bill{bills === 1 ? "" : "s"}
            </Button>
          </div>
          <Table>
            <thead>
              <tr>
                {COLUMNS.filter((c) => mapped.includes(c.key)).map((c) => (
                  <Th key={c.key}>{c.label}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((r, i) => (
                <tr key={i}>
                  {COLUMNS.filter((c) => mapped.includes(c.key)).map((c) => (
                    <Td key={c.key} className="text-ink-soft">
                      {r[c.key] || "—"}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
          {rows.length > 12 && <p className="px-6 py-3 text-xs text-ink-faint">…and {rows.length - 12} more rows</p>}
        </section>
      )}

      {result && (
        <section className="card flex flex-col gap-4 p-6">
          <div className="flex flex-wrap gap-6">
            <p className="flex items-center gap-2 text-lg font-semibold text-ledger-700">
              <CheckCircle2 className="size-5" aria-hidden /> {result.imported} imported
            </p>
            {result.skipped > 0 && <p className="text-lg font-semibold text-ink-soft">{result.skipped} already imported</p>}
            {result.errors.length > 0 && (
              <p className="flex items-center gap-2 text-lg font-semibold text-danger">
                <TriangleAlert className="size-5" aria-hidden /> {result.errors.length} not imported
              </p>
            )}
          </div>
          {result.errors.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-xl bg-danger-soft p-4 text-sm text-danger">
              {result.errors.map((e) => (
                <li key={e.reference}>
                  <strong>{e.reference}</strong>: {e.message}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Link href="/suppliers/purchases" className={primary}>
              See purchases
            </Link>
            <Button variant="secondary" onClick={() => (setRows([]), setResult(null), setFileName(""))}>
              Import another file
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
