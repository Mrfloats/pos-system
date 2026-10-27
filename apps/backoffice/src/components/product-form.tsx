"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Button, Checkbox, Field, FormError, Input, Section, Select, Textarea } from "@/components/ui";
import { api, Category, ModifierGroup, PriceList, Product, ProductKind, TaxRate, Unit } from "@/lib/api";
import { MANAGERS, useSession } from "@/lib/session";

interface PackForm {
  id?: string;
  name: string;
  quantity: string;
  barcode: string;
  price: string;
  /** Price of one pack on each extra price list (Wholesale…), by list id. */
  listPrices: Record<string, string>;
}
interface VariantForm {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  price: string;
  costPrice: string;
  reorderLevel: string;
  packagings: PackForm[];
  /** Price from 1 unit on each extra price list (Wholesale…), by list id. Empty: the normal price. */
  listPrices: Record<string, string>;
}

const emptyVariant = (): VariantForm => ({
  name: "",
  sku: "",
  barcode: "",
  price: "",
  costPrice: "",
  reorderLevel: "",
  packagings: [],
  listPrices: {},
});

const KINDS: { value: ProductKind; label: string; hint: string }[] = [
  { value: "standard", label: "Stocked item", hint: "Goods you buy in and count on the shelf" },
  { value: "service", label: "Service", hint: "No stock, e.g. delivery or labour" },
  { value: "menu_item", label: "Menu item", hint: "A dish or drink made in the kitchen or bar" },
  { value: "bundle", label: "Bundle", hint: "Several items sold together" },
];

/** Pack row columns: name, units, barcode, the retail price, one price per extra price list, remove. */
const PACK_COLUMNS: Record<number, string> = {
  0: "sm:grid-cols-[2fr_1fr_2fr_1fr_auto]",
  1: "sm:grid-cols-[2fr_1fr_2fr_1fr_1fr_auto]",
  2: "sm:grid-cols-[2fr_1fr_2fr_1fr_1fr_1fr_auto]",
};

const blank = (s: string) => (s.trim() === "" ? undefined : s.trim());

