/**
 * Theme and branding rules — pure, no I/O.
 *
 * NET-NEW (audit §15, line 37: "Theming / branding — **Absent**, hardcoded
 * 'Finance Lab', fixed palette. Build net-new"). Legacy had exactly one
 * palette, compiled into `webapp/Styles.html` and inlined into the two pages
 * that used it. Nothing here is a port.
 *
 * ---------------------------------------------------------------------------
 * The one legacy rule this module exists to protect
 * ---------------------------------------------------------------------------
 *
 * Legacy separated two kinds of colour, and CoreWorks keeps them separate:
 *
 *  - **Chrome** — `--fl-brand` and `--fl-accent`. Decoration. Fixed in legacy;
 *    per-organization here. This is what branding changes.
 *  - **Meaning** — `--fl-on-track`, `--fl-at-risk`, `--fl-delayed`,
 *    `--fl-on-hold`, mirroring the `colors` maps in `config/Enums.gs`, which
 *    the audit lists as part of the **canonical enumerations** (§5) rather
 *    than as styling. Green means on track. Red means delayed.
 *
 * An organization whose brand colour is red must not end up with a red
 * "On Track" badge. `BRANDABLE_TOKENS` is the enforced boundary, and a test
 * asserts no health, success, warning, danger, or info token appears in it.
 *
 * ---------------------------------------------------------------------------
 * Why derivation rather than more stored fields
 * ---------------------------------------------------------------------------
 *
 * `ThemeSettings` stores five colours, authored for light mode. Dark mode
 * needs its own values: the default primary is `221 83% 53%` in light and
 * `217 91% 62%` in dark, because 53% lightness on a 9%-lightness page is too
 * dim to read. Asking an administrator to author every colour twice — and to
 * get the dark contrast right by eye — would produce worse results than
 * computing it.
 *
 * So dark variants are derived, and the rule is accessibility rather than
 * taste: walk the lightness until the colour clears a WCAG contrast ratio
 * against the surface it sits on. Deterministic, and testable without a
 * browser.
 */

// ---------------------------------------------------------------------------
// HSL channels
// ---------------------------------------------------------------------------

export interface Hsl {
  /** Degrees, 0–360. */
  h: number;
  /** Percent, 0–100. */
  s: number;
  /** Percent, 0–100. */
  l: number;
}

/**
 * The stored format: HSL *channels* with no `hsl()` wrapper — `"221 83% 53%"`.
 *
 * Channels rather than complete colours because the tokens are consumed as
 * `hsl(var(--primary))`, so a component can write `hsl(var(--primary) / 0.5)`
 * for a translucent variant. A stored `#2563eb` could not do that.
 */
const CHANNEL_PATTERN =
  /^(\d{1,3}(?:\.\d+)?)\s+(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%$/;

/**
 * Strict parse. Returns null for anything that is not exactly three numeric
 * channels in range.
 *
 * These values are rendered into a `<style>` element, so this is a security
 * boundary as much as a correctness one. Note that the writer never emits the
 * input string: `formatHsl` re-serialises from the parsed *numbers*, so even a
 * value that somehow reached the database unvalidated cannot carry a `}` out
 * of its declaration and into the stylesheet.
 */
export function parseHsl(value: string | null | undefined): Hsl | null {
  if (typeof value !== "string") return null;

  const match = CHANNEL_PATTERN.exec(value.trim());
  if (!match) return null;

  const h = Number(match[1]);
  const s = Number(match[2]);
  const l = Number(match[3]);

  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) {
    return null;
  }
  if (h > 360 || s > 100 || l > 100) return null;

  return { h, s, l };
}

