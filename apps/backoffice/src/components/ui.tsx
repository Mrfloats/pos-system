"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { forwardRef, useEffect, useId, useRef } from "react";
import { MODULES } from "@/components/modules";

// ----- Buttons -------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-b from-ledger-700 to-ledger-800 text-white shadow-sm shadow-ledger-900/25 hover:from-ledger-600 hover:to-ledger-700 disabled:from-ledger-800/50 disabled:to-ledger-800/50 disabled:shadow-none",
  secondary: "bg-surface text-ink border border-line shadow-sm shadow-ink/5 hover:border-line-strong hover:bg-paper disabled:text-ink-faint",
  ghost: "text-ink-soft hover:bg-ledger-50 hover:text-ink",
  danger: "bg-surface text-danger border border-line shadow-sm shadow-ink/5 hover:border-danger/30 hover:bg-danger-soft",
};

export const buttonBase =
  "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium whitespace-nowrap transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100";

export function Button({
  variant = "primary",
  className = "",
  busy,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`${buttonBase} ${buttonStyles[variant]} ${className}`}
    >
      {busy ? "Saving…" : children}
    </button>
  );
}

// ----- Form fields -----------------------------------------------------------

const control =
  "rounded-xl border border-line-strong/80 bg-surface px-3.5 text-sm text-ink shadow-sm shadow-ink/[0.03] transition-[border-color,box-shadow] placeholder:text-ink-faint hover:border-line-strong focus:border-ledger-600 focus:ring-4 focus:ring-ledger-600/10 focus:outline-none disabled:bg-paper";

/** Full width unless the caller sets a width. */
const widthOr = (className: string) => (/(^|\s)(\w+:)?w-/.test(className) ? "" : "w-full");

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...props }, ref) {
    return <input ref={ref} {...props} className={`${control} ${widthOr(className)} h-10 ${className}`} />;
  },
);

export function Select({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${control} ${widthOr(className)} h-10 pr-8 ${className}`} />;
}

export function Textarea({ className = "", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${control} w-full min-h-20 py-2 ${className}`} />;
}

/** Label + control + optional hint. The control is passed as a render function to wire up ids. */
export function Field({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

export function Checkbox({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
      <input type="checkbox" {...props} className="size-4 accent-ledger-700" />
      {label}
    </label>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-danger/15 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
      {message}
    </p>
  );
}

// ----- Page structure ---------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  // The page's own illustration from the home screen, so every page is recognisable at a glance.
  const mod = MODULES.filter((m) => pathname.startsWith(m.href)).sort((a, b) => b.href.length - a.href.length)[0];
  const Art = mod?.art;
  return (
    <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        {Art && (
          <span className="hidden size-14 shrink-0 items-center justify-center rounded-2xl bg-surface shadow-[var(--shadow-card)] sm:flex print:hidden">
            <Art className="size-9" />
          </span>
        )}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[1.7rem]">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-ink-soft">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
    </header>
  );
}

type StatTone = "green" | "blue" | "amber" | "rose" | "violet" | "teal";
const statTones: Record<StatTone, string> = {
  green: "from-emerald-400 to-ledger-600",
  blue: "from-sky-400 to-blue-600",
  amber: "from-amber-300 to-orange-500",
  rose: "from-rose-400 to-red-500",
  violet: "from-fuchsia-400 to-violet-600",
  teal: "from-teal-300 to-teal-600",
};

/** A key figure on a card: coloured icon, label, big number, optional note. */
export function StatCard({
  label,
  value,
  note,
  icon: Icon,
  tone = "green",
  href,
  alert,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone?: StatTone;
  href?: string;
  alert?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-soft">{label}</p>
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm ${statTones[tone]}`}>
          <Icon className="size-5" aria-hidden />
        </span>
      </div>
      <p className={`mt-1 text-[1.65rem] leading-tight font-semibold tracking-tight tabular-nums ${alert ? "text-danger" : "text-ink"}`}>{value}</p>
      {note && <p className={`mt-1.5 text-xs ${alert ? "font-medium text-danger" : "text-ink-faint"}`}>{note}</p>}
    </>
  );
  const cls = "card block p-5 transition-all";
  return href ? (
    <Link href={href} className={`${cls} hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-soft">{description}</p>}
        </div>
        {actions}
      </div>
      <div>{children}</div>
    </section>
  );
}

// ----- Tables -------------------------------------------------------------------

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm [&_tbody_tr:last-child>td]:border-b-0 [&_tbody_tr:hover>td]:bg-ledger-50/40">{children}</table>
    </div>
  );
}

export function Th({ children, align = "left", className = "" }: { children?: React.ReactNode; align?: "left" | "right"; className?: string }) {
  return (
    <th
      scope="col"
      className={`border-b border-line/70 bg-paper/50 px-4 py-3 text-[11px] font-semibold tracking-wider text-ink-faint uppercase ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, align = "left", className = "" }: { children?: React.ReactNode; align?: "left" | "right"; className?: string }) {
  return (
    <td className={`border-b border-line/60 px-4 py-3.5 align-middle transition-colors ${align === "right" ? "text-right" : ""} ${className}`}>
      {children}
    </td>
  );
}

export function TableMessage({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-14 text-center text-sm text-ink-faint">
        {children}
      </td>
    </tr>
  );
}

// ----- Small pieces -------------------------------------------------------------

type BadgeTone = "neutral" | "green" | "amber" | "red";
const badgeStyles: Record<BadgeTone, string> = {
  neutral: "bg-paper text-ink-soft border-line",
  green: "bg-ledger-50 text-ledger-800 border-ledger-100",
  amber: "bg-amber-soft text-amber-ink border-amber/30",
  red: "bg-danger-soft text-danger border-danger/20",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap before:size-1.5 before:rounded-full before:bg-current before:opacity-70 ${badgeStyles[tone]}`}>
      {children}
    </span>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm text-ink-soft">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ----- Dialog (native <dialog> for focus trapping and Escape) ---------------------

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="dialog-title"
      className={`m-auto w-[calc(100%-2rem)] rounded-2xl border border-ink/5 bg-surface p-0 text-ink shadow-2xl shadow-ink/20 backdrop:backdrop-blur-[2px] ${wide ? "max-w-2xl" : "max-w-md"}`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-line/70 px-6 py-4">
            <h2 id="dialog-title" className="text-base font-semibold">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-ink-soft hover:bg-paper" aria-label="Close">
              ✕
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-ink-soft" role="status">
      <span className="size-5 animate-spin rounded-full border-2 border-ledger-100 border-t-ledger-600" />
      {label}
    </div>
  );
}
