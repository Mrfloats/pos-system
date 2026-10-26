"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Button, Dialog, Field, FormError, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { api, CustomerGroup, PriceList } from "@/lib/api";
import { MANAGERS, useSession } from "@/lib/session";

export default function CustomerGroupsPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const groups = useQuery({ queryKey: ["customer-groups"], queryFn: () => api<CustomerGroup[]>("/customer-groups") });
  const lists = useQuery({ queryKey: ["price-lists"], queryFn: () => api<PriceList[]>("/price-lists") });
  const [editing, setEditing] = useState<Partial<CustomerGroup> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = can(...MANAGERS);

  const done = (m: string) => {
    qc.invalidateQueries({ queryKey: ["customer-groups"] });
    toast(m);
    setEditing(null);
  };
  const save = useMutation({
    mutationFn: (g: Partial<CustomerGroup>) => {
      const body = { name: g.name?.trim(), description: g.description?.trim() || undefined, discountPercent: g.discountPercent || "0", priceListId: g.priceListId || null };
      return g.id ? api(`/customer-groups/${g.id}`, { method: "PATCH", body }) : api("/customer-groups", { method: "POST", body });
    },
    onSuccess: (_, g) => done(g.id ? "Group saved" : "Group added"),
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/customer-groups/${id}`, { method: "DELETE" }),
    onSuccess: () => done("Group deleted"),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Customer groups"
        description="Group customers such as staff, schools or wholesale buyers. A group's discount comes off every sale to its members automatically."
        actions={
          canEdit && (
            <Button onClick={() => (setError(null), setEditing({ name: "", discountPercent: "0" }))}>
              <Plus className="size-4" aria-hidden /> New group
            </Button>
          )
        }
      />
      {groups.isLoading ? (
        <Spinner />
      ) : !groups.data?.length ? (
        <div className="card px-6 py-16 text-center text-sm text-ink-faint">No groups yet.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.data.map((g) => (
            <button
              key={g.id}
              type="button"
              disabled={!canEdit}
              onClick={() => (setError(null), setEditing(g))}
              className="card flex flex-col gap-3 p-5 text-left transition-all enabled:hover:-translate-y-0.5 enabled:hover:shadow-[var(--shadow-lift)]"
            >
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="block font-semibold">{g.name}</span>
                  {g.description && <span className="block text-xs text-ink-faint">{g.description}</span>}
                </span>
                {Number(g.discountPercent) > 0 && (
                  <span className="rounded-xl bg-gradient-to-br from-fuchsia-400 to-violet-600 px-2.5 py-1 text-sm font-semibold text-white shadow-sm">{Number(g.discountPercent)}% off</span>
                )}
              </span>
              <span className="mt-auto flex items-center justify-between text-xs text-ink-soft">
                <span className="flex items-center gap-1.5">
                  <Users className="size-3.5" aria-hidden /> {g.members ?? 0} customer{g.members === 1 ? "" : "s"}
                </span>
                {g.priceListId && <span>{lists.data?.find((l) => l.id === g.priceListId)?.name} prices</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.name}` : "New customer group"}>
        {editing && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              save.mutate(editing);
            }}
          >
            <Field label="Name">{(id) => <Input id={id} required autoFocus placeholder="Staff" value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />}</Field>
            <Field label="Description">{(id) => <Input id={id} value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />}</Field>
            <Field label="Discount (%)" hint="Taken off each line when selling to a member.">
              {(id) => <Input id={id} inputMode="decimal" className="w-32 text-right" value={editing.discountPercent ?? ""} onChange={(e) => setEditing({ ...editing, discountPercent: e.target.value })} />}
            </Field>
            <Field label="Price list" hint="Optional, for reference on the till.">
              {(id) => (
                <Select id={id} value={editing.priceListId ?? ""} onChange={(e) => setEditing({ ...editing, priceListId: e.target.value || null })}>
                  <option value="">Normal prices</option>
                  {lists.data?.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <FormError message={error} />
            <div className="flex gap-2">
              <Button type="submit" busy={save.isPending}>
                {editing.id ? "Save group" : "Add group"}
              </Button>
              {editing.id && (
                <Button type="button" variant="danger" busy={remove.isPending} onClick={() => confirm(`Delete ${editing.name}? Its customers stay, without a group.`) && remove.mutate(editing.id!)}>
                  Delete
                </Button>
              )}
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
