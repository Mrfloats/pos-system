"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { MoneyInput } from "@/components/accounts";
import { itemName, ItemPicker } from "@/components/stock";
import { useToast } from "@/components/toast";
import { Badge, Button, Checkbox, Dialog, Field, FormError, Input, PageHeader, Select, Spinner, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, Currency, PriceList, PriceListItem } from "@/lib/api";
import { money, qty } from "@/lib/format";
import { MANAGERS, useSession } from "@/lib/session";

export default function PriceListsPage() {
  const { can, session } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const lists = useQuery({ queryKey: ["price-lists"], queryFn: () => api<PriceList[]>("/price-lists") });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: () => api<Currency[]>("/currencies") });
  const [chosen, setChosen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<PriceList> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = can(...MANAGERS);
  const selected = lists.data?.find((l) => l.id === chosen) ?? lists.data?.[0];

  const saveList = useMutation({
    mutationFn: (l: Partial<PriceList>) => {
      const body = { name: l.name?.trim(), currencyCode: l.currencyCode, isDefault: l.isDefault, active: l.active };
      return l.id ? api<PriceList>(`/price-lists/${l.id}`, { method: "PATCH", body }) : api<PriceList>("/price-lists", { method: "POST", body });
    },
    onSuccess: (l) => {
      qc.invalidateQueries({ queryKey: ["price-lists"] });
      toast("Price list saved");
      setChosen(l.id);
      setEditing(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Pricelists"
        description="Prices for groups of customers, like wholesale, with optional quantity breaks (buy 10 or more, pay less). Link a customer to a list on their record."
        actions={
          canEdit && (
            <Button onClick={() => (setError(null), setEditing({ name: "", currencyCode: session.tenant.baseCurrency, isDefault: false, active: true }))}>
              <Plus className="size-4" aria-hidden /> New pricelist
            </Button>
          )
        }
      />
      {lists.isLoading ? (
        <Spinner />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <ul className="flex gap-2 overflow-x-auto lg:flex-col">
            {lists.data?.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => setChosen(l.id)}
                  className={`w-full min-w-44 rounded-2xl border px-4 py-3 text-left transition-all ${
                    selected?.id === l.id ? "border-ledger-600 bg-surface shadow-[var(--shadow-card)]" : "border-transparent hover:bg-surface/70"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{l.name}</span>
                    {l.isDefault && <Badge tone="green">Default</Badge>}
                  </span>
                  <span className="text-xs text-ink-faint">
                    {l.currencyCode}
                    {!l.active && " · switched off"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected && <ListItems key={selected.id} list={selected} canEdit={canEdit} onEdit={() => (setError(null), setEditing(selected))} />}
        </div>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.name}` : "New pricelist"}>
        {editing && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              saveList.mutate(editing);
            }}
          >
            <Field label="Name">{(id) => <Input id={id} required autoFocus placeholder="Wholesale" value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />}</Field>
            <Field label="Currency">
              {(id) => (
                <Select id={id} value={editing.currencyCode} onChange={(e) => setEditing({ ...editing, currencyCode: e.target.value })}>
                  {currencies.data?.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Checkbox label="Default list for new customers" checked={!!editing.isDefault} onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })} />
            {editing.id && <Checkbox label="In use" checked={editing.active !== false} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />}
            <FormError message={error} />
            <Button type="submit" busy={saveList.isPending}>
              Save pricelist
            </Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}

function ListItems({ list, canEdit, onEdit }: { list: PriceList; canEdit: boolean; onEdit: () => void }) {
  const { storeId } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const items = useQuery({ queryKey: ["price-lists", list.id, "items"], queryFn: () => api<PriceListItem[]>(`/price-lists/${list.id}/items`) });
  const [draft, setDraft] = useState<{ variantId: string; name: string; basePrice: string; minQuantity: string; price: string } | null>(null);

  const put = useMutation({
    mutationFn: (body: { items: { variantId: string; minQuantity: string; price: string }[]; removeVariantIds?: string[] }) =>
      api(`/price-lists/${list.id}/items`, { method: "PUT", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["price-lists", list.id, "items"] });
      toast("Prices saved");
      setDraft(null);
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  /** The API replaces every break for a variant, so send all of that variant's breaks together. */
  const breaksFor = (variantId: string) =>
    (items.data ?? []).filter((i) => i.variantId === variantId).map((i) => ({ variantId, minQuantity: i.minQuantity, price: i.price }));

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold">{list.name}</h2>
          <p className="text-sm text-ink-soft">Items not listed here sell at their normal price.</p>
        </div>
        {canEdit && (
          <Button variant="secondary" onClick={onEdit}>
            Edit list
          </Button>
        )}
      </div>
      {canEdit && (
        <div className="border-b border-line/70 bg-paper/40 px-6 py-4">
          {!draft ? (
            <ItemPicker
              storeId={storeId}
              placeholder="Add an item to this list…"
              onPick={(i) => setDraft({ variantId: i.variantId, name: itemName(i), basePrice: i.price, minQuantity: "1", price: i.price })}
            />
          ) : (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                put.mutate({ items: [...breaksFor(draft.variantId).filter((b) => Number(b.minQuantity) !== Number(draft.minQuantity)), { variantId: draft.variantId, minQuantity: draft.minQuantity, price: draft.price }] });
              }}
            >
              <div className="min-w-48 flex-1">
                <p className="text-sm font-medium">{draft.name}</p>
                <p className="text-xs text-ink-faint">Normal price {money(draft.basePrice)}</p>
              </div>
              <Field label="From quantity">{(id) => <Input id={id} required inputMode="decimal" className="w-28 text-right" value={draft.minQuantity} onChange={(e) => setDraft({ ...draft, minQuantity: e.target.value })} />}</Field>
              <Field label={`Price (${list.currencyCode})`}>{(id) => <MoneyInput id={id} required className="w-32" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />}</Field>
              <Button type="submit" busy={put.isPending}>
                Save price
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </form>
          )}
        </div>
      )}
      {items.isLoading ? (
        <div className="px-6">
          <Spinner />
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th align="right">From qty</Th>
              <Th align="right" className="hidden sm:table-cell">
                Normal price
              </Th>
              <Th align="right">List price</Th>
              {canEdit && <Th />}
            </tr>
          </thead>
          <tbody>
            {!items.data?.length && <TableMessage colSpan={5}>No special prices on this list yet.</TableMessage>}
            {items.data?.map((i) => {
              const saving = Number(i.basePrice) - Number(i.price);
              return (
                <tr key={i.id}>
                  <Td>
                    <span className="font-medium">{itemName(i)}</span>
                    {i.sku && <span className="block font-mono text-xs text-ink-faint uppercase">{i.sku}</span>}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {qty(i.minQuantity)}+
                  </Td>
                  <Td align="right" className="hidden text-ink-soft tabular-nums sm:table-cell">
                    {money(i.basePrice)}
                  </Td>
                  <Td align="right" className="font-medium tabular-nums">
                    {money(i.price)}
                    {saving > 0 && <span className="block text-xs font-normal text-ledger-700">{money(saving)} off</span>}
                  </Td>
                  {canEdit && (
                    <Td align="right">
                      <button
                        type="button"
                        aria-label={`Remove ${itemName(i)} from ${qty(i.minQuantity)}`}
                        className="rounded-lg p-1.5 text-ink-faint hover:bg-danger-soft hover:text-danger"
                        onClick={() => {
                          const rest = breaksFor(i.variantId).filter((b) => b.minQuantity !== i.minQuantity);
                          put.mutate(rest.length ? { items: rest } : { items: [], removeVariantIds: [i.variantId] });
                        }}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </section>
  );
}
