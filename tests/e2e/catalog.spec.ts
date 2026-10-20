import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import { E2E_DATA_PREFIX, authFile, type E2EFixture } from "./env";

const fixture = (): E2EFixture => JSON.parse(process.env.E2E_FIXTURE ?? "{}");

test.skip(({ isMobile }) => isMobile, "catalog flows are covered on the desktop project");

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

/** Numbers use Algerian conventions (ar-DZ / fr-DZ); accept any thousands separator. */
const money = (digits: string) =>
  new RegExp(digits.replace(/(\d)(?=(\d{3})+$)/g, "$1[.,\\s\\u00a0\\u202f]?"));

test.describe("sales records a price, the owner verifies it (Arabic)", () => {
  test.use({ storageState: authFile("sales") });

  test("supplier -> product -> price without evidence is refused -> price -> verification", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const stamp = Date.now();
    const supplierName = `${E2E_DATA_PREFIX} Flow Supplier ${stamp}`;
    const brand = `${E2E_DATA_PREFIX} Flow ${stamp}`;

    // --- a supplier ---------------------------------------------------------------------------
    await page.goto("/ar/suppliers");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: ar.Suppliers.add }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(ar.Suppliers.name, { exact: true }).fill("x");
    await dialog.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(dialog.getByText(ar.Suppliers.nameRequired)).toBeVisible();
    await dialog.getByLabel(ar.Suppliers.name, { exact: true }).fill(supplierName);
    await dialog.getByLabel(ar.Suppliers.url).fill("javascript:alert(1)");
    await dialog.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(dialog.getByText(ar.Catalog.form.invalidUrl)).toBeVisible(); // only web links are accepted
    await dialog.getByLabel(ar.Suppliers.url).fill("https://www.ouedkniss.com/store/test");
    await dialog.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("cell", { name: new RegExp(supplierName) })).toBeVisible();

    // --- a product: unknown specs stay empty; inconsistent memory is refused -----------------
    await page.goto("/ar/catalog/new");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(page.getByText(ar.Catalog.form.brandRequired).first()).toBeVisible();

    await page.getByLabel(ar.Catalog.spec.brand, { exact: true }).fill(brand);
    await page.getByLabel(ar.Catalog.spec.model, { exact: true }).fill("FX-1");
    await page.getByLabel(ar.Catalog.spec.ramGb, { exact: true }).fill("16");
    await page.getByLabel(ar.Catalog.spec.ramMaxGb, { exact: true }).fill("8");
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(page.getByText(ar.Catalog.form.ramMax)).toBeVisible();
    await page.getByLabel(ar.Catalog.spec.ramMaxGb, { exact: true }).fill("32");
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(page).toHaveURL(/\/ar\/catalog\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(brand);
    await expect(page.getByText(ar.Catalog.unknown).first()).toBeVisible(); // unspecified = unknown
    await expect(page.getByTestId("best-price")).toHaveText(ar.Catalog.noPrice);
    const productUrl = page.url();

    // --- a price: evidence is mandatory --------------------------------------------------------
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: ar.Catalog.offer.record }).click();
    await page.getByLabel(ar.Catalog.offer.supplier).selectOption({ label: supplierName });
    await page.getByLabel(ar.Catalog.offer.price).fill("100000");
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(page.getByText(ar.Catalog.offer.evidenceRequired)).toBeVisible();

    await page
      .getByLabel(ar.Catalog.offer.source, { exact: true })
      .fill("https://example.test/listing/e2e");
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    const row = page.getByTestId("offer-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(ar.Catalog.offer.states.unverified);
    await expect(row).toContainText(ar.Catalog.offer.verificationStatus.unverified);
    await expect(row).toContainText(money("100000"));
    await expect(page.getByTestId("best-price")).toHaveText(ar.Catalog.noPrice); // unverified: not shown as the price

    // Sales cannot verify.
    await expect(page.getByRole("button", { name: ar.Catalog.offer.verify })).toHaveCount(0);

    // --- the owner checks the source and verifies ----------------------------------------------
    const ownerContext = await browser.newContext({ storageState: authFile("owner") });
    const owner = await ownerContext.newPage();
    await owner.goto(productUrl);
    await owner.waitForLoadState("networkidle");
    await owner.getByRole("button", { name: ar.Catalog.offer.verify }).click();
    await expect(owner.getByTestId("offer-row")).toContainText(ar.Catalog.offer.states.fresh);
    await expect(owner.getByTestId("best-price")).toContainText(money("100000"));
    await expect(owner.getByRole("button", { name: ar.Catalog.offer.verify })).toHaveCount(0); // decision is final
    await ownerContext.close();

    // Sales now sees the verified price.
    await page.reload();
    await expect(page.getByTestId("best-price")).toContainText(money("100000"));
    await expect(page.getByTestId("best-price")).toContainText(supplierName);
  });
});

