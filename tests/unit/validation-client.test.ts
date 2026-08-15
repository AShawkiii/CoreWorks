import { describe, expect, it } from "vitest";

import { ContractStatus, Priority } from "@/generated/prisma/enums";
import {
  clientListQuerySchema,
  createClientSchema,
  dateSchema,
  monthEndClosingDaySchema,
  optionalDateSchema,
  updateClientSchema,
} from "@/lib/validation/client";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

const valid = {
  name: "Northwind Retail",
  companyName: "Northwind Ltd",
  industry: "Retail",
  businessType: "Limited Company",
  startDate: "2026-01-15",
  servicePackageId: UUID_A,
  accountManagerId: UUID_B,
  backupMemberId: "",
  contactName: "Finance Contact",
  email: "Finance@Northwind.example.com",
  phone: "+44 20 7946 0000",
  accountingSystem: "Xero",
  reportingFrequency: "MONTHLY",
  monthEndClosingDay: "5",
  contractStatus: ContractStatus.ACTIVE,
  priority: Priority.HIGH,
  notes: "",
};

describe("dateSchema", () => {
  it("parses an input[type=date] value to local midnight", () => {
    const date = dateSchema.parse("2026-03-09");
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(2);
    expect(date.getDate()).toBe(9);
    // Local midnight, not UTC — a UTC parse can shift the calendar day
    // west of Greenwich, which would move every due-date calculation.
    expect(date.getHours()).toBe(0);
  });

  it("rejects malformed or empty dates", () => {
    for (const value of ["", "09/03/2026", "2026-3-9", "not-a-date"]) {
      expect(dateSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("optionalDateSchema", () => {
  it("maps empty to null and parses a real date", () => {
    expect(optionalDateSchema.parse("")).toBeNull();
    expect(optionalDateSchema.parse("2026-01-01")).toBeInstanceOf(Date);
  });
});

describe("monthEndClosingDaySchema", () => {
  it("accepts 1 through 31 and treats empty as unset", () => {
    expect(monthEndClosingDaySchema.parse("1")).toBe(1);
    expect(monthEndClosingDaySchema.parse("31")).toBe(31);
    expect(monthEndClosingDaySchema.parse("")).toBeNull();
  });

  it("rejects out-of-range and fractional days", () => {
    for (const value of ["0", "32", "2.5", "-1"]) {
      expect(monthEndClosingDaySchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("createClientSchema", () => {
  it("accepts a complete client and normalises optional fields", () => {
    const result = createClientSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.email).toBe("finance@northwind.example.com");
    expect(result.data.backupMemberId).toBeNull();
    expect(result.data.notes).toBeNull();
    expect(result.data.monthEndClosingDay).toBe(5);
    expect(result.data.startDate).toBeInstanceOf(Date);
  });

  it("requires Start Date — the legacy rule the brief omitted", () => {
    // Audit conflict C2: legacy validateClientFields requires it.
    const result = createClientSchema.safeParse({ ...valid, startDate: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(Object.keys(result.error.flatten().fieldErrors)).toContain(
      "startDate",
    );
  });

  it("requires a service package and an account manager", () => {
    expect(
      createClientSchema.safeParse({ ...valid, servicePackageId: "" }).success,
    ).toBe(false);
    expect(
      createClientSchema.safeParse({ ...valid, accountManagerId: "" }).success,
    ).toBe(false);
  });

  it("rejects a non-UUID reference, which could otherwise probe another tenant", () => {
    expect(
      createClientSchema.safeParse({ ...valid, servicePackageId: "1 OR 1=1" })
        .success,
    ).toBe(false);
  });

  it("requires a name of at least two characters", () => {
    expect(createClientSchema.safeParse({ ...valid, name: "" }).success).toBe(
      false,
    );
    expect(createClientSchema.safeParse({ ...valid, name: "A" }).success).toBe(
      false,
    );
  });

  it("rejects a malformed email but allows none at all", () => {
    expect(
      createClientSchema.safeParse({ ...valid, email: "nope" }).success,
    ).toBe(false);

    const blank = createClientSchema.safeParse({ ...valid, email: "" });
    expect(blank.success).toBe(true);
    expect(blank.success && blank.data.email).toBeNull();
  });

  it("accepts every contract status and priority", () => {
    for (const status of Object.values(ContractStatus)) {
      expect(
        createClientSchema.safeParse({ ...valid, contractStatus: status })
          .success,
      ).toBe(true);
    }
    for (const priority of Object.values(Priority)) {
      expect(
        createClientSchema.safeParse({ ...valid, priority }).success,
      ).toBe(true);
    }
  });
});

describe("updateClientSchema", () => {
  it("requires a client id on top of the create fields", () => {
    expect(updateClientSchema.safeParse(valid).success).toBe(false);
    expect(
      updateClientSchema.safeParse({ ...valid, clientId: UUID_A }).success,
    ).toBe(true);
  });
});

describe("clientListQuerySchema", () => {
  it("defaults to the most-urgent sort on page one", () => {
    const query = clientListQuerySchema.parse({});
    expect(query.sort).toBe("health");
    expect(query.page).toBe(1);
    expect(query.includeArchived).toBe(false);
  });

  it("accepts ALL as an explicit no-filter value", () => {
    const query = clientListQuerySchema.parse({ status: "ALL", health: "ALL" });
    expect(query.status).toBe("ALL");
    expect(query.health).toBe("ALL");
  });

  it("rejects an unknown sort or status rather than guessing", () => {
    expect(clientListQuerySchema.safeParse({ sort: "random" }).success).toBe(
      false,
    );
    expect(clientListQuerySchema.safeParse({ status: "NOPE" }).success).toBe(
      false,
    );
  });

  it("coerces a page number from the query string and floors it at 1", () => {
    expect(clientListQuerySchema.parse({ page: "3" }).page).toBe(3);
    expect(clientListQuerySchema.safeParse({ page: "0" }).success).toBe(false);
  });
});
