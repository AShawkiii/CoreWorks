import { FileQuestion } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

/**
 * 404, and also what a permission refusal renders as.
 *
 * Pages call notFound() rather than showing "forbidden" when a user lacks
 * access to a section: telling someone a page exists but is off-limits
 * confirms its existence, which is itself information.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-4 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted">
        <FileQuestion
          className="size-5 text-muted-foreground"
          aria-hidden="true"
        />
      </span>

      <div>
        <h1 className="text-lg font-semibold tracking-tight">Page not found</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          This page doesn&rsquo;t exist, or you don&rsquo;t have access to it.
        </p>
      </div>

      {/* A styled link, not a Button wrapping a Link — nesting an anchor
          inside a button is invalid and breaks keyboard behavior. */}
      <Link href="/dashboard" className={buttonVariants()}>
        Back to dashboard
      </Link>
    </main>
  );
}
