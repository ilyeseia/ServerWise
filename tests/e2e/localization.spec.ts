import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("localization", () => {
  test("root redirects to Arabic (RTL)", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/ar$/);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "ar");
    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("مرحبًا بك في ServerWise");
  });

  test("French is LTR with French copy", async ({ page }) => {
    await page.goto("/fr");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "fr");
    await expect(html).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bienvenue sur ServerWise");
  });

  test("locale switcher keeps the user on the same page", async ({ page }) => {
    await page.goto("/ar");
    // Wait for hydration so the client-side locale switch handler is attached.
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: "Français" }).click();
    await expect(page).toHaveURL(/\/fr$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });

  test("layout is mirrored: header content starts on the right in RTL", async ({ page }) => {
    await page.goto("/ar");
    const brand = page.getByRole("link", { name: "ServerWise" }).first();
    const box = await brand.boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport && box.x > viewport.width / 2).toBe(true);

    await page.goto("/fr");
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
    await page.goto("/fr");
    await page.getByRole("button", { name: "Sombre" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});

test.describe("accessibility (axe)", () => {
  for (const locale of ["ar", "fr"]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${locale} ${scheme} has no detectable violations`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`/${locale}`);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations).toEqual([]);
      });
    }
  }
});
