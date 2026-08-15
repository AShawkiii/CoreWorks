"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "coreworks-theme";
const CHANGE_EVENT = "coreworks-theme-change";

const OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

function apply(mode: ThemeMode): void {
  const dark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/**
 * The stored preference is external state, so it is read through
 * useSyncExternalStore rather than copied into React state inside an effect.
 * That keeps the render consistent, avoids a cascading re-render on mount,
 * and means a change made in another tab is picked up here too.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getSnapshot(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isThemeMode(stored) ? stored : "system";
}

/** The server cannot know the preference; ThemeScript corrects the DOM before paint. */
function getServerSnapshot(): ThemeMode {
  return "system";
}

/** Light/dark/system switch (master prompt §30). */
export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // In "system" mode, follow the OS as it changes — a machine that switches
  // at sunset should carry the app with it, without a reload.
  useEffect(() => {
    if (mode !== "system") return;

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);

  function choose(next: ThemeMode): void {
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
    // Notifies this tab; the native "storage" event only fires in others.
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5"
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => choose(option.value)}
            aria-pressed={selected}
            title={option.label}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded transition-colors",
              selected
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
