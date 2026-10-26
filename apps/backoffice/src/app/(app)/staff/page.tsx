"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Badge, Button, Checkbox, Dialog, Field, FormError, Input, PageHeader, Select, Spinner, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, Role, StaffMember } from "@/lib/api";
import { dateTime, ROLE_LABELS } from "@/lib/format";
import { ADMINS, useSession } from "@/lib/session";

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including other owners",
  admin: "Everything except changing owners",
  manager: "Products, prices, stock and customers",
  cashier: "Sells at the till, adds customers",
  waiter: "Takes orders on a handheld",
  stock_clerk: "Receives and counts stock",
  accountant: "Views records and reports",
};

interface Draft {
  id?: string;
  email: string;
  fullName: string;
  password: string;
  role: Role;
  pin: string;
  active: boolean;
  storeIds: string[];
}

export default function StaffPage() {
  const { can, stores, session } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const staff = useQuery({ queryKey: ["staff"], queryFn: () => api<StaffMember[]>("/staff") });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = can(...ADMINS);
  const roles = (Object.keys(ROLE_LABELS) as Role[]).filter((r) => r !== "owner" || session.membership.role === "owner");

  const save = useMutation({
    mutationFn: (d: Draft) => {
      if (d.id) {
        return api(`/staff/${d.id}`, {
          method: "PATCH",
          body: { role: d.role, active: d.active, pin: d.pin || undefined, storeIds: d.storeIds },
        });
      }
      return api("/staff", {
        method: "POST",
        body: { email: d.email, fullName: d.fullName, password: d.password || undefined, role: d.role, pin: d.pin || undefined, storeIds: d.storeIds },
      });
    },
    onSuccess: (_, d) => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      toast(d.id ? "Staff member saved" : "Staff member added");
      setDraft(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const storeName = (id: string) => stores.find((s) => s.id === id)?.code ?? "?";

  return (
    <div>
      <PageHeader
        title="Staff"
        description="Who can sign in, what they can do, and the PIN they use on the till."
        actions={
          isAdmin && (
            <Button onClick={() => (setError(null), setDraft({ email: "", fullName: "", password: "", role: "cashier", pin: "", active: true, storeIds: [] }))}>
              Add staff member
            </Button>
          )
        }
      />
      <div className="card">
        {staff.isLoading ? (
          <div className="px-5">
            <Spinner />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th className="hidden md:table-cell">Stores</Th>
                <Th className="hidden lg:table-cell">Last signed in</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {!staff.data?.length && <TableMessage colSpan={5}>Only you so far.</TableMessage>}
              {staff.data?.map((s) => (
                <tr key={s.id} className={s.active ? "" : "text-ink-faint"}>
                  <Td>
                    <div className="font-medium">{s.fullName}</div>
                    <div className="text-xs text-ink-soft">{s.email}</div>
                  </Td>
                  <Td>
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {ROLE_LABELS[s.role]}
                      {!s.active && <Badge tone="red">No access</Badge>}
                      {s.active && !s.hasPin && ["cashier", "waiter"].includes(s.role) && <Badge tone="amber">No till PIN</Badge>}
                    </span>
                  </Td>
                  <Td className="hidden text-ink-soft md:table-cell">{s.storeIds.length ? s.storeIds.map(storeName).join(", ") : "All stores"}</Td>
                  <Td className="hidden text-ink-soft lg:table-cell">{dateTime(s.lastLoginAt)}</Td>
                  <Td align="right">
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        onClick={() => (
                          setError(null),
                          setDraft({ id: s.id, email: s.email, fullName: s.fullName, password: "", role: s.role, pin: "", active: s.active, storeIds: s.storeIds })
                        )}
                      >
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

      <Dialog open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? `Edit ${draft.fullName}` : "Add staff member"} wide>
        {draft && (
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              save.mutate(draft);
            }}
          >
            {!draft.id && (
              <>
                <Field label="Full name">
                  {(id) => <Input id={id} required autoFocus value={draft.fullName} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })} />}
                </Field>
                <Field label="Email">
                  {(id) => <Input id={id} type="email" required value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />}
                </Field>
                <Field label="Temporary password" hint="Not needed if they already have an account." className="sm:col-span-2">
                  {(id) => (
                    <Input id={id} type="password" minLength={8} autoComplete="new-password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
                  )}
                </Field>
              </>
            )}
            <Field label="Role" hint={ROLE_HELP[draft.role]}>
              {(id) => (
                <Select id={id} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={draft.id ? "New till PIN" : "Till PIN"} hint="4 to 6 digits, unique in your business.">
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  pattern="\d{4,6}"
                  autoComplete="off"
                  placeholder={draft.id ? "Leave empty to keep" : ""}
                  value={draft.pin}
                  onChange={(e) => setDraft({ ...draft, pin: e.target.value })}
                />
              )}
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-sm font-medium">Stores</legend>
              <p className="mb-2 text-xs text-ink-soft">Tick none to allow every store.</p>
              <div className="flex flex-wrap gap-4">
                {stores.map((s) => (
                  <Checkbox
                    key={s.id}
                    label={s.name}
                    checked={draft.storeIds.includes(s.id)}
                    onChange={(e) =>
                      setDraft({ ...draft, storeIds: e.target.checked ? [...draft.storeIds, s.id] : draft.storeIds.filter((x) => x !== s.id) })
                    }
                  />
                ))}
              </div>
            </fieldset>
            {draft.id && (
              <div className="sm:col-span-2">
                <Checkbox label="Can sign in" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
              </div>
            )}
            <div className="sm:col-span-2">
              <FormError message={error} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" busy={save.isPending}>
                {draft.id ? "Save staff member" : "Add staff member"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
