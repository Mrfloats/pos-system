"use client";

import Link from "next/link";
import { MODULES } from "@/components/modules";
import { useSession } from "@/lib/session";

export default function HomePage() {
  const { session, can } = useSession();

  return (
    <div className="flex min-h-[calc(100vh-10rem)] flex-col items-center justify-center gap-10 py-6">
      <header className="text-center">
        <p className="text-sm text-ink-soft">Good to see you, {session.user.fullName.split(" ")[0]}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{session.tenant.name}</h1>
      </header>

      <nav aria-label="Modules" className="w-full">
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 md:grid-cols-4 lg:flex lg:flex-wrap lg:justify-center lg:gap-x-8 lg:gap-y-8">
          {MODULES.filter((m) => !m.roles || can(...m.roles)).map(({ href, label, art: Art }) => (
            <li key={href}>
              <Link
                href={href}
                className="group flex h-40 flex-col items-center justify-center gap-4 rounded-2xl bg-surface px-4 shadow-[0_1px_2px_rgb(24_34_43/0.04),0_4px_14px_rgb(24_34_43/0.06)] transition hover:-translate-y-1 hover:shadow-[0_2px_4px_rgb(24_34_43/0.05),0_12px_28px_rgb(24_34_43/0.10)] lg:w-36"
              >
                <Art className="size-20 transition-transform group-hover:scale-105" />
                <span className="text-[15px] font-medium text-ink">{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
