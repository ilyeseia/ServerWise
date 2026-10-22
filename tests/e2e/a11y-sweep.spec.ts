import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { authFile } from "./env";

// Production-hardening sweep: every screen of the application, in both languages, on both the
// desktop and the mobile project. Feature specs already check their own flows; this one makes sure
// no screen was left out and that none overflows the viewport sideways.
const PAGES = [
  "dashboard",
  "customers",
  "leads",
  "follow-ups",
  "catalog",
  "suppliers",
  "quotes",
  "projects",
  "assets",
  "tickets",
  "maintenance",
  "backups",
  "remote",
  "reports",
  "audit",
  "settings",
  "users",
  "account",
];

test.describe("accessibility sweep", () => {
  test.use({ storageState: authFile("owner") });
  test.setTimeout(240_000);

  for (const locale of ["ar", "fr"] as const) {
    test(`${locale}: every screen passes axe and fits the viewport`, async ({ page }) => {
      const failures: string[] = [];
      for (const path of PAGES) {
        await page.goto(`/${locale}/${path}`);
        await page.waitForLoadState("networkidle");
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        for (const v of results.violations) {
          failures.push(`${locale}/${path}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`);
        }
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (overflow > 1) failures.push(`${locale}/${path}: horizontal overflow of ${overflow}px`);
        const lang = await page.evaluate(() => document.documentElement.lang);
        if (lang !== locale) failures.push(`${locale}/${path}: html lang is "${lang}"`);
      }
      expect(failures).toEqual([]);
    });
  }
});
