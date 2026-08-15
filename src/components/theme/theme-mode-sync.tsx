/**
 * Reconciles the browser's paint-time cache with the server's answer.
 *
 * ---------------------------------------------------------------------------
 * Where the light/dark choice actually lives
 * ---------------------------------------------------------------------------
 *
 * Two stores, with one source of truth:
 *
 *  - **The database** (`DashboardPreference.themeMode`, plus the
 *    organization's `defaultMode` as the fallback) is authoritative. It is
 *    what makes the choice follow a person from their laptop to their phone.
 *  - **`localStorage` is a cache**, and only that. It exists because
 *    `ThemeScript` has to decide light-or-dark in `<head>`, before any
 *    server data is available to the client, or the page flashes white.
 *
 * This component keeps the cache honest: the server resolves the effective
 * mode on every authenticated render, and this writes that answer into
 * `localStorage`. So a preference set on another device arrives on the next
 * page load, and — the case a "write it once and forget" design gets wrong —
 * an administrator changing the organization's default reaches everyone who
 * has never made a choice of their own, instead of only new browsers.
 *
 * It renders in the authenticated layout's body rather than in `<head>`: the
 * head script has already applied the cached value, so this only corrects a
 * disagreement, and a correction one frame later is invisible where a missing
 * initial value would not have been.
 */

/**
 * Built from a fixed template with one interpolated value, and that value is
 * `JSON.stringify` of a string the server has already narrowed to exactly
 * "light", "dark", or "system" (`resolveThemeMode`). No caller-supplied text
 * reaches this string.
 */
function syncScript(mode: "light" | "dark" | "system"): string {
  return `(function(){try{var m=${JSON.stringify(mode)};if(localStorage.getItem("coreworks-theme")!==m){localStorage.setItem("coreworks-theme",m);}var d=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(document.documentElement.classList.contains("dark")!==d){document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}}catch(e){}})();`;
}

export function ThemeModeSync({
  mode,
  nonce,
}: {
  mode: "light" | "dark" | "system";
  /** Required under the Phase 14 Content-Security-Policy — see ThemeScript. */
  nonce?: string;
}) {
  return (
    <script
      nonce={nonce}
      // See the note above: the only interpolation is a server-narrowed enum.
      dangerouslySetInnerHTML={{ __html: syncScript(mode) }}
    />
  );
}
