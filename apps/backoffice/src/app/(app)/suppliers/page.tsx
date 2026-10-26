import { redirect } from "next/navigation";

/** Suppliers opens on purchases. */
export default function SuppliersPage() {
  redirect("/suppliers/purchases");
}
