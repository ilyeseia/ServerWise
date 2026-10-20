import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import { E2E_DATA_PREFIX, authFile, type E2EFixture } from "./env";

const fixture = (): E2EFixture => JSON.parse(process.env.E2E_FIXTURE ?? "{}");

test.skip(({ isMobile }) => isMobile, "quotation flows are covered on the desktop project");

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

/** Amounts use Algerian conventions (ar-DZ / fr-DZ): accept any thousands/decimal separator. */
const amount = (integer: string, decimals: string) =>
  new RegExp(
    `${integer.replace(/(\d)(?=(\d{3})+$)/g, "$1[.,\\s\\u00a0\\u202f\\u066c]?")}[.,\\u066b]${decimals}`,
  );

const lineLabel = (m: typeof ar.Quotes, n: number, column: string) =>
  `${m.lineN.replace("{n}", String(n))}: ${column}`;

test.describe("sales builds, issues and closes a quotation (Arabic)", () => {
  test.use({ storageState: authFile("sales") });

  test("lead -> draft -> product with verified price -> issue -> print -> accept", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const q = ar.Quotes;
    const { advisorLeadId, productAId } = fixture();
    expect(productAId).toBeTruthy();

    // --- create from the lead -------------------------------------------------------------
    await page.goto(`/ar/leads/${advisorLeadId}`);
    await page.waitForLoadState("networkidle");
    await page.getByLabel(q.quoteTitle, { exact: true }).fill(`${E2E_DATA_PREFIX} Quote flow`);
    await page.getByRole("button", { name: q.create, exact: true }).click();
    await expect(page).toHaveURL(/\/ar\/quotes\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Q-\d{4}-\d{4}/);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(q.noLines)).toBeVisible();

    // --- a manual line with a configured tax rate -----------------------------------------
    await page.getByRole("button", { name: q.addLine, exact: true }).click();
    await page.getByLabel(lineLabel(q, 1, q.col.description)).fill("تركيب وإعداد");
    await page.getByLabel(lineLabel(q, 1, q.col.quantity)).fill("2");
    await page.getByLabel(lineLabel(q, 1, q.col.unitPrice)).fill("1500.50");
    // 2 x 1500.50 = 3001.00 ; 19 % -> 570.19 ; total 3571.19  (the calculator, not the page)
    await expect(page.getByText(amount("3571", "19")).first()).toBeVisible();

    // --- invalid numbers block saving -------------------------------------------------------
    await page.getByLabel(lineLabel(q, 1, q.col.quantity)).fill("0");
    await expect(page.getByText(q.fixNumbers)).toBeVisible();
    await expect(page.getByRole("button", { name: q.saveDraft, exact: true })).toBeDisabled();
    await page.getByLabel(lineLabel(q, 1, q.col.quantity)).fill("2");
    await expect(page.getByText(q.fixNumbers)).toBeHidden();

    // --- a catalogue product: cost comes from the verified price, price from the markup ------
    await page.getByLabel(q.addProduct).selectOption({ label: `${E2E_DATA_PREFIX} Alpha NAS-4` });
    await page.getByRole("button", { name: q.add, exact: true }).click();
    await expect(page.getByText(q.costFromOffer.split("{cost}")[0]!)).toBeVisible();
    await expect(page.getByText(amount("90000", "00")).first()).toBeVisible(); // cost (verified, fresh)
    // 90 000 +12.34 % = 101 106.00 suggested; the unverified, cheaper price is never used.
    await expect(page.getByLabel(lineLabel(q, 2, q.col.unitPrice))).toHaveValue("101106.00");
    await expect(page.getByLabel(lineLabel(q, 2, q.col.unitPrice))).not.toHaveValue(/85/);

    await axe(page);

    // --- save, then issue ---------------------------------------------------------------------
    await page.getByRole("button", { name: q.saveDraft, exact: true }).click();
    await expect(page.getByText(q.savedDraft)).toBeVisible();
    await page.getByRole("button", { name: q.saveAndIssue, exact: true }).click();
    await expect(page.getByText(q.status.issued, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: q.saveDraft, exact: true })).toHaveCount(0);

    // An issued quotation is a read-only snapshot with a validity date.
    await expect(page.getByText(/صالح حتى/).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "تركيب وإعداد" })).toBeVisible();

    // --- print view: built from the frozen snapshot, right-to-left, no costs ---------------
    await page.getByRole("link", { name: q.printView }).click();
    await expect(page).toHaveURL(/\/print\?rev=1$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByText(q.quotation, { exact: true })).toBeVisible();
    await expect(page.getByText(q.preparedFor)).toBeVisible();
    await expect(page.getByText(q.costFromOffer.split("{cost}")[0]!)).toHaveCount(0);
    await expect(page.getByText(q.margin)).toHaveCount(0);
    await axe(page);
    await page.goBack();

    // --- record the customer's answer ---------------------------------------------------------
    await page.waitForLoadState("networkidle");
    await page.getByLabel(q.decisionNote).fill("وُقّع العقد");
    await page.getByRole("button", { name: q.markAccepted, exact: true }).click();
    await expect(page.getByText(q.status.accepted, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("وُقّع العقد")).toBeVisible();
    await expect(page.getByRole("button", { name: q.newRevision, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: q.markAccepted, exact: true })).toHaveCount(0);

    // --- the lead page lists it; French shows the same quotation ---------------------------
    const quoteUrl = page.url();
    await page.goto(`/ar/leads/${advisorLeadId}`);
    await expect(
      page.getByRole("link", { name: /Q-\d{4}-\d{4} — ZZ E2E Quote flow/ }),
    ).toBeVisible();

    await page.goto(quoteUrl.replace("/ar/", "/fr/"));
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByText(fr.Quotes.status.accepted, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(fr.Quotes.lines, { exact: true })).toBeVisible();
    await axe(page);
  });

  test("list page and a revision of a rejected quotation (French)", async ({ page }) => {
    test.setTimeout(180_000);
    const q = fr.Quotes;
    const { advisorLeadId } = fixture();

    await page.goto(`/fr/leads/${advisorLeadId}`);
    await page.waitForLoadState("networkidle");
    await page.getByLabel(q.quoteTitle, { exact: true }).fill(`${E2E_DATA_PREFIX} Revision flow`);
    await page.getByRole("button", { name: q.create, exact: true }).click();
    await expect(page).toHaveURL(/\/fr\/quotes\/[0-9a-f-]{36}$/);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: q.addLine, exact: true }).click();
    await page.getByLabel(lineLabel(q, 1, q.col.description)).fill("Maintenance annuelle");
    await page.getByLabel(lineLabel(q, 1, q.col.unitPrice)).fill("20000");
    await page.getByRole("button", { name: q.saveAndIssue, exact: true }).click();
    await expect(page.getByText(q.status.issued, { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: q.markRejected, exact: true }).click();
    await expect(page.getByText(q.status.rejected, { exact: true }).first()).toBeVisible();

    // Revise: a new draft that starts from the rejected revision.
    await page.getByRole("button", { name: q.newRevision, exact: true }).click();
    await expect(page.getByText(q.status.draft, { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel(lineLabel(q, 1, q.col.description))).toHaveValue(
      "Maintenance annuelle",
    );
    await expect(page.getByRole("navigation", { name: q.revisions })).toBeVisible();

    await page.goto("/fr/quotes");
    await expect(page.getByRole("heading", { level: 1, name: q.title })).toBeVisible();
    await expect(page.getByRole("link", { name: /Q-\d{4}-\d{4}/ }).first()).toBeVisible();
    await axe(page);
  });
});

