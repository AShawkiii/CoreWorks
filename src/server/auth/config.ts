import bcrypt from "bcryptjs";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { prisma } from "@/lib/db";
import { SIGN_IN_RULE } from "@/lib/domain/rate-limit";
import { credentialsSchema } from "@/lib/validation/auth";
import { logAudit } from "@/server/services/activity";
import { clearRateLimit, consumeRateLimit } from "@/server/services/rate-limit";

/**
 * Auth.js v5 configuration.
 *
 * Replaces the legacy access check entirely (audit §10), which was
 * `Session.getActiveUser().getEmail()` matched against the EMPLOYEES sheet.
 * The one behavior worth carrying over is that legacy failed CLOSED — any
 * error during the check denied access. That is preserved here: `authorize`
 * returns null on every failure path and never leaks why.
 *
 * Phase 14 adds two things around that, without changing the decision itself:
 * a rate limit on attempts, and an `AuditLog` entry for every outcome.
 */
/**
 * Writes one `AuditLog` entry per sign-in outcome.
 *
 * `AuditLog` is the security trail, deliberately separate from the
 * user-facing `ActivityLog` (audit §15) — a failed sign-in is not business
 * activity and does not belong in a client's history.
 *
 * The REASON is recorded even though the caller is never told it. That
 * asymmetry is the point: the endpoint stays uniform so it cannot be used to
 * enumerate accounts, while an administrator investigating afterwards can
 * still tell a forgotten password from an attack on a disabled account.
 *
 * ---------------------------------------------------------------------------
 * Attribution
 * ---------------------------------------------------------------------------
 *
 * `/settings/security` shows an organization's own entries **plus every
 * unattributed one**, because an attempt against an address that belongs to
 * nobody has no tenant and would otherwise be visible to no one.
 *
 * That makes attribution matter. An entry left null when it could have been
 * attributed is shown to every administrator in the deployment — so an
 * `organizationId` is resolved wherever the account is known, and left null
 * only where it genuinely cannot be:
 *
 *  - `success`, `bad_password`, `no_active_membership` — the account exists,
 *    so the entry belongs to its organization.
 *  - `unknown_or_disabled` — there is no account to attribute it to.
 *  - `rate_limited` — refused before any lookup, deliberately: doing the
 *    lookup anyway would hand back the work the limit exists to refuse.
 *
 * A user who belongs to several organizations is attributed to their oldest
 * membership. Duplicating the row into each would multiply an attack's trail
 * by however many organizations the victim happens to belong to.
 *
 * Never throws. A trail that can refuse a sign-in is a liability, not a
 * control.
 */
async function recordSignIn(
  email: string,
  outcome: string,
  userId?: string,
): Promise<void> {
  try {
    const membership = userId
      ? await prisma.organizationMember.findFirst({
          where: { userId, deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: { organizationId: true },
        })
      : null;

    await logAudit({
      organizationId: membership?.organizationId ?? null,
      userId: userId ?? null,
      userEmail: email,
      action: `sign_in.${outcome}`,
    });
  } catch (error) {
    console.error("[auth] could not write the sign-in audit entry", error);
  }
}

export const authConfig = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const subject = email.trim().toLowerCase();

        /*
         * Rate limit BEFORE the password comparison.
         *
         * bcrypt is deliberately slow, so checking the limit first is also
         * what stops a flood of attempts from becoming a CPU exhaustion
         * attack on top of a credential one.
         *
         * Keyed on the email rather than the address: Auth.js `authorize` has
         * no request object, and an attacker rotating addresses through a
         * proxy pool is the common case anyway. The account is what needs
         * protecting.
         */
        const limit = await consumeRateLimit(
          "signin",
          subject,
          SIGN_IN_RULE,
        );
        if (!limit.allowed) {
          await recordSignIn(subject, "rate_limited");
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: email.trim().toLowerCase() },
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            passwordHash: true,
            deletedAt: true,
          },
        });

        // Uniform failure: an unknown email and a wrong password are
        // indistinguishable to the caller, so this endpoint cannot be used to
        // enumerate accounts.
        if (!user?.passwordHash || user.deletedAt) {
          await recordSignIn(subject, "unknown_or_disabled");
          return null;
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          await recordSignIn(subject, "bad_password", user.id);
          return null;
        }

        // Legacy required Active? = Yes. The equivalent is an active
        // membership in at least one organization — a deactivated member
        // cannot sign in, matching legacy behavior.
        const activeMembership = await prisma.organizationMember.findFirst({
          where: { userId: user.id, isActive: true, deletedAt: null },
          select: { id: true },
        });
        if (!activeMembership) {
          await recordSignIn(subject, "no_active_membership", user.id);
          return null;
        }

        // Only a success clears the counter. Someone who mistyped twice and
        // then got it right should not carry the remainder into next time.
        await clearRateLimit("signin", subject);
        await recordSignIn(subject, "success", user.id);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
