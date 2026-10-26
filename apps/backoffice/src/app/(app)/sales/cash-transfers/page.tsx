"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus } from "lucide-react";
import { useState } from "react";
import { AccountSelect, MoneyInput, useChart, useCurrencies } from "@/components/accounts";
import { StoreSelect } from "@/components/stock";
import { useToast } from "@/components/toast";
import { Button, Dialog, Field, FormError, Input, PageHeader, Pager, Select, Spinner, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, CashTransfer, Page, Shift } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { MANAGERS, useSession } from "@/lib/session";

export default function CashTransfersPage() {
  const { can } = useSession();
  const [storeId, setStoreId] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const list = useQuery({
    queryKey: ["cash-transfers", { storeId, page }],
    queryFn: () => api<Page<CashTransfer>>("/cash-transfers", { query: { storeId, page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader
        title="Cash transfers"
        description="Cash taken out of a store's till: banked, sent to head office, or moved to another store. Banked cash moves from Cash on hand to that account in the books."
        actions={
          can(...MANAGERS) && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden /> New transfer
            </Button>
          )
        }
      />
      <div className="mb-4 max-w-xs">
        <StoreSelect aria-label="Store" allowAll value={storeId} onChange={(v) => (setStoreId(v), setPage(1))} />
      </div>
      <div className="card overflow-hidden">
        {list.isLoading ? (
          <div className="px-6">
            <Spinner />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>When</Th>
                <Th>From</Th>
                <Th>To</Th>
                <Th align="right">Amount</Th>
                <Th className="hidden lg:table-cell">Reference</Th>
                <Th className="hidden lg:table-cell">By</Th>
              </tr>
            </thead>
            <tbody>
              {!list.data?.items.length && <TableMessage colSpan={7}>No cash transfers yet.</TableMessage>}
              {list.data?.items.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium">{t.number}</Td>
                  <Td className="whitespace-nowrap text-ink-soft">{dateTime(t.createdAt)}</Td>
                  <Td>{t.fromStore}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <ArrowRight className="size-3.5 text-ink-faint" aria-hidden />
                      {t.toAccount ?? t.toStore}
                    </span>
                  </Td>
                  <Td align="right" className="font-semibold whitespace-nowrap tabular-nums">
                    {t.currencyCode} {money(t.amount)}
                  </Td>
                  <Td className="hidden text-ink-soft lg:table-cell">{t.reference ?? t.note ?? "—"}</Td>
                  <Td className="hidden text-ink-soft lg:table-cell">{t.createdByName ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.data && <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      </div>
      <TransferDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function TransferDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { storeId: current, session } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const chart = useChart();
  const currencies = useCurrencies();
  const [form, setForm] = useState({ storeId: current ?? "", to: "account", toAccountId: "", toStoreId: "", currencyCode: session.tenant.baseCurrency, amount: "", reference: "", note: "", shiftId: "" });
  const [error, setError] = useState<string | null>(null);
  const banks = (chart.data ?? []).filter((a) => a.isBank && a.active && a.systemKey !== "cash");
  const shifts = useQuery({
    queryKey: ["shifts", "open", form.storeId],
    queryFn: () => api<Page<Shift>>("/shifts", { query: { storeId: form.storeId, state: "open", pageSize: 20 } }),
    enabled: open && !!form.storeId,
  });

  const save = useMutation({
    mutationFn: () =>
      api<CashTransfer>("/cash-transfers", {
        method: "POST",
        body: {
          storeId: form.storeId,
          toAccountId: form.to === "account" ? form.toAccountId : undefined,
          toStoreId: form.to === "store" ? form.toStoreId : undefined,
          currencyCode: form.currencyCode,
          amount: form.amount,
          reference: form.reference.trim() || undefined,
          note: form.note.trim() || undefined,
          shiftId: form.shiftId || undefined,
        },
      }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["cash-transfers"] });
      qc.invalidateQueries({ queryKey: ["shifts"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast(`Transfer ${t.number} recorded`);
      setForm({ ...form, amount: "", reference: "", note: "" });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onClose={onClose} title="Take cash out of a till">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <Field label="From store">{(id) => <StoreSelect id={id} value={form.storeId} onChange={(v) => setForm({ ...form, storeId: v, shiftId: "" })} />}</Field>
        <div className="flex gap-2" role="radiogroup" aria-label="Where to">
          {[
            ["account", "Into an account (bank…)"],
            ["store", "To another store"],
          ].map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={form.to === v}
              onClick={() => setForm({ ...form, to: v })}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${form.to === v ? "border-ledger-600 bg-ledger-50 text-ledger-800" : "border-line text-ink-soft hover:bg-paper"}`}
            >
              {l}
            </button>
          ))}
        </div>
        {form.to === "account" ? (
          <Field label="Into">{(id) => <AccountSelect id={id} required accounts={banks} value={form.toAccountId} onChange={(v) => setForm({ ...form, toAccountId: v })} />}</Field>
        ) : (
          <Field label="To store">{(id) => <StoreSelect id={id} value={form.toStoreId} onChange={(v) => setForm({ ...form, toStoreId: v })} />}</Field>
        )}
        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <Field label="Currency">
            {(id) => (
              <Select id={id} value={form.currencyCode} onChange={(e) => setForm({ ...form, currencyCode: e.target.value })}>
                {currencies.data
                  ?.filter((c) => c.active)
                  .map((c) => (
                    <option key={c.code}>{c.code}</option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Amount">{(id) => <MoneyInput id={id} required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />}</Field>
        </div>
        {!!shifts.data?.items.length && (
          <Field label="From shift" hint="Counts against that shift's cash-up.">
            {(id) => (
              <Select id={id} value={form.shiftId} onChange={(e) => setForm({ ...form, shiftId: e.target.value })}>
                <option value="">Not from a shift</option>
                {shifts.data.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.number} · {s.cashier}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Reference" hint="Deposit slip number, for example.">
          {(id) => <Input id={id} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />}
        </Field>
        <FormError message={error} />
        <Button type="submit" busy={save.isPending}>
          Record transfer
        </Button>
      </form>
    </Dialog>
  );
}
