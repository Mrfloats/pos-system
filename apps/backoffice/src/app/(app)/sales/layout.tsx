import { SalesMenuBar } from "@/components/sales-nav";

export default function SalesLayout({ children }: LayoutProps<"/sales">) {
  return (
    <div>
      <SalesMenuBar />
      {children}
    </div>
  );
}
