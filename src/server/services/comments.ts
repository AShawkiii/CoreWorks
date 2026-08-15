import { EntityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  ForbiddenError,
  requireUserId,
  type OrgContext,
} from "@/server/context";
import { notifyMentions } from "@/server/services/notifications";

/**
 * Comments on issues and client requests (master prompt §43).
 *
 * One implementation for both, parameterised by which foreign key to write.
 * Tasks keep their own copy in `task-mutations.ts` from Phase 5.
 *
 * The two rules are the same everywhere:
 *
 *  - The parent must belong to the caller's organization, checked here rather
 *    than trusted from the form.
 *  - Only the author may remove their own comment. Managers can still read a
 *    comment they disagree with — removal is not a moderation tool.
 */

export class CommentOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentOperationError";
  }
}

export type CommentParent = "issue" | "request";

export interface CommentView {
  id: string;
  body: string;
  authorName: string | null;
  authorId: string | null;
  createdAt: Date;
}

/**
 * Confirms the parent record is in the caller's organization.
 *
 * Returns its title as well: a mention notification names what it is about,
 * and re-reading the parent for that would be a second query for something
 * this one already had to load.
 */
async function requireParentInOrg(
  ctx: OrgContext,
  parent: CommentParent,
  parentId: string,
): Promise<{ id: string; title: string }> {
  const where = {
    id: parentId,
    organizationId: ctx.organizationId,
    deletedAt: null,
  };
  const select = { id: true, title: true };

  const found =
    parent === "issue"
      ? await prisma.issue.findFirst({ where, select })
      : await prisma.clientRequest.findFirst({ where, select });

  if (!found) {
    throw new ForbiddenError(
      parent === "issue"
        ? "Issue not found in this organization."
        : "Request not found in this organization.",
    );
  }

  return found;
}

export async function addComment(
  ctx: OrgContext,
  parent: CommentParent,
  parentId: string,
  body: string,
): Promise<void> {
  const record = await requireParentInOrg(ctx, parent, parentId);

  await prisma.comment.create({
    data: {
      organizationId: ctx.organizationId,
      authorId: ctx.userId,
      body,
      ...(parent === "issue" ? { issueId: parentId } : { requestId: parentId }),
    },
  });

  await notifyMentions(ctx, body, {
    href: parent === "issue" ? `/issues/${parentId}` : `/requests/${parentId}`,
    entityType:
      parent === "issue" ? EntityType.ISSUE : EntityType.CLIENT_REQUEST,
    entityId: parentId,
    label: record.title,
  });
}

export async function deleteComment(
  ctx: OrgContext,
  parent: CommentParent,
  parentId: string,
  commentId: string,
): Promise<void> {
  await requireParentInOrg(ctx, parent, parentId);

  const comment = await prisma.comment.findFirst({
    where: {
      id: commentId,
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(parent === "issue" ? { issueId: parentId } : { requestId: parentId }),
    },
    select: { id: true, authorId: true },
  });
  if (!comment) throw new ForbiddenError("Comment not found.");

  // requireUserId, not a bare compare: a comment whose author was deleted
  // has a null authorId, and a null-vs-null match would let anyone remove it.
  if (comment.authorId !== requireUserId(ctx)) {
    throw new CommentOperationError("You can only delete your own comments.");
  }

  await prisma.comment.update({
    where: { id: commentId },
    data: { deletedAt: new Date() },
  });
}
