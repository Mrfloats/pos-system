"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Printer, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  buttonBase,
  buttonStyles,
  Checkbox,
  Dialog,
  Field,
  FormError,
  Input,
  PageHeader,
  Pager,
  Select,
  Spinner,
  Table,
  TableMessage,
  Td,
  Textarea,
  Th,
} from "@/components/ui";
import {
  Account,
  AccountType,
  api,
  Currency,
  Customer,
  DocumentState,
  FinanceDocument,
  Page,
  Periods,
  Supplier,
  TaxRate,
} from "@/lib/api";
import { money, qty } from "@/lib/format";
import { ACCOUNTANTS, useSession } from "@/lib/session";

// ----- Navigation ---------------------------------------------------------------

const TABS = [
  { href: "/accounts", label: "Overview" },
  { href: "/accounts/invoices", label: "Invoices" },
  { href: "/accounts/bills", label: "Bills" },
  { href: "/accounts/expenses", label: "Expenses" },
  { href: "/accounts/suppliers", label: "Suppliers" },
  { href: "/accounts/journal", label: "Journal" },
  { href: "/accounts/chart", label: "Chart of accounts" },
  { href: "/accounts/reports", label: "Reports" },
];

export function AccountsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Accounts" className="-mx-4 mb-7 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 print:hidden">
      <ul className="card inline-flex gap-1 p-1.5">
        {TABS.map((t) => {
          const active = t.href === "/accounts" ? pathname === "/accounts" : pathname.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-xl px-3.5 py-2 text-sm whitespace-nowrap transition-all ${
                  active ? "bg-gradient-to-b from-ledger-700 to-ledger-800 font-medium text-white shadow-sm shadow-ledger-900/25" : "text-ink-soft hover:bg-paper hover:text-ink"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ----- Shared data -----------------------------------------------------------------

export const useChart = () => useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/accounting/accounts") });
export const useTaxRates = () => useQuery({ queryKey: ["tax-rates"], queryFn: () => api<TaxRate[]>("/tax-rates") });
export const useCurrencies = () => useQuery({ queryKey: ["currencies"], queryFn: () => api<Currency[]>("/currencies") });
export const usePeriods = () => useQuery({ queryKey: ["periods"], queryFn: () => api<Periods>("/accounting/periods") });

/** Everything that shows money moving: refresh it all after any posting. */
export function useInvalidateBooks() {
  const qc = useQueryClient();
  return () => {
    for (const key of ["accounts", "accounting", "invoices", "bills", "expenses", "journals", "suppliers", "periods", "reports"]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

export const TYPE_LABELS: Record<AccountType, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};
export const TYPE_ORDER: AccountType[] = ["asset", "liability", "equity", "income", "expense"];
const CONTROL = ["receivables", "payables"];

/** Accounts people may post to by hand (not the ones kept by invoices and bills). */
export const isPostable = (a: Account) => a.active && !CONTROL.includes(a.systemKey ?? "");

/** An account picker grouped by type. */
export function AccountSelect({
  accounts,
  value,
  onChange,
  placeholder = "Choose an account",
  ...props
}: {
  accounts: Account[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value">) {
  return (
    <Select {...props} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {TYPE_ORDER.map((type) => {
        const list = accounts.filter((a) => a.type === type);
        if (!list.length) return null;
        return (
          <optgroup key={type} label={TYPE_LABELS[type]}>
            {list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </Select>
  );
}

const STATE: Record<DocumentState, { label: string; tone: "neutral" | "green" | "amber" | "red" }> = {
  unpaid: { label: "Unpaid", tone: "neutral" },
  part_paid: { label: "Part paid", tone: "amber" },
  overdue: { label: "Overdue", tone: "red" },
  paid: { label: "Paid", tone: "green" },
  void: { label: "Void", tone: "neutral" },
};

export function StateBadge({ state }: { state: DocumentState }) {
  const s = STATE[state];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const longDate = (day: string | null | undefined) =>
  day ? new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

/** A link that looks like a Button. */
export function ButtonLink({ href, variant = "primary", children }: { href: string; variant?: "primary" | "secondary" | "ghost"; children: React.ReactNode }) {
  return (
    <Link href={href} className={`${buttonBase} ${buttonStyles[variant]}`}>
      {children}
    </Link>
  );
}

/** Money input: digits with up to two decimals. */
export function MoneyInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <Input inputMode="decimal" pattern="\d+(\.\d{1,2})?" placeholder="0.00" {...props} className={`text-right ${props.className ?? ""}`} />;
}

// ----- Invoices and bills ------------------------------------------------------------

export type DocKind = "invoice" | "bill";

export const KIND = {
  invoice: {
    path: "/accounts/invoices",
    api: "/accounting/invoices",
    queryKey: "invoices",
    title: "Invoices",
    one: "invoice",
    party: "Customer",
    blurb: "Sales on credit: what customers owe you. Payments you receive go into a cash, bank or mobile money account.",
    empty: "No invoices yet. Cash sales at the till don't need one.",
  },
  bill: {
    path: "/accounts/bills",
    api: "/accounting/bills",
    queryKey: "bills",
    title: "Bills",
    one: "bill",
    party: "Supplier",
    blurb: "Supplier invoices: what you owe. Enter them when they arrive, then record payments as you make them.",
    empty: "No bills yet. Add one when a supplier invoice arrives.",
  },
};

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "unpaid", label: "Not paid" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
];

export function DocumentList({ kind }: { kind: DocKind }) {
  const k = KIND[kind];
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => (setDebounced(search.trim()), setPage(1)), 250);
    return () => clearTimeout(t);
  }, [search]);

  const docs = useQuery({
    queryKey: [k.queryKey, { debounced, status, page }],
    queryFn: () => api<Page<FinanceDocument>>(k.api, { query: { search: debounced, status, page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader
        title={k.title}
        description={k.blurb}
        actions={
          <ButtonLink href={`${k.path}/new`}>
            <Plus className="size-4" aria-hidden /> New {k.one}
          </ButtonLink>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-ink-faint" aria-hidden />
          <Input aria-label={`Search ${k.title.toLowerCase()}`} placeholder={`Number or ${k.party.toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => (setStatus(f.value), setPage(1))}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${status === f.value ? "border-ledger-700 bg-ledger-800 font-medium text-white shadow-sm" : "border-line bg-surface text-ink-soft shadow-sm shadow-ink/5 hover:text-ink"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        {docs.isLoading ? (
          <div className="px-5">
            <Spinner />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>{k.party}</Th>
                <Th className="hidden md:table-cell">Date</Th>
                <Th className="hidden md:table-cell">Due</Th>
                <Th align="right">Total</Th>
                <Th align="right" className="hidden sm:table-cell">
                  Still owed
                </Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {docs.data?.items.length === 0 && <TableMessage colSpan={7}>{debounced || status ? `No ${k.title.toLowerCase()} match.` : k.empty}</TableMessage>}
              {docs.data?.items.map((d) => (
                <tr key={d.id} className="hover:bg-paper/60">
                  <Td>
                    <Link href={`${k.path}/${d.id}`} className="font-medium hover:text-ledger-700 hover:underline">
                      {d.number}
                    </Link>
                    {d.supplierReference && <span className="block text-xs text-ink-faint">{d.supplierReference}</span>}
                  </Td>
                  <Td>{d.partyName}</Td>
                  <Td className="hidden text-ink-soft md:table-cell">{longDate(d.date)}</Td>
                  <Td className="hidden text-ink-soft md:table-cell">{longDate(d.dueDate)}</Td>
                  <Td align="right">{money(d.total, d.currencyCode)}</Td>
                  <Td align="right" className="hidden sm:table-cell">
                    {d.state === "void" ? "—" : money(d.balance)}
                  </Td>
                  <Td>
                    <StateBadge state={d.state} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {docs.data && <Pager page={page} pageSize={docs.data.pageSize} total={docs.data.total} onPage={setPage} />}
      </div>
    </div>
  );
}

interface LineDraft {
  key: number;
  accountId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRateId: string;
}

/** Rough client-side totals for the form; the API works out the exact figures. */
function previewLine(l: LineDraft, rates: TaxRate[], inclusive: boolean) {
  const amount = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
  const pct = Number(rates.find((r) => r.id === l.taxRateId)?.rate ?? 0);
  if (inclusive) {
    const tax = (amount * pct) / (100 + pct);
    return { net: amount - tax, tax };
  }
  return { net: amount, tax: (amount * pct) / 100 };
}

export function DocumentEditor({ kind }: { kind: DocKind }) {
  const k = KIND[kind];
  const router = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const { session } = useSession();
  const base = session.tenant.baseCurrency;
  const chart = useChart();
  const taxRates = useTaxRates();
  const currencies = useCurrencies();
  const periods = usePeriods();
  const parties = useQuery({
    queryKey: [kind === "invoice" ? "customers" : "suppliers", "all"],
    queryFn: () => api<Page<Customer | Supplier>>(kind === "invoice" ? "/customers" : "/suppliers", { query: { pageSize: 200 } }),
  });

  const [nextKey, setNextKey] = useState(1);
  const [form, setForm] = useState({
    partyId: "",
    date: "",
    dueDate: "",
    currencyCode: base,
    rate: "",
    taxInclusive: false,
    notes: "",
    supplierReference: "",
  });
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  const lineAccounts = useMemo(
    () => (chart.data ?? []).filter((a) => isPostable(a) && !a.isBank && (kind === "invoice" ? a.type === "income" : a.type !== "income")),
    [chart.data, kind],
  );
  const defaultTax = taxRates.data?.find((r) => r.isDefault && r.active)?.id ?? "";
  const sales = chart.data?.find((a) => a.systemKey === "sales")?.id ?? "";

  // Fill in defaults once the reference data arrives (adjusting state during render).
  const ready = !!periods.data && !!chart.data && !!taxRates.data;
  if (ready && !form.date) setForm({ ...form, date: periods.data.today });
  if (ready && lines.length === 0) {
    setLines([{ key: 0, accountId: kind === "invoice" ? sales : "", description: "", quantity: "1", unitPrice: "", taxRateId: defaultTax }]);
  }

  const activeRates = taxRates.data?.filter((r) => r.active) ?? [];
  const totals = lines.reduce(
    (t, l) => {
      const p = previewLine(l, activeRates, form.taxInclusive);
      return { net: t.net + p.net, tax: t.tax + p.tax };
    },
    { net: 0, tax: 0 },
  );
  const foreign = form.currencyCode !== base;
  const currency = currencies.data?.find((c) => c.code === form.currencyCode);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        date: form.date,
        dueDate: form.dueDate || undefined,
        currencyCode: form.currencyCode,
        rate: foreign && form.rate ? form.rate : undefined,
        taxInclusive: form.taxInclusive,
        notes: form.notes.trim() || undefined,
        lines: lines.map((l) => ({
          accountId: l.accountId || undefined,
          description: l.description.trim(),
          quantity: l.quantity || "1",
          unitPrice: l.unitPrice,
          taxRateId: l.taxRateId || null,
        })),
      };
      if (kind === "invoice") body.customerId = form.partyId;
      else {
        body.supplierId = form.partyId;
        body.supplierReference = form.supplierReference.trim() || undefined;
      }
      return api<FinanceDocument>(k.api, { method: "POST", body });
    },
    onSuccess: (doc) => {
      invalidate();
      toast(`${k.title.slice(0, -1)} ${doc.number} saved`);
      router.push(`${k.path}/${doc.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const setLine = (key: number, patch: Partial<LineDraft>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  if (!ready || !parties.data) return <Spinner />;

  return (
    <div>
      <PageHeader title={`New ${k.one}`} description={kind === "bill" ? "Copy the supplier's invoice. For stock you've already received, use the account “Stock received, not yet billed”." : undefined} />
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <div className="grid gap-4 card p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={k.party} className="sm:col-span-2">
            {(id) => (
              <Select id={id} required value={form.partyId} onChange={(e) => setForm({ ...form, partyId: e.target.value })}>
                <option value="">Choose a {k.party.toLowerCase()}</option>
                {parties.data.items
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          {kind === "bill" ? (
            <Field label="Supplier's invoice number" className="sm:col-span-2">
              {(id) => <Input id={id} value={form.supplierReference} onChange={(e) => setForm({ ...form, supplierReference: e.target.value })} />}
            </Field>
          ) : (
            <div className="hidden sm:col-span-2 sm:block" />
          )}
          <Field label="Date">{(id) => <Input id={id} type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />}</Field>
          <Field label="Due" hint={kind === "bill" ? "Empty: the supplier's payment terms." : "Empty: due on the day."}>
            {(id) => <Input id={id} type="date" min={form.date} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />}
          </Field>
          <Field label="Currency">
            {(id) => (
              <Select id={id} value={form.currencyCode} onChange={(e) => setForm({ ...form, currencyCode: e.target.value, rate: "" })}>
                {(currencies.data ?? [])
                  .filter((c) => c.active)
                  .map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          {foreign && (
            <Field label={`${form.currencyCode} per 1 ${base}`} hint={`Today's rate in Settings: ${currency?.rateToBase ?? "—"}`}>
              {(id) => <Input id={id} inputMode="decimal" placeholder={currency?.rateToBase} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />}
            </Field>
          )}
        </div>

        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <h2 className="text-base font-semibold">Lines</h2>
            <Checkbox label="Prices include VAT" checked={form.taxInclusive} onChange={(e) => setForm({ ...form, taxInclusive: e.target.checked })} />
          </div>
          <div className="flex flex-col divide-y divide-line">
            {lines.map((l, i) => {
              const p = previewLine(l, activeRates, form.taxInclusive);
              return (
                <div key={l.key} className="grid gap-3 px-5 py-4 md:grid-cols-12 md:items-end">
                  <Field label="Description" className="md:col-span-3">
                    {(id) => <Input id={id} required value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} />}
                  </Field>
                  <Field label="Account" className="md:col-span-3">
                    {(id) => <AccountSelect id={id} required accounts={lineAccounts} value={l.accountId} onChange={(v) => setLine(l.key, { accountId: v })} />}
                  </Field>
                  <Field label="Qty" className="md:col-span-1">
                    {(id) => <Input id={id} inputMode="decimal" required className="text-right" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />}
                  </Field>
                  <Field label="Price" className="md:col-span-2">
                    {(id) => <MoneyInput id={id} required value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} />}
                  </Field>
                  <Field label="VAT" className="md:col-span-2">
                    {(id) => (
                      <Select id={id} value={l.taxRateId} onChange={(e) => setLine(l.key, { taxRateId: e.target.value })}>
                        <option value="">None</option>
                        {activeRates.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <div className="flex items-center justify-between gap-2 md:col-span-1 md:flex-col md:items-end">
                    <span className="text-sm font-medium tabular-nums">{money(p.net + p.tax)}</span>
                    {lines.length > 1 && (
                      <button type="button" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} className="rounded-md p-1.5 text-ink-faint hover:bg-danger-soft hover:text-danger" aria-label={`Remove line ${i + 1}`}>
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4 border-t border-line px-5 py-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setLines([...lines, { key: nextKey, accountId: kind === "invoice" ? sales : (lines.at(-1)?.accountId ?? ""), description: "", quantity: "1", unitPrice: "", taxRateId: defaultTax }]);
                setNextKey(nextKey + 1);
              }}
            >
              <Plus className="size-4" aria-hidden /> Add line
            </Button>
            <dl className="grid min-w-56 grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt className="text-ink-soft">Before VAT</dt>
              <dd className="text-right tabular-nums">{money(totals.net)}</dd>
              <dt className="text-ink-soft">VAT</dt>
              <dd className="text-right tabular-nums">{money(totals.tax)}</dd>
              <dt className="font-semibold">Total</dt>
              <dd className="text-right font-semibold tabular-nums">{money(totals.net + totals.tax, form.currencyCode)}</dd>
            </dl>
          </div>
        </div>

        <Field label="Notes">{(id) => <Textarea id={id} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}</Field>
        <FormError message={error} />
        <div className="flex gap-2">
          <Button type="submit" busy={save.isPending}>
            Save {k.one}
          </Button>
          <ButtonLink href={k.path} variant="ghost">
            Cancel
          </ButtonLink>
        </div>
      </form>
    </div>
  );
}

export function DocumentView({ kind, id, back, title }: { kind: DocKind; id: string; back?: { href: string; label: string }; title?: string }) {
  const k = KIND[kind];
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const { session } = useSession();
  const base = session.tenant.baseCurrency;
  const [paying, setPaying] = useState(false);
  const doc = useQuery({ queryKey: [k.queryKey, id], queryFn: () => api<FinanceDocument>(`${k.api}/${id}`) });

  const act = useMutation({
    mutationFn: (path: string) => api<FinanceDocument>(path, { method: "POST" }),
    onSuccess: (_, path) => {
      invalidate();
      toast(path.includes("payments") ? "Payment voided" : `${k.title.slice(0, -1)} voided`);
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (doc.isLoading) return <Spinner />;
  if (doc.error) return <FormError message={doc.error.message} />;
  const d = doc.data!;
  const livePayments = d.payments?.filter((p) => p.status === "posted") ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={back?.href ?? k.path} className="text-sm text-ink-soft hover:text-ink print:hidden">
            ← {back?.label ?? k.title}
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {title ?? (kind === "invoice" ? "Invoice" : "Bill")} {d.number} <StateBadge state={d.state} />
          </h1>
          {d.storeName && <p className="text-sm text-ink-soft">Received into {d.storeName}</p>}
          {d.supplierReference && <p className="text-sm text-ink-soft">Supplier&apos;s reference {d.supplierReference}</p>}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {d.status === "posted" && Number(d.balance) > 0 && <Button onClick={() => setPaying(true)}>{kind === "invoice" ? "Record payment received" : "Record payment"}</Button>}
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden /> Print
          </Button>
          {d.status === "posted" && livePayments.length === 0 && (
            <Button
              variant="danger"
              busy={act.isPending}
              onClick={() => {
                if (confirm(`Void ${d.number}? A reversing entry will cancel it in the books.`)) act.mutate(`${k.api}/${id}/void`);
              }}
            >
              Void
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 card p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs text-ink-soft">{k.party}</p>
          <p className="font-medium">{d.party?.name}</p>
          {d.party?.tin && <p className="text-xs text-ink-soft">TIN {d.party.tin}</p>}
          {d.party?.vatNumber && <p className="text-xs text-ink-soft">VAT {d.party.vatNumber}</p>}
        </div>
        <div>
          <p className="text-xs text-ink-soft">Date</p>
          <p>{longDate(d.date)}</p>
        </div>
        <div>
          <p className="text-xs text-ink-soft">Due</p>
          <p>{longDate(d.dueDate)}</p>
        </div>
        <div>
          <p className="text-xs text-ink-soft">Still owed</p>
          <p className="text-lg font-semibold">{money(d.state === "void" ? 0 : d.balance, d.currencyCode)}</p>
          {d.currencyCode !== base && (
            <p className="text-xs text-ink-soft">
              Rate {Number(d.rate)} {d.currencyCode} per {base} · {money(d.totalBase, base)}
            </p>
          )}
        </div>
      </div>

      <div className="card">
        <Table>
          <thead>
            <tr>
              <Th>Description</Th>
              <Th className="hidden md:table-cell">Account</Th>
              <Th align="right">Qty</Th>
              <Th align="right">Price</Th>
              <Th align="right" className="hidden sm:table-cell">
                VAT
              </Th>
              <Th align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {d.lines?.map((l) => (
              <tr key={l.id}>
                <Td>{l.description}</Td>
                <Td className="hidden text-ink-soft md:table-cell">
                  {l.accountCode} · {l.accountName}
                </Td>
                <Td align="right">{qty(l.quantity)}</Td>
                <Td align="right">{money(l.unitPrice)}</Td>
                <Td align="right" className="hidden text-ink-soft sm:table-cell">
                  {Number(l.tax) ? money(l.tax) : (l.taxRateName ?? "—")}
                </Td>
                <Td align="right">{money(Number(l.net) + Number(l.tax))}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <dl className="ml-auto grid max-w-xs grid-cols-2 gap-x-6 gap-y-1 px-5 py-4 text-sm">
          <dt className="text-ink-soft">Before VAT</dt>
          <dd className="text-right">{money(d.subtotal)}</dd>
          <dt className="text-ink-soft">VAT</dt>
          <dd className="text-right">{money(d.taxTotal)}</dd>
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold">{money(d.total, d.currencyCode)}</dd>
          <dt className="text-ink-soft">Paid</dt>
          <dd className="text-right">{money(d.amountPaid)}</dd>
        </dl>
      </div>

      {d.notes && <p className="text-sm whitespace-pre-line text-ink-soft">{d.notes}</p>}

      <section className="card">
        <h2 className="border-b border-line px-5 py-3 text-base font-semibold">Payments</h2>
        <Table>
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Date</Th>
              <Th className="hidden sm:table-cell">{kind === "invoice" ? "Into" : "From"}</Th>
              <Th align="right">Amount</Th>
              <Th className="print:hidden" />
            </tr>
          </thead>
          <tbody>
            {!d.payments?.length && <TableMessage colSpan={5}>No payments yet.</TableMessage>}
            {d.payments?.map((p) => (
              <tr key={p.id} className={p.status === "void" ? "text-ink-faint line-through" : ""}>
                <Td>
                  {p.number}
                  {p.reference && <span className="block text-xs text-ink-faint no-underline">{p.reference}</span>}
                </Td>
                <Td>{longDate(p.date)}</Td>
                <Td className="hidden sm:table-cell">{p.accountName}</Td>
                <Td align="right">{money(p.amount, p.currencyCode)}</Td>
                <Td align="right" className="print:hidden">
                  {p.status === "posted" && (
                    <Button
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        if (confirm(`Void payment ${p.number}?`)) act.mutate(`/accounting/payments/${p.id}/void`);
                      }}
                    >
                      Void
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      {d.journalEntryId && (
        <Link href={`/accounts/journal?entry=${d.journalEntryId}`} className="text-sm text-ledger-700 hover:underline print:hidden">
          See the journal entry
        </Link>
      )}

      <PaymentDialog kind={kind} doc={d} open={paying} onClose={() => setPaying(false)} />
    </div>
  );
}

function PaymentDialog({ kind, doc, open, onClose }: { kind: DocKind; doc: FinanceDocument; open: boolean; onClose: () => void }) {
  const k = KIND[kind];
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const { session } = useSession();
  const chart = useChart();
  const periods = usePeriods();
  const currencies = useCurrencies();
  const banks = (chart.data ?? []).filter((a) => a.isBank && a.active);
  const foreign = doc.currencyCode !== session.tenant.baseCurrency;
  const [form, setForm] = useState({ accountId: "", date: "", amount: "", rate: "", reference: "" });
  const [error, setError] = useState<string | null>(null);

  // Start each time the dialog opens with the full balance and today's date.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError(null);
      setForm({ accountId: banks[0]?.id ?? "", date: periods.data?.today ?? doc.date, amount: doc.balance, rate: "", reference: "" });
    }
  }

  const pay = useMutation({
    mutationFn: () =>
      api(`${k.api}/${doc.id}/payments`, {
        method: "POST",
        body: { accountId: form.accountId, date: form.date, amount: form.amount, rate: foreign && form.rate ? form.rate : undefined, reference: form.reference.trim() || undefined },
      }),
    onSuccess: () => {
      invalidate();
      toast("Payment recorded");
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onClose={onClose} title={kind === "invoice" ? `Payment received for ${doc.number}` : `Pay ${doc.number}`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          pay.mutate();
        }}
      >
        <Field label={kind === "invoice" ? "Paid into" : "Paid from"}>
          {(id) => <AccountSelect id={id} required accounts={banks} value={form.accountId} onChange={(v) => setForm({ ...form, accountId: v })} />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date">{(id) => <Input id={id} type="date" required min={doc.date} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />}</Field>
          <Field label={`Amount (${doc.currencyCode})`} hint={`Owed: ${money(doc.balance)}`}>
            {(id) => <MoneyInput id={id} required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />}
          </Field>
        </div>
        {foreign && (
          <Field label={`Rate today (${doc.currencyCode} per 1 ${session.tenant.baseCurrency})`} hint="A different rate from the invoice date shows as an exchange gain or loss.">
            {(id) => {
              const current = currencies.data?.find((c) => c.code === doc.currencyCode)?.rateToBase;
              return <Input id={id} inputMode="decimal" placeholder={current} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />;
            }}
          </Field>
        )}
        <Field label="Reference" hint="Receipt, cheque or transaction number.">
          {(id) => <Input id={id} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />}
        </Field>
        <FormError message={error} />
        <Button type="submit" busy={pay.isPending}>
          Record payment
        </Button>
      </form>
    </Dialog>
  );
}

/** Close the books up to a date, or reopen them. */
export function ClosePeriod() {
  const { can } = useSession();
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const periods = usePeriods();
  const [through, setThrough] = useState("");
  const close = useMutation({
    mutationFn: (date: string | null) => api<Periods>("/accounting/periods/close", { method: "POST", body: { through: date } }),
    onSuccess: (p) => {
      invalidate();
      toast(p.booksClosedThrough ? `Books closed up to ${longDate(p.booksClosedThrough)}` : "All periods reopened");
      setThrough("");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  if (!periods.data || !can(...ACCOUNTANTS)) return null;
  const closed = periods.data.booksClosedThrough;

  // Suggest the end of last month.
  const t = new Date(`${periods.data.today}T00:00:00Z`);
  const lastMonthEnd = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0)).toISOString().slice(0, 10);

  return (
    <section className="card p-5">
      <h2 className="text-base font-semibold">Close a period</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-soft">
        Once your month is checked and your VAT return is filed, close it so nothing can be added or changed on those days.{" "}
        {closed ? (
          <>
            The books are closed up to <strong className="text-ink">{longDate(closed)}</strong>.
          </>
        ) : (
          "No period is closed yet."
        )}
      </p>
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          close.mutate(through || lastMonthEnd);
        }}
      >
        <Field label="Close up to and including">
          {(id) => <Input id={id} type="date" className="w-44" max={periods.data.today} placeholder={lastMonthEnd} value={through || lastMonthEnd} onChange={(e) => setThrough(e.target.value)} />}
        </Field>
        <Button type="submit" busy={close.isPending}>
          Close books
        </Button>
        {closed && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (confirm("Reopen every closed period? Only do this to correct a mistake.")) close.mutate(null);
            }}
          >
            Reopen all
          </Button>
        )}
      </form>
    </section>
  );
}
