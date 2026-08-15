import type { Metadata, Viewport } from "next";

import { ThemeScript } from "@/components/theme/theme-script";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CoreWorks",
    template: "%s · CoreWorks",
  },
  description:
    "Client management and financial operations for finance and accounting teams.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
