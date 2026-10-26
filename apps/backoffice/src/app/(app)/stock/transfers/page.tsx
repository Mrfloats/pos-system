"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { itemName, ItemPicker, StoreSelect, today } from "@/components/stock";
import { useToast } from "@/components/toast";
import { Button, Field, FormError, Input, PageHeader, Spinner, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, Page, StockLevel, StockMovementRow } from "@/lib/api";
import { dateTime, qty } from "@/lib/format";
import { STOCK_WRITERS, useSession } from "@/lib/session";

interface Line {
  item: StockLevel;
  quantity: string;
}

export default function TransfersPage() {
  const { storeId: current, stores, can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const active = stores.filter((s) => s.active);
  const [fromStoreId, setFrom] = useState(current ?? "");
  const [toStoreId, setTo] = useState(() => active.find((s) => s.id !== current)?.id ?? "");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recent = useQuery({
    queryKey: ["inventory", "transfers"],
    queryFn: () => api<Page<StockMovementRow>>("/inventory/reports/ledger", { query: { type: "transfer_out", from: "2000-01-01", to: today(), pageSize: 15 } }),
  });

  const save = useMutation({
    mutationFn: () =>
      api<{ reference: string }>("/inventory/transfers", {
        method: "POST",
        body: {
          fromStoreId,
          toStoreId,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
          lines: lines.map((l) => ({ variantId: l.item.variantId, quantity: l.quantity })),
        },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast(`Transfer ${r.reference} done`);
      setLines([]);
      setReference("");
      setNote("");
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!can(...STOCK_WRITERS)) return <p className="text-sm text-ink-soft">Only managers and stock clerks can move stock.</p>;
  if (active.length < 2) {
    return (
      <div>
        <PageHeader title="Stock transfers" />
        <div className="card px-6 py-14 text-center text-sm text-ink-faint">Add a second store or warehouse in Settings to move stock between them.</div>
      </div>
    );
  }

  const fromName = stores.find((s) => s.id === fromStoreId)?.name;
  const toName = stores.find((s) => s.id === toStoreId)?.name;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Stock transfers" description="Move stock from one store or warehouse to another. Both sides are recorded in the stock ledger together." />

      <form
        className="card overflow-visible"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <div className="grid items-end gap-4 border-b border-line/70 p-6 md:grid-cols-[1fr_auto_1fr]">
          <Field label="From">
            {(id) => (
              <StoreSelect
                id={id}
                value={fromStoreId}
                onChange={(v) => {
                  if (lines.length && !confirm("Change the store you're sending from? The items listed will be cleared.")) return;
                  setLines([]);
                  setFrom(v);
                }}
              />
            )}
          </Field>
          <span className="hidden size-10 items-center justify-center rounded-full bg-ledger-50 text-ledger-700 md:flex">
            <ArrowRight className="size-5" aria-hidden />
          </span>
          <Field label="To">{(id) => <StoreSelect id={id} value={toStoreId} onChange={setTo} />}</Field>
          <Field label="Reference" hint="Leave empty for an automatic number.">
            {(id) => <Input id={id} value={reference} onChange={(e) => setReference(e.target.value)} />}
          </Field>
          <span className="hidden md:block" />
          <Field label="Note">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
        <div className="p-6 pb-3">
          <ItemPicker
            storeId={fromStoreId}
            placeholder={`Add items from ${fromName ?? "the store"}…`}
            onPick={(item) => {
              if (lines.some((l) => l.item.variantId === item.variantId)) return toast(`${itemName(item)} is already listed`, "error");
              setLines([...lines, { item, quantity: "" }]);
            }}
          />
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th align="right">In {fromName}</Th>
              <Th align="right">Send</Th>
              <Th align="right" className="hidden sm:table-cell">
                Left after
              </Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <TableMessage colSpan={5}>Search above to add items to send.</TableMessage>}
            {lines.map((l, i) => {
              const left = Number(l.item.onHand) - (Number(l.quantity) || 0);
              return (
                <tr key={l.item.variantId}>
                  <Td className="font-medium">{itemName(l.item)}</Td>
                  <Td align="right" className="text-ink-soft tabular-nums">
                    {qty(l.item.onHand)}
                  </Td>
                  <Td align="right">
                    <Input
                      aria-label={`Quantity of ${itemName(l.item)} to send`}
                      required
                      autoFocus={i === lines.length - 1}
                      inputMode="decimal"
                      pattern="\d+(\.\d{1,3})?"
                      className="ml-auto w-28 text-right"
                      value={l.quantity}
                      onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                    />
                  </Td>
                  <Td align="right" className={`hidden tabular-nums sm:table-cell ${left < 0 ? "font-medium text-danger" : "text-ink-soft"}`}>
                    {qty(left)}
                  </Td>
                  <Td align="right">
                    <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-ink-faint hover:bg-danger-soft hover:text-danger" aria-label={`Remove ${itemName(l.item)}`}>
                      <Trash2 className="size-4" />
                    </button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/70 p-6">
          <div className="min-w-0 flex-1">
            <FormError message={fromStoreId === toStoreId ? "Choose two different stores." : error} />
          </div>
          <Button type="submit" busy={save.isPending} disabled={!lines.length || fromStoreId === toStoreId}>
            Send to {toName}
          </Button>
        </div>
      </form>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line/70 px-6 py-4 text-base font-semibold">Recent transfers</h2>
        {recent.isLoading ? (
          <div className="px-6">
            <Spinner />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Reference</Th>
                <Th>Item</Th>
                <Th>From</Th>
                <Th align="right">Qty</Th>
              </tr>
            </thead>
            <tbody>
              {!recent.data?.items.length && <TableMessage colSpan={5}>No transfers yet.</TableMessage>}
              {recent.data?.items.map((m) => (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap text-ink-soft">{dateTime(m.createdAt)}</Td>
                  <Td className="font-mono text-xs">{m.reference}</Td>
                  <Td className="font-medium">{itemName(m)}</Td>
                  <Td className="text-ink-soft">{m.storeName}</Td>
                  <Td align="right" className="tabular-nums">
                    {qty(-Number(m.quantity))}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
