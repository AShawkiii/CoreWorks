import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { OrgRole } from "@/generated/prisma/enums";
import { hasPermission, type Permission } from "@/server/auth/permissions";

/**
 * Structural guard over the server-action layer.
 *
 * Every server action is an unauthenticated HTTP endpoint until it checks —
 * Next.js will happily invoke one for any caller who knows its id. The UI
 * hiding a button is not protection.
 *
 * This asserts each exported action opens with an authorization call. It
 * verifies the guard is PRESENT, not that it is semantically correct at
 * runtime; that is covered by tests/integration/members.test.ts, which drives
 * the services against a real database. The value here is catching a future
 * action added without any guard at all.
 */

const ACTIONS_DIR = join(process.cwd(), "src", "server", "actions");

function actionFiles(): string[] {
  return readdirSync(ACTIONS_DIR).filter((file) => file.endsWith(".ts"));
}

/** Exported async functions in a "use server" module are callable endpoints. */
function exportedActions(source: string): string[] {
  return [...source.matchAll(/export async function (\w+)/g)].map(
    (match) => match[1] as string,
  );
}

function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  if (start === -1) return "";
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

/**
 * Module-local `require*` helpers, e.g. `async function requireTaskPermission`.
 *
 * Some authorization decisions need a database lookup before they can be made
 * — task editing depends on whether the caller is the assignee — so the check
 * lives in a helper rather than inline. Calling one counts as a guard, but
 * only because every such helper is itself asserted to be guarded below.
 */
function localGuards(source: string): string[] {
  return [...source.matchAll(/^(?:async )?function (require\w+)/gm)].map(
    (match) => match[1] as string,
  );
}

function localBodyOf(source: string, name: string): string {
  const match = new RegExp(`^(?:async )?function ${name}\\b`, "m").exec(source);
  if (!match) return "";
  const start = match.index;
  const next = source.indexOf("\n}\n", start);
  return source.slice(start, next === -1 ? undefined : next);
}

describe("server action authorization", () => {
  const files = actionFiles();

  it("finds action modules to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const source = readFileSync(join(ACTIONS_DIR, file), "utf8");
    const actions = exportedActions(source);
    const helpers = localGuards(source);

    describe(file, () => {
      it("is a server module", () => {
        expect(source.startsWith('"use server"')).toBe(true);
      });

      for (const action of actions) {
        it(`${action} performs an authorization check`, () => {
          const body = bodyOf(source, action);

          // Either a permission check, an authenticated-context requirement,
          // delegation to another guarded action, or a module-local require*
          // helper — which the next test proves is itself guarded.
          const guarded =
            body.includes("requirePermission(") ||
            body.includes("requireOrgContext(") ||
            body.includes("signOut(") ||
            /await\s+\w+Action\(/.test(body) ||
            helpers.some((helper) => body.includes(`${helper}(`));

          expect(
            guarded,
            `${file}::${action} has no requirePermission/requireOrgContext call`,
          ).toBe(true);
        });
      }

      for (const helper of helpers) {
        it(`${helper} is itself an authorization check`, () => {
          // Otherwise a helper named require* would launder an unguarded
          // action past the test above.
          const body = localBodyOf(source, helper);
          expect(
            body.includes("requirePermission(") ||
              body.includes("requireOrgContext("),
            `${file}::${helper} is treated as a guard but performs no check`,
          ).toBe(true);
        });
      }
    });
  }

  it("gates every mutating action behind a permission a Viewer lacks", () => {
    // A Viewer is the least-privileged role; anything they can reach must be
    // read-only. This pins the permissions the actions actually name.
    const mutating: Permission[] = [
      "org:manage",
      "member:manage",
      "client:create",
      "client:update",
      "task:create",
      "task:update",
      "settings:manage",
      "branding:manage",
      "data:import",
    ];

    for (const permission of mutating) {
      expect(
        hasPermission(OrgRole.VIEWER, permission),
        `Viewer must not hold ${permission}`,
      ).toBe(false);
    }
  });

  it("names only real permissions in requirePermission calls", () => {
    // A typo'd permission string would silently deny everyone, or worse,
    // fail a lookup and behave unpredictably.
    for (const file of files) {
      const source = readFileSync(join(ACTIONS_DIR, file), "utf8");
      const used = [
        ...source.matchAll(/requirePermission\(\s*"([^"]+)"/g),
      ].map((match) => match[1] as Permission);

      for (const permission of used) {
        expect(
          hasPermission(OrgRole.OWNER, permission),
          `${file} uses unknown permission "${permission}"`,
        ).toBe(true);
      }
    }
  });
});
