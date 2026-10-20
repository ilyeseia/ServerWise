import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("localization (public pages)", () => {
  test("root sends visitors to the Arabic (RTL) login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/ar\/login$/);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "ar");
    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("تسجيل الدخول");
  });

  test("French is LTR with French copy", async ({ page }) => {
    await page.goto("/fr/login");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "fr");
    await expect(html).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connexion");
  });

  test("locale switcher keeps the user on the same page", async ({ page }) => {
    await page.goto("/ar/login");
    // Wait for hydration so the client-side locale switch handler is attached.
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: "Français" }).click();
    await expect(page).toHaveURL(/\/fr\/login$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });

  test("layout is mirrored: header content starts on the right in RTL", async ({ page }) => {
    await page.goto("/ar/login");
    const brand = page.getByRole("link", { name: "ServerWise" }).first();
    const box = await brand.boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport && box.x > viewport.width / 2).toBe(true);

    await page.goto("/fr/login");
    const frBox = await page.getByRole("link", { name: "ServerWise" }).first().boundingBox();
    expect(frBox && frBox.x < (viewport?.width ?? 0) / 2).toBe(true);
  });

  test("unknown path shows the localized 404", async ({ page }) => {
    const response = await page.goto("/fr/does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page introuvable");
  });
});

test.describe("theme", () => {
  test("dark theme can be selected", async ({ page }) => {
    await page.goto("/fr/login");
    await page.getByRole("button", { name: "Sombre" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});

test.describe("accessibility (axe) — public pages", () => {
  for (const locale of ["ar", "fr"]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`login ${locale} ${scheme} has no detectable violations`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`/${locale}/login`);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations).toEqual([]);
      });
    }
  }
});
