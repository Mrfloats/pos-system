"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Badge, Button, Checkbox, Dialog, Field, FormError, Input, PageHeader, Section, Select, Table, TableMessage, Td, Th } from "@/components/ui";
import { api, Currency, Device, Store, TaxRate, Tenant } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { ADMINS, MANAGERS, useSession } from "@/lib/session";

export default function SettingsPage() {
  const { can } = useSession();
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Settings" description="Your business details, stores, tills, tax rates and currencies." />
      <BusinessDetails />
      <Stores />
      {can(...MANAGERS) && <Tills />}
      <TaxRates />
      <Currencies />
    </div>
  );
}

// ----- Business ------------------------------------------------------------------

function BusinessDetails() {
  const { session, can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const t = session.tenant;
  const [form, setForm] = useState({
    name: t.name,
    tin: t.tin ?? "",
    vatNumber: t.vatNumber ?? "",
    phone: t.phone ?? "",
    email: t.email ?? "",
    address: t.address ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api<Tenant>("/tenant", {
        method: "PATCH",
        body: Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || undefined])),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      toast("Business details saved");
    },
    onError: (e: Error) => setError(e.message),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <Section title="Business" description="Printed on receipts and sent with fiscal invoices.">
      <form
        className="grid gap-4 p-5 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <fieldset disabled={!can(...ADMINS)} className="contents">
          <Field label="Business name" className="md:col-span-2">
            {(id) => <Input id={id} required value={form.name} onChange={set("name")} />}
          </Field>
          <Field label="TIN">{(id) => <Input id={id} value={form.tin} onChange={set("tin")} />}</Field>
          <Field label="VAT number">{(id) => <Input id={id} value={form.vatNumber} onChange={set("vatNumber")} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} type="tel" value={form.phone} onChange={set("phone")} />}</Field>
          <Field label="Email">{(id) => <Input id={id} type="email" value={form.email} onChange={set("email")} />}</Field>
          <Field label="Address" className="md:col-span-2">
            {(id) => <Input id={id} value={form.address} onChange={set("address")} />}
          </Field>
        </fieldset>
        <p className="text-sm text-ink-soft md:col-span-2">
          Base currency {t.baseCurrency} · Country {t.country} · Time zone {t.timezone}
        </p>
        <div className="md:col-span-2">
          <FormError message={error} />
        </div>
        {can(...ADMINS) && (
          <div>
            <Button type="submit" busy={save.isPending}>
              Save business details
            </Button>
          </div>
        )}
      </form>
    </Section>
  );
}

// ----- Stores ----------------------------------------------------------------------

function Stores() {
  const { stores, can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Partial<Store> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (s: Partial<Store>) => {
      const body = { name: s.name, code: s.code, type: s.type, address: s.address || undefined, phone: s.phone || undefined, active: s.active };
      return s.id ? api(`/stores/${s.id}`, { method: "PATCH", body }) : api("/stores", { method: "POST", body });
    },
    onSuccess: (_, s) => {
      qc.invalidateQueries({ queryKey: ["stores"] });
      toast(s.id ? "Store saved" : "Store added");
      setDraft(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Section
      title="Stores and warehouses"
      description="Each keeps its own stock. Tills belong to one store."
      actions={can(...ADMINS) && <Button variant="secondary" onClick={() => (setError(null), setDraft({ type: "shop", active: true }))}>Add store</Button>}
    >
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Code</Th>
            <Th>Type</Th>
            <Th align="right">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {stores.map((s) => (
            <tr key={s.id}>
              <Td>
                <span className="font-medium">{s.name}</span> {!s.active && <Badge>Closed</Badge>}
              </Td>
              <Td className="text-ink-soft">{s.code}</Td>
              <Td className="text-ink-soft capitalize">{s.type}</Td>
              <Td align="right">
                {can(...ADMINS) && (
                  <Button variant="ghost" onClick={() => (setError(null), setDraft(s))}>
                    Edit
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Dialog open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? "Edit store" : "Add store"}>
        {draft && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              save.mutate(draft);
            }}
          >
            <Field label="Name">{(id) => <Input id={id} required autoFocus value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}</Field>
            <Field label="Code" hint="Short and unique, used on receipts. e.g. HRE01">
              {(id) => <Input id={id} required maxLength={12} value={draft.code ?? ""} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} />}
            </Field>
            <Field label="Type">
              {(id) => (
                <Select id={id} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Store["type"] })}>
                  <option value="shop">Shop</option>
                  <option value="warehouse">Warehouse</option>
                  <option value="restaurant">Restaurant</option>
                </Select>
              )}
            </Field>
            <Field label="Address">{(id) => <Input id={id} value={draft.address ?? ""} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />}</Field>
            {draft.id && <Checkbox label="Open for trading" checked={draft.active ?? true} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />}
            <FormError message={error} />
            <Button type="submit" busy={save.isPending}>
              {draft.id ? "Save store" : "Add store"}
            </Button>
          </form>
        )}
      </Dialog>
    </Section>
  );
}

