import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "src/generated/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Tailwind logical properties only: physical left/right utilities break RTL.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/(^|\\s)(-?)(ml|mr|pl|pr|left|right)-[\\w\\[]/]",
          message:
            "Use logical utilities (ms-/me-/ps-/pe-/start-/end-) instead of physical left/right ones.",
        },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // Only the repository layer may import the generated Prisma client directly.
    files: ["src/app/**", "src/components/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/generated/*", "@prisma/client"],
              message: "UI code must not use Prisma directly. Go through a module service.",
            },
          ],
        },
      ],
    },
  },
]);
