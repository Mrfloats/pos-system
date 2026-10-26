"use client";

import { Check, Sparkles } from "lucide-react";
import type { BillingPeriod, Plan, SubscriptionState } from "@/lib/api";
import { Badge } from "@/components/ui";
import { money } from "@/lib/format";

/** What a year on monthly billing would cost more than paying yearly. */
export const yearlySaving = (p: Plan) => Math.max(0, Number(p.monthlyPrice) * 12 - Number(p.yearlyPrice));

export function PeriodToggle({ value, onChange, plans }: { value: BillingPeriod; onChange: (p: BillingPeriod) => void; plans: Plan[] }) {
  const best = Math.max(0, ...plans.map((p) => Math.round((yearlySaving(p) / (Number(p.monthlyPrice) * 12 || 1)) * 100)));
  return (
    <div className="inline-flex rounded-2xl bg-paper p-1 ring-1 ring-line" role="radiogroup" aria-label="Billing">
      {(["monthly", "yearly"] as const).map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          onClick={() => onChange(p)}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 ${
            value === p ? "bg-surface text-ink shadow-md shadow-ink/10" : "text-ink-soft hover:text-ink"
          }`}
        >
          {p === "monthly" ? "Monthly" : "Yearly"}
          {p === "yearly" && best > 0 && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">Save {best}%</span>}
        </button>
      ))}
    </div>
  );
}

/** One plan to choose: price for the period, limits and features. */
export function PlanCard({
  plan,
  period,
  selected,
  current,
  popular,
  onSelect,
}: {
  plan: Plan;
  period: BillingPeriod;
  selected?: boolean;
  current?: boolean;
  popular?: boolean;
  onSelect?: () => void;
}) {
  const price = period === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;
  const saving = yearlySaving(plan);
  const Tag = onSelect ? "button" : "div";
  return (
    <Tag
      {...(onSelect ? { type: "button" as const, onClick: onSelect, "aria-pressed": selected } : {})}
      className={`relative flex h-full flex-col rounded-2xl border p-5 text-left transition-all duration-200 ${
        selected
          ? "border-ledger-600 bg-ledger-50/60 shadow-lg shadow-ledger-900/10 ring-2 ring-ledger-600/20"
          : "border-line bg-surface hover:-translate-y-0.5 hover:border-ledger-600/40 hover:shadow-md"
      }`}
    >
      {popular && (
        <span className="absolute -top-2.5 right-4 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-sm">
          <Sparkles className="size-3" /> Popular
        </span>
      )}
      <span className="flex items-center justify-between gap-2">
        <span className="text-base font-semibold">{plan.name}</span>
        {current && <Badge tone="green">Your plan</Badge>}
        {selected && !current && (
          <span className="flex size-5 items-center justify-center rounded-full bg-ledger-700 text-white">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        )}
      </span>
      {plan.description && <span className="mt-0.5 text-xs text-ink-soft">{plan.description}</span>}
      <span className="mt-4 flex items-baseline gap-1">
        <span className="text-sm text-ink-soft">{plan.currency}</span>
        <span className="text-3xl font-semibold tracking-tight tabular-nums">{money(price).replace(/\.00$/, "")}</span>
        <span className="text-sm text-ink-soft">/{period === "yearly" ? "year" : "month"}</span>
      </span>
      <span className="mt-1 h-4 text-xs font-medium text-emerald-700">{period === "yearly" && saving > 0 ? `${plan.currency} ${money(saving).replace(/\.00$/, "")} less than paying monthly` : ""}</span>
      <ul className="mt-3 flex flex-col gap-1.5 text-sm">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </Tag>
  );
}

const STATE: Record<SubscriptionState, { label: string; tone: "neutral" | "green" | "amber" | "red" }> = {
  active: { label: "Active", tone: "green" },
  complimentary: { label: "Complimentary", tone: "green" },
  grace: { label: "Payment due", tone: "amber" },
  lapsed: { label: "Lapsed", tone: "red" },
  suspended: { label: "Suspended", tone: "red" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function SubscriptionBadge({ state }: { state: SubscriptionState }) {
  return <Badge tone={STATE[state].tone}>{STATE[state].label}</Badge>;
}

export const longDay = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
