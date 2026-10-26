"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Inbox, Mail, MessageSquare, Phone, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { longDay } from "@/components/plans";
import { useToast } from "@/components/toast";
import { Badge, Button, Checkbox, Dialog, Field, FormError, Input, Select, Spinner, Textarea } from "@/components/ui";
import { api, BillingPeriod, Plan, SignupRequest } from "@/lib/api";
import { BUSINESS_LABELS, money } from "@/lib/format";

type Filter = "pending" | "approved" | "rejected";
const ago = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
};

export default function RequestsPage() {
  const [filter, setFilter] = useState<Filter>("pending");
  const requests = useQuery({
    queryKey: ["platform", "requests", filter],
    queryFn: () => api<SignupRequest[]>("/platform/requests", { platform: true, query: { status: filter } }),
  });
  const [approving, setApproving] = useState<SignupRequest | null>(null);
  const [rejecting, setRejecting] = useState<SignupRequest | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-soft">New businesses asking to join</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Sign-up requests</h1>
        </div>
        <div className="flex rounded-2xl bg-surface p-1 shadow-sm ring-1 ring-line" role="group" aria-label="Show">
          {(["pending", "approved", "rejected"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-xl px-4 py-1.5 text-sm font-medium capitalize transition ${filter === f ? "bg-ledger-800 text-white shadow-sm" : "text-ink-soft hover:text-ink"}`}
            >
              {f === "pending" ? "Waiting" : f}
            </button>
          ))}
        </div>
      </header>

      {requests.isLoading ? (
        <Spinner />
      ) : !requests.data?.length ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center text-sm text-ink-faint">
          <Inbox className="size-10 text-ink-faint/60" aria-hidden />
          {filter === "pending" ? "No requests waiting. New sign-ups appear here." : `No ${filter} requests yet.`}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {requests.data.map((r, i) => (
            <article key={r.id} className="card flex animate-fade-up flex-col p-6" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-sm">
                    <Building2 className="size-5" />
                  </span>
                  <div>
                    <h2 className="text-lg leading-tight font-semibold">{r.businessName}</h2>
                    <p className="text-xs text-ink-faint">
                      {BUSINESS_LABELS[r.businessType]} · {r.country} · {r.baseCurrency} · asked {ago(r.createdAt)}
                    </p>
                  </div>
                </div>
                {r.status === "approved" ? <Badge tone="green">Approved</Badge> : r.status === "rejected" ? <Badge tone="red">Turned down</Badge> : <Badge tone="amber">Waiting</Badge>}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-paper p-3.5 text-sm ring-1 ring-line">
                  <p className="font-medium">{r.fullName}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-ink-soft">
                    <Mail className="size-3.5" /> {r.email}
                  </p>
                  {r.phone && (
                    <p className="mt-0.5 flex items-center gap-1.5 text-ink-soft">
                      <Phone className="size-3.5" /> {r.phone}
                    </p>
                  )}
                </div>
                <div className="rounded-2xl bg-gradient-to-br from-ledger-50 to-emerald-50 p-3.5 text-sm ring-1 ring-ledger-100">
                  <p className="text-xs font-semibold tracking-[0.12em] text-ledger-700 uppercase">Wants</p>
                  <p className="mt-1 font-semibold">{r.planName}</p>
                  <p className="text-ink-soft">
                    {r.currency} {money(r.price)} / {r.billingPeriod === "yearly" ? "year" : "month"}
                  </p>
                </div>
              </div>
              {r.message && (
                <p className="mt-3 flex gap-2 rounded-2xl bg-amber-soft/60 p-3 text-sm text-amber-ink">
                  <MessageSquare className="mt-0.5 size-4 shrink-0" /> {r.message}
                </p>
              )}
              {r.status === "rejected" && r.decisionNote && <p className="mt-3 text-sm text-danger">Reason: {r.decisionNote}</p>}
              {r.status !== "pending" && (
                <p className="mt-3 text-xs text-ink-faint">
                  {r.status === "approved" ? "Approved" : "Turned down"} {r.reviewedAt ? ago(r.reviewedAt) : ""} {r.reviewedBy ? `by ${r.reviewedBy}` : ""}
                </p>
              )}

              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                {r.status === "pending" && (
                  <>
                    <Button className="flex-1" onClick={() => setApproving(r)}>
                      <Check className="size-4" /> Approve
                    </Button>
                    <Button variant="secondary" onClick={() => setRejecting(r)}>
                      <X className="size-4" /> Turn down
                    </Button>
                  </>
                )}
                {r.status === "approved" && r.tenantId && (
                  <Link href={`/platform/businesses/${r.tenantId}`} className="text-sm font-medium text-ledger-700 hover:underline">
                    Open the business →
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <ApproveDialog request={approving} onClose={() => setApproving(null)} />
      <RejectDialog request={rejecting} onClose={() => setRejecting(null)} />
    </div>
  );
}

function ApproveDialog({ request, onClose }: { request: SignupRequest | null; onClose: () => void }) {
  return (
    <Dialog open={!!request} onClose={onClose} title={request ? `Approve ${request.businessName}` : ""} wide>
      {request && <ApproveForm key={request.id} request={request} onDone={onClose} />}
    </Dialog>
  );
}

/** Remounted per request (via key), so its fields start from that request's choices. */
function ApproveForm({ request, onDone }: { request: SignupRequest; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const plans = useQuery({ queryKey: ["platform", "plans"], queryFn: () => api<Plan[]>("/platform/plans", { platform: true }) });
  const [planId, setPlanId] = useState(request.planId);
  const [period, setPeriod] = useState<BillingPeriod>(request.billingPeriod);
  const [paid, setPaid] = useState(true);
  const [payment, setPayment] = useState({ amount: request.price, method: "EcoCash", reference: "" });
  const [error, setError] = useState<string | null>(null);
  const plan = plans.data?.find((p) => p.id === planId);
  const priceFor = (p: Plan | undefined, per: BillingPeriod) => (p ? (per === "yearly" ? p.yearlyPrice : p.monthlyPrice) : "");

  const approve = useMutation({
    mutationFn: () =>
      api<{ businessName: string; currentPeriodEnd: string }>(`/platform/requests/${request.id}/approve`, {
        method: "POST",
        platform: true,
        body: { planId, billingPeriod: period, payment: paid ? { amount: payment.amount, method: payment.method, reference: payment.reference || undefined } : undefined },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["platform"] });
      toast(`${r.businessName} is open, paid up to ${longDay(r.currentPeriodEnd)}`);
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
        approve.mutate();
      }}
    >
      <p className="text-sm text-ink-soft">
        This creates the business with its first store, tax rates and price lists, and {request.fullName} can sign in straight away with the password they chose.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Plan">
          {(id) => (
            <Select
              id={id}
              value={planId}
              onChange={(e) => {
                setPlanId(e.target.value);
                setPayment({ ...payment, amount: priceFor(plans.data?.find((p) => p.id === e.target.value), period) });
              }}
            >
              {plans.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.active ? "" : " (hidden)"}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Billing">
          {(id) => (
            <Select
              id={id}
              value={period}
              onChange={(e) => {
                const next = e.target.value as BillingPeriod;
                setPeriod(next);
                setPayment({ ...payment, amount: priceFor(plan, next) });
              }}
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </Select>
          )}
        </Field>
      </div>
      <Checkbox label="They've paid the first period" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
      {paid && (
        <div className="grid animate-fade-up gap-4 rounded-2xl bg-paper p-4 ring-1 ring-line sm:grid-cols-3">
          <Field label={`Amount (${plan?.currency ?? request.currency})`}>
            {(id) => <Input id={id} required inputMode="decimal" className="text-right" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} />}
          </Field>
          <Field label="Paid by">
            {(id) => (
              <Select id={id} value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value })}>
                {["EcoCash", "OneMoney", "InnBucks", "Bank transfer", "Cash", "Card"].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Reference">{(id) => <Input id={id} placeholder="Transaction ID" value={payment.reference} onChange={(e) => setPayment({ ...payment, reference: e.target.value })} />}</Field>
        </div>
      )}
      {!paid && <p className="text-xs text-ink-faint">The business opens now; record their payment later from its page. It locks if nothing is paid by the end of the first period.</p>}
      <FormError message={error} />
      <Button type="submit" busy={approve.isPending} className="h-11">
        <Check className="size-4" /> Approve and open the business
      </Button>
    </form>
  );
}

function RejectDialog({ request, onClose }: { request: SignupRequest | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reject = useMutation({
    mutationFn: () => api(`/platform/requests/${request!.id}/reject`, { method: "POST", platform: true, body: { reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform"] });
      toast(`${request!.businessName} turned down`);
      setReason("");
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={!!request} onClose={onClose} title={request ? `Turn down ${request.businessName}` : ""}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          reject.mutate();
        }}
      >
        <Field label="Reason" hint="They see this when they try to sign in.">
          {(id) => <Textarea id={id} required autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <FormError message={error} />
        <Button type="submit" variant="danger" busy={reject.isPending}>
          Turn down
        </Button>
      </form>
    </Dialog>
  );
}
