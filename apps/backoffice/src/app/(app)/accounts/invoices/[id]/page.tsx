"use client";

import { useParams } from "next/navigation";
import { DocumentView } from "@/components/accounts";

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  return <DocumentView kind="invoice" id={id} />;
}
