"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  CUSTOM_PRESET_ID,
  THEME_MODES,
  THEME_PRESETS,
  buildThemeVariables,
  describeContrast,
  formatHsl,
  parseHsl,
  readableForeground,
  type Hsl,
} from "@/lib/domain/theme";
import {
  resetThemeAction,
  updateThemeAction,
} from "@/server/actions/theme";
import type { FormState } from "@/server/actions/organization";
import type { ThemeSettingsView } from "@/server/services/theme";

const MODE_LABELS: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  system: "Follow the device",
};

const COLOR_FIELDS = [
  {
    name: "primaryColor",
    label: "Primary",
    hint: "Buttons, links, and the focus ring.",
  },
  {
    name: "secondaryColor",
    label: "Secondary",
    hint: "Supporting actions.",
  },
  { name: "accentColor", label: "Accent", hint: "Highlights." },
  { name: "sidebarColor", label: "Sidebar", hint: "The navigation panel." },
  {
    name: "backgroundColor",
    label: "Page background",
    hint: "Light mode only — dark mode keeps its authored neutral.",
  },
] as const;

type ColorFieldName = (typeof COLOR_FIELDS)[number]["name"];

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          Saving…
        </>
      ) : (
        label
      )}
    </Button>
  );
}

/** `#rrggbb` for the native colour input, which cannot speak HSL. */
function toHex(color: Hsl): string {
  const h = ((color.h % 360) + 360) % 360;
  const s = color.s / 100;
  const l = color.l / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
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
  const channel = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function fromHex(hex: string): Hsl | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const int = Number.parseInt(match[1] as string, 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l: l * 100 };

  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === r
      ? 60 * (((g - b) / d) % 6)
      : max === g
        ? 60 * ((b - r) / d + 2)
        : 60 * ((r - g) / d + 4);

  return { h: (h + 360) % 360, s: s * 100, l: l * 100 };
}

/**
 * Live preview and contrast report.
 *
 * The preview is computed with the same `buildThemeVariables` the server uses
 * to write the stylesheet, so what an administrator sees here is what will
 * actually ship — not a hand-built approximation that can drift from it.
 */
