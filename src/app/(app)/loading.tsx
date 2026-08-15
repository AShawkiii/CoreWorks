/**
 * Route-level loading state (master prompt §46).
 *
 * A skeleton in the shape of the page that follows, rather than a spinner —
 * the layout does not jump when content arrives.
 */
export default function AppLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6" aria-busy="true">
      <span className="sr-only">Loading…</span>

      <div className="mb-6 flex flex-col gap-2">
        <div className="h-6 w-52 animate-pulse rounded bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded bg-muted" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-lg border border-border bg-card"
          />
        ))}
      </div>
    </div>
  );
}
