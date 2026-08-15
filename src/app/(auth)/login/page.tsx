import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { getCurrentUserId } from "@/server/tenancy";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage() {
  if (await getCurrentUserId()) redirect("/dashboard");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo className="text-foreground" showWordmark={false} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Sign in to CoreWorks
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Client delivery and financial operations.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Trouble signing in? Contact your CoreWorks administrator.
        </p>
      </div>
    </main>
  );
}
