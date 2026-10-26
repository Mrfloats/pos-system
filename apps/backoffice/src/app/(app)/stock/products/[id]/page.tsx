"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ProductForm } from "@/components/product-form";
import { Badge, FormError, PageHeader, Spinner } from "@/components/ui";
import { api, Product } from "@/lib/api";

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const product = useQuery({ queryKey: ["product", id], queryFn: () => api<Product>(`/products/${id}`) });

  if (product.isLoading) return <Spinner />;
  if (product.error)
    return (
      <div className="flex flex-col gap-4">
        <FormError message={product.error.message} />
        <Link href="/stock/products" className="text-sm font-medium text-ledger-700 hover:underline">
          Back to products
        </Link>
      </div>
    );

  const p = product.data!;
  return (
    <div>
      <PageHeader
        title={p.name}
        description={p.categoryName ?? undefined}
        actions={!p.active && <Badge tone="amber">Archived — not shown on tills</Badge>}
      />
      <ProductForm key={p.id} product={p} />
    </div>
  );
}
