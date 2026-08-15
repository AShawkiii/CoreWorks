/**
 * Applies the stored theme before first paint.
 *
 * This runs synchronously in <head>, ahead of hydration, so a user who chose
 * dark mode never sees a white flash. Written as a raw string because it must
 * execute before React loads.
 */
const script = `(function(){try{var m=localStorage.getItem("coreworks-theme")||"system";var d=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

export function ThemeScript() {
  return (
    <script
      // The content is a build-time constant with no interpolation.
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
