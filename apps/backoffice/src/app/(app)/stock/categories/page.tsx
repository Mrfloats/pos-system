"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Badge, Button, Dialog, Field, FormError, Input, PageHeader, Spinner, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, Category } from "@/lib/api";
import { MANAGERS, useSession } from "@/lib/session";

const SWATCHES = ["#155040", "#2563eb", "#16a34a", "#d97706", "#dc2626", "#9333ea", "#0891b2", "#64748b"];

export default function CategoriesPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/categories") });
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (c: Partial<Category>) => {
      const body = { name: c.name, color: c.color ?? undefined, sortOrder: Number(c.sortOrder ?? 0), active: c.active ?? true };
      return c.id ? api(`/categories/${c.id}`, { method: "PATCH", body }) : api("/categories", { method: "POST", body });
    },
    onSuccess: (_, c) => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      toast(c.id ? "Category saved" : "Category added");
      setEditing(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      toast("Category deleted. Its products are now uncategorised.");
      setEditing(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Categories"
        description="Group products for the till screen and for reports. The order here is the order of the till's tabs."
        actions={can(...MANAGERS) && <Button onClick={() => (setError(null), setEditing({ color: SWATCHES[0], sortOrder: (categories.data?.length ?? 0) + 1 }))}>Add category</Button>}
      />
      <div className="card">
        {categories.isLoading ? (
          <div className="px-5">
            <Spinner />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th align="right">Till order</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {!categories.data?.length && <TableMessage colSpan={3}>No categories yet. Add one to start grouping your products.</TableMessage>}
              {categories.data?.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <span className="inline-flex items-center gap-2.5">
                      <span className="size-3 rounded-sm" style={{ background: c.color ?? "#c4cdc5" }} aria-hidden />
                      <span className="font-medium">{c.name}</span>
                      {!c.active && <Badge>Hidden</Badge>}
                    </span>
                  </Td>
                  <Td align="right" className="text-ink-soft">
                    {c.sortOrder}
                  </Td>
                  <Td align="right">
                    {can(...MANAGERS) && (
                      <Button variant="ghost" onClick={() => (setError(null), setEditing(c))}>
                        Edit
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit category" : "Add category"}>
        {editing && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              save.mutate(editing);
            }}
          >
            <Field label="Name">
              {(id) => <Input id={id} required autoFocus value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />}
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Colour on the till</legend>
              <div className="flex flex-wrap gap-2">
                {SWATCHES.map((s) => (
                  <label key={s} className="cursor-pointer">
                    <input type="radio" name="color" className="peer sr-only" checked={editing.color === s} onChange={() => setEditing({ ...editing, color: s })} />
                    <span className="block size-8 rounded-md ring-offset-2 peer-checked:ring-2 peer-checked:ring-ink peer-focus-visible:ring-2 peer-focus-visible:ring-ledger-600" style={{ background: s }} />
                    <span className="sr-only">{s}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Till order" hint="Lower numbers appear first.">
              {(id) => (
                <Input id={id} type="number" min={0} value={editing.sortOrder ?? 0} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} />
              )}
            </Field>
            <FormError message={error} />
            <div className="flex justify-between gap-2">
              <Button type="submit" busy={save.isPending}>
                {editing.id ? "Save category" : "Add category"}
              </Button>
              {editing.id && (
                <Button type="button" variant="danger" busy={remove.isPending} onClick={() => remove.mutate(editing.id!)}>
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
