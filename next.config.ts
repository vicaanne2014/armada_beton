import type { NextConfig } from "next";

// Aplikasi ini sepenuhnya dinamis dan per-user (RLS Supabase), jadi Cache Components
// sengaja tidak diaktifkan. Data tidak boleh di-cache lintas user.
const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer", "exceljs"],
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
