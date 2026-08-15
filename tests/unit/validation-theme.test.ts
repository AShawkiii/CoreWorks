import { describe, expect, it } from "vitest";

import {
  CUSTOM_PRESET_ID,
  DEFAULT_BRAND,
  PRESET_IDS,
  THEME_MODES,
} from "@/lib/domain/theme";
import {
  applyPresetSchema,
  hslChannelSchema,
  presetSchema,
  setThemeModeSchema,
  themeModeSchema,
  updateThemeSchema,
} from "@/lib/validation/theme";

const VALID = {
  preset: "coreworks",
  primaryColor: DEFAULT_BRAND.primary,
  secondaryColor: DEFAULT_BRAND.secondary,
  accentColor: DEFAULT_BRAND.accent,
  sidebarColor: DEFAULT_BRAND.sidebar,
  backgroundColor: DEFAULT_BRAND.background,
  defaultMode: "system",
  logoUrl: "",
};

describe("hslChannelSchema", () => {
  it("accepts the stored channel format", () => {
    expect(hslChannelSchema.safeParse("221 83% 53%").success).toBe(true);
    expect(hslChannelSchema.safeParse("0 0% 100%").success).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(hslChannelSchema.parse("  221 83% 53%  ")).toBe("221 83% 53%");
  });

  describe("stylesheet injection is rejected at the schema", () => {
    // These values would be written into a <style> element. The domain writer
    // re-serialises from numbers as a second defence, but the request must
    // never get that far.
    const payloads = [
      "221 83% 53%; } html { display:none } .x {",
      "221 83% 53%}</style><script>alert(1)</script>",
      "221 83% 53%;@import url(//evil.example)",
      "0 0% 0%; background:url(javascript:alert(1))",
      "expression(alert(1))",
      "#2563eb",
      "rgb(37,99,235)",
      "red",
      "hsl(221 83% 53%)",
      "var(--danger)",
      "221 83% 53% !important",
      "221 83% 53%\n}\n:root{--primary:0 100% 50%",
    ];

    for (const payload of payloads) {
      it(JSON.stringify(payload.slice(0, 44)), () => {
        expect(hslChannelSchema.safeParse(payload).success).toBe(false);
      });
    }
  });

  it("rejects a value long enough to be a payload", () => {
    expect(hslChannelSchema.safeParse("2".repeat(200)).success).toBe(false);
  });

  it("rejects out-of-range channels", () => {
    expect(hslChannelSchema.safeParse("400 83% 53%").success).toBe(false);
    expect(hslChannelSchema.safeParse("221 200% 53%").success).toBe(false);
  });
});

describe("themeModeSchema", () => {
  it("accepts exactly the three modes", () => {
    for (const mode of THEME_MODES) {
      expect(themeModeSchema.safeParse(mode).success, mode).toBe(true);
    }
    expect(themeModeSchema.safeParse("sepia").success).toBe(false);
    expect(themeModeSchema.safeParse("Dark").success).toBe(false);
  });
});

describe("presetSchema", () => {
  it("accepts every declared preset and the custom marker", () => {
    for (const id of PRESET_IDS) {
      expect(presetSchema.safeParse(id).success, id).toBe(true);
    }
    expect(presetSchema.safeParse(CUSTOM_PRESET_ID).success).toBe(true);
  });

  it("rejects an unknown preset", () => {
    expect(presetSchema.safeParse("evil").success).toBe(false);
    expect(presetSchema.safeParse("").success).toBe(false);
  });
});

describe("applyPresetSchema", () => {
  it("does NOT accept the custom marker — there is no custom palette to apply", () => {
    expect(applyPresetSchema.safeParse({ preset: CUSTOM_PRESET_ID }).success).toBe(
      false,
    );
    expect(applyPresetSchema.safeParse({ preset: "coreworks" }).success).toBe(
      true,
    );
  });
});

describe("updateThemeSchema", () => {
  it("accepts a complete, valid submission", () => {
    const parsed = updateThemeSchema.safeParse(VALID);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.logoUrl).toBeNull();
  });

  it("rejects the submission if ANY colour is malformed", () => {
    // Partial acceptance would leave the organization with a half-applied
    // palette and no indication which half.
    for (const field of [
      "primaryColor",
      "secondaryColor",
      "accentColor",
      "sidebarColor",
      "backgroundColor",
    ] as const) {
      const result = updateThemeSchema.safeParse({
        ...VALID,
        [field]: "#2563eb",
      });
      expect(result.success, field).toBe(false);
    }
  });

  it("reports the offending field by name", () => {
    const result = updateThemeSchema.safeParse({
      ...VALID,
      sidebarColor: "chartreuse",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.sidebarColor).toBeDefined();
    }
  });

  it("requires https for a logo, so it can never be javascript: or data:", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "http://example.com/logo.png",
      "not a url",
    ]) {
      expect(
        updateThemeSchema.safeParse({ ...VALID, logoUrl: bad }).success,
        bad,
      ).toBe(false);
    }

    expect(
      updateThemeSchema.safeParse({
        ...VALID,
        logoUrl: "https://example.com/logo.svg",
      }).success,
    ).toBe(true);
  });

  it("normalises a blank logo to null rather than an empty string", () => {
    const parsed = updateThemeSchema.parse({ ...VALID, logoUrl: "" });
    expect(parsed.logoUrl).toBeNull();
  });

  it("rejects a missing field rather than defaulting it", () => {
    const { primaryColor: _omitted, ...withoutPrimary } = VALID;
    expect(updateThemeSchema.safeParse(withoutPrimary).success).toBe(false);
  });
});

describe("setThemeModeSchema", () => {
  it("accepts a mode and refuses anything else", () => {
    expect(setThemeModeSchema.safeParse({ mode: "dark" }).success).toBe(true);
    expect(setThemeModeSchema.safeParse({ mode: "purple" }).success).toBe(false);
    expect(setThemeModeSchema.safeParse({}).success).toBe(false);
  });
});
