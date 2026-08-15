import bcrypt from "bcryptjs";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { prisma } from "@/lib/db";
import { credentialsSchema } from "@/lib/validation/auth";

/**
 * Auth.js v5 configuration.
 *
 * Replaces the legacy access check entirely (audit §10), which was
 * `Session.getActiveUser().getEmail()` matched against the EMPLOYEES sheet.
 * The one behavior worth carrying over is that legacy failed CLOSED — any
 * error during the check denied access. That is preserved here: `authorize`
 * returns null on every failure path and never leaks why.
 */
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
        if (!user?.passwordHash || user.deletedAt) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        // Legacy required Active? = Yes. The equivalent is an active
        // membership in at least one organization — a deactivated member
        // cannot sign in, matching legacy behavior.
        const activeMembership = await prisma.organizationMember.findFirst({
          where: { userId: user.id, isActive: true, deletedAt: null },
          select: { id: true },
        });
        if (!activeMembership) return null;

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
