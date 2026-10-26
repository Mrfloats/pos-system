"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LockOpen, Printer } from "lucide-react";
import { useState } from "react";
import { methodLabel } from "@/components/sales";
import { StoreSelect } from "@/components/stock";
import { useToast } from "@/components/toast";
import { Badge, Button, Dialog, Field, FormError, Input, PageHeader, Pager, Spinner, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, Currency, Page, Shift } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { FRONT_OF_HOUSE, useSession } from "@/lib/session";

const firstOfMonth = () => `${new Date().toLocaleDateString("en-CA").slice(0, 8)}01`;
const today = () => new Date().toLocaleDateString("en-CA");

/**
 * Shifts with their cash-up. As the Operations page, cashiers open and close
 * shifts here; as the reconciliation report, it's a read-only list for a period.
 */
export function ShiftsBoard({ report }: { report?: boolean }) {
  const { can } = useSession();
  const [storeId, setStoreId] = useState("");
  const [range, setRange] = useState({ from: report ? firstOfMonth() : "", to: report ? today() : "" });
  const [page, setPage] = useState(1);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState<Shift | null>(null);

  const shifts = useQuery({
    queryKey: ["shifts", { storeId, range, page }],
    queryFn: () => api<Page<Shift>>("/shifts", { query: { storeId, from: range.from || undefined, to: range.to || undefined, page, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });

  const variance = (s: Shift) => s.cash.filter((c) => c.variance !== null && Number(c.variance) !== 0);

  return (
    <div>
      <PageHeader
        title={report ? "Shift reconciliation" : "Shifts & cash-up"}
        description={
          report
            ? "For each shift: the float, cash taken, cash sent away, what should be in the drawer, and what was counted."
            : "Open a shift with the float in the drawer; close it by counting the cash. Sales made while it's open belong to it."
        }
        actions={
          report ? (
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden /> Print
            </Button>
          ) : (
            can(...FRONT_OF_HOUSE) && (
              <Button onClick={() => setOpening(true)}>
                <LockOpen className="size-4" aria-hidden /> Open a shift
              </Button>
            )
          )
        }
      />
      <div className="mb-6 flex flex-wrap items-end gap-3 print:hidden">
        <Field label="Store">{(id) => <StoreSelect id={id} allowAll className="w-52" value={storeId} onChange={(v) => (setStoreId(v), setPage(1))} />}</Field>
        <Field label="From">{(id) => <Input id={id} type="date" className="w-44" value={range.from} onChange={(e) => (setRange({ ...range, from: e.target.value }), setPage(1))} />}</Field>
        <Field label="To">{(id) => <Input id={id} type="date" className="w-44" value={range.to} onChange={(e) => (setRange({ ...range, to: e.target.value }), setPage(1))} />}</Field>
      </div>

      {shifts.isLoading ? (
        <Spinner />
      ) : !shifts.data?.items.length ? (
        <div className="card px-6 py-16 text-center text-sm text-ink-faint">No shifts{report ? " in this period" : " yet"}.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {shifts.data.items.map((s) => {
            const off = variance(s);
            return (
              <article key={s.id} className="card overflow-hidden">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-6 py-4">
                  <div>
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{s.number}</span>
                      {s.closedAt ? (
                        off.length ? (
                          <Badge tone="red">Out by {off.map((c) => `${c.currencyCode} ${money(c.variance)}`).join(", ")}</Badge>
                        ) : (
                          <Badge tone="green">Balanced</Badge>
                        )
                      ) : (
                        <Badge tone="amber">Open</Badge>
                      )}
                    </p>
                    <p className="text-sm text-ink-soft">
                      {s.storeName} · {s.cashier ?? "—"} · {dateTime(s.openedAt)}
                      {s.closedAt && ` – ${dateTime(s.closedAt)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-right text-sm">
                      <span className="block text-xs text-ink-faint">
                        {s.salesCount} sales{s.returnsCount ? `, ${s.returnsCount} returns` : ""}
                      </span>
                      <span className="font-semibold tabular-nums">{money(s.netSalesBase)}</span>
                    </span>
                    {!report && !s.closedAt && <Button onClick={() => setClosing(s)}>Close & count</Button>}
                  </div>
                </header>
                <Table>
                  <thead>
                    <tr>
                      <Th>Cash</Th>
                      <Th align="right">Float</Th>
                      <Th align="right">Cash taken</Th>
                      <Th align="right" className="hidden sm:table-cell">
                        Sent away
                      </Th>
                      <Th align="right">Expected</Th>
                      <Th align="right">Counted</Th>
                      <Th align="right">Difference</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.cash.length === 0 && <TableMessage colSpan={7}>No cash yet.</TableMessage>}
                    {s.cash.map((c) => (
                      <tr key={c.currencyCode}>
                        <Td className="font-medium">{c.currencyCode}</Td>
                        <Td align="right" className="tabular-nums">
                          {money(c.openingFloat)}
                        </Td>
                        <Td align="right" className="tabular-nums">
                          {money(c.cashTaken)}
                        </Td>
                        <Td align="right" className="hidden tabular-nums sm:table-cell">
                          {Number(c.transferredOut) ? `−${money(c.transferredOut)}` : "—"}
                        </Td>
                        <Td align="right" className="font-semibold tabular-nums">
                          {money(c.expected)}
                        </Td>
                        <Td align="right" className="tabular-nums">
                          {c.counted === null ? "—" : money(c.counted)}
                        </Td>
                        <Td align="right" className={`font-semibold tabular-nums ${c.variance === null ? "text-ink-faint" : Number(c.variance) < 0 ? "text-danger" : Number(c.variance) > 0 ? "text-amber-ink" : "text-ledger-700"}`}>
                          {c.variance === null ? "—" : `${Number(c.variance) > 0 ? "+" : ""}${money(c.variance)}`}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {s.nonCash.length > 0 && (
                  <p className="border-t border-line/70 px-6 py-3 text-xs text-ink-soft">
                    Also taken: {s.nonCash.map((n) => `${methodLabel(n.method)} ${n.currencyCode} ${money(n.amount)}`).join(" · ")}
                  </p>
                )}
                {s.note && <p className="border-t border-line/70 px-6 py-3 text-xs text-ink-soft">Note: {s.note}</p>}
              </article>
            );
          })}
          <div className="card empty:hidden">
            <Pager page={page} pageSize={shifts.data.pageSize} total={shifts.data.total} onPage={setPage} />
          </div>
        </div>
      )}

      {!report && <OpenShiftDialog open={opening} onClose={() => setOpening(false)} />}
      {!report && <CloseShiftDialog shift={closing} onClose={() => setClosing(null)} />}
    </div>
  );
}

function useActiveCurrencies() {
  return useQuery({ queryKey: ["currencies"], queryFn: () => api<Currency[]>("/currencies") }).data?.filter((c) => c.active) ?? [];
}

function OpenShiftDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { storeId: current } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const currencies = useActiveCurrencies();
  const [storeId, setStoreId] = useState(current ?? "");
  const [float, setFloat] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api<Shift>("/shifts", { method: "POST", body: { storeId, openingFloat: Object.fromEntries(Object.entries(float).filter(([, v]) => v.trim())) } }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      toast(`Shift ${s.number} open`);
      setFloat({});
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onClose={onClose} title="Open a shift">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <Field label="Store">{(id) => <StoreSelect id={id} value={storeId} onChange={setStoreId} />}</Field>
        <p className="text-sm text-ink-soft">Cash in the drawer to start with (the float):</p>
        <div className="grid grid-cols-2 gap-3">
          {currencies.map((c) => (
            <Field key={c.code} label={c.code}>
              {(id) => <Input id={id} inputMode="decimal" placeholder="0.00" className="text-right" value={float[c.code] ?? ""} onChange={(e) => setFloat({ ...float, [c.code]: e.target.value })} />}
            </Field>
          ))}
        </div>
        <FormError message={error} />
        <Button type="submit" busy={save.isPending}>
          Open shift
        </Button>
      </form>
    </Dialog>
  );
}

function CloseShiftDialog({ shift, onClose }: { shift: Shift | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const currencies = useActiveCurrencies();
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api<Shift>(`/shifts/${shift!.id}/close`, {
        method: "POST",
        body: { countedCash: Object.fromEntries(Object.entries(counted).filter(([, v]) => v.trim())), note: note.trim() || undefined },
      }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      const off = s.cash.filter((c) => c.variance && Number(c.variance) !== 0);
      toast(off.length ? `Shift ${s.number} closed · out by ${off.map((c) => `${c.currencyCode} ${money(c.variance)}`).join(", ")}` : `Shift ${s.number} closed and balanced`, off.length ? "error" : "success");
      setCounted({});
      setNote("");
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });
  const codes = [...new Set([...(shift?.cash.map((c) => c.currencyCode) ?? []), ...currencies.map((c) => c.code)])];
  return (
    <Dialog open={!!shift} onClose={onClose} title={shift ? `Close ${shift.number}` : ""}>
      {shift && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          <p className="text-sm text-ink-soft">Count the cash in the drawer. We&apos;ll compare it with what should be there.</p>
          {codes.map((code) => {
            const line = shift.cash.find((c) => c.currencyCode === code);
            return (
              <Field key={code} label={`${code} counted`} hint={line ? `Expected ${money(line.expected)}` : undefined}>
                {(id) => <Input id={id} inputMode="decimal" placeholder="0.00" className="text-right" value={counted[code] ?? ""} onChange={(e) => setCounted({ ...counted, [code]: e.target.value })} />}
              </Field>
            );
          })}
          <Field label="Note">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <FormError message={error} />
          <Button type="submit" busy={save.isPending}>
            Close shift
          </Button>
        </form>
      )}
    </Dialog>
  );
}