function Preview({ values }: { values: Record<ColorFieldName, string> }) {
  const brand = {
    primary: values.primaryColor,
    secondary: values.secondaryColor,
    accent: values.accentColor,
    sidebar: values.sidebarColor,
    background: values.backgroundColor,
  };
  const { light, dark } = buildThemeVariables(brand);

  const primary = parseHsl(values.primaryColor);
  const primaryDark = parseHsl(dark["--primary"] ?? "");
  const sidebar = parseHsl(values.sidebarColor);

  const reports: { label: string; ratio: number; aa: boolean }[] = [];
  if (primary) {
    const report = describeContrast(primary, readableForeground(primary));
    reports.push({ label: "Primary button text", ...report });
  }
  if (primaryDark) {
    const report = describeContrast(primaryDark, readableForeground(primaryDark));
    reports.push({ label: "Primary button text (dark)", ...report });
  }
  if (sidebar) {
    const foreground = parseHsl(light["--sidebar-foreground"] ?? "");
    if (foreground) {
      const report = describeContrast(sidebar, foreground);
      reports.push({ label: "Sidebar text", ...report });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {(["light", "dark"] as const).map((scheme) => {
          const vars = scheme === "light" ? light : dark;
          const background =
            scheme === "light" ? (vars["--background"] ?? "0 0% 100%") : "222 47% 9%";
          const foreground = scheme === "light" ? "222 47% 11%" : "210 20% 96%";

          return (
            <div
              key={scheme}
              className="overflow-hidden rounded-md border border-border"
              style={{
                backgroundColor: `hsl(${background})`,
                color: `hsl(${foreground})`,
              }}
            >
              <div className="flex">
                <div
                  className="w-16 shrink-0 p-2 text-[10px]"
                  style={{
                    backgroundColor: `hsl(${vars["--sidebar"]})`,
                    color: `hsl(${vars["--sidebar-foreground"]})`,
                  }}
                >
                  Nav
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <span className="text-[11px] uppercase tracking-wide opacity-70">
                    {scheme}
                  </span>
                  <span
                    className="inline-flex w-fit items-center rounded px-2 py-1 text-xs font-medium"
                    style={{
                      backgroundColor: `hsl(${vars["--primary"]})`,
                      color: `hsl(${vars["--primary-foreground"]})`,
                    }}
                  >
                    Primary action
                  </span>
                  {/* Health colours are NOT brandable — they carry meaning
                      from the legacy enumerations. Shown here so an
                      administrator can see they stay put. */}
                  <span className="flex gap-1">
                    <span className="rounded bg-health-on-track px-1.5 py-0.5 text-[10px] text-health-on-track-fg">
                      On Track
                    </span>
                    <span className="rounded bg-health-delayed px-1.5 py-0.5 text-[10px] text-health-delayed-fg">
                      Delayed
                    </span>
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ul className="flex flex-col gap-1 text-xs">
        {reports.map((report) => (
          <li key={report.label} className="flex items-center gap-2">
            <span
              className={
                report.aa
                  ? "inline-block w-14 shrink-0 font-medium text-success"
                  : "inline-block w-14 shrink-0 font-medium text-danger"
              }
            >
              {report.ratio.toFixed(2)}:1
            </span>
            <span className="text-muted-foreground">
              {report.label} — {report.aa ? "passes WCAG AA" : "below WCAG AA (4.5:1)"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AppearanceForm({
  theme,
  logoUrl,
  canEdit,
}: {
  theme: ThemeSettingsView;
  logoUrl: string | null;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    updateThemeAction,
    {},
  );
  const [resetState, resetAction] = useActionState<FormState, FormData>(
    resetThemeAction,
    {},
  );

  const [preset, setPreset] = useState(theme.preset);
  const [values, setValues] = useState<Record<ColorFieldName, string>>({
    primaryColor: theme.primary,
    secondaryColor: theme.secondary,
    accentColor: theme.accent,
    sidebarColor: theme.sidebar,
    backgroundColor: theme.background,
  });

  const errors = state.fieldErrors ?? {};

  function choosePreset(id: string): void {
    setPreset(id);
    const found = THEME_PRESETS.find((entry) => entry.id === id);
    if (!found) return;
    setValues({
      primaryColor: found.colors.primary,
      secondaryColor: found.colors.secondary,
      accentColor: found.colors.accent,
      sidebarColor: found.colors.sidebar,
      backgroundColor: found.colors.background,
    });
  }

  function setColor(name: ColorFieldName, value: string): void {
    setValues((current) => ({ ...current, [name]: value }));
    // Editing a colour means the palette is no longer the named preset. Saying
    // otherwise would make the form claim a preset it no longer matches.
    setPreset(CUSTOM_PRESET_ID);
  }

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-5" noValidate>
        <FormMessage status={state.status} message={state.message} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="theme-preset">Preset</Label>
          <Select
            id="theme-preset"
            name="preset"
            value={preset}
            onChange={(event) => choosePreset(event.target.value)}
            disabled={!canEdit}
          >
            {THEME_PRESETS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label} — {entry.description}
              </option>
            ))}
            <option value={CUSTOM_PRESET_ID}>Custom</option>
          </Select>
          <FieldError id="theme-preset-error" message={errors.preset} />
        </div>

        <fieldset className="grid gap-4 sm:grid-cols-2" disabled={!canEdit}>
          <legend className="sr-only">Brand colours</legend>
          {COLOR_FIELDS.map((field) => {
            const parsed = parseHsl(values[field.name]);
            return (
              <div key={field.name} className="flex flex-col gap-1.5">
                <Label htmlFor={`theme-${field.name}`}>{field.label}</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={`${field.label} colour picker`}
                    value={parsed ? toHex(parsed) : "#000000"}
                    onChange={(event) => {
                      const hsl = fromHex(event.target.value);
                      if (hsl) setColor(field.name, formatHsl(hsl));
                    }}
                    disabled={!canEdit}
                    className="size-9 shrink-0 cursor-pointer rounded border border-border bg-background p-0.5"
                  />
                  <Input
                    id={`theme-${field.name}`}
                    name={field.name}
                    value={values[field.name]}
                    onChange={(event) =>
                      setColor(field.name, event.target.value)
                    }
                    aria-invalid={errors[field.name] ? true : undefined}
                    aria-describedby={`theme-${field.name}-hint`}
                    className="font-mono text-xs"
                  />
                </div>
                <p
                  id={`theme-${field.name}-hint`}
                  className="text-xs text-muted-foreground"
                >
                  {field.hint}
                </p>
                <FieldError
                  id={`theme-${field.name}-error`}
                  message={errors[field.name]}
                />
              </div>
            );
          })}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="theme-defaultMode">Default appearance</Label>
            <Select
              id="theme-defaultMode"
              name="defaultMode"
              defaultValue={theme.defaultMode}
              disabled={!canEdit}
            >
              {THEME_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {MODE_LABELS[mode]}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Applies to anyone who has not chosen for themselves. A personal
              choice always wins.
            </p>
            <FieldError
              id="theme-defaultMode-error"
              message={errors.defaultMode}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="theme-logoUrl">Logo URL</Label>
            <Input
              id="theme-logoUrl"
              name="logoUrl"
              type="url"
              defaultValue={logoUrl ?? ""}
              placeholder="https://example.com/logo.svg"
              disabled={!canEdit}
              aria-invalid={errors.logoUrl ? true : undefined}
            />
            <p className="text-xs text-muted-foreground">
              Must be https. Left blank, the CoreWorks mark is used.
            </p>
            <FieldError id="theme-logoUrl-error" message={errors.logoUrl} />
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Preview</p>
          <Preview values={values} />
        </div>

        {canEdit ? (
          <div>
            <SubmitButton label="Save appearance" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            You can see the organization&rsquo;s appearance but not change it.
          </p>
        )}
      </form>

      {canEdit ? (
        <form action={resetAction}>
          <FormMessage status={resetState.status} message={resetState.message} />
          <Button type="submit" variant="outline" size="sm" className="mt-2">
            Reset to the CoreWorks palette
          </Button>
        </form>
      ) : null}
    </div>
  );
}
