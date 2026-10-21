import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import { E2E_DATA_PREFIX, authFile, type E2EFixture } from "./env";

const fixture = (): E2EFixture => JSON.parse(process.env.E2E_FIXTURE ?? "{}");

test.skip(({ isMobile }) => isMobile, "care-operations flows are covered on the desktop project");

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test.describe("technician records an asset and a visit (Arabic)", () => {
  test.use({ storageState: authFile("technician") });

  test("asset: create, duplicate serial refused, warranty warning", async ({ page }) => {
    test.setTimeout(180_000);
    const a = ar.Assets;
    const { customerId } = fixture();
    const serial = `E2E-SN-${Date.now()}`;

    await page.goto(`/ar/assets/new?customerId=${customerId}`);
    await page.waitForLoadState("networkidle");
    await page.getByLabel(a.name, { exact: true }).fill(`${E2E_DATA_PREFIX} NAS ${Date.now()}`);
    await page.getByLabel(a.kindLabel, { exact: true }).selectOption("nas");
    await page.getByLabel(a.serial, { exact: true }).fill(serial);
    await page.getByLabel(a.warrantyUntil, { exact: true }).fill(inDays(12));
    await page
      .getByLabel(a.credentialsRef, { exact: true })
      .fill("مدير كلمات المرور لدى العميل، البند 7");
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(page).toHaveURL(/\/ar\/assets\/[0-9a-f-]{36}$/);
    await expect(page.getByText(a.renewal.expiring).first()).toBeVisible();
    await expect(page.getByText("مدير كلمات المرور لدى العميل، البند 7")).toBeVisible();
    await axe(page);

    // The same serial number for the same customer is refused.
    await page.goto(`/ar/assets/new?customerId=${customerId}`);
    await page.waitForLoadState("networkidle");
    await page.getByLabel(a.name, { exact: true }).fill(`${E2E_DATA_PREFIX} Duplicate`);
    await page.getByLabel(a.serial, { exact: true }).fill(serial);
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: ar.Crm.errors.SERIAL_EXISTS }),
    ).toBeVisible();

    // The list finds it by serial number.
    await page.goto(`/ar/assets?customerId=${customerId}&q=${serial}`);
    await expect(
      page.getByRole("link", { name: new RegExp(`${E2E_DATA_PREFIX} NAS`) }),
    ).toBeVisible();
  });

  test("overdue visit: shown, recorded, and the schedule moves on", async ({ page }) => {
    test.setTimeout(180_000);
    const m = ar.Maintenance;
    const { contractId } = fixture();

    await page.goto("/ar/maintenance");
    await expect(page.getByRole("heading", { level: 1, name: m.title })).toBeVisible();
    const due = page.getByRole("row", { name: new RegExp(`${E2E_DATA_PREFIX} Overdue check`) });
    await expect(due).toBeVisible();
    await expect(due.getByText(m.scheduleState.overdue, { exact: true })).toBeVisible();
    // Technicians do not create contracts.
    await expect(page.getByRole("link", { name: m.newContract })).toHaveCount(0);
    await axe(page);

    await page.goto(`/ar/maintenance/${contractId}`);
    await page.waitForLoadState("networkidle");
    const schedule = page
      .getByRole("listitem")
      .filter({ hasText: `${E2E_DATA_PREFIX} Overdue check` });
    await expect(schedule.getByText(m.scheduleState.overdue, { exact: true })).toBeVisible();
    await schedule.getByRole("button", { name: new RegExp(`${m.recordVisit}$`) }).click();
    await schedule
      .getByLabel(m.summary, { exact: true })
      .fill("تنظيف المراوح وفحص النسخ الاحتياطي");
    await schedule.getByLabel(m.partsReplaced, { exact: true }).fill("مروحة واحدة");
    await schedule.getByRole("button", { name: m.saveVisit, exact: true }).click();

    // The visit is logged, and the schedule is no longer overdue (next visit is three months away).
    await expect(page.getByText("تنظيف المراوح وفحص النسخ الاحتياطي")).toBeVisible();
    await expect(schedule.getByText(m.scheduleState.overdue, { exact: true })).toHaveCount(0);
    await expect(schedule.getByText(m.scheduleState.upcoming, { exact: true })).toBeVisible();
    await axe(page);

    await page.goto("/ar/maintenance");
    await expect(
      page.getByRole("row", { name: new RegExp(`${E2E_DATA_PREFIX} Overdue check`) }),
    ).toHaveCount(0);
  });
});

