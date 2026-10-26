"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Button, Dialog, Field, FormError, Input, PageHeader, Spinner } from "@/components/ui";
import { api, Attribute } from "@/lib/api";
import { MANAGERS, useSession } from "@/lib/session";

type Draft = { id?: string; name: string; values: string[] };

export default function AttributesPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const attrs = useQuery({ queryKey: ["attributes"], queryFn: () => api<Attribute[]>("/attributes") });
  const [editing, setEditing] = useState<Draft | null>(null);
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canEdit = can(...MANAGERS);

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = { name: d.name.trim(), values: d.values };
      return d.id ? api(`/attributes/${d.id}`, { method: "PATCH", body }) : api("/attributes", { method: "POST", body });
    },
    onSuccess: (_, d) => {
      qc.invalidateQueries({ queryKey: ["attributes"] });
      toast(d.id ? "Attribute saved" : "Attribute added");
      setEditing(null);
    },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/attributes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attributes"] });
      toast("Attribute deleted");
      setEditing(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const addValue = () => {
    const v = newValue.trim();
    if (!editing || !v) return;
    if (!editing.values.some((x) => x.toLowerCase() === v.toLowerCase())) setEditing({ ...editing, values: [...editing.values, v] });
    setNewValue("");
  };

  return (
    <div>
      <PageHeader
        title="Variant attributes"
        description="The ways one product comes in different versions, like Size or Flavour. Use them to name a product's variants consistently."
        actions={
          canEdit && (
            <Button onClick={() => (setError(null), setNewValue(""), setEditing({ name: "", values: [] }))}>
              <Plus className="size-4" aria-hidden /> New attribute
            </Button>
          )
        }
      />
      {attrs.isLoading ? (
        <Spinner />
      ) : !attrs.data?.length ? (
        <div className="card px-6 py-16 text-center text-sm text-ink-faint">No attributes yet. Add Size, Colour or Flavour to get started.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {attrs.data.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={!canEdit}
              onClick={() => (setError(null), setNewValue(""), setEditing({ id: a.id, name: a.name, values: a.values.map((v) => v.value) }))}
              className="card p-5 text-left transition-all enabled:hover:-translate-y-0.5 enabled:hover:shadow-[var(--shadow-lift)]"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{a.name}</span>
                <span className="text-xs text-ink-faint">{a.values.length} values</span>
              </span>
              <span className="mt-3 flex flex-wrap gap-1.5">
                {a.values.map((v) => (
                  <span key={v.id} className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-medium text-ink-soft ring-1 ring-line">
                    {v.value}
                  </span>
                ))}
              </span>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.name}` : "New attribute"}>
        {editing && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              save.mutate(editing);
            }}
          >
            <Field label="Name">{(id) => <Input id={id} required autoFocus placeholder="Size" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />}</Field>
            <Field label="Values" hint="Type a value and press Enter. They appear in this order.">
              {(id) => (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <Input
                      id={id}
                      placeholder="Large"
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addValue();
                        }
                      }}
                    />
                    <Button type="button" variant="secondary" onClick={addValue}>
                      Add
                    </Button>
                  </div>
                  {editing.values.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {editing.values.map((v) => (
                        <span key={v} className="inline-flex items-center gap-1 rounded-full bg-ledger-50 py-0.5 pr-1 pl-2.5 text-xs font-medium text-ledger-800">
                          {v}
                          <button type="button" onClick={() => setEditing({ ...editing, values: editing.values.filter((x) => x !== v) })} className="rounded-full p-0.5 hover:bg-ledger-100" aria-label={`Remove ${v}`}>
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Field>
            <FormError message={error} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" busy={save.isPending}>
                {editing.id ? "Save attribute" : "Add attribute"}
              </Button>
              {editing.id && (
                <Button type="button" variant="danger" busy={remove.isPending} onClick={() => confirm(`Delete ${editing.name}?`) && remove.mutate(editing.id!)}>
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
