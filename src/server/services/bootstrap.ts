import bcrypt from "bcryptjs";

import { OrgRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  bootstrapOrganizationSchema,
  type BootstrapOrganizationInput,
} from "@/lib/validation/bootstrap";
import { logAudit } from "@/server/services/activity";
import { nextDisplayId } from "@/server/services/ids";
import { seedOrgSettings } from "@/server/services/settings";

/**
 * First-organization bootstrap.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * Until now nothing outside `prisma/seed.ts` and the test suite could create
 * an `Organization`. There is no public signup route, and CSV import cannot
 * help — it accepts eleven sheets, none of them `ORGANIZATION`, and every
 * import runs inside an `organizationId` taken from an existing session. So a
 * production deployment had no supported way to create the tenant that every
 * other operation requires.
 *
 * The seed cannot fill that gap: it exists to produce a known development
 * fixture, it carries a password committed to this repository, and it marks
 * its organization `IS_DEMO_DATA` precisely so a production deployment can
 * assert the absence of what it creates.
 *
 * ---------------------------------------------------------------------------
 * What it is deliberately not
 * ---------------------------------------------------------------------------
 *
 * Not an HTTP endpoint. Every existing authorization decision starts from an
 * authenticated session and an organization; creating the first organization
 * has neither, so exposing it over HTTP would mean inventing a second
 * authorization model — an unauthenticated route that can mint an Owner — for
 * an operation that runs once. Shell access to the deployment is the
 * authorization, exactly as it is for `prisma migrate deploy`.
 */

/** Same cost factor the application uses everywhere else. */
const BCRYPT_ROUNDS = 12;

/** Raised for a condition the operator can fix, as distinct from a bug. */
export class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapError";
  }
}

export interface BootstrapResult {
  organizationId: string;
  organizationSlug: string;
  ownerUserId: string;
  ownerMemberId: string;
  ownerDisplayId: string;
}

/**
 * Creates an organization and its first Owner, atomically.
 *
 * Every write happens inside one transaction. A failure at any point — a slug
 * that turns out to be taken, a constraint violation on the membership —
 * leaves no organization, no settings, no user, and no counter behind. A
 * half-created tenant would be worse than none: the operator would re-run,
 * hit a duplicate, and have to unpick it by hand.
 *
 * The reads that reject duplicates happen inside the transaction too. They
 * still race in principle — another connection could insert between the check
 * and the write — which is why the unique constraints on `Organization.slug`
 * and `User.email` remain the actual guarantee. The checks exist to turn a
 * constraint violation into a sentence an operator can act on.
 */
export async function bootstrapOrganization(
  rawInput: BootstrapOrganizationInput,
): Promise<BootstrapResult> {
  const parsed = bootstrapOrganizationSchema.safeParse(rawInput);
  if (!parsed.success) {
    const [first] = parsed.error.issues;
    throw new BootstrapError(first?.message ?? "Invalid bootstrap input.");
  }
  const input = parsed.data;

  // Hashed before the transaction opens. bcrypt at cost 12 takes a few hundred
  // milliseconds, and holding a transaction open across it would pin a
  // connection for no reason.
  const passwordHash = await bcrypt.hash(input.ownerPassword, BCRYPT_ROUNDS);

  return prisma.$transaction(async (tx) => {
    const existingOrg = await tx.organization.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (existingOrg) {
      throw new BootstrapError(
        `An organization with the slug "${input.slug}" already exists.`,
      );
    }

    /*
     * An existing account is refused rather than adopted.
     *
     * `inviteMember` deliberately lets an existing user join a second
     * organization keeping their own password — the right behaviour there,
     * because the inviter never sets it. Bootstrap does set one, so adopting
     * an existing account would mean either silently ignoring the password
     * the operator supplied, or overwriting the password of an account that
     * already belongs to somebody. Refusing is the only option that cannot
     * surprise anyone.
     */
    const existingUser = await tx.user.findUnique({
      where: { email: input.ownerEmail },
      select: { id: true },
    });
    if (existingUser) {
      throw new BootstrapError(
        `A user with the email "${input.ownerEmail}" already exists. ` +
          "Bootstrap creates a new account; add an existing person to an " +
          "organization from Settings → Members instead.",
      );
    }

    const organization = await tx.organization.create({
      data: {
        name: input.organizationName,
        slug: input.slug,
        // Matches what the seed creates, so a bootstrapped organization and a
        // seeded one are structurally identical. Theme reads tolerate a
        // missing row, but starting from a real one means the Appearance page
        // updates rather than creates on first save.
        theme: { create: {} },
      },
      select: { id: true, slug: true },
    });

    // Reused rather than reimplemented: the defaults are legacy SETTINGS
    // values (audit §6.1) and belong in exactly one place.
    await seedOrgSettings(organization.id, tx);

    const user = await tx.user.create({
      data: {
        name: input.ownerName,
        email: input.ownerEmail,
        passwordHash,
      },
      select: { id: true },
    });

    // Allocates through the counter rather than hardcoding MEMBER-001, so the
    // sequence is correct for the next member added through the application.
    const displayId = await nextDisplayId(organization.id, "MEMBER", tx);

    const member = await tx.organizationMember.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        displayId,
        role: OrgRole.OWNER,
        isActive: true,
      },
      select: { id: true },
    });

    // Recorded in the security trail (Phase 14), not the Activity Log: the
    // creation of a tenant is a security event, and there is no client whose
    // history it belongs in. Written inside the transaction so a rolled-back
    // bootstrap leaves no entry claiming one happened.
    await logAudit(
      {
        organizationId: organization.id,
        userId: user.id,
        userEmail: input.ownerEmail,
        action: "organization.bootstrapped",
        metadata: { slug: organization.slug, displayId },
      },
      tx,
    );

    return {
      organizationId: organization.id,
      organizationSlug: organization.slug,
      ownerUserId: user.id,
      ownerMemberId: member.id,
      ownerDisplayId: displayId,
    };
  });
}