test.describe("who can see quotations", () => {
  test.describe("viewer", () => {
    test.use({ storageState: authFile("viewer") });
    test("gets the 404 page, and the navigation has no entry", async ({ page }) => {
      const response = await page.goto("/ar/quotes");
      expect(response?.status()).toBe(404);
      await page.goto("/ar/dashboard");
      await expect(page.getByRole("link", { name: ar.Nav.quotes })).toHaveCount(0);
    });
  });

  test.describe("technician", () => {
    test.use({ storageState: authFile("technician") });
    test("reads quotations but cannot start one", async ({ page }) => {
      const { advisorLeadId } = fixture();
      await page.goto("/ar/quotes");
      await expect(page.getByRole("heading", { level: 1, name: ar.Quotes.title })).toBeVisible();
      await page.goto(`/ar/leads/${advisorLeadId}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByLabel(ar.Quotes.quoteTitle, { exact: true })).toHaveCount(0);
    });
  });
});

test.describe("pricing configuration", () => {
  test.describe("sales", () => {
    test.use({ storageState: authFile("sales") });
    test("can see it but not change it", async ({ page }) => {
      await page.goto("/ar/settings");
      await expect(page.getByText(ar.Pricing.readOnly)).toBeVisible();
      await expect(page.getByLabel(ar.Pricing.validityDays)).toBeDisabled();
    });
  });

  test.describe("owner", () => {
    test.use({ storageState: authFile("owner") });
    test("rejects a default rate that is not in the allowed list", async ({ page }) => {
      await page.goto("/ar/settings");
      await page.waitForLoadState("networkidle");
      await page.getByLabel(ar.Pricing.defaultTaxRate).fill("7");
      await page.getByRole("button", { name: ar.Common.save, exact: true }).last().click();
      await expect(
        page.getByRole("alert").filter({ hasText: ar.Crm.errors.VALIDATION }),
      ).toBeVisible();
      await axe(page);
    });
  });
});
