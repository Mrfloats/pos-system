import type { Metadata } from "next";
import "@fontsource-variable/instrument-sans";
import "./globals.css";
import { Providers } from "@/lib/providers";

export const metadata: Metadata = {
  title: { default: "Floatly", template: "%s · Floatly" },
  description: "Floatly: point of sale and backoffice for shops, wholesalers and restaurants",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      {/* Browser extensions such as Grammarly add attributes to <body> before React loads; ignore those differences. */}
      <body className="min-h-full" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
