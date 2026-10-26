"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import { Badge, Button, Dialog, Field, FormError, Input, PageHeader, Pager, Select, Spinner, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, Customer, CustomerGroup, Page } from "@/lib/api";
import { money } from "@/lib/format";
import { MANAGERS, useSession } from "@/lib/session";

interface PriceList {
  id: string;
  name: string;
}

const empty: Partial<Customer> = { name: "", phone: "", email: "", address: "", tin: "", vatNumber: "", priceListId: null, creditLimit: "", groupId: null };

export default function CustomersPage() {
  const { can, session } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Partial<Customer> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => (setDebounced(search.trim()), setPage(1)), 250);
    return () => clearTimeout(t);
  }, [search]);

  const customers = useQuery({
    queryKey: ["customers", { debounced, page }],
    queryFn: () => api<Page<Customer>>("/customers", { query: { search: debounced, page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });
  const priceLists = useQuery({ queryKey: ["price-lists"], queryFn: () => api<PriceList[]>("/price-lists") });
  const groups = useQuery({ queryKey: ["customer-groups"], queryFn: () => api<CustomerGroup[]>("/customer-groups") });

  const save = useMutation({
    mutationFn: (c: Partial<Customer>) => {
      const opt = (v?: string | null) => (v && v.trim() ? v.trim() : undefined);
      const body = {
        name: c.name?.trim(),
        phone: opt(c.phone),
        email: opt(c.email),
        address: opt(c.address),
        tin: opt(c.tin),
        vatNumber: opt(c.vatNumber),
        priceListId: c.priceListId || null,
        creditLimit: opt(c.creditLimit) ?? null,
        groupId: c.groupId || null,
      };
      return c.id ? api(`/customers/${c.id}`, { method: "PATCH", body }) : api("/customers", { method: "POST", body });
    },
    onSuccess: (_, c) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast(c.id ? "Customer saved" : "Customer added");
      setEditing(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const set = (k: keyof Customer) => (e: React.ChangeEvent<HTMLInputElement>) => setEditing({ ...editing!, [k]: e.target.value });

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Account customers, wholesale buyers, and anyone who needs their tax details on a fiscal invoice."
        actions={<Button onClick={() => (setError(null), setEditing(empty))}>Add customer</Button>}
      />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-ink-faint" aria-hidden />
        <Input aria-label="Search customers" placeholder="Search by name, phone, email or TIN" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>
      <div className="card">
        {customers.isLoading ? (
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
                <Th className="hidden md:table-cell">Group</Th>
                <Th align="right">Credit limit</Th>
              </tr>
            </thead>
            <tbody>
              {customers.data?.items.length === 0 && (
                <TableMessage colSpan={5}>{debounced ? "No customers match your search." : "No customers yet. Walk-in sales don't need one."}</TableMessage>
              )}
              {customers.data?.items.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-paper/60" onClick={() => (setError(null), setEditing(c))}>
                  <Td>
                    <button type="button" className="text-left font-medium hover:text-ledger-700 hover:underline">
                      {c.name}
                    </button>
                    {!c.active && (
                      <span className="ml-2">
                        <Badge>Inactive</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="hidden text-ink-soft md:table-cell">{c.phone ?? "—"}</Td>
                  <Td className="hidden text-ink-soft lg:table-cell">{c.tin ?? "—"}</Td>
                  <Td className="hidden text-ink-soft md:table-cell">{groups.data?.find((g) => g.id === c.groupId)?.name ?? "—"}</Td>
                  <Td align="right">{c.creditLimit ? money(c.creditLimit) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {customers.data && <Pager page={page} pageSize={customers.data.pageSize} total={customers.data.total} onPage={setPage} />}
      </div>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit customer" : "Add customer"} wide>
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
            <Field label="Phone">{(id) => <Input id={id} type="tel" value={editing.phone ?? ""} onChange={set("phone")} />}</Field>
            <Field label="Email">{(id) => <Input id={id} type="email" value={editing.email ?? ""} onChange={set("email")} />}</Field>
            <Field label="Address" className="sm:col-span-2">
              {(id) => <Input id={id} value={editing.address ?? ""} onChange={set("address")} />}
            </Field>
            <Field label="TIN" hint="Needed on fiscal tax invoices for business buyers.">
              {(id) => <Input id={id} value={editing.tin ?? ""} onChange={set("tin")} />}
            </Field>
            <Field label="VAT number">{(id) => <Input id={id} value={editing.vatNumber ?? ""} onChange={set("vatNumber")} />}</Field>
            <Field label="Customer group" hint="Its discount applies to their sales.">
              {(id) => (
                <Select id={id} value={editing.groupId ?? ""} onChange={(e) => setEditing({ ...editing, groupId: e.target.value || null })}>
                  <option value="">No group</option>
                  {groups.data?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {Number(g.discountPercent) > 0 ? ` (${Number(g.discountPercent)}% off)` : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {can(...MANAGERS) && (
              <>
                <Field label="Price list">
                  {(id) => (
                    <Select id={id} value={editing.priceListId ?? ""} onChange={(e) => setEditing({ ...editing, priceListId: e.target.value || null })}>
                      <option value="">Standard prices</option>
                      {priceLists.data?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={`Credit limit (${session.tenant.baseCurrency})`} hint="Leave empty for cash-only customers.">
                  {(id) => <Input id={id} inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={editing.creditLimit ?? ""} onChange={set("creditLimit")} />}
                </Field>
              </>
            )}
            <div className="sm:col-span-2">
              <FormError message={error} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" busy={save.isPending}>
                {editing.id ? "Save customer" : "Add customer"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
