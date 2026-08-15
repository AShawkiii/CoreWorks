import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescriptConfig from "eslint-config-next/typescript";

/**
 * ESLint flat config.
 *
 * eslint-config-next 16 ships native flat config, so it is spread directly —
 * wrapping it in FlatCompat throws on its self-referential plugin object.
 */
const eslintConfig = [
  {
    ignores: [
      // Reference material from the Google Apps Script system — preserved
      // verbatim (master prompt §65), never linted or compiled.
      "legacy/**",
      // Prisma output; it carries its own @ts-nocheck and eslint-disable.
      "src/generated/**",
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
    ],
  },
  ...coreWebVitals,
  ...typescriptConfig,
];

export default eslintConfig;
