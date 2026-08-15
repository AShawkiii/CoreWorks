"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Label } from "@/components/ui/label";
import {
  addTaskCommentAction,
  deleteTaskCommentAction,
} from "@/server/actions/tasks";
import type { FormState } from "@/server/actions/organization";
import type { TaskComment } from "@/server/services/task-queries";

interface CommentsPanelProps {
  taskId: string;
  comments: TaskComment[];
  currentUserId: string | null;
}

function PostButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          Posting…
        </>
      ) : (
        "Post comment"
      )}
    </Button>
  );
}

export function CommentsPanel({
  taskId,
  comments,
  currentUserId,
}: CommentsPanelProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<FormState, FormData>(
    async (prev, formData) => {
      const result = await addTaskCommentAction(prev, formData);
      // Clear the box only on success, so a rejected comment is not lost.
      if (result.status === "success") formRef.current?.reset();
      return result;
    },
    {},
  );

  const formatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex flex-col gap-5">
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No comments yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {comments.map((comment) => (
            <li key={comment.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  {comment.authorName ?? "Unknown"}
                </p>
                <div className="flex items-center gap-2">
                  <time className="text-xs text-muted-foreground">
                    {formatter.format(comment.createdAt)}
                  </time>
                  {/* Both null must NOT match: a comment whose author was deleted
                      has a null authorId, and matching it would offer the delete
                      control to the wrong person. The server re-checks anyway. */}
                  {currentUserId !== null && comment.authorId === currentUserId ? (
                    <form action={deleteTaskCommentAction}>
                      <input type="hidden" name="taskId" value={taskId} />
                      <input type="hidden" name="commentId" value={comment.id} />
                      <button
                        type="submit"
                        className="text-muted-foreground transition-colors hover:text-danger"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                        <span className="sr-only">Delete comment</span>
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form
        ref={formRef}
        action={formAction}
        className="flex flex-col gap-2 border-t border-border pt-4"
        noValidate
      >
        <input type="hidden" name="taskId" value={taskId} />

        <FormMessage status={state.status} message={state.message} />

        <Label htmlFor="comment-body">Add a comment</Label>
        <textarea
          id="comment-body"
          name="body"
          rows={3}
          required
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <FieldError id="comment-body-error" message={state.fieldErrors?.body} />

        <div>
          <PostButton />
        </div>
      </form>
    </div>
  );
}
