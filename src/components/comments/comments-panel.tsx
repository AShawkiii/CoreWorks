"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/server/actions/organization";

/**
 * Comment thread for issues and client requests (master prompt §43).
 *
 * The actions are passed in rather than imported, so one component serves
 * both entities. Tasks keep their own copy from Phase 5.
 */

export interface CommentItem {
  id: string;
  body: string;
  authorName: string | null;
  authorId: string | null;
  createdAt: Date;
}

interface CommentsPanelProps {
  /** Form field name for the parent id — "issueId" or "requestId". */
  parentField: string;
  parentId: string;
  comments: CommentItem[];
  currentUserId: string | null;
  addAction: (prev: FormState, formData: FormData) => Promise<FormState>;
  deleteAction: (formData: FormData) => Promise<void>;
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
  parentField,
  parentId,
  comments,
  currentUserId,
  addAction,
  deleteAction,
}: CommentsPanelProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<FormState, FormData>(
    async (prev, formData) => {
      const result = await addAction(prev, formData);
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

  const fieldId = `${parentField}-comment-body`;

  return (
    <div className="flex flex-col gap-5">
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
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
                    <form action={deleteAction}>
                      <input
                        type="hidden"
                        name={parentField}
                        value={parentId}
                      />
                      <input
                        type="hidden"
                        name="commentId"
                        value={comment.id}
                      />
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
        <input type="hidden" name={parentField} value={parentId} />

        <FormMessage status={state.status} message={state.message} />

        <Label htmlFor={fieldId}>Add a comment</Label>
        <textarea
          id={fieldId}
          name="body"
          rows={3}
          required
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <FieldError id={`${fieldId}-error`} message={state.fieldErrors?.body} />

        <div>
          <PostButton />
        </div>
      </form>
    </div>
  );
}
