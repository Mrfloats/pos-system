"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CloudUpload, Download, FileSpreadsheet, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, FormError, PageHeader, Table, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";

/** Columns we understand, and the header names people tend to use for them. */
const COLUMNS = [
  { key: "reference", label: "Reference", required: true, names: ["reference", "ref", "receipt", "invoice", "number", "invoice no"] },
  { key: "date", label: "Date", required: true, names: ["date", "sold at", "datetime", "time"] },
  { key: "store", label: "Store code", required: true, names: ["store", "store code", "shop", "branch"] },
  { key: "item", label: "Item code", required: true, names: ["item", "sku", "barcode", "code", "product code", "item code"] },
  { key: "quantity", label: "Quantity", required: true, names: ["quantity", "qty"] },
  { key: "unitPrice", label: "Unit price", required: false, names: ["unit price", "price", "unitprice"] },
  { key: "customer", label: "Customer", required: false, names: ["customer", "customer name", "client"] },
  { key: "paymentMethod", label: "Payment", required: false, names: ["payment", "payment method", "method", "paid by"] },
  { key: "currencyCode", label: "Currency", required: false, names: ["currency", "currency code"] },
] as const;
type Key = (typeof COLUMNS)[number]["key"];

const TEMPLATE = "reference,date,store,item,quantity,unit price,customer,payment,currency\nS-1001,2026-10-01 09:15,MAIN,6001067000011,2,1.00,Cash Customer,cash,USD\nS-1001,2026-10-01 09:15,MAIN,6001067000042,1,,Cash Customer,cash,USD\n";

/** Minimal CSV reader: commas, quoted fields with "" escapes, CRLF or LF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const METHOD_WORDS: Record<string, string> = { cash: "cash", card: "card", swipe: "card", pos: "card", mobile: "mobile", ecocash: "mobile", onemoney: "mobile", innbucks: "mobile", bank: "bank", transfer: "bank", rtgs: "bank" };

interface Result {
  imported: number;
  skipped: number;
  errors: { reference: string; message: string }[];
}

export default function ImportSalesPage() {
  const qc = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<Key, string>[]>([]);
  const [mapped, setMapped] = useState<Key[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const load = async (file: File) => {
    setError(null);
    setResult(null);
    setFileName(file.name);
    const [header, ...body] = parseCsv(await file.text());
    if (!header || !body.length) return setError("That file has no rows. Save your spreadsheet as CSV and try again.");
    const index = new Map<Key, number>();
    header.forEach((h, i) => {
      const name = h.trim().toLowerCase().replace(/[_-]+/g, " ");
      const col = COLUMNS.find((c) => (c.names as readonly string[]).includes(name));
      if (col && !index.has(col.key)) index.set(col.key, i);
    });
    const missing = COLUMNS.filter((c) => c.required && !index.has(c.key));
    if (missing.length) return setError(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.map((m) => m.label).join(", ")}. Download the template to see the layout.`);
    setMapped([...index.keys()]);
    setRows(body.map((r) => Object.fromEntries(COLUMNS.map((c) => [c.key, index.has(c.key) ? (r[index.get(c.key)!] ?? "").trim() : ""])) as Record<Key, string>));
  };

  const run = useMutation({
    mutationFn: () =>
      api<Result>("/sales/import", {
        method: "POST",
        body: {
          rows: rows.map((r) => ({
            reference: r.reference,
            // "2026-10-01 09:15" → ISO; a plain date stays a date.
            date: r.date.includes(" ") ? r.date.replace(" ", "T") : r.date,
            store: r.store,
            item: r.item,
            quantity: r.quantity,
            unitPrice: r.unitPrice || undefined,
            customer: r.customer || undefined,
            paymentMethod: METHOD_WORDS[r.paymentMethod.toLowerCase()] ?? undefined,
            currencyCode: r.currencyCode ? r.currencyCode.toUpperCase() : undefined,
          })),
        },
      }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const sales = new Set(rows.map((r) => r.reference)).size;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Import sales invoices"
        description="Bring in sales from another till system or a spreadsheet. Rows with the same reference become one sale, paid in full. Stock and the books are updated like any other sale, and importing the same file twice won't double up."
        actions={
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="sales-import-template.csv" className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium shadow-sm hover:bg-paper">
            <Download className="size-4" aria-hidden /> Template
          </a>
        }
      />

      <label className="card flex cursor-pointer flex-col items-center gap-3 border-2 border-dashed border-line-strong/70 px-6 py-12 text-center transition hover:border-ledger-600 hover:bg-ledger-50/40">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-sm">
          <CloudUpload className="size-7" aria-hidden />
        </span>
        <span className="font-semibold">{fileName || "Choose a CSV file"}</span>
        <span className="text-sm text-ink-soft">Columns: reference, date, store, item (SKU or barcode), quantity — plus unit price, customer, payment and currency if you have them.</span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void load(f);
            e.target.value = "";
          }}
        />
      </label>

      <FormError message={error} />

      {rows.length > 0 && !result && (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-6 py-4">
            <p className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="size-4 text-ledger-700" aria-hidden />
              <strong>{rows.length}</strong> rows · <strong>{sales}</strong> sales
            </p>
            <Button busy={run.isPending} onClick={() => run.mutate()}>
              Import {sales} sale{sales === 1 ? "" : "s"}
            </Button>
          </div>
          <Table>
            <thead>
              <tr>
                {COLUMNS.filter((c) => mapped.includes(c.key)).map((c) => (
                  <Th key={c.key}>{c.label}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((r, i) => (
                <tr key={i}>
                  {COLUMNS.filter((c) => mapped.includes(c.key)).map((c) => (
                    <Td key={c.key} className="text-ink-soft">
                      {r[c.key] || "—"}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
          {rows.length > 12 && <p className="px-6 py-3 text-xs text-ink-faint">…and {rows.length - 12} more rows</p>}
        </section>
      )}

      {result && (
        <section className="card flex flex-col gap-4 p-6">
          <div className="flex flex-wrap gap-6">
            <p className="flex items-center gap-2 text-lg font-semibold text-ledger-700">
              <CheckCircle2 className="size-5" aria-hidden /> {result.imported} imported
            </p>
            {result.skipped > 0 && <p className="text-lg font-semibold text-ink-soft">{result.skipped} already imported</p>}
            {result.errors.length > 0 && (
              <p className="flex items-center gap-2 text-lg font-semibold text-danger">
                <TriangleAlert className="size-5" aria-hidden /> {result.errors.length} not imported
              </p>
            )}
          </div>
          {result.errors.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-xl bg-danger-soft p-4 text-sm text-danger">
              {result.errors.map((e) => (
                <li key={e.reference}>
                  <strong>{e.reference}</strong>: {e.message}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Link href="/sales/invoices" className="inline-flex h-10 items-center rounded-xl bg-ledger-800 px-4 text-sm font-medium text-white hover:bg-ledger-700">
              See sales
            </Link>
            <Button variant="secondary" onClick={() => (setRows([]), setResult(null), setFileName(""))}>
              Import another file
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
