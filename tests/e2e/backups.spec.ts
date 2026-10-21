import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import { E2E_DATA_PREFIX, authFile, type E2EFixture } from "./env";

const fixture = (): E2EFixture => JSON.parse(process.env.E2E_FIXTURE ?? "{}");

test.skip(({ isMobile }) => isMobile, "backup flows are covered on the desktop project");

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe("technician keeps a backup policy honest (Arabic)", () => {
  test.use({ storageState: authFile("technician") });

  test("a backup nobody has restored is never healthy", async ({ page }) => {
    test.setTimeout(240_000);
    const b = ar.Backups;
    const { customerId } = fixture();
    const name = `${E2E_DATA_PREFIX} Policy ${Date.now()}`;

    // --- create the policy -------------------------------------------------------------------
    await page.goto(`/ar/backups/new?customerId=${customerId}`);
    await page.waitForLoadState("networkidle");
    await page.getByLabel(b.name, { exact: true }).fill(name);
    await page.getByLabel(b.destination, { exact: true }).fill("قرص خارجي في خزنة المكتب");
    await page.getByLabel(b.keyRef, { exact: true }).fill("مدير كلمات المرور لدى العميل، البند 31");
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(page).toHaveURL(/\/ar\/backups\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await page.waitForLoadState("networkidle");

    // A brand-new policy has no proof yet.
    await expect(page.getByText(b.neverTestedNotice)).toBeVisible();
    await expect(page.getByText(b.health.warning, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(b.docState.missing, { exact: true })).toBeVisible();
    await axe(page);

    // --- a successful backup alone does not make it healthy ---------------------------------
    await page.getByRole("button", { name: b.recordBackup, exact: true }).click();
    await expect(page.getByRole("cell", { name: b.outcome.success, exact: true })).toBeVisible();
    await expect(page.getByText(b.neverTestedNotice)).toBeVisible();
    await expect(page.getByText(b.health.ok, { exact: true })).toHaveCount(0);

    // --- recovery documentation --------------------------------------------------------------
    await page
      .getByLabel(b.recoveryProcedure, { exact: true })
      .fill("1. وصّل القرص. 2. شغّل سكربت الاستعادة.");
    await page.getByRole("button", { name: b.saveRecovery, exact: true }).click();
    await expect(page.getByText(b.docState.ok, { exact: true })).toBeVisible();

    // --- a proven restore makes it healthy ----------------------------------------------------
    await page.locator("#drill-notes").fill("استُعيدت على جهاز تجريبي");
    await page.getByRole("button", { name: b.recordRestore, exact: true }).click();
    await expect(page.getByText(b.neverTestedNotice)).toHaveCount(0);
    await expect(page.getByText(b.health.ok, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(b.restoreStatus.ok, { exact: true }).first()).toBeVisible();

    // --- a failed drill is critical until it is fixed -----------------------------------------
    await page.locator("#drill-outcome").selectOption("failed");
    await page.getByRole("button", { name: b.recordRestore, exact: true }).click();
    await expect(page.getByText(b.restoreFailedNotice)).toBeVisible();
    await expect(page.getByText(b.health.critical, { exact: true }).first()).toBeVisible();
    await axe(page);

    // --- it is listed first (problems first), and the dashboard counts it ---------------------
    await page.goto(`/ar/backups?customerId=${customerId}`);
    await expect(page.getByRole("link", { name })).toBeVisible();
    await page.goto("/ar/dashboard");
    await expect(page.getByTestId("stat-backup-critical")).toBeVisible();
  });

  test("the fixture policy shows its unproven restore (French)", async ({ page }) => {
    const b = fr.Backups;
    await page.goto(`/fr/backups/${fixture().policyId}`);
    await expect(page.getByText(b.neverTestedNotice)).toBeVisible();
    await expect(
      page.getByText(b.restoreStatus.never_tested, { exact: true }).first(),
    ).toBeVisible();
    await axe(page);
    await page.goto("/fr/backups");
    await expect(page.getByRole("heading", { level: 1, name: b.title })).toBeVisible();
    await axe(page);
  });

  test("a plan with a gap: visible, explainable, but only the owner approves", async ({ page }) => {
    test.setTimeout(180_000);
    const r = ar.Remote;
    await page.goto(`/ar/remote/${fixture().planGapAId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(r.documentationOnly).first()).toBeVisible();
    await expect(page.getByText(r.gapsTitle)).toBeVisible();
    await expect(page.getByText(r.safeguard.mfa).first()).toBeVisible();
    // Technicians can edit the draft, but there is no approval button for them.
    await expect(page.getByRole("button", { name: r.approve, exact: true })).toHaveCount(0);
    await page
      .getByLabel(r.exceptions, { exact: true })
      .fill("العميل لا يملك مزود هوية يدعم MFA، وافق كتابةً");
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(page.getByText(r.gapsTitle)).toBeVisible();
    await expect(page.getByText(r.exceptionsNeeded).first()).toBeHidden();
    await axe(page);
  });
});

test.describe("owner approves remote access plans", () => {
  test.use({ storageState: authFile("owner") });

  test("a compliant plan is approved and then locked (Arabic)", async ({ page }) => {
    test.setTimeout(180_000);
    const r = ar.Remote;
    await page.goto(`/ar/remote/${fixture().planOkId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(r.gapsTitle)).toHaveCount(0);
    await page.getByRole("button", { name: r.approve, exact: true }).click();
    await expect(page.getByText(r.status.approved, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(r.lockedNotice)).toBeVisible();
    await expect(page.getByRole("button", { name: ar.Common.save, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: r.approve, exact: true })).toHaveCount(0);
    await axe(page);
  });

  test("a plan that departs from the policy cannot be approved without a reason (French)", async ({
    page,
  }) => {
    const r = fr.Remote;
    await page.goto(`/fr/remote/${fixture().planGapBId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: r.approve, exact: true })).toBeDisabled();
    await expect(page.getByText(r.cannotApproveYet)).toBeVisible();
    await expect(page.getByText(r.safeguard.noPublicExposure).first()).toBeVisible();
    await axe(page);
    await page.goto("/fr/remote");
    await expect(page.getByRole("heading", { level: 1, name: r.title })).toBeVisible();
    await axe(page);
  });
});

test.describe("who can see backups and remote plans", () => {
  test.describe("viewer", () => {
    test.use({ storageState: authFile("viewer") });
    test("gets the 404 page and no navigation entries", async ({ page }) => {
      for (const path of ["backups", "remote"]) {
        const response = await page.goto(`/ar/${path}`);
        expect(response?.status(), path).toBe(404);
      }
      await page.goto("/ar/dashboard");
      for (const name of [ar.Nav.backups, ar.Nav.remote]) {
        await expect(page.getByRole("link", { name })).toHaveCount(0);
      }
    });
  });

  test.describe("sales", () => {
    test.use({ storageState: authFile("sales") });
    test("reads policies but cannot create or record", async ({ page }) => {
      await page.goto("/ar/backups");
      await expect(page.getByRole("heading", { level: 1, name: ar.Backups.title })).toBeVisible();
      await expect(page.getByRole("link", { name: ar.Backups.newPolicy })).toHaveCount(0);
      expect((await page.goto("/ar/backups/new"))?.status()).toBe(404);
      await page.goto(`/ar/backups/${fixture().policyId}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("button", { name: ar.Backups.recordBackup })).toHaveCount(0);
      await expect(page.getByRole("button", { name: ar.Backups.recordRestore })).toHaveCount(0);
      expect((await page.goto("/ar/remote/new"))?.status()).toBe(404);
    });
  });
});
