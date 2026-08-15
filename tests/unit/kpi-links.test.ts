import { describe, expect, it } from "vitest";

import { OrgRole } from "@/generated/prisma/enums";
import { KPI_LINKS } from "@/lib/dashboard/kpi-links";
import { buildControlCenterKpis } from "@/lib/domain/view-models/control-center";
import { clientListQuerySchema } from "@/lib/validation/client";
import { issueListQuerySchema } from "@/lib/validation/issue";
import { taskListQuerySchema } from "@/lib/validation/task";
import { hasPermission } from "@/server/auth/permissions";

/**
 * The Control Center's drill-downs.
 *
 * A KPI that links somewhere showing a different number is worse than a KPI
 * that links nowhere, so these pin the two halves together: every countable
 * KPI has a target, and every target parses under the schema the destination
 * page actually uses.
 *
 * The end-to-end equality — destination row count == KPI value — is checked by
 * Phase 7's live verification against PostgreSQL, since it depends on data.
 */

const SCHEMAS = {
  "/clients": clientListQuerySchema,
  "/tasks": taskListQuerySchema,
  "/issues": issueListQuerySchema,
} as const;

/** The KPI keys, taken from the ported builder rather than re-typed. */
const KPI_KEYS = buildControlCenterKpis([], [], [], new Date(2026, 7, 15)).map(
  (kpi) => kpi.key,
);

describe("KPI drill-down targets", () => {
  it("covers every KPI except the one that is an average", () => {
    // Overall Completion % is a mean, not a set — there is no list of it.
    const expected = KPI_KEYS.filter((key) => key !== "overallCompletionPct");

    expect(Object.keys(KPI_LINKS).sort()).toEqual([...expected].sort());
  });

  it("does not link the average", () => {
    expect(KPI_LINKS.overallCompletionPct).toBeUndefined();
  });

  it("names no KPI that does not exist", () => {
    for (const key of Object.keys(KPI_LINKS)) {
      expect(KPI_KEYS, `${key} is not a Control Center KPI`).toContain(key);
    }
  });

  for (const [key, link] of Object.entries(KPI_LINKS)) {
    describe(key, () => {
      it("targets a known list route", () => {
        expect(Object.keys(SCHEMAS)).toContain(link.pathname);
      });

      it("builds a query the destination page accepts", () => {
        // A typo'd filter value would parse to the schema's default and
        // silently show a different set than the KPI counted.
        const schema = SCHEMAS[link.pathname];
        const result = schema.safeParse(link.query);
        expect(
          result.success,
          `${key} -> ${link.pathname} ${JSON.stringify(link.query)}`,
        ).toBe(true);
      });

      it("survives the parse without losing a filter", () => {
        const schema = SCHEMAS[link.pathname];
        const parsed = schema.parse(link.query) as Record<string, unknown>;

        for (const [field, value] of Object.entries(link.query)) {
          // Booleans are parsed from tokens, so compare the meaning.
          const expected =
            value === "true" ? true : value === "false" ? false : value;
          expect(parsed[field], `${key}: ${field}`).toBe(expected);
        }
      });

      it("names a real permission an Owner holds", () => {
        expect(
          hasPermission(OrgRole.OWNER, link.permission),
          `${key} uses unknown permission "${link.permission}"`,
        ).toBe(true);
      });

      it("names the permission that actually guards its destination", () => {
        const expected =
          link.pathname === "/clients"
            ? "client:view"
            : link.pathname === "/tasks"
              ? "task:view"
              : "issue:view";
        expect(link.permission).toBe(expected);
      });
    });
  }

  it("keeps every drill-down open to a Viewer", () => {
    // A Viewer holds every :view permission, so no card should be inert for
    // them. If a future phase narrows a :view, this test says so.
    for (const [key, link] of Object.entries(KPI_LINKS)) {
      expect(
        hasPermission(OrgRole.VIEWER, link.permission),
        `${key} would be inert for a Viewer`,
      ).toBe(true);
    }
  });

  it("pairs derived-condition filters with an explicit status", () => {
    // `overdue` and `surfaced` supply their own status constraint. Leaving
    // status off would let the destination apply its OPEN default on top,
    // which reads as a different question than the KPI asked.
    expect(KPI_LINKS.overdueTasks?.query.status).toBe("ALL");
    expect(KPI_LINKS.overdueTasks?.query.overdue).toBe("true");
    expect(KPI_LINKS.issuesNeedingAttention?.query.status).toBe("ALL");
    expect(KPI_LINKS.issuesNeedingAttention?.query.surfaced).toBe("true");
  });

  it("sends totalClients to every status, not the list default", () => {
    // The KPI counts all non-deleted clients; the list defaults to a narrower
    // view, so the link has to say ALL.
    expect(KPI_LINKS.totalClients?.query.status).toBe("ALL");
  });

  it("never asks a list to include archived records", () => {
    // The KPIs are computed over `deletedAt: null`, so no drill-down may
    // widen past that.
    for (const [key, link] of Object.entries(KPI_LINKS)) {
      expect(link.query.includeArchived, key).toBeUndefined();
    }
  });
});

describe("clientListQuerySchema.includeArchived", () => {
  it("reads only an explicit true token", () => {
    // z.coerce.boolean() would read "false" as true, surfacing archived
    // clients on a URL that says not to.
    expect(clientListQuerySchema.parse({}).includeArchived).toBe(false);
    expect(
      clientListQuerySchema.parse({ includeArchived: "true" }).includeArchived,
    ).toBe(true);
    expect(
      clientListQuerySchema.parse({ includeArchived: "1" }).includeArchived,
    ).toBe(true);
    expect(
      clientListQuerySchema.parse({ includeArchived: "false" }).includeArchived,
    ).toBe(false);
    expect(
      clientListQuerySchema.parse({ includeArchived: "" }).includeArchived,
    ).toBe(false);
    expect(
      clientListQuerySchema.parse({ includeArchived: "0" }).includeArchived,
    ).toBe(false);
  });
});
