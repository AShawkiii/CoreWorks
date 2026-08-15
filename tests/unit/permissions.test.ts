import { describe, expect, it } from "vitest";

import { OrgRole } from "@/generated/prisma/enums";
import {
  canManageRole,
  canUpdateTask,
  hasPermission,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_RANK,
  type Permission,
} from "@/server/auth/permissions";

const ALL_ROLES = Object.values(OrgRole);

describe("role permission matrix", () => {
  it("grants Owner every permission", () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission(OrgRole.OWNER, permission)).toBe(true);
    }
  });

  it("gives Viewer read access only", () => {
    const viewerPermissions = ROLE_PERMISSIONS[OrgRole.VIEWER];
    for (const permission of viewerPermissions) {
      expect(permission.endsWith(":view")).toBe(true);
    }
  });

  it("never lets a Viewer mutate anything", () => {
    const mutations: Permission[] = [
      "client:create",
      "client:update",
      "client:archive",
      "task:create",
      "task:update",
      "task:update_own",
      "task:delete",
      "issue:create",
      "request:create",
      "settings:manage",
      "member:manage",
      "data:import",
    ];
    for (const permission of mutations) {
      expect(hasPermission(OrgRole.VIEWER, permission)).toBe(false);
    }
  });

  it("escalates monotonically — each role includes its junior's permissions", () => {
    const ladder = [
      OrgRole.VIEWER,
      OrgRole.TEAM_MEMBER,
      OrgRole.ACCOUNTANT,
      OrgRole.MANAGER,
      OrgRole.ADMIN,
      OrgRole.OWNER,
    ];

    for (let i = 1; i < ladder.length; i += 1) {
      const junior = ladder[i - 1]!;
      const senior = ladder[i]!;
      for (const permission of ROLE_PERMISSIONS[junior]) {
        expect(
          hasPermission(senior, permission),
          `${senior} should inherit ${permission} from ${junior}`,
        ).toBe(true);
      }
    }
  });

  it("reserves billing for the Owner", () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, "billing:manage")).toBe(
        role === OrgRole.OWNER,
      );
    }
  });

  it("restricts branding and settings to Admin and above", () => {
    for (const role of ALL_ROLES) {
      const expected = role === OrgRole.OWNER || role === OrgRole.ADMIN;
      expect(hasPermission(role, "branding:manage")).toBe(expected);
      expect(hasPermission(role, "settings:manage")).toBe(expected);
    }
  });

  it("declares no permission that is not in the PERMISSIONS list", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const role of ALL_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(known.has(permission)).toBe(true);
      }
    }
  });

  it("assigns no duplicate permissions within a role", () => {
    for (const role of ALL_ROLES) {
      const permissions = ROLE_PERMISSIONS[role];
      expect(new Set(permissions).size).toBe(permissions.length);
    }
  });
});

describe("canManageRole", () => {
  it("requires strictly greater seniority", () => {
    expect(canManageRole(OrgRole.OWNER, OrgRole.ADMIN)).toBe(true);
    expect(canManageRole(OrgRole.ADMIN, OrgRole.MANAGER)).toBe(true);
    expect(canManageRole(OrgRole.MANAGER, OrgRole.TEAM_MEMBER)).toBe(true);
  });

  it("stops a role managing its own level — no lateral demotion", () => {
    // Owner is the documented exception, covered below.
    for (const role of ALL_ROLES.filter((r) => r !== OrgRole.OWNER)) {
      expect(canManageRole(role, role)).toBe(false);
    }
  });

  it("lets Owners manage other Owners", () => {
    // Nothing outranks an Owner, so without this an Owner could never be
    // demoted, deactivated, or created by an existing Owner — an
    // organization would be permanently stuck with a departed owner's
    // access. The last active Owner is protected by the member service
    // instead, so the role can still never be emptied.
    expect(canManageRole(OrgRole.OWNER, OrgRole.OWNER)).toBe(true);
  });

  it("stops privilege escalation upward", () => {
    expect(canManageRole(OrgRole.ADMIN, OrgRole.OWNER)).toBe(false);
    expect(canManageRole(OrgRole.MANAGER, OrgRole.ADMIN)).toBe(false);
    expect(canManageRole(OrgRole.VIEWER, OrgRole.OWNER)).toBe(false);
  });

  it("ranks every role distinctly", () => {
    const ranks = ALL_ROLES.map((role) => ROLE_RANK[role]);
    expect(new Set(ranks).size).toBe(ALL_ROLES.length);
  });
});

describe("canUpdateTask", () => {
  it("lets a Team Member edit only their own task", () => {
    expect(canUpdateTask(OrgRole.TEAM_MEMBER, true)).toBe(true);
    expect(canUpdateTask(OrgRole.TEAM_MEMBER, false)).toBe(false);
  });

  it("lets an Accountant and above edit any task", () => {
    for (const role of [OrgRole.ACCOUNTANT, OrgRole.MANAGER, OrgRole.ADMIN, OrgRole.OWNER]) {
      expect(canUpdateTask(role, false)).toBe(true);
    }
  });

  it("never lets a Viewer edit, even their own assigned task", () => {
    expect(canUpdateTask(OrgRole.VIEWER, true)).toBe(false);
    expect(canUpdateTask(OrgRole.VIEWER, false)).toBe(false);
  });
});
