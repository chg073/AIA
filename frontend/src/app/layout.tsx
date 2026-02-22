import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIA - Automated Investor Advisor",
  description:
    "AI-powered investment analysis and recommendations for smarter trading decisions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
