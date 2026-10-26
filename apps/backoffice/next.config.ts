import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server (.next/standalone) for the production Docker image. Vercel builds its own way.
  output: process.env.VERCEL ? undefined : "standalone",
  // npm workspaces: trace dependencies from the repository root, two folders up.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  // Products, categories and stock moved into the Stock module; keep old links and bookmarks working.
  async redirects() {
    return [
      { source: "/products", destination: "/stock/products", permanent: false },
      { source: "/products/:path*", destination: "/stock/products/:path*", permanent: false },
      { source: "/categories", destination: "/stock/categories", permanent: false },
      { source: "/inventory", destination: "/stock/products", permanent: false },
      { source: "/customers", destination: "/sales/customers", permanent: false },
    ];
  },
  // Tailwind CSS v4 is compiled by its Turbopack loader.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
