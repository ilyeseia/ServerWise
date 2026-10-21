import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Integration tests hash passwords and share one database across parallel files; the 5 s
    // default fails on slow machines (it did on CI) without anything being wrong.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    coverage: { provider: "v8", reporter: ["text", "lcov"], include: ["src/**/*.ts"] },
  },
});
