"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, PackageMinus, PackagePlus, SlidersHorizontal, Trash2, Warehouse } from "lucide-react";
import { useState } from "react";
import { itemName, ItemPicker, MovementBadge, StoreSelect, today } from "@/components/stock";
import { useToast } from "@/components/toast";
import { Button, Field, FormError, Input, PageHeader, Spinner, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, Page, StockLevel, StockMovementRow } from "@/lib/api";
import { dateTime, money, qty } from "@/lib/format";
import { STOCK_WRITERS, useSession } from "@/lib/session";

type Kind = "receive" | "opening" | "count" | "adjustment" | "waste";

const KINDS: { id: Kind; label: string; hint: string; icon: React.ComponentType<{ className?: string }>; qtyLabel: string }[] = [
  { id: "receive", label: "Receive goods", hint: "A delivery from a supplier. Adds to stock.", icon: PackagePlus, qtyLabel: "Received" },
  { id: "count", label: "Stock count", hint: "Enter what's on the shelf; the difference is adjusted.", icon: ClipboardCheck, qtyLabel: "Counted" },
  { id: "adjustment", label: "Adjust", hint: "Add or remove stock. Use a minus to remove.", icon: SlidersHorizontal, qtyLabel: "Change (+/−)" },
  { id: "waste", label: "Write off", hint: "Damaged, expired or spoiled. Takes it off stock.", icon: PackageMinus, qtyLabel: "Written off" },
  { id: "opening", label: "Opening stock", hint: "What you had when you started using the system.", icon: Warehouse, qtyLabel: "Opening qty" },
];

interface Line {
  item: StockLevel;
  quantity: string;
  unitCost: string;
}

