/**
 * Client rules.
 *
 * Port of legacy `apps-script/clients/ClientLogic.gs` (audit §6.9, §6.10).
 */

import type { DomainMember } from "@/lib/domain/types";
import type { ValidationResult } from "@/lib/domain/task";

export interface ClientValidationInput {
  name?: string | null;
  servicePackageName?: string | null;
  accountManagerName?: string | null;
  /**
   * Legacy CLIENTS."Start Date" — REQUIRED. Absent from the CoreWorks brief's
   * §10 field list; retained per audit conflict C2.
   */
  startDate?: Date | null;
}

/** Legacy `validateClientFields` — the four fields a client cannot exist without. */
export function validateClientFields(
  client: ClientValidationInput,
): ValidationResult {
  const errors: string[] = [];
  if (!client.name) errors.push("Client Name is required.");
  if (!client.servicePackageName) errors.push("Service Package is required.");
  if (!client.accountManagerName) errors.push("Account Manager is required.");
  if (!client.startDate) errors.push("Start Date is required.");
  return { valid: errors.length === 0, errors };
}

/**
 * Legacy `isDuplicateClient` — duplicates require BOTH Client Name and
 * Company Name to match.
 *
 * Name alone is not enough: two different entities in a group can share a
 * trading name, and blocking on name alone would refuse legitimate clients.
 */
export function isDuplicateClient(
  candidate: { name: string; companyName: string | null },
  existing: readonly { name: string; companyName: string | null }[],
): boolean {
  return existing.some(
    (client) =>
      client.name === candidate.name &&
      client.companyName === candidate.companyName,
  );
}

/**
 * Legacy `resolveDefaultAssignee`.
 *
 * Templates carry a ROLE, not a person, so the same template serves every
 * client. Resolution order:
 *
 *   1. the client's own Account Manager, if their job title matches the role
 *   2. otherwise the first ACTIVE member holding that job title
 *   3. otherwise the Account Manager regardless of title
 *
 * Step 3 is the important one: a generated task is never left unassigned.
 * An unowned task is invisible work, which is worse than one owned by
 * someone who may need to hand it on.
 */
export function resolveDefaultAssignee(
  role: string | null,
  accountManagerName: string | null,
  members: readonly DomainMember[],
): string | null {
  const accountManager = members.find(
    (member) => member.name === accountManagerName,
  );

  if (accountManager && role && accountManager.jobTitle === role) {
    return accountManagerName;
  }

  if (role) {
    const roleMatch = members.find(
      (member) => member.jobTitle === role && member.isActive,
    );
    if (roleMatch) return roleMatch.name;
  }

  return accountManagerName ?? null;
}
