/**
 * Role-based permissions.
 *
 * NET-NEW (audit §10). The legacy system had no authorization layer at all —
 * its only rule was "email present in EMPLOYEES and Active? = Yes", after
 * which every signed-in user could see and edit everything. Legacy
 * `EMPLOYEES.Role` holds job titles used solely to resolve template assignees
 * (audit §6.10) and is deliberately NOT an input here.
 *
 * Every check is server-side. Nothing in this file may be trusted from the
 * client (master prompt §9/§35) — the UI hides what a user cannot do, but the
 * server is what actually refuses.
 */

import { OrgRole } from "@/generated/prisma/enums";

export const PERMISSIONS = [
  "org:manage",
  "org:view",
  "member:manage",
  "member:view",
  "billing:manage",
  "client:create",
  "client:update",
  "client:archive",
  "client:view",
  "task:create",
  "task:update",
  "task:update_own",
  "task:delete",
  "task:view",
  "issue:create",
  "issue:update",
  "issue:view",
  "request:create",
  "request:update",
  "request:view",
  "template:manage",
  "template:view",
  "service:manage",
  "service:view",
  "close:manage",
  "close:view",
  "report:view",
  "activity:view",
  "settings:manage",
  "branding:manage",
  "data:import",
  "data:export",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: readonly Permission[] = [
  "org:view",
  "member:view",
  "client:view",
  "task:view",
  "issue:view",
  "request:view",
  "template:view",
  "service:view",
  "close:view",
  "report:view",
];

/**
 * Team members work their own queue: they may move their own tasks through the
 * status machine and raise issues/requests, but not create clients or reassign
 * other people's work.
 */
const TEAM_MEMBER: readonly Permission[] = [
  ...VIEWER,
  "task:update_own",
  "issue:create",
  "issue:update",
  "request:create",
  "request:update",
  "data:export",
];

/** Accountants additionally own delivery: any task, and the monthly close. */
const ACCOUNTANT: readonly Permission[] = [
  ...TEAM_MEMBER,
  "task:create",
  "task:update",
  "close:manage",
];

/** Managers run the book of business: clients, templates, and activity. */
const MANAGER: readonly Permission[] = [
  ...ACCOUNTANT,
  "client:create",
  "client:update",
  "client:archive",
  "task:delete",
  "template:manage",
  "service:manage",
  "activity:view",
  "member:manage",
  "data:import",
];

/** Admins configure the organization itself. */
const ADMIN: readonly Permission[] = [
  ...MANAGER,
  "org:manage",
  "settings:manage",
  "branding:manage",
];

/** Owners are admins plus billing, and cannot be removed by an admin. */
const OWNER: readonly Permission[] = [...ADMIN, "billing:manage"];

export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  [OrgRole.OWNER]: OWNER,
  [OrgRole.ADMIN]: ADMIN,
  [OrgRole.MANAGER]: MANAGER,
  [OrgRole.ACCOUNTANT]: ACCOUNTANT,
  [OrgRole.TEAM_MEMBER]: TEAM_MEMBER,
  [OrgRole.VIEWER]: VIEWER,
};

/** Role seniority, used to stop a user escalating or editing a senior peer. */
export const ROLE_RANK: Record<OrgRole, number> = {
  [OrgRole.OWNER]: 6,
  [OrgRole.ADMIN]: 5,
  [OrgRole.MANAGER]: 4,
  [OrgRole.ACCOUNTANT]: 3,
  [OrgRole.TEAM_MEMBER]: 2,
  [OrgRole.VIEWER]: 1,
};

export function hasPermission(role: OrgRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasAnyPermission(
  role: OrgRole,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

/**
 * Whether `actor` may modify a member holding `target`.
 *
 * Seniority is strict — an Admin cannot demote another Admin — with one
 * deliberate exception: **Owners may manage other Owners.**
 *
 * Without that exception nothing outranks an Owner, so an Owner could never
 * be demoted, deactivated, or even created by an existing Owner. An
 * organization whose owner leaves would be permanently stuck with their
 * access. Owner peers can therefore manage each other, and the last active
 * Owner is protected separately by the services (see
 * `src/server/services/members.ts`) so the role can never be emptied.
 */
export function canManageRole(actor: OrgRole, target: OrgRole): boolean {
  if (actor === OrgRole.OWNER && target === OrgRole.OWNER) return true;
  return ROLE_RANK[actor] > ROLE_RANK[target];
}

/**
 * Whether a role may edit this specific task. `task:update` covers any task;
 * `task:update_own` only the assignee's own. Callers must pass whether the
 * actor is the assignee — this function never guesses.
 */
export function canUpdateTask(role: OrgRole, isAssignee: boolean): boolean {
  if (hasPermission(role, "task:update")) return true;
  return isAssignee && hasPermission(role, "task:update_own");
}
