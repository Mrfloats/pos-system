"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Badge, Button, Checkbox, Dialog, Field, FormError, Input, PageHeader, Spinner, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, Unit } from "@/lib/api";
import { MANAGERS, useSession } from "@/lib/session";

export default function UnitsPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const units = useQuery({ queryKey: ["units"], queryFn: () => api<Unit[]>("/units") });
  const [editing, setEditing] = useState<Partial<Unit> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = can(...MANAGERS);

  const done = (message: string) => {
    qc.invalidateQueries({ queryKey: ["units"] });
    toast(message);
    setEditing(null);
  };
  const save = useMutation({
    mutationFn: (u: Partial<Unit>) => {
      const body = { name: u.name?.trim(), abbreviation: u.abbreviation?.trim(), allowsDecimal: !!u.allowsDecimal };
      return u.id ? api(`/units/${u.id}`, { method: "PATCH", body }) : api("/units", { method: "POST", body });
    },
    onSuccess: (_, u) => done(u.id ? "Unit saved" : "Unit added"),
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/units/${id}`, { method: "DELETE" }),
    onSuccess: () => done("Unit deleted"),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Units of measure"
        description="How each product is counted: each, kilograms, litres, cases. Weighed and poured units allow decimals."
        actions={
          canEdit && (
            <Button onClick={() => (setError(null), setEditing({ name: "", abbreviation: "", allowsDecimal: false }))}>
              <Plus className="size-4" aria-hidden /> New unit
            </Button>
          )
        }
      />
      <div className="card max-w-3xl overflow-hidden">
        {units.isLoading ? (
          <div className="px-6">
            <Spinner />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Unit</Th>
                <Th>Short</Th>
                <Th>Quantities</Th>
                {canEdit && <Th />}
              </tr>
            </thead>
            <tbody>
              {!units.data?.length && <TableMessage colSpan={4}>No units yet.</TableMessage>}
              {units.data?.map((u) => (
                <tr key={u.id}>
                  <Td className="font-medium">{u.name}</Td>
                  <Td className="font-mono text-ink-soft">{u.abbreviation}</Td>
                  <Td>{u.allowsDecimal ? <Badge tone="green">Decimals, e.g. 1.25</Badge> : <Badge>Whole numbers</Badge>}</Td>
                  {canEdit && (
                    <Td align="right">
                      <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => (setError(null), setEditing(u))}>
                        Edit
                      </Button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.name}` : "New unit"}>
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
              <Field label="Name" className="col-span-2">
                {(id) => <Input id={id} required autoFocus placeholder="Case" value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />}
              </Field>
              <Field label="Short">{(id) => <Input id={id} required maxLength={10} placeholder="cs" value={editing.abbreviation ?? ""} onChange={(e) => setEditing({ ...editing, abbreviation: e.target.value })} />}</Field>
            </div>
            <Checkbox label="Allow decimals (weighed or poured)" checked={!!editing.allowsDecimal} onChange={(e) => setEditing({ ...editing, allowsDecimal: e.target.checked })} />
            <FormError message={error} />
            <div className="flex gap-2">
              <Button type="submit" busy={save.isPending}>
                {editing.id ? "Save unit" : "Add unit"}
              </Button>
              {editing.id && (
                <Button type="button" variant="danger" busy={remove.isPending} onClick={() => confirm(`Delete ${editing.name}? Products using it will have no unit.`) && remove.mutate(editing.id!)}>
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
