"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Priority, TaskStatus } from "@/generated/prisma/enums";
import { PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/domain/labels";
import { cn } from "@/lib/utils";
import {
  bulkReassignAction,
  bulkStatusAction,
  type BulkFormState,
} from "@/server/actions/tasks";
import type { TaskListRow } from "@/server/services/task-queries";

interface TaskTableProps {
  rows: TaskListRow[];
  members: { id: string; name: string }[];
  canBulkEdit: boolean;
}

const STATUS_VARIANT: Record<TaskStatus, "neutral" | "primary" | "warning" | "danger" | "success"> = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "primary",
  WAITING_CLIENT: "warning",
  BLOCKED: "danger",
  IN_REVIEW: "primary",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

function BulkSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {label}
    </Button>
  );
}

export function TaskTable({ rows, members, canBulkEdit }: TaskTableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusState, statusAction] = useActionState<BulkFormState, FormData>(
    bulkStatusAction,
    {},
  );
  const [assignState, assignAction] = useActionState<BulkFormState, FormData>(
    bulkReassignAction,
    {},
  );

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const bulk = statusState.errors?.length ? statusState : assignState;

  if (rows.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-sm font-medium">No tasks found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Try widening your filters, or create a task.
        </p>
      </div>
    );
  }

  return (
    <div>
      {canBulkEdit && selected.size > 0 ? (
        <div className="flex flex-col gap-3 border-b border-border bg-muted/30 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">
              {selected.size} selected
            </span>

            <form action={statusAction} className="flex items-center gap-2">
              {[...selected].map((id) => (
                <input key={id} type="hidden" name="taskIds" value={id} />
              ))}
              <Select name="status" defaultValue="" className="h-8 w-auto">
                <option value="" disabled>
                  Set status…
                </option>
                {Object.values(TaskStatus).map((status) => (
                  <option key={status} value={status}>
                    {TASK_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
              <BulkSubmit label="Apply" />
            </form>

            <form action={assignAction} className="flex items-center gap-2">
              {[...selected].map((id) => (
                <input key={id} type="hidden" name="taskIds" value={id} />
              ))}
              <Select name="assignedToId" defaultValue="" className="h-8 w-auto">
                <option value="">Unassign</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
              <BulkSubmit label="Reassign" />
            </form>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>

          <FormMessage status={bulk.status} message={bulk.message} />

          {bulk.errors && bulk.errors.length > 0 ? (
            // A bulk run that partially applies must say what it skipped and
            // why — silently updating 3 of 10 is worse than refusing.
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {bulk.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            {canBulkEdit ? (
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  aria-label="Select all tasks on this page"
                  checked={allSelected}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? new Set(rows.map((row) => row.id))
                        : new Set(),
                    )
                  }
                  className="size-4 rounded border-input accent-primary"
                />
              </TableHead>
            ) : null}
            <TableHead>Task</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Assigned to</TableHead>
            <TableHead>Due</TableHead>
            <TableHead className="text-right">Days</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              {canBulkEdit ? (
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.taskName}`}
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                    className="size-4 rounded border-input accent-primary"
                  />
                </TableCell>
              ) : null}

              <TableCell>
                <Link
                  href={`/tasks/${row.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {row.taskName}
                </Link>
                <span className="ml-2 text-xs text-muted-foreground">
                  {row.serviceArea}
                </span>
              </TableCell>

              <TableCell>
                <Link
                  href={`/clients/${row.clientId}`}
                  className="text-muted-foreground underline-offset-4 hover:underline"
                >
                  {row.clientName}
                </Link>
              </TableCell>

              <TableCell>
                <Badge variant={STATUS_VARIANT[row.status]}>
                  {TASK_STATUS_LABELS[row.status]}
                </Badge>
              </TableCell>

              <TableCell>
                <Badge
                  variant={
                    row.priority === Priority.CRITICAL
                      ? "danger"
                      : row.priority === Priority.HIGH
                        ? "warning"
                        : "neutral"
                  }
                >
                  {PRIORITY_LABELS[row.priority]}
                </Badge>
              </TableCell>

              <TableCell className="text-muted-foreground">
                {row.assignedToName ?? "Unassigned"}
              </TableCell>

              <TableCell className="whitespace-nowrap text-muted-foreground">
                {row.dueDate
                  ? row.dueDate.toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"}
              </TableCell>

              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  row.daysOverdue > 0
                    ? "font-medium text-danger"
                    : "text-muted-foreground",
                )}
              >
                {row.daysOverdue > 0
                  ? `${row.daysOverdue} over`
                  : (row.daysRemaining ?? "—")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
