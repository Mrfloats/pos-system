"use client";

import { useParams } from "next/navigation";
import { DocumentView } from "@/components/accounts";

export default function PurchasePage() {
  const { id } = useParams<{ id: string }>();
  return <DocumentView kind="bill" id={id} title="Purchase" back={{ href: "/suppliers/purchases", label: "Purchases" }} />;
}
