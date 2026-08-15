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
  {
    rules: {
      /**
       * A leading underscore marks a parameter that exists to satisfy a
       * signature rather than to be used — `useActionState` hands every server
       * action `(prevState, formData)` whether or not it needs either. The
       * codebase already writes `_prevState`; this makes that convention
       * enforced rather than incidental, so a genuinely forgotten variable
       * still gets reported.
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
];

export default eslintConfig;
