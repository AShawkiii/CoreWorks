import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The legacy Apps Script suite stays in place as reference; it is run
    // against the ported logic in Phase 3, not by this config.
    exclude: ["node_modules/**", "legacy/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
