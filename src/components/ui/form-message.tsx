import { AlertCircle, CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface FormMessageProps {
  status?: "success" | "error";
  message?: string;
  className?: string;
}

/** Inline result banner for a submitted form (master prompt §45). */
export function FormMessage({ status, message, className }: FormMessageProps) {
  if (!status || !message) return null;

  const isError = status === "error";
  const Icon = isError ? AlertCircle : CheckCircle2;

  return (
    <div
      // Errors interrupt; confirmations are announced politely.
      role={isError ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        isError
          ? "border-danger/30 bg-danger/10 text-danger"
          : "border-success/30 bg-success/10 text-foreground",
        className,
      )}
    >
      <Icon
        className={cn("mt-0.5 size-4 shrink-0", !isError && "text-success")}
        aria-hidden="true"
      />
      <span>{message}</span>
    </div>
  );
}

interface FieldErrorProps {
  id: string;
  message?: string;
}

export function FieldError({ id, message }: FieldErrorProps) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-danger">
      {message}
    </p>
  );
}
