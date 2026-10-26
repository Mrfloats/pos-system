"use client";

import { CalendarClock, CreditCard, Store, Users } from "lucide-react";
import { useState } from "react";
import { longDay, PeriodToggle, PlanCard, SubscriptionBadge } from "@/components/plans";
import { useMySubscription } from "@/components/subscription-status";
import { FormError, PageHeader, Spinner, StatCard, Table, TableMessage, Td, Th } from "@/components/ui";
import { BillingPeriod } from "@/lib/api";
import { money } from "@/lib/format";

export default function SubscriptionPage() {
  const q = useMySubscription();
  const [period, setPeriod] = useState<BillingPeriod | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <FormError message={q.error.message} />;
  const s = q.data!;
  const showPeriod = period ?? s.billingPeriod ?? "monthly";
  const price = s.plan ? (s.billingPeriod === "yearly" ? s.plan.yearlyPrice : s.plan.monthlyPrice) : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Subscription" description="Your Floatly plan, what it costs, and the payments Floatly has recorded. To renew or change plan, pay Floatly and they'll update it here." />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Plan" value={s.plan?.name ?? "Complimentary"} icon={CreditCard} tone="green" note={price ? `${s.plan!.currency} ${money(price)} ${s.billingPeriod === "yearly" ? "a year" : "a month"}` : "No charge"} />
        <StatCard
          label="Paid up to"
          value={s.currentPeriodEnd ? longDay(s.currentPeriodEnd) : "No end date"}
          icon={CalendarClock}
          tone={s.state === "active" || s.state === "complimentary" ? "blue" : "rose"}
          note={s.daysLeft === null ? "" : s.daysLeft >= 0 ? `${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left` : `Ended ${-s.daysLeft} day${s.daysLeft === -1 ? "" : "s"} ago`}
        />
        <StatCard label="Stores" value={s.plan?.maxStores ?? "Unlimited"} icon={Store} tone="violet" note="Allowed on your plan" />
        <StatCard label="Staff" value={s.plan?.maxStaff ?? "Unlimited"} icon={Users} tone="amber" note="Allowed on your plan" />
      </div>

      <section className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-3 text-base font-semibold">
            Status <SubscriptionBadge state={s.state} />
          </h2>
          <PeriodToggle value={showPeriod} onChange={setPeriod} plans={s.plans} />
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {s.plans.map((p) => (
            <PlanCard key={p.id} plan={p} period={showPeriod} current={p.id === s.planId} />
          ))}
        </div>
        <p className="mt-4 text-xs text-ink-faint">Prices are what Floatly charges. Ask Floatly to switch plans; it takes effect from your next payment.</p>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line/70 px-6 py-4 text-base font-semibold">Payments</h2>
        <Table>
          <thead>
            <tr>
              <Th>Paid</Th>
              <Th>Covers</Th>
              <Th className="hidden sm:table-cell">How</Th>
              <Th align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {!s.payments.length && <TableMessage colSpan={4}>No payments recorded yet.</TableMessage>}
            {s.payments.map((p) => (
              <tr key={p.id}>
                <Td className="whitespace-nowrap text-ink-soft">{new Date(p.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</Td>
                <Td className="whitespace-nowrap">
                  {longDay(p.periodStart)} – {longDay(p.periodEnd)}
                </Td>
                <Td className="hidden text-ink-soft sm:table-cell">
                  {p.method}
                  {p.reference && <span className="block text-xs text-ink-faint">{p.reference}</span>}
                </Td>
                <Td align="right" className="font-semibold whitespace-nowrap tabular-nums">
                  {p.currency} {money(p.amount)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