/** Serialises from numbers, never from caller-supplied text. */
export function formatHsl(color: Hsl): string {
  const round = (value: number) => Math.round(value * 10) / 10;
  return `${round(color.h)} ${round(color.s)}% ${round(color.l)}%`;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function withLightness(color: Hsl, l: number): Hsl {
  return { ...color, l: clamp(l, 0, 100) };
}

// ---------------------------------------------------------------------------
// Contrast (WCAG 2.1)
// ---------------------------------------------------------------------------

/** HSL → sRGB, each channel 0–1. */
export function hslToRgb(color: Hsl): { r: number; g: number; b: number } {
  const h = ((color.h % 360) + 360) % 360;
  const s = clamp(color.s, 0, 100) / 100;
  const l = clamp(color.l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];

  return { r: r1 + m, g: g1 + m, b: b1 + m };
}

/** WCAG relative luminance. */
export function relativeLuminance(color: Hsl): number {
  const { r, g, b } = hslToRgb(color);
  const channel = (value: number) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

  return (
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  );
}

/** WCAG contrast ratio, 1–21. Symmetric in its arguments. */
export function contrastRatio(a: Hsl, b: Hsl): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA for normal text. */
export const CONTRAST_AA = 4.5;
/** WCAG AA for large text, and the 1.4.11 floor for UI components. */
export const CONTRAST_AA_LARGE = 3;

export const WHITE: Hsl = { h: 0, s: 0, l: 100 };
/** The near-black used by every dark foreground token, not pure #000. */
export const NEAR_BLACK: Hsl = { h: 222, s: 47, l: 9 };

/**
 * The readable text colour to place ON a fill.
 *
 * Whichever of white and near-black contrasts better. A brand colour at 53%
 * lightness takes white; the same hue at 85% takes near-black. Picking one
 * fixed foreground would make one of those unreadable.
 */
export function readableForeground(background: Hsl): Hsl {
  return contrastRatio(background, WHITE) >=
    contrastRatio(background, NEAR_BLACK)
    ? WHITE
    : NEAR_BLACK;
}

/**
 * Nudges lightness until the colour clears `minRatio` against `against`.
 *
 * Hue and saturation are never touched — an organization's brand hue is the
 * part they actually chose, and shifting it to win a contrast check would
 * hand them a different colour than the one they asked for.
 *
 * Direction is decided by which surface it must stand against: on a dark
 * background the colour is lightened, on a light one it is darkened. Steps of
 * 1% up to the point where no further movement is possible; if even pure white
 * or pure black cannot reach the target, the closest achievable value is
 * returned rather than throwing — a poor contrast is reported to the
 * administrator by `describeContrast`, not enforced by failing to render.
 */
export function ensureContrast(
  color: Hsl,
  against: Hsl,
  minRatio: number,
): Hsl {
  if (contrastRatio(color, against) >= minRatio) return color;

  const lighten = relativeLuminance(against) < relativeLuminance(color) ||
    relativeLuminance(against) < 0.18;

  let best = color;
  let bestRatio = contrastRatio(color, against);

  for (let step = 1; step <= 100; step += 1) {
    const candidate = withLightness(
      color,
      lighten ? color.l + step : color.l - step,
    );
    const ratio = contrastRatio(candidate, against);

    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
    if (ratio >= minRatio) return candidate;
    if (candidate.l <= 0 || candidate.l >= 100) break;
  }

  return best;
}

export interface ContrastReport {
  ratio: number;
  /** Passes WCAG AA for normal text. */
  aa: boolean;
  /** Passes the 3:1 floor for large text and UI components. */
  aaLarge: boolean;
}

export function describeContrast(a: Hsl, b: Hsl): ContrastReport {
  const ratio = contrastRatio(a, b);
  return {
    ratio: Math.round(ratio * 100) / 100,
    aa: ratio >= CONTRAST_AA,
    aaLarge: ratio >= CONTRAST_AA_LARGE,
  };
}

// ---------------------------------------------------------------------------
// The brand
// ---------------------------------------------------------------------------

export interface BrandColors {
  primary: string;
  secondary: string;
  accent: string;
  sidebar: string;
  background: string;
}

/** The CoreWorks defaults, matching the `:root` block in `globals.css`. */
export const DEFAULT_BRAND: BrandColors = {
  primary: "221 83% 53%",
  secondary: "215 16% 47%",
  accent: "221 83% 53%",
  sidebar: "222 47% 11%",
  background: "0 0% 100%",
};

/**
 * The tokens branding is allowed to set, directly or by derivation.
 *
 * This list is the enforced boundary described at the top of the file. Every
 * entry is chrome. No `--health-*`, `--success`, `--warning`, `--danger`, or
 * `--info` token appears, because those carry meaning that comes from
 * `Enums.gs` (audit §5) rather than from an organization's marketing.
 */
export const BRANDABLE_TOKENS = [
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--accent",
  "--accent-foreground",
  "--ring",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-muted",
  "--sidebar-accent",
  "--sidebar-border",
  "--background",
  "--surface",
  "--card",
  "--popover",
] as const;

export type BrandableToken = (typeof BRANDABLE_TOKENS)[number];

export interface ThemePreset {
  id: string;
  label: string;
  description: string;
  colors: BrandColors;
}

/**
 * Named starting points.
 *
 * `coreworks` is the schema default and reproduces `globals.css` exactly, so
 * an organization that never opens this screen renders identically to every
 * phase before this one.
 *
 * `legacy` reproduces the palette from the system CoreWorks replaces —
 * `--fl-brand: #1f2937` (222 30% 17%) and `--fl-accent: #2563eb`
 * (217 91% 53%) — for a team that would rather the new tool looked like the
 * old one on day one.
 */
export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: "coreworks",
    label: "CoreWorks",
    description: "The default blue.",
    colors: DEFAULT_BRAND,
  },
  {
    id: "legacy",
    label: "Classic",
    description: "The palette from the previous Sheets system.",
    colors: {
      primary: "217 91% 53%",
      secondary: "215 14% 34%",
      accent: "217 91% 53%",
      sidebar: "222 30% 17%",
      background: "220 20% 98%",
    },
  },
  {
    id: "slate",
    label: "Slate",
    description: "Low-chroma and quiet.",
    colors: {
      primary: "215 25% 35%",
      secondary: "215 16% 47%",
      accent: "199 89% 40%",
      sidebar: "215 28% 14%",
      background: "0 0% 100%",
    },
  },
  {
    id: "forest",
    label: "Forest",
    description: "Deep green.",
    colors: {
      primary: "158 64% 30%",
      secondary: "155 12% 42%",
      accent: "160 84% 32%",
      sidebar: "158 40% 12%",
      background: "150 20% 99%",
    },
  },
  {
    id: "plum",
    label: "Plum",
    description: "Warm purple.",
    colors: {
      primary: "271 55% 45%",
      secondary: "270 10% 46%",
      accent: "292 60% 44%",
      sidebar: "270 35% 15%",
      background: "300 20% 99%",
    },
  },
] as const;

