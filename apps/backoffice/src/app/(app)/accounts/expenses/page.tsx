"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { AccountSelect, isPostable, longDate, MoneyInput, useChart, useCurrencies, useInvalidateBooks, usePeriods, useTaxRates } from "@/components/accounts";
import { useToast } from "@/components/toast";
import { Badge, Button, Dialog, Field, FormError, Input, PageHeader, Pager, Select, Spinner, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, Expense, Page, Supplier } from "@/lib/api";
import { money } from "@/lib/format";
import { useSession } from "@/lib/session";

export default function ExpensesPage() {
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  // The overview's "Record expense" button links here with ?new=1.
  const [adding, setAdding] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("new"));

  useEffect(() => {
    const t = setTimeout(() => (setDebounced(search.trim()), setPage(1)), 250);
    return () => clearTimeout(t);
  }, [search]);

  const expenses = useQuery({
    queryKey: ["expenses", { debounced, page }],
    queryFn: () => api<Page<Expense>>("/accounting/expenses", { query: { search: debounced, page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });

  const voidExpense = useMutation({
    mutationFn: (id: string) => api(`/accounting/expenses/${id}/void`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast("Expense voided");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Money paid out on the spot: rent, ZESA, fuel, bank charges. For a supplier invoice you'll pay later, add a bill instead."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden /> Record expense
          </Button>
        }
      />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-ink-faint" aria-hidden />
        <Input aria-label="Search expenses" placeholder="Description, payee or reference" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>
      <div className="card">
        {expenses.isLoading ? (
          <div className="px-5">
            <Spinner />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>What for</Th>
                <Th className="hidden md:table-cell">Account</Th>
                <Th className="hidden lg:table-cell">Paid from</Th>
                <Th align="right">Amount</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {expenses.data?.items.length === 0 && <TableMessage colSpan={6}>{debounced ? "No expenses match." : "No expenses recorded yet."}</TableMessage>}
              {expenses.data?.items.map((e) => (
                <tr key={e.id} className={e.status === "void" ? "text-ink-faint" : ""}>
                  <Td className="whitespace-nowrap">{longDate(e.date)}</Td>
                  <Td>
                    <span className={e.status === "void" ? "line-through" : "font-medium"}>{e.description}</span>
                    <span className="block text-xs text-ink-faint">
                      {e.number}
                      {(e.payee ?? e.supplierName) && ` · ${e.payee ?? e.supplierName}`}
                      {e.reference && ` · ${e.reference}`}
                    </span>
                  </Td>
                  <Td className="hidden text-ink-soft md:table-cell">{e.accountName}</Td>
                  <Td className="hidden text-ink-soft lg:table-cell">{e.paidFromName}</Td>
                  <Td align="right" className="whitespace-nowrap">
                    {money(e.total, e.currencyCode)}
                    {Number(e.tax) > 0 && <span className="block text-xs text-ink-faint">incl. VAT {money(e.tax)}</span>}
                  </Td>
                  <Td align="right">
                    {e.status === "void" ? (
                      <Badge>Void</Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          if (confirm(`Void expense ${e.number}?`)) voidExpense.mutate(e.id);
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
        )}
        {expenses.data && <Pager page={page} pageSize={expenses.data.pageSize} total={expenses.data.total} onPage={setPage} />}
      </div>
      <ExpenseDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function ExpenseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const { session } = useSession();
  const base = session.tenant.baseCurrency;
  const chart = useChart();
  const periods = usePeriods();
  const taxRates = useTaxRates();
  const currencies = useCurrencies();
  const suppliers = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => api<Page<Supplier>>("/suppliers", { query: { pageSize: 200 } }) });
  const spendOn = (chart.data ?? []).filter((a) => isPostable(a) && !a.isBank && (a.type === "expense" || a.type === "asset"));
  const banks = (chart.data ?? []).filter((a) => a.isBank && a.active);
  const empty = { date: "", accountId: "", paidFromAccountId: "", supplierId: "", payee: "", description: "", reference: "", currencyCode: base, rate: "", total: "", taxRateId: "" };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);

  const ready = !!chart.data && !!periods.data;
  const [wasOpen, setWasOpen] = useState(false);
  if (ready && open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError(null);
      setForm({ ...empty, date: periods.data.today, paidFromAccountId: banks[0]?.id ?? "" });
    }
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const save = useMutation({
    mutationFn: () =>
      api<Expense>("/accounting/expenses", {
        method: "POST",
        body: {
          date: form.date,
          accountId: form.accountId,
          paidFromAccountId: form.paidFromAccountId,
          supplierId: form.supplierId || undefined,
          payee: form.payee.trim() || undefined,
          description: form.description.trim(),
          reference: form.reference.trim() || undefined,
          currencyCode: form.currencyCode,
          rate: form.currencyCode !== base && form.rate ? form.rate : undefined,
          total: form.total,
          taxRateId: form.taxRateId || null,
        },
      }),
    onSuccess: (e) => {
      invalidate();
      toast(`Expense ${e.number} recorded`);
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onClose={onClose} title="Record an expense" wide>
      {!ready ? (
        <Spinner />
      ) : (
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          <Field label="What was it for" className="sm:col-span-2">
            {(id) => <Input id={id} required autoFocus placeholder="ZESA tokens for the shop" value={form.description} onChange={set("description")} />}
          </Field>
          <Field label="Account">{(id) => <AccountSelect id={id} required accounts={spendOn} value={form.accountId} onChange={(v) => setForm({ ...form, accountId: v })} />}</Field>
          <Field label="Paid from">{(id) => <AccountSelect id={id} required accounts={banks} value={form.paidFromAccountId} onChange={(v) => setForm({ ...form, paidFromAccountId: v })} />}</Field>
          <Field label="Date">{(id) => <Input id={id} type="date" required value={form.date} onChange={set("date")} />}</Field>
          <Field label="Amount paid" hint="The full amount, including any VAT.">
            {(id) => <MoneyInput id={id} required value={form.total} onChange={set("total")} />}
          </Field>
          <Field label="VAT included" hint="Only if the slip is a valid tax invoice.">
            {(id) => (
              <Select id={id} value={form.taxRateId} onChange={set("taxRateId")}>
                <option value="">No VAT to claim</option>
                {taxRates.data
                  ?.filter((r) => r.active && Number(r.rate) > 0)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({Number(r.rate)}%)
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Currency">
            {(id) => (
              <Select id={id} value={form.currencyCode} onChange={(e) => setForm({ ...form, currencyCode: e.target.value, rate: "" })}>
                {currencies.data
                  ?.filter((c) => c.active)
                  .map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          {form.currencyCode !== base && (
            <Field label={`${form.currencyCode} per 1 ${base}`}>
              {(id) => <Input id={id} inputMode="decimal" placeholder={currencies.data?.find((c) => c.code === form.currencyCode)?.rateToBase} value={form.rate} onChange={set("rate")} />}
            </Field>
          )}
          <Field label="Supplier" hint="Optional.">
            {(id) => (
              <Select id={id} value={form.supplierId} onChange={set("supplierId")}>
                <option value="">None</option>
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
          <Field label="Paid to" hint="If not a supplier on your list.">
            {(id) => <Input id={id} value={form.payee} onChange={set("payee")} />}
          </Field>
          <Field label="Reference" hint="Receipt or slip number.">
            {(id) => <Input id={id} value={form.reference} onChange={set("reference")} />}
          </Field>
          <div className="sm:col-span-2">
            <FormError message={error} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" busy={save.isPending}>
              Record expense
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
