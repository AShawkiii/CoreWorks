import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password",
};

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo className="text-foreground" showWordmark={false} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Reset your password
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              We&rsquo;ll email you a link to choose a new one.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <ForgotPasswordForm />
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link
            href="/login"
            className="text-primary underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
