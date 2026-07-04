import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "D.E.G — Data Engineering Gym",
  description:
    "A data engineering practice platform for SQL, modeling, quality, indexing, optimization, and production-style incidents.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
