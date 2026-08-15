/**
 * Injects the organization's brand as CSS custom properties.
 *
 * Rendered by the authenticated layout, so it is present in the **initial
 * HTML**. There is no flash of the default palette and no client round trip:
 * by the time the browser paints, `--primary` already holds the organization's
 * colour and every component that reads it is correct on the first frame.
 *
 * The unauthenticated pages — sign-in, password reset — deliberately do not
 * get it. Which organization a visitor belongs to is not known until they have
 * signed in, and guessing from a hostname or a query parameter would let an
 * anonymous caller pick a tenant's branding, which is a phishing aid rather
 * than a feature.
 *
 * ---------------------------------------------------------------------------
 * On `dangerouslySetInnerHTML`
 * ---------------------------------------------------------------------------
 *
 * A `<style>` element cannot take a string child through JSX escaping — React
 * would escape the CSS itself — so this is the only way to emit a stylesheet.
 * It is safe here because of what `css` is, not because of what this component
 * does:
 *
 *  - every value was validated as three numeric HSL channels on the way in
 *    (`hslChannelSchema`), and again on the way out (`getThemeSettings`);
 *  - `buildThemeCss` re-serialises from the parsed **numbers**, so the string
 *    is assembled from digits and fixed punctuation and cannot contain a
 *    brace, an `@import`, or a `</style>`.
 *
 * The prop is therefore typed as the output of that builder, and this
 * component must never be handed a caller-supplied string.
 */
export function ThemeStyle({ css }: { css: string }) {
  if (!css) return null;

  return (
    <style
      id="coreworks-brand"
      // Built from numbers by buildThemeCss — see the note above.
      dangerouslySetInnerHTML={{ __html: css }}
    />
  );
}
