"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CircleDollarSign, Pause, Play, Settings2 } from "lucide-react";
import { useState } from "react";
import { longDay, SubscriptionBadge } from "@/components/plans";
import { useToast } from "@/components/toast";
import { Button, Dialog, Field, FormError, Input, Select, Spinner, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, BillingPeriod, Plan, SubscriptionPayment, SubscriptionState } from "@/lib/api";
import { money } from "@/lib/format";

interface PlatformSub {
  planId: string | null;
  billingPeriod: BillingPeriod | null;
  status: "active" | "suspended" | "cancelled";
  currentPeriodEnd: string | null;
  state: SubscriptionState;
  payments: SubscriptionPayment[];
}

const METHODS = ["EcoCash", "OneMoney", "InnBucks", "Bank transfer", "Cash", "Card"];

/** One business's Floatly subscription, as Floatly staff see and manage it. */
export function PlatformSubscription({ tenantId, businessName }: { tenantId: string; businessName: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const sub = useQuery({ queryKey: ["platform", "subscription", tenantId], queryFn: () => api<PlatformSub>(`/platform/businesses/${tenantId}/subscription`, { platform: true }) });
  const plans = useQuery({ queryKey: ["platform", "plans"], queryFn: () => api<Plan[]>("/platform/plans", { platform: true }) });
  const [dialog, setDialog] = useState<"pay" | "change" | null>(null);

  const setStatus = useMutation({
    mutationFn: (status: "active" | "suspended") => api(`/platform/businesses/${tenantId}/subscription`, { method: "PATCH", platform: true, body: { status } }),
    onSuccess: (_, status) => {
      qc.invalidateQueries({ queryKey: ["platform"] });
      toast(status === "suspended" ? `${businessName} suspended` : `${businessName} reactivated`);
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (sub.isLoading || !sub.data) return <Spinner />;
  const s = sub.data;
  const plan = plans.data?.find((p) => p.id === s.planId);
  const price = plan ? (s.billingPeriod === "yearly" ? plan.yearlyPrice : plan.monthlyPrice) : null;

  return (
    <section className="card overflow-hidden">
      <div className="relative overflow-hidden bg-gradient-to-r from-[#0f3d30] via-ledger-950 to-[#071f18] p-6 text-white">
        <div aria-hidden className="pointer-events-none absolute -top-20 right-10 size-56 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm text-emerald-100/70">
              Floatly subscription <SubscriptionBadge state={s.state} />
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {plan?.name ?? "No plan (complimentary)"}
              {price && (
                <span className="ml-2 text-base font-normal text-emerald-100/80">
                  {plan!.currency} {money(price)} / {s.billingPeriod === "yearly" ? "year" : "month"}
                </span>
              )}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-emerald-100/80">
              <CalendarClock className="size-4" /> {s.currentPeriodEnd ? `Paid up to ${longDay(s.currentPeriodEnd)}` : "No end date"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setDialog("pay")} className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-ledger-900 shadow-md transition hover:-translate-y-0.5">
              <CircleDollarSign className="size-4" /> Record payment
            </button>
            <button onClick={() => setDialog("change")} className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-medium ring-1 ring-white/20 transition hover:bg-white/20">
              <Settings2 className="size-4" /> Change
            </button>
            {s.status === "suspended" ? (
              <button onClick={() => setStatus.mutate("active")} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-400/20 px-4 text-sm font-medium text-emerald-100 ring-1 ring-emerald-300/30 transition hover:bg-emerald-400/30">
                <Play className="size-4" /> Reactivate
              </button>
            ) : (
              <button
                onClick={() => confirm(`Suspend ${businessName}? Its staff are locked out until you reactivate it.`) && setStatus.mutate("suspended")}
                className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-medium text-rose-200 ring-1 ring-rose-300/30 transition hover:bg-rose-500/20"
              >
                <Pause className="size-4" /> Suspend
              </button>
            )}
          </div>
        </div>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Covers</Th>
            <Th className="hidden md:table-cell">Plan</Th>
            <Th className="hidden sm:table-cell">How</Th>
            <Th className="hidden lg:table-cell">Recorded by</Th>
            <Th align="right">Amount</Th>
          </tr>
        </thead>
        <tbody>
          {!s.payments.length && <TableMessage colSpan={5}>No payments recorded yet.</TableMessage>}
          {s.payments.map((p) => (
            <tr key={p.id}>
              <Td className="whitespace-nowrap">
                {longDay(p.periodStart)} – {longDay(p.periodEnd)}
              </Td>
              <Td className="hidden text-ink-soft md:table-cell">
                {p.planName} · {p.billingPeriod}
              </Td>
              <Td className="hidden text-ink-soft sm:table-cell">
                {p.method}
                {p.reference && <span className="block text-xs text-ink-faint">{p.reference}</span>}
              </Td>
              <Td className="hidden text-ink-soft lg:table-cell">{p.recordedBy ?? "—"}</Td>
              <Td align="right" className="font-semibold whitespace-nowrap tabular-nums">
                {p.currency} {money(p.amount)}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Dialog open={dialog === "pay"} onClose={() => setDialog(null)} title={`Payment from ${businessName}`}>
        {dialog === "pay" && <PaymentForm tenantId={tenantId} sub={s} plans={plans.data ?? []} onDone={() => setDialog(null)} />}
      </Dialog>
      <Dialog open={dialog === "change"} onClose={() => setDialog(null)} title={`Change ${businessName}'s subscription`}>
        {dialog === "change" && <ChangeForm tenantId={tenantId} sub={s} plans={plans.data ?? []} onDone={() => setDialog(null)} />}
      </Dialog>
    </section>
  );
}

function PaymentForm({ tenantId, sub, plans, onDone }: { tenantId: string; sub: PlatformSub; plans: Plan[]; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [planId, setPlanId] = useState(sub.planId ?? plans[0]?.id ?? "");
  const [period, setPeriod] = useState<BillingPeriod>(sub.billingPeriod ?? "monthly");
  const priceOf = (id: string, per: BillingPeriod) => {
    const p = plans.find((x) => x.id === id);
    return p ? (per === "yearly" ? p.yearlyPrice : p.monthlyPrice) : "";
  };
  const [form, setForm] = useState({ amount: priceOf(planId, period), method: "EcoCash", reference: "" });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api<{ periodStart: string; periodEnd: string }>(`/platform/businesses/${tenantId}/payments`, {
        method: "POST",
        platform: true,
        body: { ...form, reference: form.reference || undefined, planId, billingPeriod: period },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["platform"] });
      toast(`Paid up to ${longDay(r.periodEnd)}`);
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <p className="text-sm text-ink-soft">
        {sub.currentPeriodEnd && sub.state === "active"
          ? `This adds one ${period === "yearly" ? "year" : "month"} after ${longDay(sub.currentPeriodEnd)}.`
          : `This covers one ${period === "yearly" ? "year" : "month"} from today and opens the business again.`}
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Plan">
          {(id) => (
            <Select id={id} value={planId} onChange={(e) => (setPlanId(e.target.value), setForm({ ...form, amount: priceOf(e.target.value, period) }))}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="For">
          {(id) => (
            <Select
              id={id}
              value={period}
              onChange={(e) => {
                const next = e.target.value as BillingPeriod;
                setPeriod(next);
                setForm({ ...form, amount: priceOf(planId, next) });
              }}
            >
              <option value="monthly">One month</option>
              <option value="yearly">One year</option>
            </Select>
          )}
        </Field>
        <Field label="Amount">{(id) => <Input id={id} required inputMode="decimal" className="text-right" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />}</Field>
        <Field label="Paid by">
          {(id) => (
            <Select id={id} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Reference">{(id) => <Input id={id} placeholder="Transaction ID" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />}</Field>
      <FormError message={error} />
      <Button type="submit" busy={save.isPending}>
        Record payment
      </Button>
    </form>
  );
}

function ChangeForm({ tenantId, sub, plans, onDone }: { tenantId: string; sub: PlatformSub; plans: Plan[]; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ planId: sub.planId ?? "", billingPeriod: sub.billingPeriod ?? "monthly", currentPeriodEnd: sub.currentPeriodEnd ?? "" });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api(`/platform/businesses/${tenantId}/subscription`, {
        method: "PATCH",
        platform: true,
        body: { planId: form.planId || null, billingPeriod: form.billingPeriod, currentPeriodEnd: form.currentPeriodEnd || null },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform"] });
      toast("Subscription updated");
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <Field label="Plan" hint="No plan means no limits and no charge.">
        {(id) => (
          <Select id={id} value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>
            <option value="">No plan (complimentary)</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Billing">
        {(id) => (
          <Select id={id} value={form.billingPeriod} onChange={(e) => setForm({ ...form, billingPeriod: e.target.value as BillingPeriod })}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </Select>
        )}
      </Field>
      <Field label="Paid up to" hint="Empty for no end date. Use Record payment for normal renewals.">
        {(id) => <Input id={id} type="date" value={form.currentPeriodEnd} onChange={(e) => setForm({ ...form, currentPeriodEnd: e.target.value })} />}
      </Field>
      <FormError message={error} />
      <Button type="submit" busy={save.isPending}>
        Save
      </Button>
    </form>
  );
}
