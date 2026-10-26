import { StockMenuBar } from "@/components/stock-nav";

export default function StockLayout({ children }: LayoutProps<"/stock">) {
  return (
    <div>
      <StockMenuBar />
      {children}
    </div>
  );
}
