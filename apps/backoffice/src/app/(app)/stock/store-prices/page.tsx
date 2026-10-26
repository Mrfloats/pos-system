"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { MoneyInput } from "@/components/accounts";
import { itemName, StoreSelect } from "@/components/stock";
import { useToast } from "@/components/toast";
import { Button, Field, Input, PageHeader, Pager, Spinner, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, Page, StorePriceRow } from "@/lib/api";
import { money } from "@/lib/format";
import { MANAGERS, useSession } from "@/lib/session";

export default function StorePricesPage() {
  const { storeId: currentStore, can, stores } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [storeId, setStoreId] = useState(currentStore ?? "");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  // Edits not yet saved: variantId → new price ("" clears the store price).
  const [edits, setEdits] = useState<Record<string, string>>({});
  const canEdit = can(...MANAGERS);
  const storeName = stores.find((s) => s.id === storeId)?.name;

  useEffect(() => {
    const t = setTimeout(() => (setDebounced(search.trim()), setPage(1)), 250);
    return () => clearTimeout(t);
  }, [search]);

  const rows = useQuery({
    queryKey: ["store-prices", storeId, { debounced, page }],
    queryFn: () => api<Page<StorePriceRow>>("/store-prices", { query: { storeId, search: debounced, page, pageSize: 50 } }),
    enabled: !!storeId,
    placeholderData: keepPreviousData,
  });

  const save = useMutation({
    mutationFn: () =>
      api("/store-prices", {
        method: "PUT",
        body: { storeId, items: Object.entries(edits).map(([variantId, price]) => ({ variantId, price: price.trim() ? price.trim() : null })) },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store-prices"] });
      toast(`Prices saved for ${storeName}`);
      setEdits({});
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const changed = Object.keys(edits).length;

  return (
    <div>
      <PageHeader
        title="Store prices"
        description="Sell an item at a different price in one store. Leave the store price empty to use the normal price."
        actions={
          canEdit && (
            <Button disabled={!changed} busy={save.isPending} onClick={() => save.mutate()}>
              Save {changed ? `${changed} change${changed === 1 ? "" : "s"}` : "changes"}
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Store">
          {(id) => (
            <StoreSelect
              id={id}
              className="w-60"
              value={storeId}
              onChange={(v) => {
                if (changed && !confirm("Switch store and drop your unsaved changes?")) return;
                setEdits({});
                setStoreId(v);
                setPage(1);
              }}
            />
          )}
        </Field>
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-3 left-3.5 size-4 text-ink-faint" aria-hidden />
          <Input aria-label="Search items" placeholder="Search by name or code" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
      </div>
      <div className="card overflow-hidden">
        {rows.isLoading ? (
          <div className="px-6">
            <Spinner />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="hidden md:table-cell">Code</Th>
                <Th>Item</Th>
                <Th align="right">Normal price</Th>
                <Th align="right">Price in {storeName ?? "this store"}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.data?.items.length === 0 && <TableMessage colSpan={4}>No items match.</TableMessage>}
              {rows.data?.items.map((r) => {
                const value = edits[r.variantId] ?? r.storePrice ?? "";
                const dirty = r.variantId in edits;
                return (
                  <tr key={r.variantId}>
                    <Td className="hidden font-mono text-xs text-ink-soft uppercase md:table-cell">{r.sku ?? "—"}</Td>
                    <Td className="font-medium">{itemName(r)}</Td>
                    <Td align="right" className="text-ink-soft tabular-nums">
                      {money(r.price)}
                    </Td>
                    <Td align="right">
                      {canEdit ? (
                        <MoneyInput
                          aria-label={`Price of ${itemName(r)} in ${storeName}`}
                          placeholder={money(r.price)}
                          className={`ml-auto w-32 ${dirty ? "border-amber bg-amber-soft/40" : ""}`}
                          value={value}
                          onChange={(e) => {
                            const v = e.target.value;
                            setEdits((cur) => {
                              const next = { ...cur };
                              if (v === (r.storePrice ?? "")) delete next[r.variantId];
                              else next[r.variantId] = v;
                              return next;
                            });
                          }}
                        />
                      ) : (
                        <span className="font-medium tabular-nums">{r.storePrice ? money(r.storePrice) : "—"}</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {rows.data && <Pager page={page} pageSize={rows.data.pageSize} total={rows.data.total} onPage={setPage} />}
      </div>
    </div>
  );
}