test.describe("hardware advisor (Arabic, RTL)", () => {
  test.use({ storageState: authFile("sales") });

  test("runs on a lead, ranks by fit, uses verified prices only, and explains itself", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { advisorLeadId } = fixture();
    await page.goto(`/ar/leads/${advisorLeadId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: ar.Advisor.title })).toBeVisible();
    await expect(page.getByText(ar.Advisor.noRuns)).toBeVisible();

    await page.getByRole("button", { name: ar.Advisor.run }).click();
    const results = page.getByTestId("advisor-results");
    await expect(results).toBeVisible();

    // Alpha (strong) outranks Beta (weak); both have a verified price.
    const ranked = await results.getByTestId("ranked-item").allInnerTexts();
    const alpha = ranked.findIndex((t) => t.includes(`${E2E_DATA_PREFIX} Alpha`));
    const beta = ranked.findIndex((t) => t.includes(`${E2E_DATA_PREFIX} Beta`));
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(beta).toBeGreaterThan(alpha);

    // Strict mode uses the verified 90,000, not the newer unverified 85,000.
    const alphaCard = results
      .getByTestId("ranked-item")
      .filter({ hasText: `${E2E_DATA_PREFIX} Alpha` });
    await expect(alphaCard).toContainText(money("90000"));
    await expect(alphaCard).not.toContainText(money("85000"));
    await expect(alphaCard.getByTestId("adjusted-score")).toHaveText(/\d/);

    // A product with no price at all is excluded, with the reason.
    const gamma = results
      .getByTestId("excluded-item")
      .filter({ hasText: `${E2E_DATA_PREFIX} Gamma` });
    await expect(gamma).toContainText(ar.Advisor.exclusions.no_usable_offer);

    // The explanation: every factor, with what was needed and what is available.
    await alphaCard.locator("summary").click();
    for (const id of [
      "performance",
      "ram",
      "storage",
      "network",
      "noise",
      "power",
      "gpu",
      "upgradeability",
      "warranty",
      "budget",
    ]) {
      await expect(alphaCard.getByTestId(`factor-${id}`)).toBeVisible();
    }
    await expect(alphaCard.getByTestId("factor-gpu")).toContainText(
      ar.Advisor.statuses.not_applicable,
    );
    await expect(alphaCard.getByTestId("factor-ram")).toContainText(ar.Advisor.statuses.met);
    await expect(alphaCard.getByTestId("factor-budget")).toContainText(money("150000"));
    await expect(page.getByText(ar.Advisor.assumptionsTitle)).toBeVisible();
    await expect(page.getByText(ar.Advisor.disclaimer)).toBeVisible();

    // Explicitly allowing unverified prices changes the outcome - and is visible in the result.
    await page.getByLabel(ar.Advisor.includeUnverified).check();
    await page.getByRole("button", { name: ar.Advisor.run }).click();
    await expect(page.getByRole("navigation", { name: ar.Advisor.history })).toBeVisible();
    const relaxed = page
      .getByTestId("advisor-results")
      .getByTestId("ranked-item")
      .filter({ hasText: `${E2E_DATA_PREFIX} Alpha` });
    await expect(relaxed).toContainText(money("85000"));
    await expect(relaxed).toContainText(ar.Catalog.offer.states.unverified);
    await expect(page.getByTestId("advisor-results")).toContainText(ar.Advisor.includeUnverified);

    // The earlier run is kept exactly as it was.
    const history = page.getByRole("navigation", { name: ar.Advisor.history }).getByRole("link");
    await expect(history).toHaveCount(2);
    await history.nth(1).click();
    await expect(page).toHaveURL(/rec=/);
    await expect(
      page
        .getByTestId("advisor-results")
        .getByTestId("ranked-item")
        .filter({ hasText: `${E2E_DATA_PREFIX} Alpha` }),
    ).toContainText(money("90000"));
  });
});

test.describe("search, comparison and French UI", () => {
  test.use({ storageState: authFile("sales") });

  test("finds products, compares two side by side, and shows unknown specs honestly (French)", async ({
    page,
  }) => {
    await page.goto(`/fr/catalog?q=${encodeURIComponent(`${E2E_DATA_PREFIX} Alpha`)}`);
    await expect(page.getByRole("link", { name: /Alpha NAS-4/ })).toBeVisible();
    await expect(
      page.getByRole("cell", { name: fr.Catalog.categories.nas, exact: true }),
    ).toBeVisible();

    await page.goto(`/fr/catalog?q=${encodeURIComponent(E2E_DATA_PREFIX)}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("checkbox", { name: new RegExp("Alpha NAS-4") }).check();
    await page.getByRole("checkbox", { name: new RegExp("Beta Mini-1") }).check();
    await page.getByRole("button", { name: fr.Catalog.compare }).click();

    await expect(page).toHaveURL(/\/fr\/catalog\/compare\?ids=/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      fr.Catalog.detail.compareTitle,
    );
    const table = page.getByRole("table", { name: fr.Catalog.detail.compareTitle });
    await expect(table.getByRole("link", { name: /Alpha NAS-4/ })).toBeVisible();
    await expect(table.getByRole("link", { name: /Beta Mini-1/ })).toBeVisible();
    await expect(table.getByText(fr.Catalog.unknown).first()).toBeVisible(); // Beta has no CPU model
    await expect(table.getByText(fr.Catalog.noPrice)).toHaveCount(0); // both have verified fresh prices

    await page.goto(`/fr/catalog/compare?ids=${fixture().productAId}`);
    await expect(page.getByText(fr.Catalog.detail.compareNeedTwo)).toBeVisible();
  });

  test("the product page shows each observation with its freshness, in French", async ({
    page,
  }) => {
    await page.goto(`/fr/catalog/${fixture().productAId}`);
    const rows = page.getByTestId("offer-row");
    await expect(rows).toHaveCount(2);
    // Newest observation first; it is unverified, so it is not "the price".
    await expect(rows.nth(0)).toContainText(fr.Catalog.offer.states.unverified);
    await expect(rows.nth(1)).toContainText(fr.Catalog.offer.states.fresh);
    await expect(rows.nth(1)).toContainText(fr.Catalog.detail.superseded);
    await expect(page.getByTestId("best-price")).toContainText(money("90000"));
  });
});

