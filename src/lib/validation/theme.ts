import { z } from "zod";

import {
  CUSTOM_PRESET_ID,
  PRESET_IDS,
  THEME_MODES,
  parseHsl,
} from "@/lib/domain/theme";
import { logoUrlSchema } from "@/lib/validation/organization";

/**
 * Theme and branding validation (master prompt §27/§28/§29/§30).
 *
 * **These values are rendered into a `<style>` element.** That makes this file
 * a security boundary, not only a correctness one, and it is defended twice:
 *
 *  1. Here — a colour must be exactly three numeric HSL channels. Not a CSS
 *     colour keyword, not `#hex`, not `var(--x)`, not anything containing a
 *     brace, a semicolon, a comment marker, or `</style>`.
 *  2. In `buildThemeCss` — the writer re-serialises from the parsed *numbers*
 *     rather than echoing the stored string, so even a value that reached the
 *     database by some other route cannot escape its declaration.
 *
 * Either alone would do. Both, because a stylesheet injection is a full
 * page-defacement and data-exfiltration primitive, and the cost of the second
 * check is one function call.
 */

/**
 * An HSL channel triple: `"221 83% 53%"`.
 *
 * Delegates to the domain parser rather than restating the pattern, so the
 * rule the writer trusts and the rule the form enforces are the same rule and
 * cannot drift apart.
 */
export const hslChannelSchema = z
  .string()
  .trim()
  .max(32, "Colour value is too long.")
  .refine(
    (value) => parseHsl(value) !== null,
    "Use HSL channels, e.g. 221 83% 53%.",
  );

export const themeModeSchema = z.enum(THEME_MODES);

/**
 * A preset id, or `custom`.
 *
 * `custom` is not a palette — it is the marker for "these colours were chosen
 * by hand", so reopening the form does not falsely claim the organization is
 * still on a named preset it has since edited away from.
 */
export const presetSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === CUSTOM_PRESET_ID || PRESET_IDS.includes(value),
    "Unknown theme preset.",
  );

export const updateThemeSchema = z.object({
  preset: presetSchema,
  primaryColor: hslChannelSchema,
  secondaryColor: hslChannelSchema,
  accentColor: hslChannelSchema,
  sidebarColor: hslChannelSchema,
  backgroundColor: hslChannelSchema,
  defaultMode: themeModeSchema,
  /**
   * Reuses the Phase 2 schema, which already restricts a logo to `https://`
   * so it can never be a `javascript:` or `data:` URI. Branding is where a
   * logo is actually set, but the rule belongs with the organization profile
   * that stores it.
   */
  logoUrl: logoUrlSchema,
});

/** Applying a named preset: the colours come from the preset, not the form. */
export const applyPresetSchema = z.object({
  preset: z
    .string()
    .trim()
    .refine((value) => PRESET_IDS.includes(value), "Unknown theme preset."),
});

/** A user's own light/dark choice. Not gated by any permission. */
export const setThemeModeSchema = z.object({
  mode: themeModeSchema,
});

export type UpdateThemeInput = z.infer<typeof updateThemeSchema>;
export type SetThemeModeInput = z.infer<typeof setThemeModeSchema>;
