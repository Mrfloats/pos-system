"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import { Badge, Button, Dialog, Field, FormError, Input, PageHeader, Pager, Spinner, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, Page, Supplier } from "@/lib/api";
import { money } from "@/lib/format";

const empty: Partial<Supplier> = { name: "", contactName: "", phone: "", email: "", address: "", tin: "", vatNumber: "", paymentTermsDays: 30 };

export default function SuppliersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => (setDebounced(search.trim()), setPage(1)), 250);
    return () => clearTimeout(t);
  }, [search]);

  const suppliers = useQuery({
    queryKey: ["suppliers", { debounced, page }],
    queryFn: () => api<Page<Supplier>>("/suppliers", { query: { search: debounced, page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });

  const save = useMutation({
    mutationFn: (s: Partial<Supplier>) => {
      const opt = (v?: string | null) => (v && v.trim() ? v.trim() : undefined);
      const body = {
        name: s.name?.trim(),
        contactName: opt(s.contactName),
        phone: opt(s.phone),
        email: opt(s.email),
        address: opt(s.address),
        tin: opt(s.tin),
        vatNumber: opt(s.vatNumber),
        paymentTermsDays: Number(s.paymentTermsDays ?? 30),
        active: s.active,
      };
      return s.id ? api(`/suppliers/${s.id}`, { method: "PATCH", body }) : api("/suppliers", { method: "POST", body });
    },
    onSuccess: (_, s) => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      toast(s.id ? "Supplier saved" : "Supplier added");
      setEditing(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const set = (k: keyof Supplier) => (e: React.ChangeEvent<HTMLInputElement>) => setEditing({ ...editing!, [k]: e.target.value });

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="The businesses you buy from. What you owe each one comes from their unpaid bills."
        actions={<Button onClick={() => (setError(null), setEditing(empty))}>Add supplier</Button>}
      />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-ink-faint" aria-hidden />
        <Input aria-label="Search suppliers" placeholder="Name, phone or TIN" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>
      <div className="card">
        {suppliers.isLoading ? (
          <div className="px-5">
            <Spinner />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th className="hidden md:table-cell">Phone</Th>
                <Th className="hidden lg:table-cell">TIN</Th>
                <Th className="hidden sm:table-cell">Terms</Th>
                <Th align="right">You owe</Th>
              </tr>
            </thead>
            <tbody>
              {suppliers.data?.items.length === 0 && <TableMessage colSpan={5}>{debounced ? "No suppliers match." : "No suppliers yet."}</TableMessage>}
              {suppliers.data?.items.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-paper/60" onClick={() => (setError(null), setEditing(s))}>
                  <Td>
                    <button type="button" className="text-left font-medium hover:text-ledger-700 hover:underline">
                      {s.name}
                    </button>
                    {!s.active && (
                      <span className="ml-2">
                        <Badge>Inactive</Badge>
                      </span>
                    )}
                    {s.contactName && <span className="block text-xs text-ink-faint">{s.contactName}</span>}
                  </Td>
                  <Td className="hidden text-ink-soft md:table-cell">{s.phone ?? "—"}</Td>
                  <Td className="hidden text-ink-soft lg:table-cell">{s.tin ?? "—"}</Td>
                  <Td className="hidden text-ink-soft sm:table-cell">{s.paymentTermsDays ? `${s.paymentTermsDays} days` : "On receipt"}</Td>
                  <Td align="right">
                    {Number(s.owed) > 0 ? (
                      <Link href="/accounts/reports?report=aged-payables" onClick={(e) => e.stopPropagation()} className="font-medium hover:text-ledger-700 hover:underline">
                        {money(s.owed)}
                      </Link>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {suppliers.data && <Pager page={page} pageSize={suppliers.data.pageSize} total={suppliers.data.total} onPage={setPage} />}
      </div>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit supplier" : "Add supplier"} wide>
        {editing && (
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              save.mutate(editing);
            }}
          >
            <Field label="Name" className="sm:col-span-2">
              {(id) => <Input id={id} required autoFocus value={editing.name ?? ""} onChange={set("name")} />}
            </Field>
            <Field label="Contact person">{(id) => <Input id={id} value={editing.contactName ?? ""} onChange={set("contactName")} />}</Field>
            <Field label="Phone">{(id) => <Input id={id} type="tel" value={editing.phone ?? ""} onChange={set("phone")} />}</Field>
            <Field label="Email">{(id) => <Input id={id} type="email" value={editing.email ?? ""} onChange={set("email")} />}</Field>
            <Field label="Pays bills after (days)" hint="Used to suggest each bill's due date.">
              {(id) => <Input id={id} type="number" min={0} max={365} value={editing.paymentTermsDays ?? 30} onChange={(e) => setEditing({ ...editing, paymentTermsDays: Number(e.target.value) })} />}
            </Field>
            <Field label="Address" className="sm:col-span-2">
              {(id) => <Input id={id} value={editing.address ?? ""} onChange={set("address")} />}
            </Field>
            <Field label="TIN">{(id) => <Input id={id} value={editing.tin ?? ""} onChange={set("tin")} />}</Field>
            <Field label="VAT number">{(id) => <Input id={id} value={editing.vatNumber ?? ""} onChange={set("vatNumber")} />}</Field>
            <div className="sm:col-span-2">
              <FormError message={error} />
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" busy={save.isPending}>
                {editing.id ? "Save supplier" : "Add supplier"}
              </Button>
              {editing.id && (
                <Button type="button" variant="secondary" onClick={() => save.mutate({ ...editing, active: !editing.active })}>
                  {editing.active ? "Switch off" : "Switch back on"}
                </Button>
              )}
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
