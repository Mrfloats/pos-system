"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, ArrowRight, Banknote, Boxes, FileText, HandCoins, Landmark, Plus, Receipt, ReceiptText, Smartphone, TrendingDown, TrendingUp, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AccountSelect, ButtonLink, ClosePeriod, longDate, MoneyInput, useChart, useInvalidateBooks, usePeriods } from "@/components/accounts";
import { useToast } from "@/components/toast";
import { Button, Dialog, Field, FormError, Input, PageHeader, Spinner, StatCard } from "@/components/ui";
import { AccountingSummary, api } from "@/lib/api";
import { money } from "@/lib/format";

/** Icons for the standard money accounts, by account code. */
const MONEY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "1000": Banknote,
  "1100": Landmark,
  "1150": Smartphone,
};

export default function AccountsOverviewPage() {
  const summary = useQuery({ queryKey: ["accounting", "summary"], queryFn: () => api<AccountingSummary>("/accounting/summary") });
  const [transferring, setTransferring] = useState(false);

  if (summary.isLoading) return <Spinner />;
  if (summary.error) return <FormError message={summary.error.message} />;
  const s = summary.data!;
  const cur = s.currency;
  const totalMoney = s.moneyAccounts.reduce((t, a) => t + Number(a.balance), 0);
  const loss = Number(s.thisMonth.profit) < 0;
  const monthName = new Date(`${s.thisMonth.from}T00:00:00`).toLocaleDateString("en-GB", { month: "long" });

  const figures = [
    { label: "Customers owe you", icon: HandCoins, tone: "blue" as const, value: s.receivables, href: "/accounts/reports?report=aged-receivables", note: s.overdueInvoices.count ? `${money(s.overdueInvoices.amount)} overdue on ${s.overdueInvoices.count} invoice${s.overdueInvoices.count === 1 ? "" : "s"}` : "Nothing overdue" , alert: s.overdueInvoices.count > 0 },
    { label: "You owe suppliers", icon: Truck, tone: "violet" as const, value: s.payables, href: "/accounts/reports?report=aged-payables", note: s.overdueBills.count ? `${money(s.overdueBills.amount)} overdue on ${s.overdueBills.count} bill${s.overdueBills.count === 1 ? "" : "s"}` : "Nothing overdue", alert: s.overdueBills.count > 0 },
    Number(s.vatOwed) < 0
      ? { label: "VAT to claim from ZIMRA", icon: ReceiptText, tone: "teal" as const, alert: false, value: String(-Number(s.vatOwed)), href: "/accounts/reports?report=vat", note: "Input VAT is more than output VAT" }
      : { label: "VAT owed to ZIMRA", icon: ReceiptText, tone: "amber" as const, alert: false, value: s.vatOwed, href: "/accounts/reports?report=vat", note: "Output VAT less input VAT" },
    { label: "Stock at cost", icon: Boxes, tone: "green" as const, alert: false, value: s.stockValue, href: "/accounts/reports?report=balance-sheet", note: "From goods received and counts" },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Accounts"
        description={`All figures in ${cur}, the base currency.${s.booksClosedThrough ? ` Books closed up to ${longDate(s.booksClosedThrough)}.` : ""}`}
        actions={
          <>
            <ButtonLink href="/accounts/invoices/new">
              <FileText className="size-4" aria-hidden /> New invoice
            </ButtonLink>
            <ButtonLink href="/accounts/bills/new" variant="secondary">
              <Plus className="size-4" aria-hidden /> New bill
            </ButtonLink>
            <ButtonLink href="/accounts/expenses?new=1" variant="secondary">
              <Receipt className="size-4" aria-hidden /> Record expense
            </ButtonLink>
            <Button variant="secondary" onClick={() => setTransferring(true)}>
              <ArrowLeftRight className="size-4" aria-hidden /> Move money
            </Button>
          </>
        }
      />

      {/* Money on hand: a dark card that reads like a wallet, one chip per account */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-ledger-700 via-ledger-800 to-ledger-950 p-6 text-white shadow-[var(--shadow-lift)] sm:p-7">
        <div aria-hidden className="pointer-events-none absolute -top-20 -right-10 size-72 rounded-full bg-emerald-300/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="flex items-center gap-2 text-sm text-ledger-100/80">
              <Wallet className="size-4" aria-hidden /> Cash, bank and mobile money
            </p>
            <p className={`mt-1 text-4xl font-semibold tracking-tight tabular-nums ${totalMoney < 0 ? "text-rose-200" : ""}`}>{money(totalMoney, cur)}</p>
          </div>
          <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-3">
            {s.moneyAccounts.map((a) => {
              const Icon = MONEY_ICONS[a.code] ?? Banknote;
              return (
                <Link
                  key={a.id}
                  href={`/accounts/reports?report=ledger&account=${a.id}`}
                  className="flex min-w-44 items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/10 backdrop-blur transition hover:bg-white/15"
                >
                  <span className="flex size-9 items-center justify-center rounded-xl bg-white/15">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span>
                    <span className="block text-xs text-ledger-100/80">{a.name}</span>
                    <span className={`block font-semibold tabular-nums ${Number(a.balance) < 0 ? "text-rose-200" : ""}`}>{money(a.balance)}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {figures.map((f) => (
          <StatCard key={f.label} label={f.label} value={money(f.value)} note={f.note} icon={f.icon} tone={f.alert ? "rose" : f.tone} href={f.href} alert={f.alert} />
        ))}
      </div>

      <section className="card p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">{monthName} so far</h2>
          <Link href="/accounts/reports?report=profit-and-loss" className="inline-flex items-center gap-1 text-sm font-medium text-ledger-700 hover:gap-2 hover:underline">
            Profit and loss <ArrowRight className="size-4 transition-all" aria-hidden />
          </Link>
        </div>
        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-ledger-50 p-4">
            <dt className="flex items-center gap-2 text-sm text-ledger-800">
              <TrendingUp className="size-4" aria-hidden /> Income
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{money(s.thisMonth.income)}</dd>
          </div>
          <div className="rounded-2xl bg-amber-soft p-4">
            <dt className="flex items-center gap-2 text-sm text-amber-ink">
              <TrendingDown className="size-4" aria-hidden /> Costs and expenses
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{money(s.thisMonth.expenses)}</dd>
          </div>
          <div className={`rounded-2xl p-4 ${loss ? "bg-danger-soft" : "bg-sky-50"}`}>
            <dt className={`text-sm ${loss ? "text-danger" : "text-sky-800"}`}>{loss ? "Loss" : "Profit"}</dt>
            <dd className={`mt-1 text-2xl font-semibold tabular-nums ${loss ? "text-danger" : "text-sky-900"}`}>{money(Math.abs(Number(s.thisMonth.profit)))}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-ink-faint">Till sales are added automatically once the till app is connected. Until then, income comes from invoices.</p>
      </section>

      <ClosePeriod />
      <TransferDialog open={transferring} onClose={() => setTransferring(false)} />
    </div>
  );
}

/** Moving money between cash, bank and mobile money (banking the takings, withdrawing cash…). */
function TransferDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const chart = useChart();
  const periods = usePeriods();
  const banks = (chart.data ?? []).filter((a) => a.isBank && a.active);
  const [form, setForm] = useState({ fromAccountId: "", toAccountId: "", date: "", amount: "", description: "", reference: "" });
  const [error, setError] = useState<string | null>(null);

  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError(null);
      setForm({ fromAccountId: banks[0]?.id ?? "", toAccountId: banks[1]?.id ?? "", date: periods.data?.today ?? "", amount: "", description: "", reference: "" });
    }
  }

  const save = useMutation({
    mutationFn: () =>
      api("/accounting/transfers", {
        method: "POST",
        body: { ...form, description: form.description.trim() || undefined, reference: form.reference.trim() || undefined },
      }),
    onSuccess: () => {
      invalidate();
      toast("Money moved");
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onClose={onClose} title="Move money between accounts">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <Field label="From">{(id) => <AccountSelect id={id} required accounts={banks} value={form.fromAccountId} onChange={(v) => setForm({ ...form, fromAccountId: v })} />}</Field>
        <Field label="To">{(id) => <AccountSelect id={id} required accounts={banks} value={form.toAccountId} onChange={(v) => setForm({ ...form, toAccountId: v })} />}</Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date">{(id) => <Input id={id} type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />}</Field>
          <Field label="Amount">{(id) => <MoneyInput id={id} required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />}</Field>
        </div>
        <Field label="What for" hint="For example: Banking Friday's takings.">
          {(id) => <Input id={id} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
        </Field>
        <Field label="Reference">{(id) => <Input id={id} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />}</Field>
        <FormError message={error} />
        <Button type="submit" busy={save.isPending}>
          Move money
        </Button>
      </form>
    </Dialog>
  );
}
