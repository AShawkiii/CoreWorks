import { describe, expect, it } from "vitest";

import {
  BRANDABLE_TOKENS,
  CONTRAST_AA,
  CONTRAST_AA_LARGE,
  DEFAULT_BRAND,
  NEAR_BLACK,
  THEME_PRESETS,
  WHITE,
  buildThemeCss,
  buildThemeVariables,
  contrastRatio,
  describeContrast,
  ensureContrast,
  formatHsl,
  isDefaultBrand,
  isThemeMode,
  parseHsl,
  presetById,
  readableForeground,
  relativeLuminance,
  resolveThemeMode,
  withLightness,
  type Hsl,
} from "@/lib/domain/theme";

describe("parseHsl", () => {
  it("accepts the stored channel format", () => {
    expect(parseHsl("221 83% 53%")).toEqual({ h: 221, s: 83, l: 53 });
    expect(parseHsl("  0 0% 100%  ")).toEqual({ h: 0, s: 0, l: 100 });
    expect(parseHsl("221.5 83.2% 53.7%")).toEqual({
      h: 221.5,
      s: 83.2,
      l: 53.7,
    });
  });

  it("rejects every other colour notation", () => {
    // The tokens are consumed as hsl(var(--primary)), so nothing else can work
    // even if it looks like a colour.
    for (const bad of [
      "#2563eb",
      "rgb(37, 99, 235)",
      "red",
      "hsl(221 83% 53%)",
      "var(--primary)",
      "221 83 53",
      "221% 83% 53%",
      "221 83% ",
      "",
    ]) {
      expect(parseHsl(bad), bad).toBeNull();
    }
  });

  it("rejects out-of-range channels", () => {
    expect(parseHsl("400 83% 53%")).toBeNull();
    expect(parseHsl("221 120% 53%")).toBeNull();
    expect(parseHsl("221 83% 120%")).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(parseHsl(null)).toBeNull();
    expect(parseHsl(undefined)).toBeNull();
  });

  describe("stylesheet injection", () => {
    // These values are written into a <style> element. A parse that let any of
    // them through would be a full page-defacement primitive.
    const payloads = [
      "221 83% 53%; } html { display: none } .x {",
      "221 83% 53%}</style><script>alert(1)</script>",
      "0 0% 0%; background: url(javascript:alert(1))",
      "221 83% 53% /* comment */",
      "expression(alert(1))",
      "221 83% 53%;@import url(//evil.example)",
      "\n221 83% 53%\n}\n:root{--primary:0 100% 50%",
    ];

    for (const payload of payloads) {
      it(`rejects ${JSON.stringify(payload.slice(0, 40))}`, () => {
        expect(parseHsl(payload)).toBeNull();
      });
    }

    it("never emits an unparseable value even if one reaches the builder", () => {
      // Defence in depth: the writer re-serialises from parsed numbers, so a
      // value that somehow bypassed validation still cannot escape.
      const css = buildThemeCss({
        ...DEFAULT_BRAND,
        primary: "221 83% 53%} html {display:none",
      });

      expect(css).not.toContain("display");
      expect(css).not.toContain("<");
      // Braces appear only as the selector delimiters this builder writes.
      expect(css.match(/\{/g)?.length).toBe(css.match(/\}/g)?.length);
    });
  });
});

describe("formatHsl", () => {
  it("round-trips", () => {
    const color = parseHsl("221 83% 53%");
    expect(color).not.toBeNull();
    expect(formatHsl(color!)).toBe("221 83% 53%");
  });

  it("rounds to one decimal so output is stable", () => {
    expect(formatHsl({ h: 221.44444, s: 83.55555, l: 53.1 })).toBe(
      "221.4 83.6% 53.1%",
    );
  });
});

