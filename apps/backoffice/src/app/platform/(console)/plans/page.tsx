"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { PeriodToggle, PlanCard } from "@/components/plans";
import { useToast } from "@/components/toast";
import { Badge, Button, Checkbox, Dialog, Field, FormError, Input, Spinner, Textarea } from "@/components/ui";
import { api, BillingPeriod, Plan, PlatformBilling } from "@/lib/api";
import { money } from "@/lib/format";

type Draft = Partial<Plan> & { featuresText: string };
const blank: Draft = { code: "", name: "", description: "", monthlyPrice: "", yearlyPrice: "", currency: "USD", maxStores: null, maxStaff: null, active: true, featuresText: "" };

export default function PlansPage() {
  const plans = useQuery({ queryKey: ["platform", "plans"], queryFn: () => api<Plan[]>("/platform/plans", { platform: true }) });
  const billing = useQuery({ queryKey: ["platform", "billing"], queryFn: () => api<PlatformBilling>("/platform/billing", { platform: true }) });
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [editing, setEditing] = useState<Draft | null>(null);
  const count = (planId: string) => billing.data?.subscriptions.filter((s) => s.planId === planId && ["active", "grace"].includes(s.state)).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-soft">What businesses pay Floatly</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Plans</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PeriodToggle value={period} onChange={setPeriod} plans={plans.data ?? []} />
          <Button onClick={() => setEditing(blank)}>
            <Plus className="size-4" /> New plan
          </Button>
        </div>
      </header>

      {billing.data && (
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="rounded-2xl bg-surface px-4 py-2 shadow-sm ring-1 ring-line">
            Monthly recurring revenue{" "}
            <strong className="tabular-nums">{billing.data.mrr.length ? billing.data.mrr.map((m) => `${m.currency} ${money(m.amount)}`).join(" · ") : "—"}</strong>
          </span>
          <span className="rounded-2xl bg-surface px-4 py-2 shadow-sm ring-1 ring-line">
            Ending within 7 days <strong>{billing.data.endingSoon}</strong>
          </span>
          <span className="rounded-2xl bg-surface px-4 py-2 shadow-sm ring-1 ring-line">
            Overdue <strong className={billing.data.lapsed ? "text-danger" : ""}>{billing.data.lapsed}</strong>
          </span>
        </div>
      )}

      {plans.isLoading ? (
        <Spinner />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {plans.data?.map((p, i) => (
            <div key={p.id} className="flex animate-fade-up flex-col gap-2" style={{ animationDelay: `${i * 60}ms` }}>
              <div className={p.active ? "" : "opacity-60"}>
                <PlanCard plan={p} period={period} />
              </div>
              <div className="flex items-center justify-between px-1 text-sm">
                <span className="flex items-center gap-2 text-ink-soft">
                  {count(p.id)} paying {count(p.id) === 1 ? "business" : "businesses"}
                  {!p.active && <Badge>Hidden from sign-up</Badge>}
                </span>
                <Button variant="ghost" className="h-8" onClick={() => setEditing({ ...p, featuresText: p.features.join("\n") })}>
                  <Pencil className="size-3.5" /> Edit
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <PlanDialog draft={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function PlanDialog({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  return (
    <Dialog open={!!draft} onClose={onClose} title={draft?.id ? `Edit ${draft.name}` : "New plan"} wide>
      {draft && <PlanForm key={draft.id ?? "new"} initial={draft} onDone={onClose} />}
    </Dialog>
  );
}

function PlanForm({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const num = (v: string) => (v.trim() ? Number(v) : null);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...(d.id ? {} : { code: d.code?.trim() }),
        name: d.name?.trim(),
        description: d.description?.trim() || undefined,
        monthlyPrice: d.monthlyPrice,
        yearlyPrice: d.yearlyPrice,
        currency: d.currency,
        maxStores: d.maxStores ?? null,
        maxStaff: d.maxStaff ?? null,
        features: d.featuresText
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean),
        active: d.active,
      };
      return d.id ? api(`/platform/plans/${d.id}`, { method: "PATCH", platform: true, body }) : api("/platform/plans", { method: "POST", platform: true, body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform"] });
      toast(d.id ? "Plan saved" : "Plan added");
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <Field label="Name">{(id) => <Input id={id} required autoFocus value={d.name ?? ""} onChange={(e) => setD({ ...d, name: e.target.value })} />}</Field>
      {!d.id ? (
        <Field label="Code" hint="Lowercase, e.g. growth. Can't change later.">
          {(id) => <Input id={id} required value={d.code ?? ""} onChange={(e) => setD({ ...d, code: e.target.value.toLowerCase() })} />}
        </Field>
      ) : (
        <Field label="Code">{(id) => <Input id={id} disabled value={d.code ?? ""} />}</Field>
      )}
      <Field label="Description" className="sm:col-span-2">
        {(id) => <Input id={id} value={d.description ?? ""} onChange={(e) => setD({ ...d, description: e.target.value })} />}
      </Field>
      <Field label={`Monthly price (${d.currency})`}>
        {(id) => <Input id={id} required inputMode="decimal" className="text-right" value={d.monthlyPrice ?? ""} onChange={(e) => setD({ ...d, monthlyPrice: e.target.value })} />}
      </Field>
      <Field label={`Yearly price (${d.currency})`} hint={d.monthlyPrice ? `12 months would be ${money(Number(d.monthlyPrice) * 12)}` : undefined}>
        {(id) => <Input id={id} required inputMode="decimal" className="text-right" value={d.yearlyPrice ?? ""} onChange={(e) => setD({ ...d, yearlyPrice: e.target.value })} />}
      </Field>
      <Field label="Most stores" hint="Empty for unlimited.">
        {(id) => <Input id={id} inputMode="numeric" value={d.maxStores ?? ""} onChange={(e) => setD({ ...d, maxStores: num(e.target.value) })} />}
      </Field>
      <Field label="Most staff" hint="Empty for unlimited.">
        {(id) => <Input id={id} inputMode="numeric" value={d.maxStaff ?? ""} onChange={(e) => setD({ ...d, maxStaff: num(e.target.value) })} />}
      </Field>
      <Field label="Features" hint="One per line, shown on the sign-up page." className="sm:col-span-2">
        {(id) => <Textarea id={id} className="min-h-28" value={d.featuresText} onChange={(e) => setD({ ...d, featuresText: e.target.value })} />}
      </Field>
      <div className="sm:col-span-2">
        <Checkbox label="Offer this plan on the sign-up page" checked={d.active !== false} onChange={(e) => setD({ ...d, active: e.target.checked })} />
      </div>
      <div className="sm:col-span-2">
        <FormError message={error} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" busy={save.isPending}>
          {d.id ? "Save plan" : "Add plan"}
        </Button>
      </div>
    </form>
  );
}
