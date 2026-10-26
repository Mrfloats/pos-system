import type { PlatformBusiness } from "./api";

const DAY = 86_400_000;

/** How recently a business was used: signed in or sold something. */
export function activity(b: Pick<PlatformBusiness, "lastLoginAt" | "lastSaleAt">) {
  const last = Math.max(b.lastLoginAt ? Date.parse(b.lastLoginAt) : 0, b.lastSaleAt ? Date.parse(b.lastSaleAt) : 0);
  if (!last) return { label: "Never used", tone: "neutral" as const, last: null };
  const days = (Date.now() - last) / DAY;
  if (days <= 7) return { label: "Active", tone: "green" as const, last };
  if (days <= 30) return { label: "Quiet", tone: "amber" as const, last };
  return { label: "Inactive", tone: "red" as const, last };
}

export const ago = (t: number | string | null) => {
  if (!t) return "never";
  const days = Math.floor((Date.now() - (typeof t === "number" ? t : Date.parse(t))) / DAY);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 30 ? `${days} days ago` : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