describe("contrast", () => {
  it("matches the WCAG reference values", () => {
    // Black on white is the definitional 21:1.
    expect(contrastRatio({ h: 0, s: 0, l: 0 }, WHITE)).toBeCloseTo(21, 5);
    // A colour against itself is 1:1.
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    const a: Hsl = { h: 221, s: 83, l: 53 };
    const b: Hsl = { h: 45, s: 96, l: 90 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it("computes luminance monotonically in lightness", () => {
    const hues = [0, 120, 221, 300];
    for (const h of hues) {
      let previous = -1;
      for (let l = 0; l <= 100; l += 10) {
        const luminance = relativeLuminance({ h, s: 80, l });
        expect(luminance, `h=${h} l=${l}`).toBeGreaterThan(previous);
        previous = luminance;
      }
    }
  });

  it("reports AA and AA-large separately", () => {
    const report = describeContrast({ h: 0, s: 0, l: 0 }, WHITE);
    expect(report.aa).toBe(true);
    expect(report.aaLarge).toBe(true);

    const poor = describeContrast({ h: 0, s: 0, l: 96 }, WHITE);
    expect(poor.aa).toBe(false);
    expect(poor.aaLarge).toBe(false);
  });
});

describe("readableForeground", () => {
  it("puts white on a dark fill and near-black on a light one", () => {
    expect(readableForeground({ h: 221, s: 83, l: 25 })).toEqual(WHITE);
    expect(readableForeground({ h: 45, s: 96, l: 85 })).toEqual(NEAR_BLACK);
  });

  it("always picks the better of the two, at every lightness", () => {
    // The property that matters: whichever it returns must be the one with
    // the higher ratio. A fixed white would fail on a pale brand colour.
    for (let l = 0; l <= 100; l += 5) {
      const background: Hsl = { h: 200, s: 70, l };
      const chosen = readableForeground(background);
      const other = chosen === WHITE ? NEAR_BLACK : WHITE;
      expect(
        contrastRatio(background, chosen),
        `l=${l}`,
      ).toBeGreaterThanOrEqual(contrastRatio(background, other));
    }
  });

  it("gives every preset's primary a readable label", () => {
    for (const preset of THEME_PRESETS) {
      const primary = parseHsl(preset.colors.primary);
      expect(primary, preset.id).not.toBeNull();
      const ratio = contrastRatio(primary!, readableForeground(primary!));
      expect(ratio, `${preset.id} primary`).toBeGreaterThanOrEqual(CONTRAST_AA);
    }
  });
});

describe("ensureContrast", () => {
  const darkPage: Hsl = { h: 222, s: 47, l: 9 };

  it("leaves a colour alone when it already passes", () => {
    const bright: Hsl = { h: 217, s: 91, l: 70 };
    expect(ensureContrast(bright, darkPage, CONTRAST_AA_LARGE)).toEqual(bright);
  });

  it("lifts a colour that is too dim against a dark page", () => {
    const dim: Hsl = { h: 221, s: 83, l: 18 };
    const fixed = ensureContrast(dim, darkPage, CONTRAST_AA_LARGE);

    expect(fixed.l).toBeGreaterThan(dim.l);
    expect(contrastRatio(fixed, darkPage)).toBeGreaterThanOrEqual(
      CONTRAST_AA_LARGE,
    );
  });

  it("never changes the hue or saturation the organization chose", () => {
    const brand: Hsl = { h: 271, s: 55, l: 12 };
    const fixed = ensureContrast(brand, darkPage, CONTRAST_AA);

    expect(fixed.h).toBe(brand.h);
    expect(fixed.s).toBe(brand.s);
  });

  it("returns the closest achievable value rather than throwing", () => {
    // Against a mid-grey, no lightness of a mid-grey hue can reach 21:1.
    const grey: Hsl = { h: 0, s: 0, l: 50 };
    const result = ensureContrast(grey, grey, 21);
    expect(result).toBeDefined();
    expect(Number.isFinite(result.l)).toBe(true);
  });

  it("reaches the floor from any starting lightness", () => {
    for (let l = 0; l <= 100; l += 5) {
      const fixed = ensureContrast({ h: 221, s: 83, l }, darkPage, CONTRAST_AA_LARGE);
      expect(
        contrastRatio(fixed, darkPage),
        `from l=${l}`,
      ).toBeGreaterThanOrEqual(CONTRAST_AA_LARGE - 0.001);
    }
  });
});

describe("BRANDABLE_TOKENS", () => {
  it("contains no token that carries meaning", () => {
    // The rule this whole module exists to protect. Client health, status, and
    // priority colours come from the legacy enumerations (audit §5); an
    // organization whose brand is red must not get a red "On Track".
    const forbidden = [
      "health",
      "success",
      "warning",
      "danger",
      "info",
      "foreground-health",
    ];

    for (const token of BRANDABLE_TOKENS) {
      for (const word of forbidden) {
        expect(token.includes(word), `${token} must not be brandable`).toBe(
          false,
        );
      }
    }
  });

  it("emits no meaning-carrying token, whatever the brand", () => {
    const css = buildThemeCss({
      primary: "0 100% 50%",
      secondary: "0 100% 40%",
      accent: "0 100% 45%",
      sidebar: "0 100% 20%",
      background: "0 100% 97%",
    });

    for (const token of [
      "--health-on-track",
      "--health-at-risk",
      "--health-delayed",
      "--health-on-hold",
      "--success",
      "--warning",
      "--danger",
      "--info",
    ]) {
      expect(css.includes(token), `${token} leaked into the brand stylesheet`).toBe(
        false,
      );
    }
  });

  it("only ever emits tokens on the brandable list", () => {
    const css = buildThemeCss(THEME_PRESETS[3]!.colors);
    const emitted = [...css.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]);

    expect(emitted.length).toBeGreaterThan(0);
    for (const token of emitted) {
      expect(
        (BRANDABLE_TOKENS as readonly string[]).includes(token!),
        `${token} is emitted but not declared brandable`,
      ).toBe(true);
    }
  });
});

describe("buildThemeVariables", () => {
  it("derives a readable foreground for every fill, in both modes", () => {
    for (const preset of THEME_PRESETS) {
      const { light, dark } = buildThemeVariables(preset.colors);

      for (const [fill, foreground] of [
        ["--primary", "--primary-foreground"],
        ["--secondary", "--secondary-foreground"],
        ["--accent", "--accent-foreground"],
      ] as const) {
        for (const [mode, vars] of [
          ["light", light],
          ["dark", dark],
        ] as const) {
          const a = parseHsl(vars[fill] ?? "");
          const b = parseHsl(vars[foreground] ?? "");
          expect(a, `${preset.id} ${mode} ${fill}`).not.toBeNull();
          expect(b, `${preset.id} ${mode} ${foreground}`).not.toBeNull();
          expect(
            contrastRatio(a!, b!),
            `${preset.id} ${mode} ${fill} vs its foreground`,
          ).toBeGreaterThanOrEqual(CONTRAST_AA);
        }
      }
    }
  });

  it("gives every preset a dark primary that clears the UI floor", () => {
    const darkPage: Hsl = { h: 222, s: 47, l: 9 };

    for (const preset of THEME_PRESETS) {
      const { dark } = buildThemeVariables(preset.colors);
      const primary = parseHsl(dark["--primary"] ?? "");
      expect(primary, preset.id).not.toBeNull();
      expect(
        contrastRatio(primary!, darkPage),
        `${preset.id} dark primary against the page`,
      ).toBeGreaterThanOrEqual(CONTRAST_AA_LARGE - 0.001);
    }
  });

  it("makes sidebar text readable on the sidebar, at any lightness", () => {
    for (let l = 0; l <= 100; l += 10) {
      const { light } = buildThemeVariables({
        ...DEFAULT_BRAND,
        sidebar: `210 30% ${l}%`,
      });
      const panel = parseHsl(light["--sidebar"] ?? "");
      const text = parseHsl(light["--sidebar-foreground"] ?? "");
      expect(panel, `l=${l}`).not.toBeNull();
      expect(text, `l=${l}`).not.toBeNull();
      expect(
        contrastRatio(panel!, text!),
        `sidebar text at l=${l}`,
      ).toBeGreaterThanOrEqual(CONTRAST_AA - 0.001);
    }
  });

  it("ties the focus ring to the primary — an invisible ring is a failure", () => {
    const { light, dark } = buildThemeVariables(THEME_PRESETS[2]!.colors);
    expect(light["--ring"]).toBe(light["--primary"]);
    expect(dark["--ring"]).toBe(dark["--primary"]);
  });

  it("falls back per-slot on an unparseable value", () => {
    const { light } = buildThemeVariables({
      ...DEFAULT_BRAND,
      primary: "not a colour",
    });
    expect(light["--primary"]).toBe(DEFAULT_BRAND.primary);
    // The other slots are untouched by one bad value.
    expect(light["--sidebar"]).toBe(DEFAULT_BRAND.sidebar);
  });

  it("handles an entirely empty brand", () => {
    const { light } = buildThemeVariables({});
    expect(light["--primary"]).toBe(DEFAULT_BRAND.primary);
  });

  it("does not tint the dark page background", () => {
    // Dark keeps its authored neutral: tinting a 9%-lightness page muddies
    // every surface above it, and the brand is already carried elsewhere.
    const { dark } = buildThemeVariables({
      ...DEFAULT_BRAND,
      background: "120 80% 95%",
    });
    expect(dark["--background"]).toBeUndefined();
  });
});

describe("buildThemeCss", () => {
  it("emits nothing for the stock palette", () => {
    expect(buildThemeCss(DEFAULT_BRAND)).toBe("");
    expect(isDefaultBrand(DEFAULT_BRAND)).toBe(true);
  });

  it("treats an equivalent-but-differently-written default as default", () => {
    expect(isDefaultBrand({ ...DEFAULT_BRAND, primary: "  221 83% 53%  " })).toBe(
      true,
    );
  });

  it("emits both blocks for a custom palette", () => {
    const css = buildThemeCss(THEME_PRESETS[1]!.colors);
    expect(css).toContain(":root{");
    expect(css).toContain(".dark{");
    expect(css).toContain("--primary:");
  });

  it("is stable — the same input yields byte-identical output", () => {
    // An unstable ordering would change the HTML on every render.
    const a = buildThemeCss(THEME_PRESETS[3]!.colors);
    const b = buildThemeCss({ ...THEME_PRESETS[3]!.colors });
    expect(a).toBe(b);
  });

  it("produces balanced, well-formed declarations", () => {
    for (const preset of THEME_PRESETS) {
      const css = buildThemeCss(preset.colors);
      if (!css) continue;
      expect(css.match(/\{/g)!.length).toBe(css.match(/\}/g)!.length);
      expect(css).not.toContain(";;");
      expect(css).not.toMatch(/[<>]/);
    }
  });
});

describe("presets", () => {
  it("has unique ids and parseable colours", () => {
    const ids = THEME_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const preset of THEME_PRESETS) {
      for (const [key, value] of Object.entries(preset.colors)) {
        expect(parseHsl(value), `${preset.id}.${key}`).not.toBeNull();
      }
    }
  });

  it("reproduces globals.css exactly under the default preset", () => {
    // An organization that never opens the appearance screen must render
    // identically to every phase before this one.
    expect(presetById("coreworks")?.colors).toEqual(DEFAULT_BRAND);
  });

  it("returns undefined for an unknown id", () => {
    expect(presetById("nope")).toBeUndefined();
    expect(presetById("custom")).toBeUndefined();
  });
});

describe("resolveThemeMode", () => {
  it("prefers the user's own choice", () => {
    expect(resolveThemeMode("dark", "light")).toBe("dark");
    expect(resolveThemeMode("light", "dark")).toBe("light");
  });

  it("falls back to the organization default when the user has none", () => {
    expect(resolveThemeMode(null, "dark")).toBe("dark");
    expect(resolveThemeMode(undefined, "light")).toBe("light");
  });

  it("falls back to system when neither is set or either is nonsense", () => {
    expect(resolveThemeMode(null, null)).toBe("system");
    expect(resolveThemeMode("sepia", "neon")).toBe("system");
    // A bad user value must not shadow a good organization default.
    expect(resolveThemeMode("sepia", "dark")).toBe("dark");
  });

  it("never throws on an unrecognised stored value", () => {
    // A row written before a future mode is removed must not lock anyone out.
    expect(() => resolveThemeMode("{}", "[]")).not.toThrow();
    expect(resolveThemeMode("{}", "[]")).toBe("system");
  });
});

describe("isThemeMode", () => {
  it("accepts exactly the three modes", () => {
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("system")).toBe(true);
    expect(isThemeMode("Dark")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(42)).toBe(false);
  });
});

describe("withLightness", () => {
  it("clamps rather than wrapping", () => {
    expect(withLightness({ h: 0, s: 0, l: 50 }, 140).l).toBe(100);
    expect(withLightness({ h: 0, s: 0, l: 50 }, -20).l).toBe(0);
  });
});
