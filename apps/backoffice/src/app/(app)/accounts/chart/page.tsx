"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { TYPE_LABELS, TYPE_ORDER, useChart, useInvalidateBooks } from "@/components/accounts";
import { useToast } from "@/components/toast";
import { Badge, Button, Checkbox, Dialog, Field, FormError, Input, PageHeader, Select, Spinner, Table, Td, Th } from "@/components/ui";
import { Account, AccountType, api } from "@/lib/api";
import { money } from "@/lib/format";
import { ACCOUNTANTS, useSession } from "@/lib/session";

type Draft = Partial<Account> & { type: AccountType };

export default function ChartPage() {
  const { can } = useSession();
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const chart = useChart();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const canEdit = can(...ACCOUNTANTS);

  const save = useMutation({
    mutationFn: (a: Draft) => {
      const body = {
        code: a.code?.trim(),
        name: a.name?.trim(),
        description: a.description?.trim() || undefined,
        ...(a.systemKey ? {} : { isBank: a.type === "asset" ? !!a.isBank : false }),
        ...(a.id ? { active: a.active } : { type: a.type }),
      };
      return a.id ? api(`/accounting/accounts/${a.id}`, { method: "PATCH", body }) : api("/accounting/accounts", { method: "POST", body });
    },
    onSuccess: (_, a) => {
      invalidate();
      toast(a.id ? "Account saved" : "Account added");
      setEditing(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  if (chart.isLoading) return <Spinner />;
  if (chart.error) return <FormError message={chart.error.message} />;
  const accounts = chart.data!.filter((a) => showInactive || a.active);

  return (
    <div>
      <PageHeader
        title="Chart of accounts"
        description="The accounts your books are kept in. Accounts marked “automatic” are posted to by invoices, bills, payments and stock; you can rename them but not remove them."
        actions={canEdit && <Button onClick={() => (setError(null), setEditing({ type: "expense", code: "", name: "", active: true }))}>Add account</Button>}
      />
      <div className="mb-4">
        <Checkbox label="Show switched-off accounts" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
      </div>
      <div className="flex flex-col gap-6">
        {TYPE_ORDER.map((type) => {
          const list = accounts.filter((a) => a.type === type);
          if (!list.length) return null;
          return (
            <section key={type} className="card">
              <h2 className="border-b border-line px-5 py-3 text-base font-semibold">{TYPE_LABELS[type]}</h2>
              <Table>
                <thead>
                  <tr>
                    <Th className="w-20">Code</Th>
                    <Th>Name</Th>
                    <Th align="right">Balance</Th>
                    <Th className="hidden sm:table-cell" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.id} className={a.active ? "" : "text-ink-faint"}>
                      <Td className="text-ink-soft tabular-nums">{a.code}</Td>
                      <Td>
                        <Link href={`/accounts/reports?report=ledger&account=${a.id}`} className="font-medium hover:text-ledger-700 hover:underline">
                          {a.name}
                        </Link>
                        <span className="ml-2 inline-flex gap-1 align-middle">
                          {a.systemKey && <Badge>Automatic</Badge>}
                          {a.isBank && <Badge tone="green">Money</Badge>}
                          {!a.active && <Badge>Off</Badge>}
                        </span>
                        {a.description && <span className="block text-xs text-ink-faint">{a.description}</span>}
                      </Td>
                      <Td align="right" className={`tabular-nums ${Number(a.balance) < 0 ? "text-danger" : ""}`}>
                        {a.hasActivity ? money(a.balance) : "—"}
                      </Td>
                      <Td align="right" className="hidden sm:table-cell">
                        {canEdit && (
                          <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => (setError(null), setEditing(a))}>
                            Edit
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </section>
          );
        })}
      </div>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.name}` : "Add account"}>
        {editing && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              save.mutate(editing);
            }}
          >
            <div className="grid grid-cols-3 gap-4">
              <Field label="Code">{(id) => <Input id={id} required maxLength={12} value={editing.code ?? ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />}</Field>
              <Field label="Name" className="col-span-2">
                {(id) => <Input id={id} required autoFocus value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />}
              </Field>
            </div>
            <Field label="Type" hint={editing.id ? "The type can't change once the account exists." : "Expense codes starting with 5 count as cost of sales on the profit and loss."}>
              {(id) => (
                <Select id={id} disabled={!!editing.id} value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as AccountType })}>
                  {TYPE_ORDER.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Description">{(id) => <Input id={id} value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />}</Field>
            {editing.type === "asset" && !editing.systemKey && (
              <Checkbox label="Money account (cash, bank or mobile money)" checked={!!editing.isBank} onChange={(e) => setEditing({ ...editing, isBank: e.target.checked })} />
            )}
            {editing.id && !editing.systemKey && (
              <Checkbox label="In use" checked={editing.active !== false} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
            )}
            <FormError message={error} />
            <Button type="submit" busy={save.isPending}>
              {editing.id ? "Save account" : "Add account"}
            </Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}
