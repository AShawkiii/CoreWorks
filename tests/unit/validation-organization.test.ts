import { describe, expect, it } from "vitest";

import {
  currencySchema,
  localeSchema,
  logoUrlSchema,
  organizationSlugSchema,
  timezoneSchema,
  updateOrganizationSchema,
} from "@/lib/validation/organization";

describe("organizationSlugSchema", () => {
  it("accepts lowercase hyphenated slugs", () => {
    expect(organizationSlugSchema.parse("meridian-advisory")).toBe(
      "meridian-advisory",
    );
    expect(organizationSlugSchema.parse("acme2")).toBe("acme2");
  });

  it("rejects uppercase, spaces, and underscores", () => {
    for (const value of ["Meridian", "meridian advisory", "meridian_advisory"]) {
      expect(organizationSlugSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects leading, trailing, and doubled hyphens", () => {
    for (const value of ["-acme", "acme-", "ac--me"]) {
      expect(organizationSlugSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects reserved slugs that would shadow app routes", () => {
    // A slug of "settings" or "api" could collide with real routes if slugs
    // are ever used as a URL segment.
    for (const value of ["api", "settings", "dashboard", "login", "admin"]) {
      expect(organizationSlugSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("timezoneSchema", () => {
  it("accepts real IANA zones", () => {
    for (const zone of ["Europe/London", "UTC", "America/New_York"]) {
      expect(timezoneSchema.safeParse(zone).success).toBe(true);
    }
  });

  it("rejects an invented zone", () => {
    expect(timezoneSchema.safeParse("Mars/Olympus").success).toBe(false);
    expect(timezoneSchema.safeParse("").success).toBe(false);
  });
});

describe("currencySchema", () => {
  it("uppercases a valid code", () => {
    expect(currencySchema.parse("gbp")).toBe("GBP");
  });

  it("rejects anything that is not three letters", () => {
    for (const value of ["GB", "GBPX", "12A", "G8P"]) {
      expect(currencySchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("localeSchema", () => {
  it("accepts common locale shapes", () => {
    for (const value of ["en", "en-GB", "pt-BR"]) {
      expect(localeSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects malformed locales", () => {
    for (const value of ["e", "en_GB", "english!"]) {
      expect(localeSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("logoUrlSchema", () => {
  it("normalizes empty to null", () => {
    expect(logoUrlSchema.parse("")).toBeNull();
  });

  it("accepts an https URL", () => {
    expect(logoUrlSchema.parse("https://cdn.example.com/logo.png")).toBe(
      "https://cdn.example.com/logo.png",
    );
  });

  it("rejects non-https schemes", () => {
    // http would leak over plaintext; javascript: and data: would be an
    // injection vector once rendered into an <img src>.
    for (const value of [
      "http://example.com/logo.png",
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    ]) {
      expect(logoUrlSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("updateOrganizationSchema", () => {
  const valid = {
    name: "Meridian Advisory",
    slug: "meridian-advisory",
    logoUrl: "",
    timezone: "Europe/London",
    currency: "gbp",
    locale: "en-GB",
  };

  it("accepts and normalizes a complete payload", () => {
    const result = updateOrganizationSchema.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.success && result.data.currency).toBe("GBP");
    expect(result.success && result.data.logoUrl).toBeNull();
  });

  it("rejects a too-short name", () => {
    expect(
      updateOrganizationSchema.safeParse({ ...valid, name: "A" }).success,
    ).toBe(false);
  });
});