// ----- Tills -----------------------------------------------------------------------

/** Devices running the Floatly Till app. They are added from the app itself, so here they are seen, renamed and switched off. */
function Tills() {
  const { stores, can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const devices = useQuery({ queryKey: ["devices"], queryFn: () => api<Device[]>("/devices") });
  const [draft, setDraft] = useState<Device | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (d: Device) => api(`/devices/${d.id}`, { method: "PATCH", body: { name: d.name, active: d.active } }),
    onSuccess: (_, d) => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      toast(d.active ? "Till saved" : `${d.name} is switched off`);
      setDraft(null);
    },
    onError: (e: Error) => setError(e.message),
  });
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "";

  return (
    <Section
      title="Tills"
      description="Phones, tablets, countertop tills and computers running the Floatly Till app. To add one, install the app and sign in on it as an owner or admin; staff then sign in with their till PIN."
    >
      <Table>
        <thead>
          <tr>
            <Th>Till</Th>
            <Th>Store</Th>
            <Th>Last used</Th>
            <Th align="right">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {devices.data?.length === 0 && <TableMessage colSpan={4}>No tills yet. Install Floatly Till on a device and sign in on it to add one.</TableMessage>}
          {devices.data?.map((d) => (
            <tr key={d.id}>
              <Td>
                <span className="font-medium">{d.name}</span> <span className="text-ink-faint">{d.code}</span>{" "}
                {!d.active ? <Badge>Switched off</Badge> : !d.registered && <Badge tone="amber">Not set up</Badge>}
              </Td>
              <Td className="text-ink-soft">{storeName(d.storeId)}</Td>
              <Td className="text-ink-soft">{dateTime(d.lastSeenAt)}</Td>
              <Td align="right">
                {can(...ADMINS) && (
                  <Button variant="ghost" onClick={() => (setError(null), setDraft(d))}>
                    Edit
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Dialog open={!!draft} onClose={() => setDraft(null)} title="Edit till">
        {draft && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              save.mutate(draft);
            }}
          >
            <Field label="Name">{(id) => <Input id={id} required autoFocus maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}</Field>
            <Checkbox label="Can be used" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
            <p className="text-sm text-ink-soft">Switch a till off if it is lost or stolen: nobody can sign in on it until it is switched on again.</p>
            <FormError message={error} />
            <Button type="submit" busy={save.isPending}>
              Save till
            </Button>
          </form>
        )}
      </Dialog>
    </Section>
  );
}

// ----- Tax rates -------------------------------------------------------------------

function TaxRates() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const rates = useQuery({ queryKey: ["tax-rates"], queryFn: () => api<TaxRate[]>("/tax-rates") });
  const [draft, setDraft] = useState<Partial<TaxRate> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (t: Partial<TaxRate>) => {
      const body = {
        name: t.name,
        code: t.code,
        rate: t.rate,
        inclusive: t.inclusive ?? true,
        isDefault: t.isDefault ?? false,
        fiscalTaxId: t.fiscalTaxId ?? undefined,
      };
      return t.id ? api(`/tax-rates/${t.id}`, { method: "PATCH", body }) : api("/tax-rates", { method: "POST", body });
    },
    onSuccess: (_, t) => {
      qc.invalidateQueries({ queryKey: ["tax-rates"] });
      toast(t.id ? "Tax rate saved" : "Tax rate added");
      setDraft(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Section
      title="Tax rates"
      description="Check these against your tax authority before you start selling."
      actions={can(...ADMINS) && <Button variant="secondary" onClick={() => (setError(null), setDraft({ inclusive: true }))}>Add tax rate</Button>}
    >
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Code</Th>
            <Th align="right">Rate</Th>
            <Th className="hidden md:table-cell">Prices</Th>
            <Th align="right">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rates.data?.map((t) => (
            <tr key={t.id}>
              <Td>
                <span className="font-medium">{t.name}</span> {t.isDefault && <Badge tone="green">Default</Badge>}
              </Td>
              <Td className="text-ink-soft">{t.code}</Td>
              <Td align="right">{Number(t.rate)}%</Td>
              <Td className="hidden text-ink-soft md:table-cell">{t.inclusive ? "Include tax" : "Tax added at till"}</Td>
              <Td align="right">
                {can(...ADMINS) && (
                  <Button variant="ghost" onClick={() => (setError(null), setDraft(t))}>
                    Edit
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Dialog open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? "Edit tax rate" : "Add tax rate"}>
        {draft && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              save.mutate(draft);
            }}
          >
            <Field label="Name">{(id) => <Input id={id} required autoFocus value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}</Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Code">
                {(id) => <Input id={id} required maxLength={12} value={draft.code ?? ""} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} />}
              </Field>
              <Field label="Rate (%)">
                {(id) => (
                  <Input id={id} required inputMode="decimal" pattern="\d{1,3}(\.\d{1,2})?" value={draft.rate ?? ""} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} />
                )}
              </Field>
            </div>
            <Field label="Fiscal tax ID (optional)" hint="The tax ID your fiscal device or ZIMRA FDMS expects.">
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  value={draft.fiscalTaxId ?? ""}
                  onChange={(e) => setDraft({ ...draft, fiscalTaxId: e.target.value ? Number(e.target.value) : null })}
                />
              )}
            </Field>
            <Checkbox label="Shelf prices already include this tax" checked={draft.inclusive ?? true} onChange={(e) => setDraft({ ...draft, inclusive: e.target.checked })} />
            <Checkbox label="Use for new products" checked={draft.isDefault ?? false} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />
            <FormError message={error} />
            <Button type="submit" busy={save.isPending}>
              {draft.id ? "Save tax rate" : "Add tax rate"}
            </Button>
          </form>
        )}
      </Dialog>
    </Section>
  );
}

