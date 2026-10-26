"use client";

import { useParams } from "next/navigation";
import { SaleView } from "@/components/sales";

export default function SalePage() {
  const { id } = useParams<{ id: string }>();
  return <SaleView id={id} />;
}