test.describe("sales runs a ticket and a contract", () => {
  test.use({ storageState: authFile("sales") });

  test("ticket: open -> comment -> resolve needs a resolution -> close (Arabic)", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const t = ar.Tickets;
    const { customerId } = fixture();
    const title = `${E2E_DATA_PREFIX} Server down ${Date.now()}`;

    await page.goto(`/ar/tickets/new?customerId=${customerId}`);
    await page.waitForLoadState("networkidle");
    await page.getByLabel(t.titleLabel, { exact: true }).fill(title);
    await page.getByLabel(t.priorityLabel, { exact: true }).selectOption("urgent");
    await page.getByLabel(t.description, { exact: true }).fill("لا يستجيب الخادم منذ الصباح");
    await page.getByRole("button", { name: t.open, exact: true }).click();
    await expect(page).toHaveURL(/\/ar\/tickets\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/T-\d{4}-\d{4}/);
    await expect(page.getByText(t.priority.urgent, { exact: true }).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await axe(page);

    // Discussion.
    await page.getByLabel(t.comment, { exact: true }).fill("اتصلنا بالعميل وسنتوجه إلى الموقع");
    await page.getByRole("button", { name: t.post, exact: true }).click();
    await expect(page.getByText("اتصلنا بالعميل وسنتوجه إلى الموقع")).toBeVisible();

    // In progress; resolving is impossible without a resolution.
    await page
      .getByRole("button", {
        name: t.moveTo.replace("{status}", t.status.in_progress),
        exact: true,
      })
      .click();
    await expect(page.getByText(t.status.in_progress, { exact: true }).first()).toBeVisible();
    const resolve = page.getByRole("button", {
      name: t.moveTo.replace("{status}", t.status.resolved),
      exact: true,
    });
    await expect(resolve).toBeDisabled();
    await page.getByLabel(t.resolution, { exact: true }).fill("استُبدل مزود الطاقة");
    await expect(resolve).toBeEnabled();
    await resolve.click();
    await expect(page.getByText(t.status.resolved, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("استُبدل مزود الطاقة").first()).toBeVisible();

    // Close: final, nothing can be added any more.
    await page
      .getByRole("button", { name: t.moveTo.replace("{status}", t.status.closed), exact: true })
      .click();
    await expect(page.getByText(t.closedNotice)).toBeVisible();
    await expect(page.getByLabel(t.comment, { exact: true })).toHaveCount(0);

    // It is listed, and the dashboard counts open urgent tickets from real data.
    await page.goto(`/ar/tickets?customerId=${customerId}&q=${encodeURIComponent(title)}`);
    await expect(page.getByRole("link", { name: /T-\d{4}-\d{4}/ })).toBeVisible();
    await page.goto("/ar/dashboard");
    await expect(page.getByTestId("stat-open-tickets")).toBeVisible();
    await expect(page.getByTestId("stat-overdue-maintenance")).toBeVisible();
  });

  test("contract: create with an asset, schedule a visit, cancel (French)", async ({ page }) => {
    test.setTimeout(240_000);
    const m = fr.Maintenance;
    const { customerId } = fixture();
    const title = `${E2E_DATA_PREFIX} Contract ${Date.now()}`;

    await page.goto(`/fr/maintenance/new?customerId=${customerId}`);
    await page.waitForLoadState("networkidle");
    await page.getByLabel(m.titleLabel, { exact: true }).fill(title);
    await page.getByLabel(m.monthlyFee, { exact: true }).fill("9000");
    await page.getByLabel(new RegExp(`${E2E_DATA_PREFIX} Fixture server`)).check();
    await axe(page);
    await page.getByRole("button", { name: fr.Common.save, exact: true }).click();
    await expect(page).toHaveURL(/\/fr\/maintenance\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(`${E2E_DATA_PREFIX} Fixture server`) }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");

    await page.getByLabel(m.scheduleTitle, { exact: true }).fill("Contrôle trimestriel");
    await page.getByLabel(m.firstVisit, { exact: true }).fill(inDays(3));
    await page.getByRole("button", { name: m.addSchedule, exact: true }).click();
    const schedule = page.getByRole("listitem").filter({ hasText: "Contrôle trimestriel" });
    await expect(schedule.getByText(m.scheduleState.due_soon, { exact: true })).toBeVisible();

    // Cancelling needs a reason, is final, and switches the visits off.
    const cancel = page.getByRole("button", { name: m.cancelContract, exact: true });
    await expect(cancel).toBeDisabled();
    await page.getByLabel(m.cancelReason, { exact: true }).fill("Le client a fermé son bureau");
    await cancel.click();
    await expect(page.getByText(m.contractState.cancelled, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: m.addSchedule })).toHaveCount(0);
    await axe(page);
  });
});

test.describe("French pages are accessible", () => {
  test.use({ storageState: authFile("owner") });

  for (const path of ["assets", "tickets", "maintenance", "tickets/new", "assets/new"]) {
    test(`fr: /${path}`, async ({ page }) => {
      await page.goto(`/fr/${path}`);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await axe(page);
    });
  }

  test("fr: asset detail", async ({ page }) => {
    await page.goto(`/fr/assets/${fixture().assetId}`);
    await expect(page.getByText(fr.Assets.renewal.expiring).first()).toBeVisible();
    await axe(page);
  });
});

test.describe("who can see care operations", () => {
  test.describe("viewer", () => {
    test.use({ storageState: authFile("viewer") });
    test("gets the 404 page and no navigation entries", async ({ page }) => {
      for (const path of ["assets", "tickets", "maintenance"]) {
        const response = await page.goto(`/ar/${path}`);
        expect(response?.status(), path).toBe(404);
      }
      await page.goto("/ar/dashboard");
      for (const name of [ar.Nav.assets, ar.Nav.tickets, ar.Nav.maintenance]) {
        await expect(page.getByRole("link", { name })).toHaveCount(0);
      }
    });
  });

  test.describe("sales", () => {
    test.use({ storageState: authFile("sales") });
    test("reads assets but cannot add them", async ({ page }) => {
      await page.goto("/ar/assets");
      await expect(page.getByRole("heading", { level: 1, name: ar.Assets.title })).toBeVisible();
      await expect(page.getByRole("link", { name: ar.Assets.add })).toHaveCount(0);
      const response = await page.goto("/ar/assets/new");
      expect(response?.status()).toBe(404);
    });
  });
});
