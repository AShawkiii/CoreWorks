import { z } from "zod";

/**
 * Comment validation, shared by every commentable entity (master prompt §43).
 *
 * Tasks carry their own copy in `validation/task.ts` from Phase 5, keyed on
 * `taskId`. These are keyed on a neutral `parentId` so issues and requests can
 * share one schema instead of each restating the same three rules.
 */

export const commentSchema = z.object({
  parentId: z.string().uuid("Invalid record."),
  body: z
    .string()
    .trim()
    .min(1, "Write something first.")
    .max(4000, "Comment is too long."),
});

export const deleteCommentSchema = z.object({
  parentId: z.string().uuid("Invalid record."),
  commentId: z.string().uuid("Invalid comment."),
});

export type CommentInput = z.infer<typeof commentSchema>;