// ----- Currencies ------------------------------------------------------------------

function Currencies() {
  const { session, can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: () => api<Currency[]>("/currencies") });
  const [draft, setDraft] = useState<Partial<Currency> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (c: Partial<Currency>) =>
      c.id
        ? api(`/currencies/${c.id}`, { method: "PATCH", body: { rateToBase: c.rateToBase, name: c.name, symbol: c.symbol } })
        : api("/currencies", { method: "POST", body: { code: c.code, name: c.name, symbol: c.symbol, rateToBase: c.rateToBase } }),
    onSuccess: (_, c) => {
      qc.invalidateQueries({ queryKey: ["currencies"] });
      toast(c.id ? "Exchange rate updated" : "Currency added");
      setDraft(null);
    },
    onError: (e: Error) => setError(e.message),
  });
  const base = session.tenant.baseCurrency;

  return (
    <Section
      title="Currencies"
      description={`Currencies the till accepts. Prices are kept in ${base} and converted at these rates.`}
      actions={can(...ADMINS) && <Button variant="secondary" onClick={() => (setError(null), setDraft({}))}>Add currency</Button>}
    >
      <Table>
        <thead>
          <tr>
            <Th>Currency</Th>
            <Th align="right">Rate</Th>
            <Th align="right">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {currencies.data?.map((c) => (
            <tr key={c.id}>
              <Td>
                <span className="font-medium">{c.code}</span> <span className="text-ink-soft">{c.name}</span> {c.isBase && <Badge tone="green">Base</Badge>}
              </Td>
              <Td align="right">{c.isBase ? "—" : `1 ${base} = ${Number(c.rateToBase).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${c.code}`}</Td>
              <Td align="right">
                {!c.isBase && can(...MANAGERS) && (
                  <Button variant="ghost" onClick={() => (setError(null), setDraft(c))}>
                    Update rate
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Dialog open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? `Update ${draft.code} rate` : "Add currency"}>
        {draft && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              save.mutate(draft);
            }}
          >
            {!draft.id && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Code" hint="e.g. ZWG, ZAR">
                    {(id) => <Input id={id} required autoFocus maxLength={3} value={draft.code ?? ""} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} />}
                  </Field>
                  <Field label="Symbol">{(id) => <Input id={id} required maxLength={6} value={draft.symbol ?? ""} onChange={(e) => setDraft({ ...draft, symbol: e.target.value })} />}</Field>
                </div>
                <Field label="Name">{(id) => <Input id={id} required value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}</Field>
              </>
            )}
            <Field label={`How many ${draft.code || "units"} for 1 ${base}?`}>
              {(id) => (
                <Input id={id} required inputMode="decimal" pattern="\d+(\.\d{1,6})?" value={draft.rateToBase ?? ""} onChange={(e) => setDraft({ ...draft, rateToBase: e.target.value })} />
              )}
            </Field>
            <FormError message={error} />
            <Button type="submit" busy={save.isPending}>
              {draft.id ? "Update rate" : "Add currency"}
            </Button>
          </form>
        )}
      </Dialog>
    </Section>
  );
}
