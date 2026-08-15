"use server";

import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/db";
import { forgotPasswordSchema } from "@/lib/validation/auth";

export interface ForgotPasswordState {
  sent?: boolean;
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
 * link. Delivery itself lands in Phase 11 (master prompt §24) — until then the
 * token is issued and recorded, and the link is logged in development only.
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

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, deletedAt: true },
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

  return { sent: true };
}