export const PRESET_IDS = THEME_PRESETS.map((preset) => preset.id);

/** The preset marking "these colours were chosen by hand". */
export const CUSTOM_PRESET_ID = "custom";

export function presetById(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((preset) => preset.id === id);
}

// ---------------------------------------------------------------------------
// Token derivation
// ---------------------------------------------------------------------------

/** The dark-mode page background, from the `.dark` block in `globals.css`. */
const DARK_BACKGROUND: Hsl = { h: 222, s: 47, l: 9 };

export type ThemeVariables = Partial<Record<BrandableToken, string>>;

export interface ThemeVariableSets {
  light: ThemeVariables;
  dark: ThemeVariables;
}

/**
 * Turns five stored colours into the custom properties that override
 * `globals.css`.
 *
 * Only tokens that actually differ from the default are emitted, so an
 * organization on the stock palette ships an empty style block rather than a
 * full restatement of the stylesheet.
 *
 * Anything unparseable falls back to the CoreWorks default for that slot. This
 * is deliberate belt-and-braces: the value was validated on the way in, and is
 * validated again here, because the output is a stylesheet.
 */
export function buildThemeVariables(brand: Partial<BrandColors>): ThemeVariableSets {
  const read = (
    value: string | null | undefined,
    fallback: string,
  ): Hsl => parseHsl(value) ?? parseHsl(fallback) ?? { h: 0, s: 0, l: 0 };

  const primary = read(brand.primary, DEFAULT_BRAND.primary);
  const secondary = read(brand.secondary, DEFAULT_BRAND.secondary);
  const accent = read(brand.accent, DEFAULT_BRAND.accent);
  const sidebar = read(brand.sidebar, DEFAULT_BRAND.sidebar);
  const background = read(brand.background, DEFAULT_BRAND.background);

  const light: ThemeVariables = {};
  const dark: ThemeVariables = {};

  // --- Fills that carry text on them -------------------------------------
  // Each gets a foreground chosen for contrast rather than a fixed white,
  // and a dark variant lifted until it clears the 3:1 UI-component floor
  // against the dark page.
  const fills: [BrandableToken, BrandableToken, Hsl][] = [
    ["--primary", "--primary-foreground", primary],
    ["--secondary", "--secondary-foreground", secondary],
    ["--accent", "--accent-foreground", accent],
  ];

  for (const [token, foregroundToken, color] of fills) {
    light[token] = formatHsl(color);
    light[foregroundToken] = formatHsl(readableForeground(color));

    const darkColor = ensureContrast(color, DARK_BACKGROUND, CONTRAST_AA_LARGE);
    dark[token] = formatHsl(darkColor);
    dark[foregroundToken] = formatHsl(readableForeground(darkColor));
  }

  // The focus ring follows the primary in both modes — a ring the user cannot
  // see is an accessibility failure, and it is the same colour question.
  light["--ring"] = light["--primary"];
  dark["--ring"] = dark["--primary"];

  // --- The sidebar --------------------------------------------------------
  // A surface with its own foreground family, dark by default even in light
  // mode. Its four companions are derived so the whole panel stays coherent
  // whatever hue is chosen.
  const sidebarSet = (base: Hsl): ThemeVariables => {
    const onDark = base.l < 50;
    return {
      "--sidebar": formatHsl(base),
      "--sidebar-foreground": formatHsl(
        ensureContrast(
          withLightness(base, onDark ? 92 : 12),
          base,
          CONTRAST_AA,
        ),
      ),
      "--sidebar-muted": formatHsl(
        ensureContrast(
          withLightness(base, onDark ? 62 : 38),
          base,
          CONTRAST_AA_LARGE,
        ),
      ),
      // A hover/selected wash: a small step away from the panel itself, in
      // whichever direction stays on the panel rather than off it.
      "--sidebar-accent": formatHsl(
        withLightness(base, onDark ? base.l + 9 : base.l - 9),
      ),
      "--sidebar-border": formatHsl(
        withLightness(base, onDark ? base.l + 9 : base.l - 9),
      ),
    };
  };

  Object.assign(light, sidebarSet(sidebar));
  // Dark mode drops the sidebar below the page so the panel still reads as a
  // separate plane rather than merging into the background.
  Object.assign(
    dark,
    sidebarSet(withLightness(sidebar, Math.max(4, sidebar.l - 4))),
  );

  // --- The page background ------------------------------------------------
  // Light mode only. Dark mode keeps its authored neutral: tinting a
  // 9%-lightness page with a brand hue muddies every surface above it for no
  // gain, and the brand is already carried by the sidebar and the primary.
  light["--background"] = formatHsl(background);
  light["--surface"] = formatHsl(
    withLightness(background, background.l > 50 ? background.l - 2 : background.l + 2),
  );
  light["--card"] = formatHsl(background);
  light["--popover"] = formatHsl(background);

  return { light, dark };
}

