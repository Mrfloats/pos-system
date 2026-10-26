"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CreditCard, Inbox, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { Spinner } from "@/components/ui";
import { api, PlatformBilling, platformTokenStore } from "@/lib/api";

/** The platform console shell: its own sign-in, a slim dark bar, no business sidebar. */
export default function PlatformConsoleLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [hasToken] = useState(() => typeof window !== "undefined" && !!platformTokenStore.get());
  useEffect(() => {
    if (!platformTokenStore.get()) router.replace("/platform/login");
  }, [router]);
  const me = useQuery({
    queryKey: ["platform", "me"],
    queryFn: () => api<{ id: string; email: string; fullName: string }>("/platform/me", { platform: true }),
    enabled: hasToken,
  });

  if (!me.data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Opening the platform console…" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 bg-gradient-to-r from-ink via-[#1d2a33] to-ledger-950 text-white shadow-[var(--shadow-lift)] print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3 sm:px-8">
          <Link href="/platform" className="flex items-center gap-3">
            <BrandMark inverted />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium ring-1 ring-white/15">
              <ShieldCheck className="size-3.5" aria-hidden /> Platform
            </span>
          </Link>
          <ConsoleNav />
          <span className="ml-auto text-right text-sm">
            <span className="block font-medium">{me.data.fullName}</span>
            <span className="block text-xs text-white/60">{me.data.email}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              platformTokenStore.clear();
              qc.removeQueries({ queryKey: ["platform"] });
              router.replace("/platform/login");
            }}
            className="rounded-xl p-2 text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">{children}</main>
    </div>
  );
}

/** Businesses, sign-up requests (with how many are waiting) and plans. */
function ConsoleNav() {
  const pathname = usePathname();
  const billing = useQuery({ queryKey: ["platform", "billing"], queryFn: () => api<PlatformBilling>("/platform/billing", { platform: true }), refetchInterval: 60_000 });
  const pending = billing.data?.pendingRequests ?? 0;
  const tabs = [
    { href: "/platform", label: "Businesses", icon: Building2, active: pathname === "/platform" || pathname.startsWith("/platform/businesses") },
    { href: "/platform/requests", label: "Requests", icon: Inbox, active: pathname.startsWith("/platform/requests"), count: pending },
    { href: "/platform/plans", label: "Plans", icon: CreditCard, active: pathname.startsWith("/platform/plans") },
  ];
  return (
    <nav aria-label="Console" className="flex items-center gap-1 rounded-2xl bg-white/[0.06] p-1 ring-1 ring-white/10">
      {tabs.map(({ href, label, icon: Icon, active, count }) => (
        <Link
          key={href}
          href={href}
          aria-current={active ? "page" : undefined}
          className={`relative flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium transition ${active ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"}`}
        >
          <Icon className="size-4" aria-hidden />
          {label}
          {!!count && (
            <span className="flex h-5 min-w-5 animate-pop items-center justify-center rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-ink shadow-[0_0_12px_rgb(251_191_36/0.6)]">{count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
