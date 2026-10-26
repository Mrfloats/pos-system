"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Clock, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AuthCard, stagger } from "@/components/auth-showcase";
import { PeriodToggle, yearlySaving } from "@/components/plans";
import { Button, Field, FormError, Input, Spinner, Textarea } from "@/components/ui";
import { api, BillingPeriod, BusinessType, Plan } from "@/lib/api";
import { money } from "@/lib/format";

const TYPES: { value: BusinessType; label: string; detail: string }[] = [
  { value: "retail", label: "Retail shop", detail: "Barcodes, shelves, walk-in customers" },
  { value: "wholesale", label: "Wholesale", detail: "Cases and bales, trade prices, accounts" },
  { value: "mixed", label: "Retail and wholesale", detail: "Sell singles and cases from one stock" },
  { value: "restaurant", label: "Restaurant", detail: "Menu items, sides and extras, kitchen tickets" },
];

const price = (p: Plan, period: BillingPeriod) => `${p.currency} ${money(period === "yearly" ? p.yearlyPrice : p.monthlyPrice).replace(/\.00$/, "")}`;

export default function SignupPage() {
  const plans = useQuery({ queryKey: ["plans", "public"], queryFn: () => api<Plan[]>("/auth/plans") });
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [planId, setPlanId] = useState("");
  const [form, setForm] = useState({ businessName: "", businessType: "retail" as BusinessType, fullName: "", email: "", phone: "", password: "", message: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const list = plans.data ?? [];
  // The middle plan is the one most businesses want.
  const popular = list.length >= 3 ? list[1].id : undefined;
  const chosen = list.find((p) => p.id === (planId || popular || list[0]?.id));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/signup-requests", {
        method: "POST",
        body: { ...form, phone: form.phone || undefined, message: form.message || undefined, planId: chosen!.id, billingPeriod: period },
      });
      setStep(3);
    } catch (err) {
      setError((err as Error).message);
      setShake((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  if (step === 3 && chosen) {
    return (
      <AuthCard>
        <div className="flex flex-col items-center text-center">
          <span className="flex size-16 animate-pop items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-lg shadow-emerald-600/30">
            <MailCheck className="size-8" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">Request sent</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Thanks, {form.fullName.split(" ")[0]}. Floatly will review <strong className="text-ink">{form.businessName}</strong> and be in touch about your first payment.
          </p>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-y-2 rounded-2xl bg-paper p-4 text-sm">
          <dt className="text-ink-soft">Plan</dt>
          <dd className="text-right font-medium">{chosen.name}</dd>
          <dt className="text-ink-soft">Billing</dt>
          <dd className="text-right font-medium">
            {price(chosen, period)} / {period === "yearly" ? "year" : "month"}
          </dd>
          <dt className="text-ink-soft">Sign in with</dt>
          <dd className="truncate text-right font-medium">{form.email}</dd>
        </dl>
        <p className="mt-4 flex items-start gap-2 text-xs text-ink-soft">
          <Clock className="mt-0.5 size-3.5 shrink-0" /> Once it&apos;s approved, sign in with the email and password you just chose. Until then, signing in shows that it&apos;s waiting.
        </p>
        <Link href="/login" className="mt-6 flex h-11 items-center justify-center rounded-xl bg-ledger-800 text-sm font-semibold text-white transition hover:bg-ledger-700">
          Back to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard shakeKey={shake}>
      <div {...stagger(0)}>
        <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-ledger-700 uppercase">
          <span className={`flex size-5 items-center justify-center rounded-full ${step === 1 ? "bg-ledger-700 text-white" : "bg-ledger-100 text-ledger-800"}`}>{step > 1 ? <Check className="size-3" strokeWidth={3} /> : 1}</span>
          Plan
          <span className="h-px w-6 bg-line-strong" />
          <span className={`flex size-5 items-center justify-center rounded-full ${step === 2 ? "bg-ledger-700 text-white" : "bg-paper text-ink-faint ring-1 ring-line"}`}>2</span>
          <span className={step === 2 ? "" : "text-ink-faint"}>Your business</span>
        </div>
        <h1 className="mt-3 text-[26px] leading-tight font-semibold tracking-tight">{step === 1 ? "Choose your plan" : "Tell us about your business"}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {step === 1 ? "Your request goes to Floatly for approval. You can change plans later." : "We'll set up your first store, tax rates and price lists once you're approved."}
        </p>
      </div>

      {step === 1 ? (
        <div className="mt-6 flex flex-col gap-4">
          <div {...stagger(1)}>
            <PeriodToggle value={period} onChange={setPeriod} plans={list} />
          </div>
          {plans.isLoading ? (
            <Spinner />
          ) : (
            <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="Plan">
              {list.map((p, i) => {
                const on = chosen?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setPlanId(p.id)}
                    {...stagger(2 + i)}
                    className={`group relative animate-fade-up rounded-2xl border p-4 text-left transition-all duration-200 ${
                      on ? "border-ledger-600 bg-ledger-50/60 shadow-md shadow-ledger-900/10 ring-2 ring-ledger-600/15" : "border-line bg-surface hover:-translate-y-0.5 hover:border-ledger-600/40 hover:shadow-md"
                    }`}
                  >
                    {p.id === popular && <span className="absolute -top-2 right-4 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase shadow-sm">Popular</span>}
                    <span className="flex items-center gap-3">
                      <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition ${on ? "border-ledger-700 bg-ledger-700" : "border-line-strong"}`}>
                        {on && <span className="size-2 rounded-full bg-white" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{p.name}</span>
                        <span className="block truncate text-xs text-ink-soft">{p.features.slice(0, 2).join(" · ")}</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-lg font-semibold tabular-nums">{price(p, period)}</span>
                        <span className="block text-[11px] text-ink-faint">
                          {period === "yearly" ? (yearlySaving(p) > 0 ? `save ${p.currency} ${money(yearlySaving(p)).replace(/\.00$/, "")}` : "per year") : "per month"}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <Button type="button" className="mt-1 h-11" disabled={!chosen} onClick={() => setStep(2)}>
            Continue with {chosen?.name ?? "a plan"} <ArrowRight className="size-4" />
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          {chosen && (
            <button type="button" onClick={() => setStep(1)} className="flex items-center justify-between rounded-xl bg-paper px-3.5 py-2.5 text-left text-sm ring-1 ring-line transition hover:ring-ledger-600/40">
              <span>
                <span className="font-semibold">{chosen.name}</span>
                <span className="text-ink-soft">
                  {" "}
                  · {price(chosen, period)} / {period === "yearly" ? "year" : "month"}
                </span>
              </span>
              <span className="flex items-center gap-1 text-xs font-medium text-ledger-700">
                <ArrowLeft className="size-3.5" /> Change
              </span>
            </button>
          )}
          <Field label="Business name">{(id) => <Input id={id} required minLength={2} autoFocus value={form.businessName} onChange={set("businessName")} />}</Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">What do you run?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {TYPES.map((t) => (
                <label
                  key={t.value}
                  className={`cursor-pointer rounded-xl border px-3 py-2 transition-colors ${form.businessType === t.value ? "border-ledger-700 bg-ledger-50" : "border-line-strong bg-surface hover:bg-paper"}`}
                >
                  <input type="radio" name="businessType" value={t.value} checked={form.businessType === t.value} onChange={() => setForm({ ...form, businessType: t.value })} className="sr-only" />
                  <span className="block text-sm font-medium">{t.label}</span>
                  <span className="block text-xs text-ink-soft">{t.detail}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name">{(id) => <Input id={id} required autoComplete="name" value={form.fullName} onChange={set("fullName")} />}</Field>
            <Field label="Phone">{(id) => <Input id={id} type="tel" autoComplete="tel" placeholder="+263…" value={form.phone} onChange={set("phone")} />}</Field>
          </div>
          <Field label="Email">{(id) => <Input id={id} type="email" required autoComplete="email" value={form.email} onChange={set("email")} />}</Field>
          <Field label="Password" hint="At least 8 characters. You'll sign in with it once approved.">
            {(id) => <Input id={id} type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set("password")} />}
          </Field>
          <Field label="Anything we should know? (optional)">{(id) => <Textarea id={id} className="min-h-16" value={form.message} onChange={set("message")} />}</Field>
          <FormError message={error} />
          <Button type="submit" busy={busy} className="h-11">
            {busy ? "Sending…" : "Send request"}
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-ink-soft">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-ledger-700 underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
