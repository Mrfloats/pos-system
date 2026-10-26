/** Formats a decimal string like "1234.5" as "1,234.50". */
export function money(value: string | number | null | undefined, currency?: string) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  const formatted = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${formatted}` : formatted;
}

/** Quantities: drop trailing zeros ("12.000" → "12", "4.500" → "4.5"). */
export function qty(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  cashier: "Cashier",
  waiter: "Waiter",
  stock_clerk: "Stock clerk",
  accountant: "Accountant",
};

export const BUSINESS_LABELS: Record<string, string> = {
  retail: "Retail shop",
  wholesale: "Wholesale",
  restaurant: "Restaurant",
  mixed: "Retail and wholesale",
};

export function dateTime(iso: string | null | undefined) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}
