"use client";

import { AccountsTabs } from "@/components/accounts";
import { BOOKKEEPERS, useSession } from "@/lib/session";

export default function AccountsLayout({ children }: LayoutProps<"/accounts">) {
  const { can } = useSession();
  if (!can(...BOOKKEEPERS)) {
    return <p className="text-sm text-ink-soft">Accounts are for owners, managers and accountants. Ask the owner if you need access.</p>;
  }
  return (
    <div>
      <AccountsTabs />
      {children}
    </div>
  );
}
