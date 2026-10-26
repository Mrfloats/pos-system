"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, Role, Session, Store, tokenStore } from "./api";

interface SessionValue {
  session: Session;
  stores: Store[];
  storeId: string | null;
  setStoreId: (id: string) => void;
  switchBusiness: (tenantId: string) => Promise<void>;
  signOut: () => void;
  can: (...roles: Role[]) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);
const STORE_KEY = "pos.store";
const NO_STORES: Store[] = [];

export const MANAGERS: Role[] = ["owner", "admin", "manager"];
export const ADMINS: Role[] = ["owner", "admin"];
export const STOCK_WRITERS: Role[] = [...MANAGERS, "stock_clerk"];
/** Sell at the till: open shifts, make sales and quotations. */
export const FRONT_OF_HOUSE: Role[] = [...MANAGERS, "cashier", "waiter"];
/** Enter bills, invoices, payments and expenses, and read the accounts. */
export const BOOKKEEPERS: Role[] = [...MANAGERS, "accountant"];
/** Change the chart of accounts, post journals and close periods. */
export const ACCOUNTANTS: Role[] = [...ADMINS, "accountant"];

/** Saves a fresh login/sign-up response and enters the app. */
export function startSession(s: Session) {
  if (s.accessToken) tokenStore.set(s.accessToken);
}

/** Wraps the signed-in part of the app. Sends people without a session to /login. */
export function SessionProvider({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  // Read once on the client. The server render has no token and shows the fallback,
  // which is also what the client shows until the profile loads, so hydration matches.
  const [hasToken] = useState(() => typeof window !== "undefined" && !!tokenStore.get());

  useEffect(() => {
    if (!tokenStore.get()) router.replace("/login");
  }, [router]);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Session>("/auth/me"), enabled: !!hasToken });
  const stores = useQuery({ queryKey: ["stores"], queryFn: () => api<Store[]>("/stores"), enabled: !!hasToken });

  const [chosenStore, setChosenStore] = useState<string | null>(() => {
    try {
      return typeof window === "undefined" ? null : localStorage.getItem(STORE_KEY);
    } catch {
      return null;
    }
  });
  // Chosen store first, then a selling location (not a warehouse), then anything open.
  const storeId = useMemo(() => {
    const list = stores.data;
    if (!list?.length) return null;
    const valid =
      list.find((s) => s.id === chosenStore && s.active) ??
      list.find((s) => s.active && s.type !== "warehouse") ??
      list.find((s) => s.active) ??
      list[0];
    return valid.id;
  }, [stores.data, chosenStore]);

  const setStoreId = useCallback((id: string) => {
    setChosenStore(id);
    try {
      localStorage.setItem(STORE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const switchBusiness = useCallback(
    async (tenantId: string) => {
      const next = await api<Session>("/auth/switch-tenant", { method: "POST", body: { tenantId } });
      startSession(next);
      try {
        localStorage.removeItem(STORE_KEY);
      } catch {
        /* ignore */
      }
      setChosenStore(null);
      qc.clear();
      router.push("/");
    },
    [qc, router],
  );

  const signOut = useCallback(() => {
    tokenStore.clear();
    qc.clear();
    router.replace("/login");
  }, [qc, router]);

  const value = useMemo<SessionValue | null>(() => {
    // If the store list can't load, carry on with none rather than spinning forever.
    if (!me.data || (!stores.data && !stores.isError)) return null;
    const role = me.data.membership.role;
    return {
      session: me.data,
      stores: stores.data ?? NO_STORES,
      storeId,
      setStoreId,
      switchBusiness,
      signOut,
      can: (...roles) => roles.includes(role),
    };
  }, [me.data, stores.data, stores.isError, storeId, setStoreId, switchBusiness, signOut]);

  if (!value) return <>{fallback}</>;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
