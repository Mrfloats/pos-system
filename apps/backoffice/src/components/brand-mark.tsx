import { APP_NAME } from "@/lib/brand";

/** The app's logo: a receipt-roll mark on a ledger-green tile, beside the product name. */
export function BrandMark({ inverted = false, iconOnly = false, className = "" }: { inverted?: boolean; iconOnly?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 32 32" className={`size-8 shrink-0 rounded-[9px] drop-shadow-sm ${inverted ? "ring-1 ring-white/25" : ""}`} aria-hidden>
        {/* Solid fills only: a gradient id would break when another copy of the logo is hidden (mobile bar). */}
        <rect width="32" height="32" rx="9" fill="#1c6652" />
        <path d="M0 9a9 9 0 0 1 9-9h14a9 9 0 0 1 9 9v5C22 18 10 10 0 16z" fill="#34c38f" opacity="0.45" />
        <path d="M10 7h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z" fill="#fff" />
        <path d="M13 11.5h6M13 15h6M13 18.5h3.5" stroke="#1c6652" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {iconOnly ? <span className="sr-only">{APP_NAME}</span> : <span className={`text-[15px] font-semibold tracking-tight ${inverted ? "text-white" : "text-ink"}`}>{APP_NAME}</span>}
    </span>
  );
}
