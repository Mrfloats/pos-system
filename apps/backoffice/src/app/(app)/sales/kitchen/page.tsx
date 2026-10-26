"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChefHat, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import { Button, PageHeader, Select, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { qty } from "@/lib/format";
import { useSession } from "@/lib/session";

type Status = "pending" | "preparing" | "ready" | "served";

interface Ticket {
  saleId: string;
  number: string;
  customerName: string;
  soldAt: string;
  note: string | null;
  storeName: string;
  lines: { id: string; productName: string; variantName: string; quantity: string; station: string | null; status: Status; note: string | null }[];
}

const COLUMNS: { status: Exclude<Status, "served">; title: string; next: Status; action: string; tone: string }[] = [
  { status: "pending", title: "New", next: "preparing", action: "Start", tone: "from-amber-300 to-orange-500" },
  { status: "preparing", title: "Preparing", next: "ready", action: "Ready", tone: "from-sky-400 to-blue-600" },
  { status: "ready", title: "Ready to serve", next: "served", action: "Served", tone: "from-emerald-400 to-ledger-600" },
];

/** A ticket sits in the column of its least-advanced dish. */
const ticketStatus = (t: Ticket): Status => (["pending", "preparing", "ready"] as const).find((s) => t.lines.some((l) => l.status === s)) ?? "served";

export default function KitchenPage() {
  const { storeId } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [station, setStation] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const board = useQuery({
    queryKey: ["sales", "kitchen", storeId, station],
    queryFn: () => api<{ tickets: Ticket[]; stations: string[] }>("/sales/kitchen", { query: { storeId, station } }),
    refetchInterval: 10_000,
  });

  const move = useMutation({
    mutationFn: ({ saleId, status, lineIds }: { saleId: string; status: Status; lineIds?: string[] }) => api(`/sales/${saleId}/kitchen`, { method: "PATCH", body: { status, lineIds } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sales", "kitchen"] }),
    onError: (e: Error) => toast(e.message, "error"),
  });

  const minutes = (iso: string) => Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));

  return (
    <div>
      <PageHeader
        title="Kitchen orders"
        description="Dishes from sales, oldest first. Updates every few seconds."
        actions={
          <Select aria-label="Station" className="w-48" value={station} onChange={(e) => setStation(e.target.value)}>
            <option value="">All stations</option>
            {board.data?.stations.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        }
      />
      {board.isLoading ? (
        <Spinner />
      ) : !board.data?.tickets.length ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center text-sm text-ink-faint">
          <ChefHat className="size-10 text-ink-faint/60" aria-hidden />
          No orders waiting. Dishes appear here when a sale includes a menu item with a kitchen station.
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          {COLUMNS.map((col) => {
            const tickets = board.data.tickets.filter((t) => ticketStatus(t) === col.status);
            return (
              <section key={col.status} className="flex flex-col gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <span className={`size-2.5 rounded-full bg-gradient-to-br ${col.tone}`} />
                  {col.title}
                  <span className="text-ink-faint">{tickets.length}</span>
                </h2>
                {tickets.length === 0 && <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-xs text-ink-faint">Nothing here</p>}
                {tickets.map((t) => {
                  const wait = minutes(t.soldAt);
                  return (
                    <article key={t.saleId} className="card overflow-hidden">
                      <header className={`flex items-center justify-between bg-gradient-to-r px-4 py-2.5 text-white ${col.tone}`}>
                        <span className="font-semibold">{t.number}</span>
                        <span className={`flex items-center gap-1 text-xs font-medium ${wait >= 15 ? "rounded-full bg-white/25 px-2 py-0.5" : ""}`}>
                          <Clock className="size-3.5" aria-hidden /> {wait} min
                        </span>
                      </header>
                      <div className="px-4 py-3">
                        <p className="text-xs text-ink-faint">
                          {t.customerName} · {t.storeName}
                        </p>
                        <ul className="mt-2 flex flex-col gap-1.5">
                          {t.lines.map((l) => (
                            <li key={l.id} className={`flex items-start justify-between gap-2 text-sm ${l.status !== col.status ? "text-ink-faint line-through" : ""}`}>
                              <span>
                                <span className="font-semibold tabular-nums">{qty(l.quantity)}×</span> {l.productName}
                                {l.variantName !== "Default" && ` · ${l.variantName}`}
                                {l.note && <span className="block text-xs text-amber-ink">{l.note}</span>}
                              </span>
                              {l.station && <span className="shrink-0 rounded-full bg-paper px-2 py-0.5 text-[11px] text-ink-soft">{l.station}</span>}
                            </li>
                          ))}
                        </ul>
                        {t.note && <p className="mt-2 rounded-lg bg-amber-soft px-2 py-1 text-xs text-amber-ink">{t.note}</p>}
                        <Button
                          className="mt-3 w-full"
                          busy={move.isPending && move.variables?.saleId === t.saleId}
                          onClick={() =>
                            move.mutate({ saleId: t.saleId, status: col.next, lineIds: t.lines.filter((l) => l.status === col.status).map((l) => l.id) })
                          }
                        >
                          {col.action}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
