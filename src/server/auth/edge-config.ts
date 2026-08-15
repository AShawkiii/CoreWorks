import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe subset of the auth config, for middleware.
 *
 * Middleware runs on the Edge runtime, where Prisma and bcrypt cannot load.
 * With the JWT session strategy the token is verifiable from the cookie alone,
 * so no provider list is needed here — sign-in itself still goes through the
 * full Node-runtime config in `config.ts`.
 */
export const edgeAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  providers: [],
  callbacks: {
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
