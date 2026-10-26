import { SupplierMenuBar } from "@/components/supplier-nav";

export default function SuppliersLayout({ children }: LayoutProps<"/suppliers">) {
  return (
    <div>
      <SupplierMenuBar />
      {children}
    </div>
  );
}
