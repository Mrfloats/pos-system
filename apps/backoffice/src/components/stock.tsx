"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Badge, Input, Select } from "@/components/ui";
import { api, Page, StockLevel } from "@/lib/api";
import { qty } from "@/lib/format";
import { useSession } from "@/lib/session";

export const MOVEMENT_LABELS: Record<string, string> = {
  opening: "Opening stock",
  receive: "Received",
  sale: "Sold",
  return: "Returned",
  adjustment: "Adjustment",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  waste: "Waste",
};

export const MOVEMENT_TONES: Record<string, "neutral" | "green" | "amber" | "red"> = {
  opening: "green",
  receive: "green",
  return: "green",
  transfer_in: "green",
  sale: "neutral",
  transfer_out: "amber",
  adjustment: "amber",
  waste: "red",
};

export function MovementBadge({ type }: { type: string }) {
  return <Badge tone={MOVEMENT_TONES[type] ?? "neutral"}>{MOVEMENT_LABELS[type] ?? type}</Badge>;
}

/** Today in the browser's calendar, as YYYY-MM-DD. */
export const today = () => new Date().toLocaleDateString("en-CA");
export const firstOfMonth = () => `${today().slice(0, 8)}01`;

export const itemName = (i: { productName: string; variantName: string }) =>
  i.variantName && i.variantName !== "Default" ? `${i.productName} · ${i.variantName}` : i.productName;

/** Store picker; with `allowAll`, an empty value means every store together. */
export function StoreSelect({
  value,
  onChange,
  allowAll,
  ...props
}: { value: string; onChange: (id: string) => void; allowAll?: boolean } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value">) {
  const { stores } = useSession();
  return (
    <Select {...props} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll && <option value="">All stores</option>}
      {stores
        .filter((s) => s.active)
        .map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.code})
          </option>
        ))}
    </Select>
  );
}

/**
 * Search-as-you-type item picker. Shows what's on hand in `storeId` so people
 * can see stock while they pick. Calls `onPick` and clears itself.
 */
export function ItemPicker({
  storeId,
  onPick,
  placeholder = "Search by name, SKU or scan a barcode",
  autoFocus,
}: {
  storeId: string | null;
  onPick: (item: StockLevel) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const results = useQuery({
    queryKey: ["inventory", storeId, "pick", debounced],
    queryFn: () => api<Page<StockLevel>>("/inventory/levels", { query: { storeId, search: debounced, pageSize: 8 } }),
    enabled: !!storeId && open,
  });
  // Results for an older search are never shown or picked while a newer one is on its way.
  const stale = debounced !== text.trim() || results.isFetching;
  const items = stale ? [] : (results.data?.items ?? []);

  const pick = (item: StockLevel) => {
    onPick(item);
    setText("");
    setOpen(false);
    setActive(0);
  };

  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute top-3 left-3.5 size-4 text-ink-faint" aria-hidden />
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Find an item"
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="pl-10"
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => (setText(e.target.value), setOpen(true), setActive(0))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive(Math.min(active + 1, items.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive(Math.max(active - 1, 0));
          }
          if (e.key === "Enter" && open && items[active]) {
            e.preventDefault();
            pick(items[active]);
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="card absolute inset-x-0 top-full z-30 mt-2 max-h-80 overflow-y-auto p-1.5">
          {stale && <li className="px-3 py-2 text-sm text-ink-faint">Searching…</li>}
          {!stale && items.length === 0 && <li className="px-3 py-2 text-sm text-ink-faint">No stocked items match.</li>}
          {items.map((item, i) => (
            <li
              key={item.variantId}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => (e.preventDefault(), pick(item))}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 ${i === active ? "bg-ledger-50" : ""}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{itemName(item)}</span>
                <span className="block text-xs text-ink-faint">{[item.sku, item.barcode].filter(Boolean).join(" · ") || "No code"}</span>
              </span>
              <span className="shrink-0 text-right text-xs text-ink-soft">
                <span className="block font-medium text-ink tabular-nums">{qty(item.onHand)}</span>
                on hand
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
