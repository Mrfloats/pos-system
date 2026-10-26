import { redirect } from "next/navigation";

/** Sales opens on its list of sales invoices. */
export default function SalesPage() {
  redirect("/sales/invoices");
}
