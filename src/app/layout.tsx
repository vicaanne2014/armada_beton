import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WMS Batching Plant",
  description: "Warehouse Management System: gudang material dan barang jadi batching plant beton",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
