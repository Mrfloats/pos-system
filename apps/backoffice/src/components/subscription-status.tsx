"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Lock, LogOut } from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { longDay } from "@/components/plans";
import { api, MySubscription } from "@/lib/api";
import { money } from "@/lib/format";
import { useSession } from "@/lib/session";

export const useMySubscription = () =>
  useQuery({ queryKey: ["subscription"], queryFn: () => api<MySubscription>("/subscription"), staleTime: 5 * 60_000 });

/** A slim warning above the page while a payment is due (the last week, and the grace days after). */
export function SubscriptionBanner() {
  const sub = useMySubscription().data;
  if (!sub) return null;
  const dueSoon = sub.state === "active" && sub.daysLeft !== null && sub.daysLeft <= 7;
  if (!dueSoon && sub.state !== "grace") return null;
  const grace = sub.state === "grace";
  return (
    <div className={`mb-6 flex animate-fade-up flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-sm ring-1 ${grace ? "bg-danger-soft text-danger ring-danger/20" : "bg-amber-soft text-amber-ink ring-amber/30"}`}>
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">
        {grace ? (
          <>
            Your Floatly subscription ended on <strong>{longDay(sub.currentPeriodEnd)}</strong>. Renew by <strong>{longDay(sub.graceEnds)}</strong> to keep working.
          </>
        ) : (
          <>
            Your {sub.plan?.name} plan is paid up to <strong>{longDay(sub.currentPeriodEnd)}</strong> ({sub.daysLeft === 0 ? "today" : `${sub.daysLeft} day${sub.daysLeft === 1 ? "" : "s"} left`}).
          </>
        )}
      </span>
      <Link href="/subscription" className="inline-flex items-center gap-1 font-semibold underline-offset-4 hover:underline">
        Renew <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

/** Shown instead of the app when the subscription has lapsed or the business is suspended. */
export function LapsedScreen() {
  const { session, signOut } = useSession();
  const sub = useMySubscription().data;
  const suspended = sub?.state === "suspended";
  const price = sub?.plan ? (sub.billingPeriod === "yearly" ? sub.plan.yearlyPrice : sub.plan.monthlyPrice) : null;
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#0f3d30] via-ledger-950 to-[#071f18] px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute -top-32 -right-24 size-[28rem] animate-drift rounded-full bg-emerald-400/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 size-96 animate-drift-reverse rounded-full bg-sky-400/10 blur-3xl" />
      <div className="relative w-full max-w-lg animate-fade-up">
        <BrandMark inverted className="mb-6" />
        <div className="card overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400" />
          <div className="p-8">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300 to-orange-500 text-white shadow-lg shadow-orange-600/30">
              <Lock className="size-7" />
            </span>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight">{suspended ? `${session.tenant.name} is suspended` : `Time to renew ${session.tenant.name}`}</h1>
            <p className="mt-2 text-sm text-ink-soft">
              {suspended
                ? "Floatly has paused this business. Get in touch with Floatly to restore access."
                : `Your Floatly subscription ended on ${longDay(sub?.currentPeriodEnd)}. Your data is safe; pay for the next period and Floatly will open it up again.`}
            </p>
            {sub?.plan && !suspended && (
              <div className="mt-6 flex items-center justify-between rounded-2xl bg-paper p-4 ring-1 ring-line">
                <span>
                  <span className="block text-xs text-ink-faint">Your plan</span>
                  <span className="font-semibold">{sub.plan.name}</span>
                </span>
                <span className="text-right">
                  <span className="block text-xs text-ink-faint">{sub.billingPeriod === "yearly" ? "Per year" : "Per month"}</span>
                  <span className="text-lg font-semibold tabular-nums">
                    {sub.plan.currency} {money(price)}
                  </span>
                </span>
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/subscription" className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-ledger-800 px-4 text-sm font-semibold text-white transition hover:bg-ledger-700">
                See subscription and payments
              </Link>
              <button onClick={signOut} className="inline-flex h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm font-medium text-ink-soft transition hover:bg-paper hover:text-ink">
                <LogOut className="size-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
