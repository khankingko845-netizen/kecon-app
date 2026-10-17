import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // E2E specs (tests/e2e) belong to Playwright, not Vitest.
    include: ["tests/unit/**/*.test.ts", "tests/db/**/*.test.ts"],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    // PGlite boots a WASM Postgres and replays every migration (~3-5 s).
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