/** True when the brand is the stock palette, so no override is needed at all. */
export function isDefaultBrand(brand: Partial<BrandColors>): boolean {
  return (
    (Object.keys(DEFAULT_BRAND) as (keyof BrandColors)[]).every((key) => {
      const supplied = parseHsl(brand[key]);
      const fallback = parseHsl(DEFAULT_BRAND[key]);
      if (!supplied || !fallback) return false;
      return (
        supplied.h === fallback.h &&
        supplied.s === fallback.s &&
        supplied.l === fallback.l
      );
    })
  );
}

function declarations(vars: ThemeVariables): string {
  return Object.entries(vars)
    // Sorted so identical input produces identical output — an unstable
    // ordering would change the HTML on every render and defeat caching.
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([token, value]) => `${token}:${value};`)
    .join("");
}

/**
 * The stylesheet text for an organization's brand.
 *
 * Every value passed through `formatHsl`, so the output is built from numbers
 * and cannot contain a brace, a semicolon in the wrong place, or a `</style>`.
 * Returns an empty string for the stock palette.
 */
export function buildThemeCss(brand: Partial<BrandColors>): string {
  if (isDefaultBrand(brand)) return "";

  const { light, dark } = buildThemeVariables(brand);
  const lightBlock = declarations(light);
  const darkBlock = declarations(dark);

  if (!lightBlock && !darkBlock) return "";

  return [
    lightBlock ? `:root{${lightBlock}}` : "",
    darkBlock ? `.dark{${darkBlock}}` : "",
  ]
    .filter(Boolean)
    .join("");
}

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === "string" &&
    (THEME_MODES as readonly string[]).includes(value)
  );
}

/**
 * Which mode actually applies.
 *
 * A user's own choice wins; the organization default is the fallback for
 * someone who has never chosen. Anything unrecognised — including a value
 * written before a future mode is removed — falls back rather than throwing,
 * so a bad row cannot lock somebody out of the application.
 */
export function resolveThemeMode(
  userMode: string | null | undefined,
  organizationDefault: string | null | undefined,
): ThemeMode {
  if (isThemeMode(userMode)) return userMode;
  if (isThemeMode(organizationDefault)) return organizationDefault;
  return "system";
}
