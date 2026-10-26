"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AccountSelect, isPostable, longDate, MoneyInput, useChart, useInvalidateBooks, usePeriods } from "@/components/accounts";
import { useToast } from "@/components/toast";
import { Badge, Button, Checkbox, Dialog, Field, FormError, Input, PageHeader, Pager, Select, Spinner } from "@/components/ui";
import { api, JournalEntry, Page } from "@/lib/api";
import { money } from "@/lib/format";
import { ACCOUNTANTS, useSession } from "@/lib/session";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  opening: "Opening balance",
  invoice: "Invoice",
  invoice_payment: "Payment received",
  bill: "Bill",
  bill_payment: "Bill payment",
  expense: "Expense",
  transfer: "Transfer",
  stock: "Stock",
  sale: "Till sale",
  reversal: "Reversal",
};

export default function JournalPage() {
  const { can } = useSession();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  // Invoices, bills and the general ledger link here with ?entry=<id> to show one entry.
  const [entryId, setEntryId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("entry"),
  );

  useEffect(() => {
    const t = setTimeout(() => (setDebounced(search.trim()), setPage(1)), 250);
    return () => clearTimeout(t);
  }, [search]);

  const journals = useQuery({
    queryKey: ["journals", { debounced, source, page }],
    queryFn: () => api<Page<JournalEntry>>("/accounting/journals", { query: { search: debounced, source, page, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });
  const single = useQuery({
    queryKey: ["journals", "one", entryId],
    queryFn: () => api<JournalEntry>(`/accounting/journals/${entryId}`),
    enabled: !!entryId,
  });

  return (
    <div>
      <PageHeader
        title="Journal"
        description="Every entry in the books, newest first. Invoices, bills, payments, expenses and stock post here by themselves; manual entries are for corrections and opening balances."
        actions={
          can(...ACCOUNTANTS) && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden /> New journal entry
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-ink-faint" aria-hidden />
          <Input aria-label="Search journal" placeholder="Number, description or reference" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select aria-label="Type of entry" className="w-48" value={source} onChange={(e) => (setSource(e.target.value), setPage(1))}>
          <option value="">All entries</option>
          {Object.entries(SOURCE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </div>

      {journals.isLoading ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-3">
          {journals.data?.items.length === 0 && <p className="card px-5 py-12 text-center text-sm text-ink-soft">No journal entries match.</p>}
          {journals.data?.items.map((e) => <EntryCard key={e.id} entry={e} />)}
          {journals.data && (
            <div className="card empty:hidden">
              <Pager page={page} pageSize={journals.data.pageSize} total={journals.data.total} onPage={setPage} />
            </div>
          )}
        </div>
      )}

      <Dialog open={!!entryId} onClose={() => setEntryId(null)} title={single.data ? `Journal entry ${single.data.number}` : "Journal entry"} wide>
        {single.isLoading ? <Spinner /> : single.error ? <FormError message={single.error.message} /> : single.data && <EntryCard entry={single.data} bare />}
      </Dialog>
      <JournalDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function EntryCard({ entry: e, bare }: { entry: JournalEntry; bare?: boolean }) {
  const { can } = useSession();
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const reversible = ["manual", "opening", "transfer"].includes(e.source) && !e.reversedBy;
  const reverse = useMutation({
    mutationFn: () => api<JournalEntry>(`/accounting/journals/${e.id}/reverse`, { method: "POST", body: {} }),
    onSuccess: (r) => {
      invalidate();
      toast(`Reversed by ${r.number}`);
    },
    onError: (err: Error) => toast(err.message, "error"),
  });
  const totalDebit = e.lines.reduce((s, l) => s + Number(l.debit), 0);

  return (
    <article className={bare ? "" : "card"}>
      <header className={`flex flex-wrap items-start justify-between gap-3 ${bare ? "pb-3" : "border-b border-line px-5 py-3"}`}>
        <div>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{e.number}</span>
            <span className="text-ink-soft">{longDate(e.date)}</span>
            <Badge tone={e.source === "reversal" ? "amber" : e.source === "manual" || e.source === "opening" ? "green" : "neutral"}>{SOURCE_LABELS[e.source] ?? e.source}</Badge>
            {e.reversedBy && <Badge tone="red">Reversed by {e.reversedBy}</Badge>}
          </p>
          <p className="mt-1 text-sm">{e.description}</p>
          <p className="text-xs text-ink-faint">
            {e.reference && `Ref ${e.reference} · `}
            {e.createdByName ?? "System"}
          </p>
        </div>
        {reversible && can(...ACCOUNTANTS) && (
          <Button
            variant="secondary"
            className="h-8"
            busy={reverse.isPending}
            onClick={() => {
              if (confirm(`Reverse ${e.number}? An equal and opposite entry will cancel it.`)) reverse.mutate();
            }}
          >
            Reverse
          </Button>
        )}
      </header>
      <table className="w-full text-sm">
        <thead className="sr-only">
          <tr>
            <th>Account</th>
            <th>Debit</th>
            <th>Credit</th>
          </tr>
        </thead>
        <tbody>
          {e.lines.map((l) => (
            <tr key={l.id} className="border-b border-line/60 last:border-0">
              <td className={`py-1.5 ${bare ? "" : "px-5"} ${Number(l.credit) ? "pl-10 sm:pl-14" : ""}`}>
                <span className="text-ink-faint">{l.accountCode}</span> {l.accountName}
                {l.memo && <span className="block text-xs text-ink-faint">{l.memo}</span>}
                {l.foreignAmount && (
                  <span className="block text-xs text-ink-faint">
                    {money(l.foreignAmount, l.currencyCode ?? undefined)}
                  </span>
                )}
              </td>
              <td className="w-28 py-1.5 text-right tabular-nums">{Number(l.debit) ? money(l.debit) : ""}</td>
              <td className={`w-28 py-1.5 text-right tabular-nums ${bare ? "" : "pr-5"}`}>{Number(l.credit) ? money(l.credit) : ""}</td>
            </tr>
          ))}
          <tr className="text-xs text-ink-faint">
            <td className={`py-1.5 ${bare ? "" : "px-5"}`}>Total</td>
            <td className="py-1.5 text-right tabular-nums">{money(totalDebit)}</td>
            <td className={`py-1.5 text-right tabular-nums ${bare ? "" : "pr-5"}`}>{money(totalDebit)}</td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}

interface LineDraft {
  key: number;
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
}

function JournalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const chart = useChart();
  const periods = usePeriods();
  const accounts = (chart.data ?? []).filter(isPostable);
  const blank = (key: number): LineDraft => ({ key, accountId: "", debit: "", credit: "", memo: "" });
  const [form, setForm] = useState({ date: "", description: "", reference: "", opening: false });
  const [lines, setLines] = useState<LineDraft[]>([blank(0), blank(1)]);
  const [nextKey, setNextKey] = useState(2);
  const [error, setError] = useState<string | null>(null);

  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError(null);
      setForm({ date: periods.data?.today ?? "", description: "", reference: "", opening: false });
      setLines([blank(0), blank(1)]);
    }
  }

  const debits = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const credits = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.round(debits * 100) === Math.round(credits * 100) && debits > 0;
  const setLine = (key: number, patch: Partial<LineDraft>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = useMutation({
    mutationFn: () =>
      api<JournalEntry>("/accounting/journals", {
        method: "POST",
        body: {
          date: form.date,
          description: form.description.trim(),
          reference: form.reference.trim() || undefined,
          opening: form.opening,
          lines: lines
            .filter((l) => l.accountId)
            .map((l) => ({ accountId: l.accountId, debit: l.debit || undefined, credit: l.credit || undefined, memo: l.memo.trim() || undefined })),
        },
      }),
    onSuccess: (je) => {
      invalidate();
      toast(`${je.number} posted`);
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onClose={onClose} title="New journal entry" wide>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date">{(id) => <Input id={id} type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />}</Field>
          <Field label="Description" className="sm:col-span-2">
            {(id) => <Input id={id} required placeholder="Owner's capital paid into the bank" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
          </Field>
          <Field label="Reference">{(id) => <Input id={id} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />}</Field>
          <div className="flex items-end pb-2 sm:col-span-2">
            <Checkbox label="These are opening balances from my old books" checked={form.opening} onChange={(e) => setForm({ ...form, opening: e.target.checked })} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="hidden grid-cols-12 gap-2 text-xs font-medium text-ink-soft sm:grid">
            <span className="col-span-5">Account</span>
            <span className="col-span-3">Note</span>
            <span className="col-span-2 text-right">Debit</span>
            <span className="col-span-2 text-right">Credit</span>
          </div>
          {lines.map((l, i) => (
            <div key={l.key} className="grid grid-cols-12 items-center gap-2">
              <AccountSelect aria-label={`Line ${i + 1} account`} className="col-span-12 sm:col-span-5" accounts={accounts} value={l.accountId} onChange={(v) => setLine(l.key, { accountId: v })} />
              <Input aria-label={`Line ${i + 1} note`} className="col-span-12 sm:col-span-3" value={l.memo} onChange={(e) => setLine(l.key, { memo: e.target.value })} />
              <MoneyInput aria-label={`Line ${i + 1} debit`} className="col-span-5 sm:col-span-2" value={l.debit} onChange={(e) => setLine(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} />
              <MoneyInput aria-label={`Line ${i + 1} credit`} className="col-span-5 sm:col-span-2" value={l.credit} onChange={(e) => setLine(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} />
              {lines.length > 2 && (
                <button type="button" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} className="col-span-2 justify-self-end rounded-md p-1.5 text-ink-faint hover:bg-danger-soft hover:text-danger sm:hidden" aria-label={`Remove line ${i + 1}`}>
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <Button type="button" variant="secondary" onClick={() => (setLines([...lines, blank(nextKey)]), setNextKey(nextKey + 1))}>
              <Plus className="size-4" aria-hidden /> Add line
            </Button>
            <p className={`text-sm tabular-nums ${balanced ? "text-ledger-700" : "text-ink-soft"}`}>
              Debits {money(debits)} · Credits {money(credits)}
              {!balanced && debits + credits > 0 && <span className="ml-2 font-medium text-danger">Off by {money(Math.abs(debits - credits))}</span>}
            </p>
          </div>
        </div>
        <FormError message={error} />
        <Button type="submit" busy={save.isPending} disabled={!balanced}>
          Post entry
        </Button>
      </form>
    </Dialog>
  );
}
