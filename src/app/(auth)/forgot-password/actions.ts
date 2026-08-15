"use server";

import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/db";
import { PASSWORD_RESET_RULE } from "@/lib/domain/rate-limit";
import { forgotPasswordSchema } from "@/lib/validation/auth";
import { logAudit } from "@/server/services/activity";
import { consumeRateLimit } from "@/server/services/rate-limit";

export interface ForgotPasswordState {
  sent?: boolean;
  /** Whole minutes until another request is accepted, when refused. */
  retryAfterMinutes?: number;
  fieldErrors?: { email?: string };
}

/** Reset links are short-lived; an hour is long enough to act on, short enough to limit exposure. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Issues a password-reset token.
 *
 * Always reports success, whether or not the address exists — otherwise this
 * form becomes an account-enumeration oracle.
 *
 * Only the SHA-256 hash of the token is stored, so a database read cannot be
 * replayed to seize an account; the raw token exists solely in the emailed
 * link. Delivery is not implemented — no mail transport is configured in this
 * deployment — so the token is issued and recorded, and the link is logged in
 * development only. `docs/deployment.md` records what wiring a transport
 * requires.
 *
 * Phase 14 adds a rate limit, for a different reason than the one on sign-in.
 * Sign-in is limited to slow down guessing; this is limited because each
 * accepted request is meant to put mail in somebody's inbox, so an unlimited
 * form is a way to flood a real person. It is keyed on the submitted address
 * and counts requests for addresses that do not exist too — otherwise the
 * counter itself would reveal which addresses are real.
 *
 * The refusal is reported plainly. It says nothing the caller does not already
 * know (they submitted these requests), so it is not an enumeration oracle,
 * and a silent refusal would leave someone waiting for a link that is never
 * coming. The cost is that a third party can spend somebody's reset budget for
 * an hour; `docs/security.md` records that trade-off.
 */
export async function forgotPasswordAction(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: { email: parsed.error.flatten().fieldErrors.email?.[0] },
    };
  }

  const subject = parsed.data.email.trim().toLowerCase();

  // Before the lookup, so a refused request costs no query and cannot be
  // timed to tell an existing address from an absent one.
  const limit = await consumeRateLimit(
    "reset",
    subject,
    PASSWORD_RESET_RULE,
  );
  if (!limit.allowed) {
    try {
      await logAudit({
        userId: null,
        userEmail: subject,
        action: "password_reset.rate_limited",
      });
    } catch (error) {
      console.error("[reset] could not write the audit entry", error);
    }
    return {
      retryAfterMinutes: Math.max(1, Math.ceil(limit.retryAfterSeconds / 60)),
    };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: {
      id: true,
      deletedAt: true,
      // Attributing the entry keeps it out of every other organization's
      // trail — an unattributed row is shown to every administrator in the
      // deployment by design, so leaving one null when it need not be is an
      // over-disclosure. Oldest membership, matching `recordSignIn`.
      memberships: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { organizationId: true },
      },
    },
  });

  if (user && !user.deletedAt) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");

    // Supersede any outstanding tokens so only the newest link works.
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expires: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });

    if (process.env.NODE_ENV === "development") {
      console.info(
        `[dev] Password reset link: ${process.env.NEXT_PUBLIC_APP_URL ?? ""}/reset-password?token=${token}`,
      );
    }
  }

  // Recorded for every accepted request, whether or not the address matched,
  // so the trail shows the attempt rather than only its outcome.
  const known = user && !user.deletedAt ? user : null;
  try {
    await logAudit({
      organizationId: known?.memberships[0]?.organizationId ?? null,
      userId: known?.id ?? null,
      userEmail: subject,
      action: "password_reset.requested",
    });
  } catch (error) {
    console.error("[reset] could not write the audit entry", error);
  }

  return { sent: true };
}
