"use client";

import { Building2, ChevronsLeft, CreditCard, ChevronsRight, ChevronsUpDown, House, LogOut, Menu, Store, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { MODULES } from "@/components/modules";
import { LapsedScreen, SubscriptionBanner, useMySubscription } from "@/components/subscription-status";
import { Spinner } from "@/components/ui";
import { BUSINESS_LABELS, ROLE_LABELS } from "@/lib/format";
import { SUBSCRIPTION_LAPSED_EVENT } from "@/lib/api";
import { ADMINS, SessionProvider, useSession } from "@/lib/session";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Spinner label="Opening your business…" />
        </div>
      }
    >
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Close the mobile menu after navigating (adjusting state during render, not in an effect).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("floatly.sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("floatly.sidebar", next ? "collapsed" : "open");
    } catch {
      /* private mode: just for this visit */
    }
  };

  // A lapsed or suspended subscription locks the app (the API refuses with 402);
  // only the Subscription page stays open so the owner can see what to pay.
  const qc = useQueryClient();
  const sub = useMySubscription();
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    const onLapsed = () => {
      setRefused(true);
      qc.invalidateQueries({ queryKey: ["subscription"] });
    };
    window.addEventListener(SUBSCRIPTION_LAPSED_EVENT, onLapsed);
    return () => window.removeEventListener(SUBSCRIPTION_LAPSED_EVENT, onLapsed);
  }, [qc]);
  const locked = refused || ["lapsed", "suspended", "cancelled"].includes(sub.data?.state ?? "");
  if (locked && pathname !== "/subscription") return <LapsedScreen />;

  // The home launcher is a clean page of tiles, so it swaps the sidebar for a slim top bar.
  if (pathname === "/") {
    return (
      <div className="min-h-screen">
        <HomeBar />
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
          <SubscriptionBanner />
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className={`min-h-screen transition-[padding] duration-300 print:pl-0 ${collapsed ? "lg:pl-[5.5rem]" : "lg:pl-72"}`}>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line/70 bg-surface/85 px-4 backdrop-blur lg:hidden print:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-xl p-2 text-ink-soft hover:bg-paper hover:text-ink">
          <Menu className="size-5" />
        </button>
        <BrandMark />
      </div>

      {open && <div className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px] lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col overflow-hidden bg-gradient-to-b from-[#0f3d30] via-ledger-950 to-[#071f18] text-white shadow-[4px_0_24px_rgb(10_44_34/0.18)] transition-all duration-300 lg:translate-x-0 print:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:w-[5.5rem]" : ""}`}
      >
        {/* Soft light in the corners so the panel isn't a flat block */}
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-emerald-400/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 size-72 rounded-full bg-sky-400/10 blur-3xl" />

        <div className={`relative flex items-center pt-6 ${collapsed ? "lg:justify-center lg:px-0" : ""} justify-between px-5`}>
          <Link href="/" aria-label="Home" className="rounded-xl">
            {collapsed ? (
              <>
                <BrandMark inverted className="lg:hidden" />
                <BrandMark inverted iconOnly className="hidden lg:inline-flex" />
              </>
            ) : (
              <BrandMark inverted />
            )}
          </Link>
          <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-xl p-1.5 text-white/70 hover:bg-white/10 lg:hidden">
            <X className="size-5" />
          </button>
        </div>

        <BusinessSwitcher collapsed={collapsed} />

        <nav className={`relative flex-1 overflow-x-hidden overflow-y-auto py-2 [scrollbar-width:thin] ${collapsed ? "lg:px-3" : ""} px-4`} aria-label="Main">
          <NavLinks pathname={pathname} collapsed={collapsed} />
        </nav>

        <UserFooter collapsed={collapsed} />

        {/* Fold the sidebar to icons (desktop only) */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}
          title={collapsed ? "Expand the menu" : "Collapse the menu"}
          className="absolute top-7 -right-0 hidden h-7 w-5 items-center justify-center rounded-l-lg bg-white/10 text-white/70 ring-1 ring-white/10 backdrop-blur transition hover:bg-white/20 hover:text-white lg:flex"
        >
          {collapsed ? <ChevronsRight className="size-3.5" /> : <ChevronsLeft className="size-3.5" />}
        </button>
      </aside>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 lg:py-10">
        <SubscriptionBanner />
        {children}
      </main>
    </div>
  );
}

/** Home's icon, drawn to sit with the module illustrations. */
/** The Subscription link's icon: a card on a violet tile. */
function SubscriptionArt({ className }: { className?: string }) {
  return (
    <span className={`flex items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-400 to-violet-600 text-white ${className}`}>
      <CreditCard className="size-3.5" aria-hidden />
    </span>
  );
}

function HomeArt({ className }: { className?: string }) {
  return (
    <span className={`flex items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-ledger-600 text-white ${className}`}>
      <House className="size-3.5" aria-hidden />
    </span>
  );
}

/** Which heading each area sits under in the sidebar. */
const SECTIONS: { title: string; hrefs: string[] }[] = [
  { title: "Overview", hrefs: ["/", "/dashboard"] },
  { title: "Trade", hrefs: ["/stock", "/sales", "/suppliers"] },
  { title: "Money", hrefs: ["/accounts"] },
  { title: "Admin", hrefs: ["/staff", "/settings", "/subscription"] },
];

function NavLinks({ pathname, collapsed }: { pathname: string; collapsed: boolean }) {
  const { can } = useSession();
  const items = [
    { href: "/", label: "Home", art: HomeArt, roles: undefined },
    ...MODULES,
    { href: "/subscription", label: "Subscription", art: SubscriptionArt, roles: ADMINS },
  ].filter((n) => !n.roles || can(...n.roles));
  return (
    <div className="flex flex-col gap-5">
      {SECTIONS.map((section) => {
        const links = items.filter((i) => section.hrefs.includes(i.href));
        if (!links.length) return null;
        return (
          <div key={section.title}>
            <p className={`px-3 pb-2 text-[10.5px] font-semibold tracking-[0.14em] text-emerald-100/45 uppercase ${collapsed ? "lg:hidden" : ""}`}>{section.title}</p>
            {collapsed && <div aria-hidden className="mx-auto mb-2 hidden h-px w-8 bg-white/10 lg:block" />}
            <ul className="flex flex-col gap-1">
              {links.map(({ href, label, art: Art }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? label : undefined}
                      className={`group relative flex items-center gap-3 rounded-2xl px-2.5 py-2 text-sm transition-all duration-200 ${collapsed ? "lg:justify-center lg:px-0" : ""} ${
                        active
                          ? "bg-white/[0.12] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_8px_20px_-8px_rgb(0_0_0/0.5)] ring-1 ring-white/10"
                          : "text-emerald-50/75 hover:bg-white/[0.06] hover:text-white"
                      }`}
                    >
                      {active && <span aria-hidden className="absolute top-2 bottom-2 -left-4 w-1 rounded-r-full bg-gradient-to-b from-emerald-300 to-teal-400 shadow-[0_0_12px_rgb(52_211_153/0.8)]" />}
                      <span
                        className={`flex size-9 shrink-0 items-center justify-center rounded-xl transition-all duration-200 ${
                          active ? "bg-white shadow-md shadow-black/20" : "bg-white/[0.94] shadow-sm shadow-black/20 group-hover:scale-105 group-hover:bg-white"
                        }`}
                      >
                        <Art className="size-6" />
                      </span>
                      <span className={`flex-1 truncate ${collapsed ? "lg:hidden" : ""}`}>{label}</span>
                      {active && !collapsed && <span aria-hidden className="size-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgb(110_231_183)]" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** First letters of the first two words, e.g. "Demo Supermarket" → "DS". */
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/** Business and store pickers: the top of the sidebar, because owners run several of each. */
function BusinessSwitcher({ collapsed }: { collapsed: boolean }) {
  const { session, stores, storeId, setStoreId, switchBusiness } = useSession();
  const [switching, setSwitching] = useState(false);
  const activeStores = stores.filter((s) => s.active);
  const store = activeStores.find((s) => s.id === storeId);
  const badge = (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 text-sm font-semibold text-white shadow-lg shadow-blue-900/40 ring-1 ring-white/20">
      {initials(session.tenant.name)}
    </span>
  );

  return (
    <>
      {collapsed && (
        <div className="relative mt-6 hidden justify-center lg:flex" title={`${session.tenant.name} · ${store?.name ?? ""}`}>
          {badge}
        </div>
      )}
      <div className={`relative mx-4 mt-6 mb-4 rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10 backdrop-blur ${collapsed ? "lg:hidden" : ""}`}>
        <div className="flex items-center gap-3">
          {badge}
          <div className="relative min-w-0 flex-1">
            <label htmlFor="business" className="sr-only">
              Business
            </label>
            <select
              id="business"
              value={session.tenant.id}
              disabled={switching || session.businesses.length < 2}
              onChange={async (e) => {
                setSwitching(true);
                await switchBusiness(e.target.value).finally(() => setSwitching(false));
              }}
              className="w-full appearance-none truncate bg-transparent pr-6 text-sm leading-tight font-semibold text-white disabled:opacity-100 [&>option]:text-ink"
            >
              {session.businesses.map((b) => (
                <option key={b.tenantId} value={b.tenantId}>
                  {b.name}
                </option>
              ))}
            </select>
            {session.businesses.length > 1 && <ChevronsUpDown className="pointer-events-none absolute top-0 right-0 size-4 text-white/50" aria-hidden />}
            <p className="mt-0.5 truncate text-xs text-emerald-100/55">{BUSINESS_LABELS[session.tenant.businessType]}</p>
          </div>
        </div>

        <div className="relative mt-3">
          <label htmlFor="store" className="sr-only">
            Working in
          </label>
          <Store className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-emerald-200/70" aria-hidden />
          <select
            id="store"
            value={storeId ?? ""}
            onChange={(e) => setStoreId(e.target.value)}
            className="w-full appearance-none rounded-xl bg-black/20 py-2 pr-8 pl-8 text-sm text-white ring-1 ring-white/10 transition hover:bg-black/30 [&>option]:text-ink"
          >
            {activeStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
          <ChevronsUpDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-white/50" aria-hidden />
        </div>
      </div>
    </>
  );
}

/**
 * A picker that looks like a labelled chip: icon, small caption, the chosen
 * value. A native select sits invisibly on top, so it still opens the
 * browser's own list and works with the keyboard and screen readers.
 */
function PickerChip({
  id,
  icon: Icon,
  caption,
  display,
  badge,
  children,
  ...select
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  caption: string;
  /** What the chip shows: the chosen option, in words. */
  display: string;
  badge?: string;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="group relative flex min-w-0 items-center gap-2.5 rounded-2xl bg-white/[0.07] py-1.5 pr-3 pl-1.5 ring-1 ring-white/10 transition hover:bg-white/[0.12] focus-within:ring-2 focus-within:ring-emerald-300/70">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-300/30 to-teal-500/20 text-emerald-100 ring-1 ring-white/10">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 leading-none">
        <label htmlFor={id} className="block text-[10px] font-semibold tracking-[0.14em] text-emerald-100/50 uppercase">
          {caption}
        </label>
        <span className="mt-1 flex items-center gap-1.5">
          <span className="max-w-56 truncate text-[13.5px] font-medium tracking-[-0.01em] text-white">{display}</span>
          {badge && <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide text-emerald-100/80">{badge}</span>}
        </span>
      </span>
      <ChevronsUpDown className="ml-1 size-3.5 shrink-0 text-white/40 transition group-hover:text-white/70" aria-hidden />
      <select id={id} {...select} className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default [&>option]:text-ink">
        {children}
      </select>
    </div>
  );
}

/** Business, store and user controls for the home launcher, on the same deep green as the sidebar. */
function HomeBar() {
  const { session, stores, storeId, setStoreId, switchBusiness, signOut } = useSession();
  const [switching, setSwitching] = useState(false);
  const activeStores = stores.filter((s) => s.active);
  const store = activeStores.find((s) => s.id === storeId);

  return (
    <header className="sticky top-0 z-30 overflow-hidden bg-gradient-to-r from-[#0f3d30] via-ledger-950 to-[#071f18] text-white shadow-[0_4px_24px_rgb(10_44_34/0.18)]">
      {/* The same deep green and corner glow as the sidebar */}
      <div aria-hidden className="pointer-events-none absolute -top-24 right-1/4 size-64 rounded-full bg-emerald-400/20 blur-3xl" />
      <div className="relative mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-8">
        <BrandMark inverted className="mr-auto" />

        {session.businesses.length > 1 && (
          <PickerChip
            id="home-business"
            icon={Building2}
            caption="Business"
            display={switching ? "Switching…" : session.tenant.name}
            value={session.tenant.id}
            disabled={switching}
            onChange={async (e) => {
              setSwitching(true);
              await switchBusiness(e.target.value).finally(() => setSwitching(false));
            }}
          >
            {session.businesses.map((b) => (
              <option key={b.tenantId} value={b.tenantId}>
                {b.name}
              </option>
            ))}
          </PickerChip>
        )}

        <PickerChip
          id="home-store"
          icon={Store}
          caption="Working in"
          display={store?.name ?? "Choose a store"}
          badge={store?.code}
          value={storeId ?? ""}
          onChange={(e) => setStoreId(e.target.value)}
        >
          {activeStores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.code})
            </option>
          ))}
        </PickerChip>

        <div className="flex items-center gap-1 rounded-2xl bg-white/[0.07] py-1.5 pr-1.5 pl-1.5 ring-1 ring-white/10">
          <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-500 text-[11px] font-semibold text-white shadow-md shadow-orange-900/30">
            {initials(session.user.fullName)}
            <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-ledger-950" />
          </span>
          <div className="hidden min-w-0 px-2 leading-none sm:block">
            <p className="max-w-40 truncate text-[13.5px] font-medium tracking-[-0.01em] text-white">{session.user.fullName}</p>
            <p className="mt-1">
              <span className="inline-block rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-emerald-200 uppercase">
                {ROLE_LABELS[session.membership.role]}
              </span>
            </p>
          </div>
          <span aria-hidden className="mx-1 h-7 w-px bg-white/10" />
          <button
            onClick={signOut}
            className="flex size-8 items-center justify-center rounded-xl text-white/60 transition hover:bg-rose-500/15 hover:text-rose-300"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

function UserFooter({ collapsed }: { collapsed: boolean }) {
  const { session, signOut } = useSession();
  const avatar = (
    <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-500 text-xs font-semibold text-white shadow-md shadow-orange-900/30 ring-2 ring-white/15">
      {initials(session.user.fullName)}
      <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-ledger-950" />
    </span>
  );
  return (
    <div className="relative border-t border-white/10 p-4">
      {collapsed && (
        <div className="hidden flex-col items-center gap-2 lg:flex">
          <span title={`${session.user.fullName} · ${ROLE_LABELS[session.membership.role]}`}>{avatar}</span>
          <button onClick={signOut} className="rounded-xl p-2 text-white/60 hover:bg-white/10 hover:text-rose-300" aria-label="Sign out" title="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      )}
      <div className={`flex items-center gap-3 rounded-2xl bg-white/[0.06] p-2.5 ring-1 ring-white/10 ${collapsed ? "lg:hidden" : ""}`}>
        {avatar}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{session.user.fullName}</p>
          <p className="truncate text-xs text-emerald-100/55">{ROLE_LABELS[session.membership.role]}</p>
        </div>
        <button onClick={signOut} className="rounded-xl p-2 text-white/60 transition hover:bg-white/10 hover:text-rose-300" aria-label="Sign out" title="Sign out">
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}