test.describe("permissions", () => {
  test.describe("technician: maintains the catalog but never verifies", () => {
    test.use({ storageState: authFile("technician") });

    test("can add products, record prices, and has no verification controls", async ({ page }) => {
      await page.goto("/ar/catalog");
      await expect(page.getByRole("link", { name: ar.Catalog.add })).toBeVisible();
      await page.goto(`/ar/catalog/${fixture().productAId}`);
      await expect(page.getByRole("button", { name: ar.Catalog.offer.record })).toBeVisible();
      await expect(page.getByRole("button", { name: ar.Catalog.offer.verify })).toHaveCount(0);
      await expect(page.getByRole("button", { name: ar.Catalog.offer.reject })).toHaveCount(0);
    });

    test("can read advisor results but not run the advisor", async ({ page }) => {
      await page.goto(`/ar/leads/${fixture().leadId}`);
      await expect(page.getByRole("heading", { name: ar.Advisor.title })).toBeVisible();
      await expect(page.getByTestId("advisor-results")).toBeVisible();
      await expect(page.getByRole("button", { name: ar.Advisor.run })).toHaveCount(0);
    });
  });

  test.describe("viewer: no access", () => {
    test.use({ storageState: authFile("viewer") });

    test("catalog and supplier pages are 404 and absent from the navigation", async ({ page }) => {
      await page.goto("/ar/dashboard");
      const nav = page.getByRole("navigation", { name: ar.Header.mainNav });
      for (const label of [ar.Nav.catalog, ar.Nav.suppliers]) {
        await expect(nav.getByRole("link", { name: label })).toHaveCount(0);
      }
      for (const path of [
        "/ar/catalog",
        `/ar/catalog/${fixture().productAId}`,
        "/ar/suppliers",
        "/ar/catalog/compare",
      ]) {
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(404);
      }
    });
  });
});

test.describe("accessibility (axe) — catalog and advisor", () => {
  test.use({ storageState: authFile("owner") });

  const paths = (f: E2EFixture) => [
    "catalog",
    "catalog/new",
    `catalog/${f.productAId}`,
    `catalog/${f.productAId}/edit`,
    `catalog/compare?ids=${f.productAId}&ids=${f.productBId}`,
    "suppliers",
    `leads/${f.leadId}`,
  ];

  for (const locale of ["ar", "fr"] as const) {
    for (const index of paths({} as E2EFixture).keys()) {
      test(`${locale}: page #${index} has no detectable violations`, async ({ page }) => {
        await page.goto(`/${locale}/${paths(fixture())[index]!}`);
        await page.waitForLoadState("networkidle");
        await axe(page);
      });
    }

    test(`${locale}: the supplier dialog and the price form have no detectable violations`, async ({
      page,
    }) => {
      await page.goto(`/${locale}/suppliers`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: (locale === "ar" ? ar : fr).Suppliers.add }).click();
      await axe(page);
      await page.keyboard.press("Escape");

      await page.goto(`/${locale}/catalog/${fixture().productAId}`);
      await page.waitForLoadState("networkidle");
      await page
        .getByRole("button", { name: (locale === "ar" ? ar : fr).Catalog.offer.record })
        .click();
      await axe(page);
    });
  }
});
