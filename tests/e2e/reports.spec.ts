import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import { E2E_DATA_PREFIX, authFile } from "./env";

test.skip(({ isMobile }) => isMobile, "report flows are covered on the desktop project");

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

const asNumber = async (page: Page, testId: string) =>
  Number((await page.getByTestId(testId).innerText()).replace(/[^\d]/g, ""));

test.describe("owner reads the reports", () => {
  test.use({ storageState: authFile("owner") });

  test("Arabic: sections, real figures and a period selector", async ({ page }) => {
    const r = ar.Reports;
    await page.goto("/ar/reports");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1, name: r.title })).toBeVisible();
    for (const heading of [r.sales, r.operations, r.support, r.maintenance, r.backups]) {
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
    // The fixture opened a ticket and issued quotations just now, so the month shows real figures.
    expect(await asNumber(page, "r-tickets-opened")).toBeGreaterThanOrEqual(1);
    expect(await asNumber(page, "r-quotes-issued")).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("r-issued-total")).toContainText(r.currency);
    await expect(page.getByRole("row", { name: new RegExp(ar.Crm.leadStatus.new) })).toBeVisible();
    await axe(page);

    // Changing the period reloads the same page for that period.
    await page.getByLabel(r.period, { exact: true }).selectOption("365d");
    await page.getByRole("button", { name: r.apply, exact: true }).click();
    await expect(page).toHaveURL(/range=365d/);
    await expect(page.getByLabel(r.period, { exact: true })).toHaveValue("365d");
    expect(await asNumber(page, "r-quotes-issued")).toBeGreaterThanOrEqual(1);
  });

  test("French and an unknown period fall back safely", async ({ page }) => {
    const r = fr.Reports;
    await page.goto("/fr/reports?range=bogus");
    await expect(page.getByRole("heading", { level: 1, name: r.title })).toBeVisible();
    await expect(page.getByLabel(r.period, { exact: true })).toHaveValue("30d");
    await expect(page.getByRole("link", { name: r.exportTickets })).toBeVisible();
    await axe(page);
  });
});

test.describe("sales exports a CSV", () => {
  test.use({ storageState: authFile("sales") });

  test("a labelled, BOM-prefixed file with the fixture data, as an attachment", async ({
    page,
  }) => {
    await page.goto("/ar/reports?range=365d");
    const link = page.getByRole("link", { name: ar.Reports.exportTickets });
    await expect(link).toHaveAttribute(
      "href",
      /\/api\/reports\/export\?section=tickets&range=365d&locale=ar/,
    );

    const response = await page.request.get(
      "/api/reports/export?section=tickets&range=365d&locale=ar",
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toMatch(
      /^attachment; filename="serverwise-tickets-365d-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(response.headers()["cache-control"]).toBe("no-store");
    const body = await response.text();
    expect(body.charCodeAt(0)).toBe(0xfeff); // byte-order mark: Excel reads Arabic correctly
    const lines = body.slice(1).split("\r\n");
    expect(lines[0]).toBe(
      ["number", "title", "customer", "status", "priority", "assignee", "openedAt", "resolvedAt"]
        .map((c) => (ar.Reports.csv.tickets as Record<string, string>)[c])
        .join(","),
    );
    expect(body).toContain(`${E2E_DATA_PREFIX} Fixture ticket`);

    // French headers come from the locale parameter.
    const french = await page.request.get(
      "/api/reports/export?section=quotes&range=365d&locale=fr",
    );
    expect((await french.text()).slice(1).split("\r\n")[0]).toContain(fr.Reports.csv.quotes.number);
  });

  test("rejects unknown sections", async ({ page }) => {
    const response = await page.request.get("/api/reports/export?section=users&range=30d");
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: "UNKNOWN_SECTION" });
  });
});

test.describe("who sees what", () => {
  test.describe("technician", () => {
    test.use({ storageState: authFile("technician") });

    test("sees counts but no money, and cannot export", async ({ page }) => {
      await page.goto("/ar/reports");
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1, name: ar.Reports.title })).toBeVisible();
      expect(await asNumber(page, "r-quotes-issued")).toBeGreaterThanOrEqual(1);
      await expect(page.getByTestId("r-issued-total")).toHaveCount(0);
      await expect(page.getByText(ar.Reports.monthlyFees)).toHaveCount(0);
      await expect(page.getByRole("link", { name: /\(CSV\)/ })).toHaveCount(0);

      const response = await page.request.get("/api/reports/export?section=tickets&range=30d");
      expect(response.status()).toBe(403);
    });
  });

  test.describe("viewer (read-only accountant)", () => {
    test.use({ storageState: authFile("viewer") });

    test("reads reports including money, but cannot export", async ({ page }) => {
      await page.goto("/ar/reports");
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("r-issued-total")).toBeVisible();
      await expect(page.getByRole("link", { name: /\(CSV\)/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: ar.Nav.reports })).toBeVisible();
      // The rest of the application is still closed to this role.
      expect((await page.goto("/ar/customers"))?.status()).toBe(404);
      const response = await page.request.get("/api/reports/export?section=quotes&range=30d");
      expect(response.status()).toBe(403);
    });
  });

  test("an anonymous visitor gets 401 from the export and the login page from the report", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const response = await context.request.get(
      `${test.info().project.use.baseURL}/api/reports/export?section=tickets&range=30d`,
    );
    expect(response.status()).toBe(401);
    const page = await context.newPage();
    await page.goto(`${test.info().project.use.baseURL}/ar/reports`);
    await expect(page).toHaveURL(/\/ar\/login/);
    await context.close();
  });
});
