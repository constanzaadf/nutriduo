import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });

export const metadata: Metadata = {
  title: { default: "NutriDuo", template: "%s · NutriDuo" },
  description: "Dos alimentaciones individuales, una sola cocina.",
};

export const viewport: Viewport = {
  themeColor: "#f6f1e7",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-CL" className={`${bricolage.variable} ${figtree.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
