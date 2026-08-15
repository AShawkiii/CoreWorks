"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Error boundary for authenticated pages (master prompt §45).
 *
 * Shows the thrown message, because the actions in this app throw only
 * messages written for users — permission refusals and rule violations such
 * as "This is the only active Owner". Unexpected failures are converted to a
 * generic message at the action boundary before they ever reach here, so a
 * raw database error cannot surface.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-4 py-20 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-danger/10">
        <AlertTriangle className="size-5 text-danger" aria-hidden="true" />
      </span>

      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {error.message || "The page could not be loaded."}
        </p>
      </div>

      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
      </div>

      {error.digest ? (
        <p className="text-xs text-muted-foreground">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
    </div>
  );
}
