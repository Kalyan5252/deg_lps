import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SQLForge — Learn SQL by fixing production",
  description:
    "An AI-mentored platform that teaches SQL through realistic data engineering incidents.",
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
