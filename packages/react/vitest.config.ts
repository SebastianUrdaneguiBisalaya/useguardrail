import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@useguardril/core": fileURLToPath(
        new URL("../core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      include: [
        "src/**",
      ],
      reporter: [
        "text",
      ],
    },
    environment: "jsdom",
    passWithNoTests: true,
  },
});
