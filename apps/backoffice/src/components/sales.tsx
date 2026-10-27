"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  CreditCard,
  Landmark,
  LayoutGrid,
  List,
  Minus,
  Plus,
  Printer,
  Search,
  Smartphone,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { StoreSelect } from "@/components/stock";
import { useToast } from "@/components/toast";
import { Badge, Button, Checkbox, Dialog, Field, FormError, Input, Select, Spinner, Table, TableMessage, Td, Textarea, Th } from "@/components/ui";
import { api, Currency, Customer, Page, PaymentMethod, PriceList, Product, Sale, SaleStatus, SaleType } from "@/lib/api";
import { dateTime, money, qty } from "@/lib/format";
import { MANAGERS, useSession } from "@/lib/session";

// ----- Small pieces -----------------------------------------------------------------

export const METHODS: { id: PaymentMethod; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "cash", label: "Cash", icon: Banknote },
  { id: "card", label: "Card", icon: CreditCard },
  { id: "mobile", label: "Mobile money", icon: Smartphone },
  { id: "bank", label: "Bank transfer", icon: Landmark },
];
export const methodLabel = (m: string) => METHODS.find((x) => x.id === m)?.label ?? m;

const STATUS: Record<SaleStatus, { label: string; tone: "neutral" | "green" | "amber" | "red" }> = {
  open: { label: "Open", tone: "amber" },
  completed: { label: "Done", tone: "green" },
  converted: { label: "Sold", tone: "green" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  void: { label: "Void", tone: "red" },
};

export function SaleStatusBadge({ status, type }: { status: SaleStatus; type?: SaleType }) {
  if (type === "return" && status === "completed") return <Badge tone="amber">Refunded</Badge>;
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const FISCAL: Record<Sale["fiscalStatus"], { label: string; tone: "neutral" | "green" | "amber" | "red" }> = {
  not_required: { label: "Not required", tone: "neutral" },
  pending: { label: "Pending", tone: "amber" },
  submitted: { label: "Fiscalised", tone: "green" },
  failed: { label: "Failed", tone: "red" },
};
export const FiscalBadge = ({ status }: { status: Sale["fiscalStatus"] }) => <Badge tone={FISCAL[status].tone}>{FISCAL[status].label}</Badge>;

const today = () => new Date().toLocaleDateString("en-CA");
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA");
};
const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const PERIODS = [
  { id: "today", label: "Today", from: () => today() },
  { id: "week", label: "Last 7 days", from: () => daysAgo(6) },
  { id: "month", label: "Last 30 days", from: () => daysAgo(29) },
  { id: "all", label: "All time", from: () => "" },
] as const;

const toolbarButton =
  "inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-medium transition-all active:scale-[0.98]";
const primary = `${toolbarButton} bg-gradient-to-b from-ledger-700 to-ledger-800 text-white shadow-sm shadow-ledger-900/25 hover:from-ledger-600 hover:to-ledger-700`;
const secondary = `${toolbarButton} border border-line bg-surface text-ink shadow-sm shadow-ink/5 hover:bg-paper`;

// ----- List of sales, returns or quotations --------------------------------------------

export function SalesList({ type }: { type: "sale" | "quotation" }) {
  const { can, session } = useSession();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["id"]>(type === "sale" ? "today" : "all");
  const [showReturns, setShowReturns] = useState(false);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"list" | "cards">("list");
  const PAGE = 50;

  useEffect(() => {
    const t = setTimeout(() => (setDebounced(search.trim()), setPage(1)), 250);
    return () => clearTimeout(t);
  }, [search]);

  const p = PERIODS.find((x) => x.id === period)!;
  const listType = type === "quotation" ? "quotation" : showReturns ? "return" : "sale";
  const list = useQuery({
    queryKey: ["sales", listType, { debounced, period, page }],
    queryFn: () => api<Page<Sale>>("/sales", { query: { type: listType, search: debounced, from: p.from() || undefined, to: p.from() ? today() : undefined, page, pageSize: PAGE } }),
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  const first = data?.total ? (page - 1) * PAGE + 1 : 0;
  const last = data ? Math.min(page * PAGE, data.total) : 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const title = type === "quotation" ? "Quotations" : showReturns ? "Sales Returns" : "Sales Invoices";
  const base = type === "quotation" ? "/sales/quotations" : "/sales/invoices";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link href={`${base}/new`} className={primary}>
          <Plus className="size-4" aria-hidden /> New
        </Link>
        {type === "sale" && can(...MANAGERS) && (
          <Link href="/sales/import" className={secondary}>
            <CloudUpload className="size-4" aria-hidden /> Smart Import Invoices
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>

        <div className="order-last flex w-full min-w-0 items-center gap-2 rounded-xl border border-line-strong/80 bg-surface px-2 shadow-sm shadow-ink/[0.03] focus-within:border-ledger-600 focus-within:ring-4 focus-within:ring-ledger-600/10 2xl:order-none 2xl:w-auto 2xl:max-w-xl 2xl:flex-1">
          <Search className="ml-1 size-4 shrink-0 text-ink-faint" aria-hidden />
          {period !== "all" && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-ledger-50 py-1 pr-1 pl-2 text-xs font-medium text-ledger-800">
              {p.label}
              <button type="button" onClick={() => (setPeriod("all"), setPage(1))} className="rounded p-0.5 hover:bg-ledger-100" aria-label="Show all dates">
                <X className="size-3" />
              </button>
            </span>
          )}
          {showReturns && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-amber-soft py-1 pr-1 pl-2 text-xs font-medium text-amber-ink">
              Returns
              <button type="button" onClick={() => (setShowReturns(false), setPage(1))} className="rounded p-0.5 hover:bg-amber/20" aria-label="Show sales">
                <X className="size-3" />
              </button>
            </span>
          )}
          <input
            aria-label={`Search ${title.toLowerCase()}`}
            placeholder="Number or customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
          />
          <Select aria-label="Period" value={period} onChange={(e) => (setPeriod(e.target.value as typeof period), setPage(1))} className="h-8 w-32 border-0 bg-paper text-xs shadow-none focus:ring-0">
            {PERIODS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </Select>
          {type === "sale" && !showReturns && (
            <button type="button" onClick={() => (setShowReturns(true), setPage(1))} className="shrink-0 rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-paper">
              Returns
            </button>
          )}
        </div>

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
      </div>

      {list.isLoading ? (
        <Spinner />
      ) : !data?.items.length ? (
        <div className="card px-6 py-16 text-center text-sm text-ink-faint">
          {type === "quotation" ? "No quotations" : showReturns ? "No returns" : "No sales"} {period === "all" ? "yet" : `in ${p.label.toLowerCase()}`}.{" "}
          <Link href={`${base}/new`} className="font-medium text-ledger-700 hover:underline">
            {type === "quotation" ? "Write a quotation" : "Make a sale"}
          </Link>
        </div>
      ) : view === "list" ? (
        <div className="card overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Customer</Th>
                <Th>Date</Th>
                <Th className="hidden lg:table-cell">Store</Th>
                <Th className="hidden xl:table-cell">POS terminal</Th>
                <Th className="hidden 2xl:table-cell">App version</Th>
                <Th align="right" className="hidden md:table-cell">
                  Qty
                </Th>
                <Th className="hidden lg:table-cell">Salesperson</Th>
                <Th align="right">Total</Th>
                <Th>Status</Th>
                {type === "sale" && <Th className="hidden md:table-cell">ZIMRA status</Th>}
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id} className={s.status === "void" ? "text-ink-faint" : ""}>
                  <Td>
                    <Link href={`/sales/invoices/${s.id}`} className="font-medium hover:text-ledger-700 hover:underline">
                      {s.number}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">{s.customerName}</Td>
                  <Td className="whitespace-nowrap text-ink-soft">{shortDateTime(s.soldAt)}</Td>
                  <Td className="hidden whitespace-nowrap lg:table-cell">{s.storeName}</Td>
                  <Td className="hidden text-ink-soft xl:table-cell">{s.deviceName ?? "Backoffice"}</Td>
                  <Td className="hidden text-ink-soft 2xl:table-cell">{s.appVersion ?? "—"}</Td>
                  <Td align="right" className="hidden tabular-nums md:table-cell">
                    {Number(s.itemCount).toFixed(2)}
                  </Td>
                  <Td className="hidden whitespace-nowrap text-ink-soft lg:table-cell">{s.salesperson ?? "—"}</Td>
                  <Td align="right" className="font-medium whitespace-nowrap tabular-nums">
                    {s.currencyCode === session.tenant.baseCurrency ? `${money(s.total)} ${s.currencyCode}` : `${s.currencyCode} ${money(s.total)}`}
                  </Td>
                  <Td>
                    <SaleStatusBadge status={s.status} type={s.type} />
                  </Td>
                  {type === "sale" && (
                    <Td className="hidden md:table-cell">
                      <FiscalBadge status={s.fiscalStatus} />
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data.items.map((s) => (
            <Link key={s.id} href={`/sales/invoices/${s.id}`} className="card flex flex-col gap-2 p-4 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
              <span className="flex items-center justify-between">
                <span className="font-semibold">{s.number}</span>
                <SaleStatusBadge status={s.status} type={s.type} />
              </span>
              <span className="text-sm text-ink-soft">{s.customerName}</span>
              <span className="mt-auto flex items-end justify-between pt-2">
                <span className="text-xs text-ink-faint">{shortDateTime(s.soldAt)}</span>
                <span className="text-lg font-semibold tabular-nums">
                  {s.currencyCode} {money(s.total)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ----- Sale entry -----------------------------------------------------------------------

interface CartLine {
  key: number;
  variantId: string;
  name: string;
  basePrice: string;
  quantity: string;
  /** Typed by the user; empty = the store's price. */
  unitPrice: string;
  discount: string;
}

interface Preview {
  currencyCode: string;
  rate: string;
  /** The price list that priced it (chosen, or the customer's); null for normal prices. */
  priceListId: string | null;
  lines: { variantId: string; unitPrice: string; discount: string; net: string; tax: string; total: string; taxRateName: string | null }[];
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  totalBase: string;
}

/** Product search for selling: every active item, stocked or not (services, menu items). */
function SellPicker({ onPick }: { onPick: (v: { variantId: string; name: string; price: string }) => void }) {
  const listId = useId();
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const results = useQuery({
    queryKey: ["products", "sell", debounced],
    queryFn: () => api<Page<Product>>("/products", { query: { search: debounced, active: true, pageSize: 10 } }),
    enabled: open,
  });
  const stale = debounced !== text.trim() || results.isFetching;
  const options = stale
    ? []
    : (results.data?.items ?? []).flatMap((p) =>
        p.variants
          .filter((v) => v.active)
          .map((v) => ({ variantId: v.id, name: v.name === "Default" ? p.name : `${p.name} · ${v.name}`, price: v.price, code: v.sku ?? v.barcode })),
      );
  const pick = (o: (typeof options)[number]) => {
    onPick(o);
    setText("");
    setActive(0);
  };

  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute top-3.5 left-4 size-5 text-ink-faint" aria-hidden />
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Add an item"
        autoFocus
        placeholder="Scan a barcode or search for an item…"
        className="h-12 pl-12 text-base"
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => (setText(e.target.value), setOpen(true), setActive(0))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive(Math.min(active + 1, options.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive(Math.max(active - 1, 0));
          }
          if (e.key === "Enter" && options[active]) {
            e.preventDefault();
            pick(options[active]);
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="card absolute inset-x-0 top-full z-30 mt-2 max-h-96 overflow-y-auto p-1.5">
          {stale && <li className="px-3 py-2 text-sm text-ink-faint">Searching…</li>}
          {!stale && options.length === 0 && <li className="px-3 py-2 text-sm text-ink-faint">No items match.</li>}
          {options.map((o, i) => (
            <li
              key={o.variantId}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => (e.preventDefault(), pick(o))}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 ${i === active ? "bg-ledger-50" : ""}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{o.name}</span>
                {o.code && <span className="block font-mono text-xs text-ink-faint uppercase">{o.code}</span>}
              </span>
              <span className="text-sm font-semibold tabular-nums">{money(o.price)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface PayDraft {
  key: number;
  method: PaymentMethod;
  currencyCode: string;
  amount: string;
  reference: string;
}

export function SaleEditor({ mode }: { mode: "sale" | "quotation" }) {
  const { session, storeId: currentStore } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const base = session.tenant.baseCurrency;
  const [storeId, setStoreId] = useState(currentStore ?? "");
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  /** "" uses the customer's prices (Wholesale for a wholesale customer), else normal prices. */
  const [priceListId, setPriceListId] = useState("");
  const [currencyCode, setCurrencyCode] = useState(base);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [pays, setPays] = useState<PayDraft[]>([]);
  const [note, setNote] = useState("");
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toLocaleDateString("en-CA");
  });
  const [nextKey, setNextKey] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());

  const customers = useQuery({ queryKey: ["customers", "all"], queryFn: () => api<Page<Customer>>("/customers", { query: { pageSize: 200 } }) });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: () => api<Currency[]>("/currencies") });
  const priceLists = useQuery({ queryKey: ["price-lists"], queryFn: () => api<PriceList[]>("/price-lists") });
  const activeLists = priceLists.data?.filter((l) => l.active) ?? [];
  const rateOf = (code: string) => currencies.data?.find((c) => c.code === code)?.rateToBase ?? "1";

  // Lines with a quantity are priced; the preview comes back in the same order.
  const priced = lines.filter((l) => Number(l.quantity) > 0);
  const body = {
    storeId,
    customerId: customerId || undefined,
    priceListId: priceListId || undefined,
    currencyCode,
    lines: priced.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitPrice: l.unitPrice || undefined, discount: l.discount || undefined })),
  };
  const preview = useQuery({
    queryKey: ["sales", "preview", body],
    queryFn: () => api<Preview>("/sales/preview", { method: "POST", body }),
    enabled: !!storeId && body.lines.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const pv = body.lines.length ? preview.data : undefined;
  const total = Number(pv?.total ?? 0);

  // Tendered in base currency, using each payment currency's rate, to show what's left and the change.
  const toBase = (amount: number, code: string) => (code === base ? amount : amount / Number(rateOf(code)));
  const tenderedBase = pays.reduce((t, p) => t + toBase(Number(p.amount) || 0, p.currencyCode), 0);
  const dueBase = Number(pv?.totalBase ?? 0);
  const remainingBase = Math.max(0, dueBase - tenderedBase);
  const changeBase = Math.max(0, tenderedBase - dueBase);
  const remainingIn = (code: string) => (code === base ? remainingBase : remainingBase * Number(rateOf(code)));

  const addLine = (v: { variantId: string; name: string; price: string }) => {
    const existing = lines.find((l) => l.variantId === v.variantId && !l.unitPrice && !l.discount);
    if (existing) {
      setLines(lines.map((l) => (l === existing ? { ...l, quantity: String(Number(l.quantity) + 1) } : l)));
    } else {
      setLines([...lines, { key: nextKey, variantId: v.variantId, name: v.name, basePrice: v.price, quantity: "1", unitPrice: "", discount: "" }]);
      setNextKey(nextKey + 1);
    }
  };
  const setLine = (key: number, patch: Partial<CartLine>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addPayment = (method: PaymentMethod) => {
    const amount = remainingIn(currencyCode);
    setPays([...pays, { key: nextKey, method, currencyCode, amount: amount > 0 ? amount.toFixed(2) : "", reference: "" }]);
    setNextKey(nextKey + 1);
  };

  const save = useMutation({
    mutationFn: () =>
      mode === "quotation"
        ? api<Sale>("/sales/quotations", { method: "POST", body: { ...body, customerName: customerName.trim() || undefined, note: note.trim() || undefined, validUntil } })
        : api<Sale>("/sales", {
            method: "POST",
            body: {
              ...body,
              customerName: customerName.trim() || undefined,
              note: note.trim() || undefined,
              clientId,
              payments: pays.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, currencyCode: p.currencyCode, amount: p.amount, reference: p.reference.trim() || undefined })),
            },
          }),
    onSuccess: (sale) => {
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      const change = sale.payments?.find((p) => Number(p.change) > 0);
      toast(mode === "quotation" ? `Quotation ${sale.number} saved` : `Sale ${sale.number} done${change ? ` · change ${change.currencyCode} ${money(change.change)}` : ""}`);
      setClientId(crypto.randomUUID());
      router.push(`/sales/invoices/${sale.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const fmt = (v: string | number) => `${currencyCode} ${money(v)}`;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{mode === "quotation" ? "New quotation" : "New sale"}</h1>
          <StoreSelect aria-label="Store" className="w-56" value={storeId} onChange={setStoreId} />
        </div>
        <SellPicker onPick={addLine} />
        <div className="card overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Price</Th>
                <Th align="right" className="hidden md:table-cell">
                  Discount
                </Th>
                <Th align="right">Total</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && <TableMessage colSpan={6}>Scan or search above to add items.</TableMessage>}
              {lines.map((l) => {
                const p = priced.indexOf(l);
                const pl = p >= 0 ? pv?.lines[p] : undefined;
                return (
                  <tr key={l.key}>
                    <Td>
                      <span className="font-medium">{l.name}</span>
                      {pl?.taxRateName && <span className="block text-xs text-ink-faint">{pl.taxRateName}</span>}
                    </Td>
                    <Td align="right">
                      <div className="ml-auto flex w-32 items-center justify-end gap-1">
                        <button type="button" onClick={() => setLine(l.key, { quantity: String(Math.max(0, Number(l.quantity) - 1)) })} className="rounded-lg p-1.5 text-ink-soft hover:bg-paper" aria-label={`One less ${l.name}`}>
                          <Minus className="size-4" />
                        </button>
                        <Input aria-label={`Quantity of ${l.name}`} inputMode="decimal" className="w-16 px-2 text-center" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                        <button type="button" onClick={() => setLine(l.key, { quantity: String(Number(l.quantity) + 1) })} className="rounded-lg p-1.5 text-ink-soft hover:bg-paper" aria-label={`One more ${l.name}`}>
                          <Plus className="size-4" />
                        </button>
                      </div>
                    </Td>
                    <Td align="right">
                      <Input aria-label={`Price of ${l.name}`} inputMode="decimal" placeholder={pl?.unitPrice ?? l.basePrice} className="ml-auto w-24 text-right" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} />
                    </Td>
                    <Td align="right" className="hidden md:table-cell">
                      <Input aria-label={`Discount on ${l.name}`} inputMode="decimal" placeholder={pl && Number(pl.discount) ? pl.discount : "0.00"} className="ml-auto w-24 text-right" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} />
                    </Td>
                    <Td align="right" className="font-semibold whitespace-nowrap tabular-nums">
                      {pl ? money(pl.total) : "—"}
                    </Td>
                    <Td align="right">
                      <button type="button" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} className="rounded-lg p-1.5 text-ink-faint hover:bg-danger-soft hover:text-danger" aria-label={`Remove ${l.name}`}>
                        <Trash2 className="size-4" />
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
        <Field label="Note">{(id) => <Textarea id={id} className="min-h-14" value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>

      <aside className="flex flex-col gap-4 xl:sticky xl:top-6 xl:self-start">
        <section className="card flex flex-col gap-4 p-5">
          <Field label="Customer">
            {(id) => (
              <Select id={id} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Cash Customer</option>
                {customers.data?.items
                  .filter((c) => c.active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          {activeLists.length > 1 && (
            <Field
              label="Prices"
              hint={
                !priceListId && pv?.priceListId
                  ? `${activeLists.find((l) => l.id === pv.priceListId)?.name ?? "This customer's"} prices, set for this customer.`
                  : undefined
              }
            >
              {(id) => (
                <Select id={id} value={priceListId} onChange={(e) => setPriceListId(e.target.value)}>
                  <option value="">The customer&apos;s prices</option>
                  {activeLists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {!customerId && <Field label="Name on receipt (optional)">{(id) => <Input id={id} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />}</Field>}
          <Field label="Sell in">
            {(id) => (
              <Select id={id} value={currencyCode} onChange={(e) => (setCurrencyCode(e.target.value), setPays([]))}>
                {currencies.data
                  ?.filter((c) => c.active)
                  .map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name}
                      {c.isBase ? "" : ` (${Number(c.rateToBase)} per ${base})`}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </section>

        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-ledger-700 via-ledger-800 to-ledger-950 p-5 text-white shadow-[var(--shadow-lift)]">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-ledger-100/80">Items</dt>
            <dd className="text-right tabular-nums">{money(pv?.subtotal ?? 0)}</dd>
            {Number(pv?.discountTotal) > 0 && (
              <>
                <dt className="text-ledger-100/80">Discount</dt>
                <dd className="text-right tabular-nums">−{money(pv!.discountTotal)}</dd>
              </>
            )}
            <dt className="text-ledger-100/80">VAT included</dt>
            <dd className="text-right tabular-nums">{money(pv?.taxTotal ?? 0)}</dd>
          </dl>
          <div className="mt-3 flex items-end justify-between border-t border-white/15 pt-3">
            <span className="text-sm text-ledger-100/80">Total</span>
            <span className="text-3xl font-semibold tracking-tight tabular-nums">{fmt(total)}</span>
          </div>
          {currencyCode !== base && pv && <p className="mt-1 text-right text-xs text-ledger-100/70">= {money(pv.totalBase)} {base}</p>}
          {preview.isFetching && <span className="absolute top-3 right-4 text-xs text-ledger-100/60">Updating…</span>}
        </section>

        {mode === "sale" ? (
          <section className="card flex flex-col gap-3 p-5">
            <h2 className="text-sm font-semibold">Payment</h2>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={!pv || (remainingBase <= 0.004 && m.id !== "cash")}
                  onClick={() => addPayment(m.id)}
                  className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-medium shadow-sm transition hover:border-ledger-600 hover:bg-ledger-50 disabled:opacity-40"
                >
                  <m.icon className="size-4 text-ledger-700" /> {m.label}
                </button>
              ))}
            </div>
            {pays.map((p) => (
              <div key={p.key} className="flex items-center gap-2 rounded-xl bg-paper p-2">
                <span className="w-20 shrink-0 text-xs font-medium">{methodLabel(p.method)}</span>
                <Select aria-label="Payment currency" className="h-9 w-20 px-2 text-xs" value={p.currencyCode} onChange={(e) => setPays(pays.map((x) => (x.key === p.key ? { ...x, currencyCode: e.target.value } : x)))}>
                  {currencies.data
                    ?.filter((c) => c.active)
                    .map((c) => (
                      <option key={c.code}>{c.code}</option>
                    ))}
                </Select>
                <Input aria-label={`${methodLabel(p.method)} amount`} inputMode="decimal" className="h-9 text-right" value={p.amount} onChange={(e) => setPays(pays.map((x) => (x.key === p.key ? { ...x, amount: e.target.value } : x)))} />
                <button type="button" onClick={() => setPays(pays.filter((x) => x.key !== p.key))} className="rounded-lg p-1.5 text-ink-faint hover:text-danger" aria-label="Remove payment">
                  <X className="size-4" />
                </button>
              </div>
            ))}
            {pays.length > 0 && (
              <p className={`flex justify-between text-sm font-medium ${remainingBase > 0.004 ? "text-danger" : "text-ledger-700"}`}>
                <span>{remainingBase > 0.004 ? "Still to pay" : changeBase > 0.004 ? "Change to give" : "Paid in full"}</span>
                <span className="tabular-nums">
                  {remainingBase > 0.004
                    ? fmt(remainingIn(currencyCode))
                    : changeBase > 0.004
                      ? (() => {
                          const cash = [...pays].reverse().find((x) => x.method === "cash");
                          const code = cash?.currencyCode ?? currencyCode;
                          return `${code} ${money(code === base ? changeBase : changeBase * Number(rateOf(code)))}`;
                        })()
                      : ""}
                </span>
              </p>
            )}
            <FormError message={error ?? (preview.error ? preview.error.message : null)} />
            <Button className="h-12 text-base" disabled={!pv || remainingBase > 0.004 || preview.isFetching} busy={save.isPending} onClick={() => (setError(null), save.mutate())}>
              Complete sale
            </Button>
          </section>
        ) : (
          <section className="card flex flex-col gap-3 p-5">
            <Field label="Valid until">{(id) => <Input id={id} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}</Field>
            <FormError message={error ?? (preview.error ? preview.error.message : null)} />
            <Button className="h-12 text-base" disabled={!pv} busy={save.isPending} onClick={() => (setError(null), save.mutate())}>
              Save quotation
            </Button>
          </section>
        )}
      </aside>
    </div>
  );
}

// ----- One sale: receipt, payments, returns ------------------------------------------------

export function SaleView({ id }: { id: string }) {
  const { can, session } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const [returning, setReturning] = useState(false);
  const [converting, setConverting] = useState(false);
  const sale = useQuery({ queryKey: ["sales", id], queryFn: () => api<Sale>(`/sales/${id}`) });

  const act = useMutation({
    mutationFn: (action: "void" | "cancel") => api<Sale>(`/sales/${id}/${action}`, { method: "POST" }),
    onSuccess: (_, action) => {
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      toast(action === "void" ? "Voided" : "Quotation cancelled");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (sale.isLoading) return <Spinner />;
  if (sale.error) return <FormError message={sale.error.message} />;
  const s = sale.data!;
  const kind = s.type === "quotation" ? "Quotation" : s.type === "return" ? "Return" : "Sale";
  const canReturn = s.type === "sale" && s.status === "completed" && can(...MANAGERS) && s.lines!.some((l) => Number(l.quantity) > Number(l.returnedQuantity ?? 0));
  const back = s.type === "quotation" ? "/sales/quotations" : "/sales/invoices";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={back} className="text-sm text-ink-soft hover:text-ink print:hidden">
            ← {s.type === "quotation" ? "Quotations" : "Sales Invoices"}
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {kind} {s.number} <SaleStatusBadge status={s.status} type={s.type} />
            {s.type !== "quotation" && <FiscalBadge status={s.fiscalStatus} />}
          </h1>
          <p className="text-sm text-ink-soft">
            {dateTime(s.soldAt)} · {s.storeName} · {s.deviceName ?? "Backoffice"}
            {s.salesperson && ` · ${s.salesperson}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {s.type === "quotation" && s.status === "open" && (
            <>
              <Button onClick={() => setConverting(true)}>Turn into a sale</Button>
              <Button variant="secondary" busy={act.isPending} onClick={() => confirm(`Cancel ${s.number}?`) && act.mutate("cancel")}>
                Cancel quotation
              </Button>
            </>
          )}
          {canReturn && (
            <Button variant="secondary" onClick={() => setReturning(true)}>
              <Undo2 className="size-4" aria-hidden /> Return items
            </Button>
          )}
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden /> Print
          </Button>
          {s.type !== "quotation" && s.status === "completed" && can(...MANAGERS) && (
            <Button variant="danger" busy={act.isPending} onClick={() => confirm(`Void ${s.number}? Stock and money go back as if it never happened.`) && act.mutate("void")}>
              Void
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="card overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Price</Th>
                <Th align="right" className="hidden sm:table-cell">
                  Discount
                </Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {s.lines!.map((l) => (
                <tr key={l.id}>
                  <Td>
                    <span className="font-medium">
                      {l.variantName !== "Default" ? `${l.productName} · ${l.variantName}` : l.productName}
                      {l.packName && ` · ${l.packName}`}
                    </span>
                    {l.modifiers && l.modifiers.length > 0 && <span className="block text-xs text-ink-soft">{l.modifiers.map((m) => m.name).join(", ")}</span>}
                    <span className="block text-xs text-ink-faint">
                      {l.taxRateName ?? "No tax"}
                      {Number(l.returnedQuantity) > 0 && <span className="ml-2 font-medium text-amber-ink">{qty(l.returnedQuantity)} returned</span>}
                      {l.kitchenStatus && <span className="ml-2">Kitchen: {l.kitchenStatus}</span>}
                    </span>
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {qty(l.quantity)}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {money(l.unitPrice)}
                  </Td>
                  <Td align="right" className="hidden text-ink-soft tabular-nums sm:table-cell">
                    {Number(l.discount) ? money(l.discount) : "—"}
                  </Td>
                  <Td align="right" className="font-medium tabular-nums">
                    {money(l.total)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {s.note && <p className="border-t border-line/70 px-5 py-3 text-sm text-ink-soft">{s.type === "return" ? `Reason: ${s.note}` : s.note}</p>}
        </div>

        <aside className="flex flex-col gap-4">
          <section className="card p-5">
            <p className="text-xs text-ink-faint">Customer</p>
            <p className="font-medium">{s.customerName}</p>
            <dl className="mt-4 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-ink-soft">Items</dt>
              <dd className="text-right tabular-nums">{money(s.subtotal)}</dd>
              {Number(s.discountTotal) > 0 && (
                <>
                  <dt className="text-ink-soft">Discount</dt>
                  <dd className="text-right tabular-nums">−{money(s.discountTotal)}</dd>
                </>
              )}
              <dt className="text-ink-soft">VAT included</dt>
              <dd className="text-right tabular-nums">{money(s.taxTotal)}</dd>
              <dt className="mt-2 border-t border-line pt-2 font-semibold">{s.type === "return" ? "Refunded" : "Total"}</dt>
              <dd className="mt-2 border-t border-line pt-2 text-right text-lg font-semibold tabular-nums">
                {s.currencyCode} {money(s.total)}
              </dd>
              {s.currencyCode !== session.tenant.baseCurrency && (
                <dd className="col-span-2 text-right text-xs text-ink-faint">
                  = {money(s.totalBase)} {session.tenant.baseCurrency} at {Number(s.rate)}
                </dd>
              )}
            </dl>
          </section>
          {!!s.payments?.length && (
            <section className="card p-5">
              <h2 className="mb-2 text-sm font-semibold">{s.type === "return" ? "Refund" : "Payments"}</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {s.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span>
                      {methodLabel(p.method)}
                      {Number(p.change) > 0 && <span className="block text-xs text-ink-faint">Change {p.currencyCode} {money(p.change)}</span>}
                    </span>
                    <span className="font-medium tabular-nums">
                      {p.currencyCode} {money(Math.abs(Number(p.amount)))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!s.related?.length && (
            <section className="card p-5 print:hidden">
              <h2 className="mb-2 text-sm font-semibold">Linked</h2>
              <ul className="flex flex-col gap-1.5 text-sm">
                {s.related.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <Link href={`/sales/invoices/${r.id}`} className="font-medium text-ledger-700 hover:underline">
                      {r.type === "return" ? "Return" : r.type === "quotation" ? "Quotation" : "Sale"} {r.number}
                    </Link>
                    <SaleStatusBadge status={r.status} type={r.type} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {s.journalEntryId && (
            <Link href={`/accounts/journal?entry=${s.journalEntryId}`} className="text-sm text-ledger-700 hover:underline print:hidden">
              See the journal entry
            </Link>
          )}
        </aside>
      </div>

      {canReturn && <ReturnDialog sale={s} open={returning} onClose={() => setReturning(false)} onDone={(r) => router.push(`/sales/invoices/${r.id}`)} />}
      {s.type === "quotation" && <ConvertDialog quote={s} open={converting} onClose={() => setConverting(false)} onDone={(r) => router.push(`/sales/invoices/${r.id}`)} />}
    </div>
  );
}

function ReturnDialog({ sale, open, onClose, onDone }: { sale: Sale; open: boolean; onClose: () => void; onDone: (r: Sale) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api<Sale>(`/sales/${sale.id}/returns`, {
        method: "POST",
        body: { method, reason: reason.trim(), restock, lines: Object.entries(quantities).filter(([, q]) => Number(q) > 0).map(([lineId, quantity]) => ({ lineId, quantity })) },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      toast(`Return ${r.number}: refund ${r.currencyCode} ${money(r.total)}`);
      onClose();
      onDone(r);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onClose={onClose} title={`Return items from ${sale.number}`} wide>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <ul className="flex flex-col divide-y divide-line">
          {sale.lines!.map((l) => {
            const left = Number(l.quantity) - Number(l.returnedQuantity ?? 0);
            return (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{l.productName}</span>
                  <span className="text-xs text-ink-faint">
                    {qty(left)} of {qty(l.quantity)} can come back · {money(l.total)}
                  </span>
                </span>
                <Input
                  aria-label={`Quantity of ${l.productName} to return`}
                  inputMode="decimal"
                  disabled={left <= 0}
                  placeholder="0"
                  className="w-24 text-right"
                  value={quantities[l.id] ?? ""}
                  onChange={(e) => setQuantities({ ...quantities, [l.id]: e.target.value })}
                />
              </li>
            );
          })}
        </ul>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Refund by">
            {(id) => (
              <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {METHODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Reason">{(id) => <Input id={id} required placeholder="Expired, wrong item…" value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        </div>
        <Checkbox label="Put the items back in stock" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
        <FormError message={error} />
        <Button type="submit" busy={save.isPending}>
          Refund
        </Button>
      </form>
    </Dialog>
  );
}

function ConvertDialog({ quote, open, onClose, onDone }: { quote: Sale; open: boolean; onClose: () => void; onDone: (r: Sale) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amount, setAmount] = useState(quote.total);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api<Sale>(`/sales/${quote.id}/convert`, { method: "POST", body: { payments: [{ method, amount }] } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["sales"] });
      toast(`Sale ${r.number} done`);
      onClose();
      onDone(r);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onClose={onClose} title={`Sell ${quote.number}`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <p className="text-sm">
          Total due <strong>{quote.currencyCode} {money(quote.total)}</strong>
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Paid by">
            {(id) => (
              <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {METHODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={`Amount (${quote.currencyCode})`}>{(id) => <Input id={id} required inputMode="decimal" className="text-right" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        </div>
        <FormError message={error} />
        <Button type="submit" busy={save.isPending}>
          Complete sale
        </Button>
      </form>
    </Dialog>
  );
}
