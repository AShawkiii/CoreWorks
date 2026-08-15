import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";

import { ThemeScript } from "@/components/theme/theme-script";
import { NONCE_HEADER } from "@/proxy";

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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Set by middleware on every forwarded request. Absent only if middleware
  // did not run, in which case there is no CSP to satisfy either.
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript nonce={nonce} />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