export function ProductForm({ product }: { product?: Product }) {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { session, can } = useSession();
  const editable = can(...MANAGERS);
  const isRestaurant = session.tenant.businessType === "restaurant";
  const isWholesale = session.tenant.businessType === "wholesale" || session.tenant.businessType === "mixed";

  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/categories") });
  const taxRates = useQuery({ queryKey: ["tax-rates"], queryFn: () => api<TaxRate[]>("/tax-rates") });
  const units = useQuery({ queryKey: ["units"], queryFn: () => api<Unit[]>("/units") });
  const modifierGroups = useQuery({ queryKey: ["modifier-groups"], queryFn: () => api<ModifierGroup[]>("/modifier-groups") });
  const priceLists = useQuery({ queryKey: ["price-lists"], queryFn: () => api<PriceList[]>("/price-lists") });
  // The normal price is the default list (Retail); every other list gets its own price field.
  const retailList = priceLists.data?.find((l) => l.isDefault);
  const extraLists = priceLists.data?.filter((l) => l.active && !l.isDefault) ?? [];

  const [form, setForm] = useState({
    name: product?.name ?? "",
    description: product?.description ?? "",
    kind: product?.kind ?? ((isRestaurant ? "menu_item" : "standard") as ProductKind),
    categoryId: product?.categoryId ?? "",
    taxRateId: product?.taxRateId ?? "",
    unitId: product?.unitId ?? "",
    trackStock: product?.trackStock ?? !isRestaurant,
    soldByWeight: product?.soldByWeight ?? false,
    kitchenStation: product?.kitchenStation ?? "",
    modifierGroupIds: product?.modifierGroups?.map((g) => g.id) ?? [],
  });
  const [variants, setVariants] = useState<VariantForm[]>(
    product
      ? product.variants
          .filter((v) => v.active)
          .map((v) => ({
            id: v.id,
            name: v.name === "Default" ? "" : v.name,
            sku: v.sku ?? "",
            barcode: v.barcode ?? "",
            price: v.price,
            costPrice: v.costPrice ?? "",
            reorderLevel: v.reorderLevel ? String(Number(v.reorderLevel)) : "",
            packagings: (v.packagings ?? []).map((p) => ({
              id: p.id,
              name: p.name,
              quantity: String(Number(p.quantity)),
              barcode: p.barcode ?? "",
              price: p.price ?? "",
              listPrices: Object.fromEntries((p.listPrices ?? []).filter((l) => Number(l.minQuantity) === 1).map((l) => [l.priceListId, l.price])),
            })),
            listPrices: Object.fromEntries((v.listPrices ?? []).filter((l) => Number(l.minQuantity) === 1).map((l) => [l.priceListId, l.price])),
          }))
      : [emptyVariant()],
  );
  const [error, setError] = useState<string | null>(null);

  const setVariant = (i: number, patch: Partial<VariantForm>) =>
    setVariants((vs) => vs.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  const setPack = (vi: number, pi: number, patch: Partial<PackForm>) =>
    setVariant(vi, { packagings: variants[vi].packagings.map((p, idx) => (idx === pi ? { ...p, ...patch } : p)) });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        description: blank(form.description),
        kind: form.kind,
        categoryId: form.categoryId || (product ? null : undefined),
        taxRateId: form.taxRateId || (product ? null : undefined),
        unitId: form.unitId || (product ? null : undefined),
        trackStock: form.kind === "standard" ? form.trackStock : false,
        soldByWeight: form.soldByWeight,
        kitchenStation: blank(form.kitchenStation),
        modifierGroupIds: form.modifierGroupIds,
        variants: variants.map((v) => ({
          id: v.id,
          name: blank(v.name) ?? "Default",
          sku: blank(v.sku),
          barcode: blank(v.barcode),
          price: v.price.trim(),
          costPrice: blank(v.costPrice),
          reorderLevel: blank(v.reorderLevel),
          // Empty takes the item off that list (back to the normal price); its quantity breaks stay.
          listPrices: extraLists.map((l) => ({ priceListId: l.id, price: blank(v.listPrices[l.id] ?? "") ?? null })),
          packagings: v.packagings.map((p) => ({
            name: p.name.trim(),
            quantity: p.quantity.trim(),
            barcode: blank(p.barcode),
            price: blank(p.price),
            listPrices: extraLists.map((l) => ({ priceListId: l.id, price: blank(p.listPrices[l.id] ?? "") ?? null })),
          })),
        })),
      };
      return product
        ? api<Product>(`/products/${product.id}`, { method: "PATCH", body })
        : api<Product>("/products", { method: "POST", body });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product", saved.id] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      toast(product ? "Product saved" : "Product added");
      router.push("/stock/products");
    },
    onError: (err: Error) => setError(err.message),
  });

  const archive = useMutation({
    mutationFn: () => api(`/products/${product!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast("Product archived");
      router.push("/stock/products");
    },
    onError: (err: Error) => toast(err.message, "error"),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
      className="flex flex-col gap-6"
    >
      <fieldset disabled={!editable} className="flex flex-col gap-6">
        <Section title="Details">
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <Field label="Name" className="md:col-span-2">
              {(id) => <Input id={id} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
            </Field>
            <Field label="Type">
              {(id) => (
                <Select
                  id={id}
                  value={form.kind}
                  onChange={(e) => {
                    const kind = e.target.value as ProductKind;
                    setForm({ ...form, kind, trackStock: kind === "standard" });
                  }}
                >
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Category">
              {(id) => (
                <Select id={id} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">No category</option>
                  {categories.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Tax" hint="Leave on the default unless this item is zero-rated or exempt.">
              {(id) => (
                <Select id={id} value={form.taxRateId} onChange={(e) => setForm({ ...form, taxRateId: e.target.value })}>
                  <option value="">{product ? "No tax" : "Default tax rate"}</option>
                  {taxRates.data?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({Number(t.rate)}%)
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Unit">
              {(id) => (
                <Select id={id} value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
                  <option value="">Not set</option>
                  {units.data?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.abbreviation})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Description (optional)" className="md:col-span-2">
              {(id) => <Textarea id={id} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
            </Field>
            <div className="flex flex-wrap gap-6 md:col-span-2">
              {form.kind === "standard" && (
                <Checkbox label="Track stock" checked={form.trackStock} onChange={(e) => setForm({ ...form, trackStock: e.target.checked })} />
              )}
              <Checkbox
                label="Sold by weight (price from the scale)"
                checked={form.soldByWeight}
                onChange={(e) => setForm({ ...form, soldByWeight: e.target.checked })}
              />
            </div>
          </div>
        </Section>

        <Section
          title="Prices and barcodes"
          description={
            (variants.length > 1
              ? "Each variant has its own price, barcode and stock."
              : "Add variants for sizes or flavours that are priced or stocked separately.") +
            (priceLists.data && !extraLists.length ? " To sell at wholesale prices too, add a Wholesale price list under Stock → Price lists." : "")
          }
          actions={
            <Button type="button" variant="secondary" onClick={() => setVariants([...variants, emptyVariant()])}>
              <Plus className="size-4" aria-hidden /> Add variant
            </Button>
          }
        >
          <div className="divide-y divide-line">
            {variants.map((v, i) => (
              <div key={v.id ?? `new-${i}`} className="p-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  {variants.length > 1 && (
                    <Field label="Variant name" className="lg:col-span-2">
                      {(id) => <Input id={id} placeholder="e.g. 2 litre" value={v.name} onChange={(e) => setVariant(i, { name: e.target.value })} />}
                    </Field>
                  )}
                  <Field label={`${extraLists.length ? `${retailList?.name ?? "Retail"} price` : "Price"} (${session.tenant.baseCurrency})`}>
                    {(id) => (
                      <Input id={id} required inputMode="decimal" pattern="\d+(\.\d{1,2})?" title="An amount like 4.50" value={v.price} onChange={(e) => setVariant(i, { price: e.target.value })} />
                    )}
                  </Field>
                  {extraLists.map((l) => {
                    const breaks = product?.variants.find((pv) => pv.id === v.id)?.listPrices?.filter((p) => p.priceListId === l.id && Number(p.minQuantity) > 1).length ?? 0;
                    return (
                      <Field
                        key={l.id}
                        label={`${l.name} price (${l.currencyCode})`}
                        hint={
                          breaks
                            ? `Plus ${breaks} quantity ${breaks === 1 ? "break" : "breaks"} under Stock → Price lists.`
                            : `Empty: sold at the ${(retailList?.name ?? "retail").toLowerCase()} price.`
                        }
                      >
                        {(id) => (
                          <Input
                            id={id}
                            inputMode="decimal"
                            pattern="\d+(\.\d{1,2})?"
                            title="An amount like 3.90"
                            value={v.listPrices[l.id] ?? ""}
                            onChange={(e) => setVariant(i, { listPrices: { ...v.listPrices, [l.id]: e.target.value } })}
                          />
                        )}
                      </Field>
                    );
                  })}
                  <Field label="Cost price">
                    {(id) => (
                      <Input id={id} inputMode="decimal" pattern="\d+(\.\d{1,2})?" title="An amount like 3.10" value={v.costPrice} onChange={(e) => setVariant(i, { costPrice: e.target.value })} />
                    )}
                  </Field>
                  <Field label="Barcode">
                    {(id) => <Input id={id} value={v.barcode} onChange={(e) => setVariant(i, { barcode: e.target.value })} />}
                  </Field>
                  <Field label="SKU">
                    {(id) => <Input id={id} value={v.sku} onChange={(e) => setVariant(i, { sku: e.target.value })} />}
                  </Field>
                  {form.trackStock && form.kind === "standard" && (
                    <Field label="Reorder at" hint="Warn when stock falls to this.">
                      {(id) => (
                        <Input id={id} inputMode="decimal" pattern="\d+(\.\d{1,3})?" value={v.reorderLevel} onChange={(e) => setVariant(i, { reorderLevel: e.target.value })} />
                      )}
                    </Field>
                  )}
                </div>

                {(isWholesale || v.packagings.length > 0) && form.kind === "standard" && (
                  <div className="mt-4 rounded-md bg-paper p-3">
                    <p className="text-sm font-medium">Wholesale packs</p>
                    <p className="text-xs text-ink-soft">
                      Sell this item by the case or bale with its own barcode and price{extraLists.length ? `s (${[retailList?.name ?? "Retail", ...extraLists.map((l) => l.name)].join(" and ").toLowerCase()})` : ""}.
                      Empty prices are worked out from the single item&apos;s price × units in the pack.
                    </p>
                    {v.packagings.map((p, pi) => (
                      <div key={pi} className={`mt-3 grid items-end gap-2 ${PACK_COLUMNS[extraLists.length] ?? "sm:grid-cols-3"}`}>
                        <Field label="Pack name">
                          {(id) => <Input id={id} required placeholder="Case of 24" value={p.name} onChange={(e) => setPack(i, pi, { name: e.target.value })} />}
                        </Field>
                        <Field label="Units in pack">
                          {(id) => <Input id={id} required inputMode="decimal" value={p.quantity} onChange={(e) => setPack(i, pi, { quantity: e.target.value })} />}
                        </Field>
                        <Field label="Pack barcode">
                          {(id) => <Input id={id} value={p.barcode} onChange={(e) => setPack(i, pi, { barcode: e.target.value })} />}
                        </Field>
                        <Field label={extraLists.length ? `${retailList?.name ?? "Retail"} price` : "Pack price"}>
                          {(id) => <Input id={id} inputMode="decimal" value={p.price} onChange={(e) => setPack(i, pi, { price: e.target.value })} />}
                        </Field>
                        {extraLists.map((l) => (
                          <Field key={l.id} label={`${l.name} price`}>
                            {(id) => (
                              <Input
                                id={id}
                                inputMode="decimal"
                                pattern="\d+(\.\d{1,2})?"
                                title="An amount like 20.00"
                                value={p.listPrices[l.id] ?? ""}
                                onChange={(e) => setPack(i, pi, { listPrices: { ...p.listPrices, [l.id]: e.target.value } })}
                              />
                            )}
                          </Field>
                        ))}
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label="Remove pack"
                          onClick={() => setVariant(i, { packagings: v.packagings.filter((_, idx) => idx !== pi) })}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      className="mt-2 -ml-2"
                      onClick={() => setVariant(i, { packagings: [...v.packagings, { name: "", quantity: "", barcode: "", price: "", listPrices: {} }] })}
                    >
                      <Plus className="size-4" aria-hidden /> Add pack
                    </Button>
                  </div>
                )}

                {variants.length > 1 && (
                  <Button type="button" variant="ghost" className="mt-3 -ml-2 text-danger" onClick={() => setVariants(variants.filter((_, idx) => idx !== i))}>
                    Remove variant
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Section>

        {(isRestaurant || form.kind === "menu_item") && (
          <Section title="Kitchen" description="Where it's prepared and which choices the waiter must ask for.">
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <Field label="Prepared at" hint="e.g. grill, bar, pizza oven">
                {(id) => <Input id={id} value={form.kitchenStation} onChange={(e) => setForm({ ...form, kitchenStation: e.target.value })} />}
              </Field>
              <div>
                <p className="mb-1.5 text-sm font-medium">Choices</p>
                {modifierGroups.data?.length ? (
                  <div className="flex flex-col gap-2">
                    {modifierGroups.data.map((g) => (
                      <Checkbox
                        key={g.id}
                        label={`${g.name} (pick ${g.minSelect === g.maxSelect ? g.maxSelect : `${g.minSelect}–${g.maxSelect}`})`}
                        checked={form.modifierGroupIds.includes(g.id)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            modifierGroupIds: e.target.checked
                              ? [...form.modifierGroupIds, g.id]
                              : form.modifierGroupIds.filter((x) => x !== g.id),
                          })
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-ink-soft">No choice groups yet, such as sides or extras.</p>
                )}
              </div>
            </div>
          </Section>
        )}
      </fieldset>

      <FormError message={error} />
      {editable && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <Button type="submit" busy={save.isPending}>
              {product ? "Save changes" : "Add product"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.push("/stock/products")}>
              Cancel
            </Button>
          </div>
          {product?.active && (
            <Button type="button" variant="danger" busy={archive.isPending} onClick={() => archive.mutate()}>
              Archive product
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
