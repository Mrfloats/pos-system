import { redirect } from "next/navigation";

/** Stock opens on its product list. */
export default function StockPage() {
  redirect("/stock/products");
}
