"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, LayoutGrid, List, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Select, Spinner, Table, Td, Th } from "@/components/ui";
import { api, Category, Page, Product } from "@/lib/api";
import { money, qty } from "@/lib/format";
import { MANAGERS, useSession } from "@/lib/session";

type StockedProduct = Product & { onHand: string; stores: string[] };
type View = "list" | "cards";

const KIND_LABELS: Record<string, string> = {
  standard: "Stocked item",
  service: "Service",
  menu_item: "Menu item",
  bundle: "Bundle",
};
const PAGE_SIZE = 50;

/** A soft colour per first letter, for product placeholders. */
const SWATCHES = ["from-sky-400 to-blue-600", "from-emerald-400 to-ledger-600", "from-amber-300 to-orange-500", "from-fuchsia-400 to-violet-600", "from-rose-400 to-red-500", "from-teal-300 to-teal-600"];
const swatch = (name: string) => SWATCHES[name.charCodeAt(0) % SWATCHES.length];

export default function ProductsPage() {
  const { can, session } = useSession();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<View>(() => {
    try {
      return (localStorage.getItem("pos.products.view") as View) || "list";
    } catch {
      return "list";
    }
  });

  useEffect(() => {
    const t = setTimeout(() => (setDebounced(search.trim()), setPage(1)), 250);
    return () => clearTimeout(t);
  }, [search]);

  const chooseView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem("pos.products.view", v);
    } catch {
      /* private mode */
    }
  };

  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/categories") });
  const products = useQuery({
    queryKey: ["products", "stock", { debounced, categoryId, activeOnly, page }],
    queryFn: () =>
      api<Page<StockedProduct>>("/products", {
        query: { search: debounced, categoryId, active: activeOnly ? true : undefined, withStock: true, page, pageSize: PAGE_SIZE },
      }),
    placeholderData: keepPreviousData,
  });

  const catName = (id: string | null) => categories.data?.find((c) => c.id === id)?.name;
  const data = products.data;
  const first = data && data.total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = data ? Math.min(page * PAGE_SIZE, data.total) : 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const cur = session.tenant.baseCurrency;

  return (
    <div>
      {/* Toolbar: new, title, search with filter chips, pager, view switch */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {can(...MANAGERS) && (
          <Link
            href="/stock/products/new"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-b from-ledger-700 to-ledger-800 px-4 text-sm font-medium text-white shadow-sm shadow-ledger-900/25 hover:from-ledger-600 hover:to-ledger-700"
          >
            <Plus className="size-4" aria-hidden /> New
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">Products</h1>

        <div className="order-last flex w-full min-w-0 items-center gap-2 rounded-xl border border-line-strong/80 bg-surface px-2 shadow-sm shadow-ink/[0.03] focus-within:border-ledger-600 focus-within:ring-4 focus-within:ring-ledger-600/10 lg:order-none lg:mx-auto lg:w-auto lg:min-w-[32rem] xl:min-w-[36rem]">
          <Search className="ml-1 size-4 shrink-0 text-ink-faint" aria-hidden />
          {activeOnly && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-ledger-50 py-1 pr-1 pl-2 text-xs font-medium text-ledger-800">
              Active
              <button type="button" onClick={() => (setActiveOnly(false), setPage(1))} className="rounded p-0.5 hover:bg-ledger-100" aria-label="Show archived products too">
                <X className="size-3" />
              </button>
            </span>
          )}
          {categoryId && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-sky-50 py-1 pr-1 pl-2 text-xs font-medium text-sky-800">
              {catName(categoryId)}
              <button type="button" onClick={() => (setCategoryId(""), setPage(1))} className="rounded p-0.5 hover:bg-sky-100" aria-label="Clear category">
                <X className="size-3" />
              </button>
            </span>
          )}
          <input
            aria-label="Search products"
            placeholder="Search name, code or scan a barcode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
          />
          <Select
            aria-label="Category"
            value={categoryId}
            onChange={(e) => (setCategoryId(e.target.value), setPage(1))}
            className="h-8 w-36 border-0 bg-paper text-xs shadow-none focus:ring-0"
          >
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {!activeOnly && (
            <button type="button" onClick={() => setActiveOnly(true)} className="shrink-0 rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-paper">
              Active only
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <span className="text-sm text-ink-soft tabular-nums">
            {first}–{last} / {data?.total ?? 0}
          </span>
          <div className="flex">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-l-xl border border-line bg-surface p-2.5 text-ink-soft shadow-sm hover:bg-paper disabled:opacity-40" aria-label="Previous page">
              <ChevronLeft className="size-4" />
            </button>
            <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="-ml-px rounded-r-xl border border-line bg-surface p-2.5 text-ink-soft shadow-sm hover:bg-paper disabled:opacity-40" aria-label="Next page">
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="flex rounded-xl border border-line bg-surface p-0.5 shadow-sm" role="group" aria-label="View">
            {(
              [
                ["list", List, "List"],
                ["cards", LayoutGrid, "Cards"],
              ] as const
            ).map(([v, Icon, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                aria-label={label}
                title={label}
                onClick={() => chooseView(v)}
                className={`rounded-lg p-2 ${view === v ? "bg-ledger-800 text-white" : "text-ink-soft hover:bg-paper"}`}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {products.isLoading ? (
        <Spinner />
      ) : !data?.items.length ? (
        <div className="card px-6 py-16 text-center text-sm text-ink-faint">
          {debounced || categoryId ? (
            "No products match. Try a different search or category."
          ) : can(...MANAGERS) ? (
            <>
              No products yet.{" "}
              <Link href="/stock/products/new" className="font-medium text-ledger-700 hover:underline">
                Add your first product
              </Link>
            </>
          ) : (
            "No products yet."
          )}
        </div>
      ) : view === "list" ? (
        <div className="card overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th className="hidden md:table-cell">Product code</Th>
                <Th>Product name</Th>
                <Th className="hidden md:table-cell">Category</Th>
                <Th align="right">Sell price</Th>
                <Th className="hidden text-center xl:table-cell">By weight</Th>
                <Th className="hidden text-center xl:table-cell">Track stock</Th>
                <Th align="right">Qty</Th>
                <Th className="hidden lg:table-cell">Stores</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => {
                const variants = p.variants.filter((v) => v.active);
                const main = variants.find((v) => v.isDefault) ?? variants[0] ?? p.variants[0];
                const onHand = Number(p.onHand);
                const low = p.trackStock && main?.reorderLevel != null && onHand <= Number(main.reorderLevel);
                return (
                  <tr key={p.id}>
                    <Td className="hidden font-mono text-xs text-ink-soft uppercase md:table-cell">{main?.sku ?? "—"}</Td>
                    <Td>
                      <Link href={`/stock/products/${p.id}`} className="font-medium hover:text-ledger-700 hover:underline">
                        {p.name}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                        {p.kind !== "standard" && <Badge>{KIND_LABELS[p.kind]}</Badge>}
                        {variants.length > 1 && <span>{variants.length} variants</span>}
                        {!p.active && <Badge tone="amber">Archived</Badge>}
                      </div>
                    </Td>
                    <Td className="hidden text-ink-soft md:table-cell">{catName(p.categoryId) ?? "—"}</Td>
                    <Td align="right" className="font-medium whitespace-nowrap tabular-nums">
                      {money(main?.price, cur)}
                    </Td>
                    <Td className="hidden text-center xl:table-cell">
                      <Tick on={p.soldByWeight} label="Sold by weight" />
                    </Td>
                    <Td className="hidden text-center xl:table-cell">
                      <Tick on={p.trackStock} label="Tracks stock" />
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {!p.trackStock ? (
                        <span className="text-ink-faint">—</span>
                      ) : onHand <= 0 ? (
                        <Badge tone="red">{qty(p.onHand)}</Badge>
                      ) : low ? (
                        <Badge tone="amber">{qty(p.onHand)}</Badge>
                      ) : (
                        <span className="font-medium">{qty(p.onHand)}</span>
                      )}
                    </Td>
                    <Td className="hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {p.stores.map((s) => (
                          <span key={s} className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-medium text-ink-soft ring-1 ring-line">
                            {s}
                          </span>
                        ))}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {data.items.map((p) => {
            const main = p.variants.find((v) => v.isDefault) ?? p.variants[0];
            const onHand = Number(p.onHand);
            return (
              <Link key={p.id} href={`/stock/products/${p.id}`} className="card group flex flex-col p-4 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
                <span className={`flex aspect-[4/3] items-center justify-center rounded-xl bg-gradient-to-br text-3xl font-semibold text-white ${swatch(p.name)}`}>
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="mt-3 line-clamp-2 text-sm font-medium group-hover:text-ledger-700">{p.name}</span>
                <span className="text-xs text-ink-faint">{catName(p.categoryId) ?? "No category"}</span>
                <span className="mt-auto flex items-end justify-between pt-3">
                  <span className="font-semibold tabular-nums">{money(main?.price)}</span>
                  {p.trackStock && (
                    <span className={`text-xs font-medium ${onHand <= 0 ? "text-danger" : "text-ink-soft"}`}>{qty(p.onHand)} in stock</span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tick({ on, label }: { on: boolean; label: string }) {
  return on ? (
    <span className="inline-flex size-5 items-center justify-center rounded-md bg-ledger-600 text-white" title={label}>
      <Check className="size-3.5" aria-label={label} />
    </span>
  ) : (
    <span className="inline-block size-5 rounded-md border border-line-strong/70" aria-label={`Not ${label.toLowerCase()}`} />
  );
}
