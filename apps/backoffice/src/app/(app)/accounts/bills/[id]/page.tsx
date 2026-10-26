"use client";

import { useParams } from "next/navigation";
import { DocumentView } from "@/components/accounts";

export default function BillPage() {
  const { id } = useParams<{ id: string }>();
  return <DocumentView kind="bill" id={id} />;
}
