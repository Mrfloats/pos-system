"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AccountSelect, longDate, useChart, usePeriods } from "@/components/accounts";
import { Badge, Button, Field, FormError, Input, PageHeader, Select, Spinner, Table, TableMessage, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";

const REPORTS = [
  { id: "profit-and-loss", label: "Profit and loss", dates: "range" },
  { id: "balance-sheet", label: "Balance sheet", dates: "asOf" },
  { id: "trial-balance", label: "Trial balance", dates: "asOf" },
  { id: "vat", label: "VAT summary", dates: "range" },
  { id: "aged-receivables", label: "Customers who owe you", dates: "asOf" },
  { id: "aged-payables", label: "Suppliers you owe", dates: "asOf" },
  { id: "ledger", label: "Account history (general ledger)", dates: "range" },
] as const;
type ReportId = (typeof REPORTS)[number]["id"];

interface Statement {
  currency: string;
  sections: { title: string; rows: { id: string; code: string; name: string; amount: string }[]; total: string }[];
  [key: string]: unknown;
}

export default function ReportsPage() {
  const periods = usePeriods();
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const [report, setReport] = useState<ReportId>(() => (REPORTS.find((r) => r.id === params.get("report"))?.id ?? "profit-and-loss"));
  const [accountId, setAccountId] = useState(() => params.get("account") ?? "");
  const [dates, setDates] = useState({ from: "", to: "", asOf: "" });

  if (!periods.data) return <Spinner />;
  const today = periods.data.today;
  const from = dates.from || `${today.slice(0, 8)}01`;
  const to = dates.to || today;
  const asOf = dates.asOf || today;
  const meta = REPORTS.find((r) => r.id === report)!;

  return (
    <div>
      <PageHeader
        title="Reports"
        description={`Read straight from the ledger, in ${periods.data.baseCurrency}.`}
        actions={
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden /> Print
          </Button>
        }
      />
      <div className="mb-6 flex flex-wrap items-end gap-3 print:hidden">
        <Field label="Report">
          {(id) => (
            <Select id={id} className="w-72" value={report} onChange={(e) => setReport(e.target.value as ReportId)}>
              {REPORTS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {meta.dates === "range" ? (
          <>
            <Field label="From">{(id) => <Input id={id} type="date" className="w-44" value={from} max={to} onChange={(e) => setDates({ ...dates, from: e.target.value })} />}</Field>
            <Field label="To">{(id) => <Input id={id} type="date" className="w-44" value={to} min={from} onChange={(e) => setDates({ ...dates, to: e.target.value })} />}</Field>
          </>
        ) : (
          <Field label="As at">{(id) => <Input id={id} type="date" className="w-44" value={asOf} onChange={(e) => setDates({ ...dates, asOf: e.target.value })} />}</Field>
        )}
        {report === "ledger" && <LedgerAccountPicker value={accountId} onChange={setAccountId} />}
      </div>

      <h2 className="mb-4 hidden text-xl font-semibold print:block">
        {meta.label} · {meta.dates === "range" ? `${longDate(from)} to ${longDate(to)}` : `as at ${longDate(asOf)}`}
      </h2>

      {report === "profit-and-loss" && <ProfitAndLoss from={from} to={to} />}
      {report === "balance-sheet" && <BalanceSheet asOf={asOf} />}
      {report === "trial-balance" && <TrialBalance asOf={asOf} />}
      {report === "vat" && <Vat from={from} to={to} />}
      {report === "aged-receivables" && <Aged kind="receivables" asOf={asOf} />}
      {report === "aged-payables" && <Aged kind="payables" asOf={asOf} />}
      {report === "ledger" && (accountId ? <Ledger accountId={accountId} from={from} to={to} /> : <p className="text-sm text-ink-soft">Choose an account.</p>)}
    </div>
  );
}

function useReport<T>(path: string, query: Record<string, string>) {
  return useQuery({ queryKey: ["reports", path, query], queryFn: () => api<T>(`/accounting/reports/${path}`, { query }) });
}

function Loading({ q, children }: { q: { isLoading: boolean; error: Error | null }; children: () => React.ReactNode }) {
  if (q.isLoading) return <Spinner />;
  if (q.error) return <FormError message={q.error.message} />;
  return <>{children()}</>;
}

function LedgerAccountPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const chart = useChart();
  return (
    <Field label="Account">
      {(id) => <AccountSelect id={id} className="w-72" accounts={chart.data ?? []} value={value} onChange={onChange} />}
    </Field>
  );
}

/** A titled list of accounts with a total, used by the profit and loss and the balance sheet. */
function StatementSection({ section }: { section: Statement["sections"][number] }) {
  return (
    <section className="card">
      <h3 className="border-b border-line px-5 py-3 font-semibold">{section.title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {section.rows.length === 0 && (
            <tr>
              <td className="px-5 py-3 text-ink-faint">Nothing in this period.</td>
            </tr>
          )}
          {section.rows.map((r) => (
            <tr key={r.id} className="border-b border-line/60">
              <td className="px-5 py-2">
                {r.code && (
                  <Link href={`/accounts/reports?report=ledger&account=${r.id}`} className="text-ink-faint hover:underline">
                    {r.code}
                  </Link>
                )}{" "}
                {r.name}
              </td>
              <td className="px-5 py-2 text-right tabular-nums">{money(r.amount)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="px-5 py-2.5">Total {section.title.toLowerCase()}</td>
            <td className="px-5 py-2.5 text-right tabular-nums">{money(section.total)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Bottom({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border-2 border-ledger-700 bg-ledger-50 px-5 py-4">
      <span className="font-semibold">{label}</span>
      <span className={`text-xl font-semibold tabular-nums ${good === false ? "text-danger" : "text-ledger-800"}`}>{money(value)}</span>
    </div>
  );
}

function ProfitAndLoss({ from, to }: { from: string; to: string }) {
  const q = useReport<Statement & { grossProfit: string; netProfit: string }>("profit-and-loss", { from, to });
  return (
    <Loading q={q}>
      {() => {
        const r = q.data!;
        const [income, cos, expenses] = r.sections;
        return (
          <div className="flex max-w-3xl flex-col gap-4">
            <StatementSection section={income} />
            <StatementSection section={cos} />
            <Bottom label={Number(r.grossProfit) < 0 ? "Gross loss" : "Gross profit"} value={String(Math.abs(Number(r.grossProfit)))} good={Number(r.grossProfit) >= 0} />
            <StatementSection section={expenses} />
            <Bottom label={Number(r.netProfit) < 0 ? "Net loss" : "Net profit"} value={String(Math.abs(Number(r.netProfit)))} good={Number(r.netProfit) >= 0} />
          </div>
        );
      }}
    </Loading>
  );
}

function BalanceSheet({ asOf }: { asOf: string }) {
  const q = useReport<Statement & { totalAssets: string; totalLiabilitiesAndEquity: string; balanced: boolean }>("balance-sheet", { asOf });
  return (
    <Loading q={q}>
      {() => {
        const r = q.data!;
        return (
          <div className="flex max-w-3xl flex-col gap-4">
            <StatementSection section={r.sections[0]} />
            <StatementSection section={r.sections[1]} />
            <StatementSection section={r.sections[2]} />
            <Bottom label="Liabilities and equity" value={r.totalLiabilitiesAndEquity} />
            {!r.balanced && <FormError message="The balance sheet doesn't balance. Please report this; it points to a fault in the system." />}
          </div>
        );
      }}
    </Loading>
  );
}

function TrialBalance({ asOf }: { asOf: string }) {
  const q = useReport<{
    rows: { id: string; code: string; name: string; debit: string | null; credit: string | null }[];
    totalDebit: string;
    totalCredit: string;
    balanced: boolean;
  }>("trial-balance", { asOf });
  return (
    <Loading q={q}>
      {() => {
        const r = q.data!;
        return (
          <div className="max-w-3xl card">
            <Table>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th align="right">Debit</Th>
                  <Th align="right">Credit</Th>
                </tr>
              </thead>
              <tbody>
                {r.rows.length === 0 && <TableMessage colSpan={3}>Nothing posted yet.</TableMessage>}
                {r.rows.map((row) => (
                  <tr key={row.id}>
                    <Td>
                      <span className="text-ink-faint">{row.code}</span> {row.name}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {row.debit ? money(row.debit) : ""}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {row.credit ? money(row.credit) : ""}
                    </Td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <Td>
                    Totals <Badge tone={r.balanced ? "green" : "red"}>{r.balanced ? "Balanced" : "Out of balance"}</Badge>
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {money(r.totalDebit)}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {money(r.totalCredit)}
                  </Td>
                </tr>
              </tbody>
            </Table>
          </div>
        );
      }}
    </Loading>
  );
}

interface VatRow {
  rateName: string;
  rate: string | null;
  net: string;
  tax: string;
}

function Vat({ from, to }: { from: string; to: string }) {
  const q = useReport<{ sales: VatRow[]; purchases: VatRow[]; outputTax: string; inputTax: string; netPayable: string }>("vat", { from, to });
  const block = (title: string, rows: VatRow[], total: string) => (
    <section className="card">
      <h3 className="border-b border-line px-5 py-3 font-semibold">{title}</h3>
      <Table>
        <thead>
          <tr>
            <Th>Rate</Th>
            <Th align="right">Value before VAT</Th>
            <Th align="right">VAT</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <TableMessage colSpan={3}>Nothing in this period.</TableMessage>}
          {rows.map((r) => (
            <tr key={r.rateName}>
              <Td>{r.rateName}</Td>
              <Td align="right" className="tabular-nums">
                {money(r.net)}
              </Td>
              <Td align="right" className="tabular-nums">
                {money(r.tax)}
              </Td>
            </tr>
          ))}
          <tr className="font-semibold">
            <Td>Total</Td>
            <Td />
            <Td align="right" className="tabular-nums">
              {money(total)}
            </Td>
          </tr>
        </tbody>
      </Table>
    </section>
  );
  return (
    <Loading q={q}>
      {() => {
        const r = q.data!;
        const refund = Number(r.netPayable) < 0;
        return (
          <div className="flex max-w-3xl flex-col gap-4">
            {block("Sales (output VAT)", r.sales, r.outputTax)}
            {block("Purchases and expenses (input VAT)", r.purchases, r.inputTax)}
            <Bottom label={refund ? "VAT ZIMRA owes you" : "VAT to pay ZIMRA"} value={String(Math.abs(Number(r.netPayable)))} />
            <p className="text-xs text-ink-faint">From invoices, bills and expenses dated in the period. Till sales will be added once the till app is connected. Check figures against your fiscal device reports before filing.</p>
          </div>
        );
      }}
    </Loading>
  );
}

interface AgedParty {
  id: string;
  name: string;
  current: string;
  "1-30": string;
  "31-60": string;
  "61-90": string;
  "90+": string;
  total: string;
  documents: { id: string; number: string; dueDate: string; currencyCode: string; balance: string; daysOverdue: number }[];
}

function Aged({ kind, asOf }: { kind: "receivables" | "payables"; asOf: string }) {
  const q = useReport<{ buckets: string[]; parties: AgedParty[]; totals: Omit<AgedParty, "id" | "name" | "documents"> }>(`aged-${kind}`, { asOf });
  const labels: Record<string, string> = { current: "Not yet due", "1-30": "1–30 days late", "31-60": "31–60", "61-90": "61–90", "90+": "Over 90" };
  const docPath = kind === "receivables" ? "/accounts/invoices" : "/accounts/bills";
  return (
    <Loading q={q}>
      {() => {
        const r = q.data!;
        const cols = r.buckets as (keyof typeof r.totals)[];
        return (
          <div className="card">
            <Table>
              <thead>
                <tr>
                  <Th>{kind === "receivables" ? "Customer" : "Supplier"}</Th>
                  {cols.map((b) => (
                    <Th key={b} align="right" className={b === "current" ? "" : "hidden md:table-cell"}>
                      {labels[b]}
                    </Th>
                  ))}
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {r.parties.length === 0 && <TableMessage colSpan={cols.length + 2}>{kind === "receivables" ? "No customer owes you anything." : "You don't owe any supplier."}</TableMessage>}
                {r.parties.map((p) => (
                  <tr key={p.id}>
                    <Td>
                      <span className="font-medium">{p.name}</span>
                      <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
                        {p.documents.map((d) => (
                          <Link key={d.id} href={`${docPath}/${d.id}`} className={`hover:underline ${d.daysOverdue > 0 ? "text-danger" : "text-ink-faint"}`}>
                            {d.number}
                          </Link>
                        ))}
                      </span>
                    </Td>
                    {cols.map((b) => (
                      <Td key={b} align="right" className={`tabular-nums ${b === "current" ? "" : "hidden md:table-cell"} ${b !== "current" && Number(p[b]) > 0 ? "text-danger" : ""}`}>
                        {Number(p[b]) ? money(p[b]) : "—"}
                      </Td>
                    ))}
                    <Td align="right" className="font-medium tabular-nums">
                      {money(p.total)}
                    </Td>
                  </tr>
                ))}
                {r.parties.length > 0 && (
                  <tr className="font-semibold">
                    <Td>Total</Td>
                    {cols.map((b) => (
                      <Td key={b} align="right" className={`tabular-nums ${b === "current" ? "" : "hidden md:table-cell"}`}>
                        {money(r.totals[b])}
                      </Td>
                    ))}
                    <Td align="right" className="tabular-nums">
                      {money(r.totals.total)}
                    </Td>
                  </tr>
                )}
              </tbody>
            </Table>
          </div>
        );
      }}
    </Loading>
  );
}

function Ledger({ accountId, from, to }: { accountId: string; from: string; to: string }) {
  const q = useReport<{
    account: { code: string; name: string };
    openingBalance: string;
    closingBalance: string;
    lines: { entryId: string; number: string; date: string; description: string; reference: string | null; debit: string | null; credit: string | null; balance: string; foreignAmount: string | null; currencyCode: string | null }[];
  }>("general-ledger", { accountId, from, to });
  return (
    <Loading q={q}>
      {() => {
        const r = q.data!;
        return (
          <div className="card">
            <h3 className="border-b border-line px-5 py-3 font-semibold">
              {r.account.code} · {r.account.name}
            </h3>
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Details</Th>
                  <Th align="right">Debit</Th>
                  <Th align="right">Credit</Th>
                  <Th align="right">Balance</Th>
                </tr>
              </thead>
              <tbody>
                <tr className="text-ink-soft">
                  <Td>{longDate(from)}</Td>
                  <Td>Balance brought forward</Td>
                  <Td />
                  <Td />
                  <Td align="right" className="tabular-nums">
                    {money(r.openingBalance)}
                  </Td>
                </tr>
                {r.lines.length === 0 && <TableMessage colSpan={5}>Nothing posted in this period.</TableMessage>}
                {r.lines.map((l, i) => (
                  <tr key={`${l.entryId}-${i}`}>
                    <Td className="whitespace-nowrap">{longDate(l.date)}</Td>
                    <Td>
                      <Link href={`/accounts/journal?entry=${l.entryId}`} className="hover:text-ledger-700 hover:underline">
                        {l.description}
                      </Link>
                      <span className="block text-xs text-ink-faint">
                        {l.number}
                        {l.reference && ` · ${l.reference}`}
                        {l.foreignAmount && ` · ${money(l.foreignAmount, l.currencyCode ?? undefined)}`}
                      </span>
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {l.debit ? money(l.debit) : ""}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {l.credit ? money(l.credit) : ""}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {money(l.balance)}
                    </Td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <Td>{longDate(to)}</Td>
                  <Td>Closing balance</Td>
                  <Td />
                  <Td />
                  <Td align="right" className="tabular-nums">
                    {money(r.closingBalance)}
                  </Td>
                </tr>
              </tbody>
            </Table>
          </div>
        );
      }}
    </Loading>
  );
}
