import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Dev Dashboard",
  description: "Unified AI API usage, cost, and budget dashboard for OpenAI and Anthropic.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