export default function AdjustmentsPage() {
  const { storeId: current, can, stores } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [storeId, setStoreId] = useState(current ?? "");
  const [kind, setKind] = useState<Kind>("receive");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per submission, so a retried request never counts stock twice.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const meta = KINDS.find((k) => k.id === kind)!;
  const withCost = kind === "receive" || kind === "opening";

  const recent = useQuery({
    queryKey: ["inventory", "recent", storeId],
    queryFn: () => api<Page<StockMovementRow>>("/inventory/reports/ledger", { query: { storeId, from: "2000-01-01", to: today(), pageSize: 12 } }),
    enabled: !!storeId,
  });

  const save = useMutation({
    mutationFn: () => {
      if (kind === "count") {
        return api("/inventory/stock-takes", {
          method: "POST",
          body: { storeId, reference: reference.trim() || undefined, lines: lines.map((l) => ({ variantId: l.item.variantId, countedQuantity: l.quantity })) },
        });
      }
      return api("/inventory/movements", {
        method: "POST",
        body: {
          storeId,
          type: kind,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
          lines: lines.map((l, i) => ({
            variantId: l.item.variantId,
            quantity: l.quantity,
            unitCost: withCost && l.unitCost ? l.unitCost : undefined,
            clientId: uuidFor(requestId, i),
          })),
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast(`${meta.label} saved for ${lines.length} item${lines.length === 1 ? "" : "s"}`);
      setLines([]);
      setReference("");
      setNote("");
      setRequestId(crypto.randomUUID());
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!can(...STOCK_WRITERS)) return <p className="text-sm text-ink-soft">Only managers and stock clerks can change stock.</p>;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Stock adjustment" description="Receive deliveries, count shelves, adjust or write off stock. Everything is recorded in the stock ledger and valued into your accounts." />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5" role="radiogroup" aria-label="What are you doing?">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={kind === k.id}
            onClick={() => setKind(k.id)}
            className={`card flex flex-col items-start gap-2 p-4 text-left transition-all ${kind === k.id ? "ring-2 ring-ledger-600" : "hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]"}`}
          >
            <span className={`flex size-9 items-center justify-center rounded-xl ${kind === k.id ? "bg-gradient-to-br from-emerald-400 to-ledger-600 text-white" : "bg-paper text-ink-soft"}`}>
              <k.icon className="size-5" />
            </span>
            <span className="text-sm font-semibold">{k.label}</span>
            <span className="text-xs text-ink-faint">{k.hint}</span>
          </button>
        ))}
      </div>

      <form
        className="card overflow-visible"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <div className="grid gap-4 border-b border-line/70 p-6 sm:grid-cols-3">
          <Field label="Store">
            {(id) => (
              <StoreSelect
                id={id}
                value={storeId}
                onChange={(v) => {
                  if (lines.length && !confirm("Change store? The items listed will be cleared.")) return;
                  setLines([]);
                  setStoreId(v);
                }}
              />
            )}
          </Field>
          <Field label="Reference" hint={kind === "receive" ? "Delivery note or supplier invoice number." : undefined}>
            {(id) => <Input id={id} value={reference} onChange={(e) => setReference(e.target.value)} />}
          </Field>
          {kind !== "count" && <Field label="Note">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>}
        </div>

        <div className="p-6 pb-3">
          <ItemPicker
            storeId={storeId}
            onPick={(item) => {
              if (lines.some((l) => l.item.variantId === item.variantId)) return toast(`${itemName(item)} is already listed`, "error");
              setLines([...lines, { item, quantity: "", unitCost: item.costPrice ?? "" }]);
            }}
          />
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th align="right">On hand</Th>
              <Th align="right">{meta.qtyLabel}</Th>
              {withCost && <Th align="right">Cost each</Th>}
              {kind === "count" && <Th align="right">Difference</Th>}
              <Th />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <TableMessage colSpan={6}>Search above to add items.</TableMessage>}
            {lines.map((l, i) => {
              const diff = kind === "count" && l.quantity !== "" ? Number(l.quantity) - Number(l.item.onHand) : null;
              const set = (patch: Partial<Line>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <tr key={l.item.variantId}>
                  <Td>
                    <span className="font-medium">{itemName(l.item)}</span>
                    {l.item.sku && <span className="block font-mono text-xs text-ink-faint uppercase">{l.item.sku}</span>}
                  </Td>
                  <Td align="right" className="text-ink-soft tabular-nums">
                    {qty(l.item.onHand)}
                  </Td>
                  <Td align="right">
                    <Input
                      aria-label={`${meta.qtyLabel} for ${itemName(l.item)}`}
                      required
                      autoFocus={i === lines.length - 1}
                      inputMode="decimal"
                      pattern={kind === "adjustment" ? "-?\\d+(\\.\\d{1,3})?" : "\\d+(\\.\\d{1,3})?"}
                      className="ml-auto w-28 text-right"
                      value={l.quantity}
                      onChange={(e) => set({ quantity: e.target.value })}
                    />
                  </Td>
                  {withCost && (
                    <Td align="right">
                      <Input aria-label={`Cost of ${itemName(l.item)}`} inputMode="decimal" pattern="\d+(\.\d{1,2})?" placeholder="0.00" className="ml-auto w-28 text-right" value={l.unitCost} onChange={(e) => set({ unitCost: e.target.value })} />
                    </Td>
                  )}
                  {kind === "count" && (
                    <Td align="right" className={`font-medium tabular-nums ${diff === null || diff === 0 ? "text-ink-faint" : diff < 0 ? "text-danger" : "text-ledger-700"}`}>
                      {diff === null ? "—" : `${diff > 0 ? "+" : ""}${qty(diff)}`}
                    </Td>
                  )}
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
            <FormError message={error} />
          </div>
          {withCost && lines.length > 0 && (
            <span className="text-sm text-ink-soft">
              Value <span className="font-semibold text-ink tabular-nums">{money(lines.reduce((t, l) => t + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0))}</span>
            </span>
          )}
          <Button type="submit" busy={save.isPending} disabled={!lines.length}>
            Save {meta.label.toLowerCase()}
          </Button>
        </div>
      </form>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line/70 px-6 py-4 text-base font-semibold">Latest movements in {stores.find((s) => s.id === storeId)?.name}</h2>
        {recent.isLoading ? (
          <div className="px-6">
            <Spinner />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Item</Th>
                <Th>Type</Th>
                <Th align="right">Qty</Th>
                <Th className="hidden md:table-cell">Reference</Th>
              </tr>
            </thead>
            <tbody>
              {!recent.data?.items.length && <TableMessage colSpan={5}>No movements yet.</TableMessage>}
              {recent.data?.items.map((m) => (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap text-ink-soft">{dateTime(m.createdAt)}</Td>
                  <Td className="font-medium">{itemName(m)}</Td>
                  <Td>
                    <MovementBadge type={m.type} />
                  </Td>
                  <Td align="right" className={`font-medium tabular-nums ${Number(m.quantity) < 0 ? "text-danger" : "text-ledger-700"}`}>
                    {Number(m.quantity) > 0 ? "+" : ""}
                    {qty(m.quantity)}
                  </Td>
                  <Td className="hidden text-ink-soft md:table-cell">{m.reference ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}

/** A stable per-line id derived from the submission id (same line, same retry → same key). */
function uuidFor(base: string, index: number) {
  const hex = (parseInt(base.slice(-4), 16) + index) % 0x10000;
  return `${base.slice(0, -4)}${hex.toString(16).padStart(4, "0")}`;
}
