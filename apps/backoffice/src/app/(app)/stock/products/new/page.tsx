"use client";

import { ProductForm } from "@/components/product-form";
import { PageHeader } from "@/components/ui";

export default function NewProductPage() {
  return (
    <div>
      <PageHeader title="Add product" />
      <ProductForm />
    </div>
  );
}
