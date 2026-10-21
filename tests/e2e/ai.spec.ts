import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import { E2E_AI_KEY, authFile, type E2EFixture } from "./env";

const fixture = (): E2EFixture => JSON.parse(process.env.E2E_FIXTURE ?? "{}");

test.skip(({ isMobile }) => isMobile, "assistant flows are covered on the desktop project");

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe("sales uses the assistant (Arabic)", () => {
  test.use({ storageState: authFile("sales") });

  test("summarise a customer: a labelled draft, answered by the provider in Arabic", async ({
    page,
  }) => {
    const a = ar.Ai;
    await page.goto(`/ar/customers/${fixture().customerId}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: a.summarizeCustomer, exact: true }).click();

    const answer = page.getByRole("region", { name: a.answer });
    await expect(answer).toBeVisible();
    // The fake provider echoes the language and the task it was given.
    await expect(answer.getByText(/\[E2E Arabic\] Summarise the relationship/)).toBeVisible();
    await expect(answer.getByText(a.draftNotice)).toBeVisible();
    await expect(answer.getByText("Premier point E2E")).toBeVisible();
    await expect(answer.getByRole("button", { name: a.copy, exact: true })).toBeVisible();
    await expect(answer.getByText(/المتبقي اليوم/)).toBeVisible();
    await axe(page);
  });

  test("a follow-up draft needs a goal first, and a provider outage is only a notice", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const a = ar.Ai;
    await page.goto(`/ar/customers/${fixture().customerId}`);
    await page.waitForLoadState("networkidle");

    const draft = page.getByRole("button", { name: a.draftFollowUp, exact: true });
    await expect(draft).toBeDisabled();
    await page.getByLabel(a.goal, { exact: true }).fill("تذكير بعرض السعر");
    await expect(draft).toBeEnabled();
    await draft.click();
    const answer = page.getByRole("region", { name: a.answer });
    await expect(answer.getByText("Sujet E2E")).toBeVisible();
    await expect(answer.getByText(/Write a short, polite follow-up/)).toBeVisible();

    // The provider fails: a calm notice, and the rest of the page keeps working.
    await page.getByLabel(a.goal, { exact: true }).fill("FORCE_ERROR please");
    await draft.click();
    await expect(page.getByText(a.unavailable.provider_error)).toBeVisible();
    await expect(page.getByRole("region", { name: a.answer })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("button", { name: a.summarizeCustomer, exact: true }),
    ).toBeEnabled();
  });

  test("credentials in an answer are removed before they reach the screen", async ({ page }) => {
    const a = ar.Ai;
    await page.goto(`/ar/customers/${fixture().customerId}`);
    await page.waitForLoadState("networkidle");
    await page.getByLabel(a.goal, { exact: true }).fill("FORCE_SECRET now");
    await page.getByRole("button", { name: a.draftFollowUp, exact: true }).click();
    const answer = page.getByRole("region", { name: a.answer });
    await expect(answer).toBeVisible();
    await expect(answer.getByText(a.redacted)).toBeVisible();
    await expect(answer).not.toContainText("Tr0ub4dor");
    await expect(answer).not.toContainText("ABCDEFGHIJKLMNOP1234");
  });

  test("draft handover notes for a project: text only, nothing is saved", async ({ page }) => {
    const a = ar.Ai;
    await page.goto(`/ar/projects/${fixture().projectId}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: a.draftHandover, exact: true }).click();
    await expect(page.getByRole("region", { name: a.answer })).toBeVisible();
    // The handover record of the project is untouched.
    await page.reload();
    await expect(page.getByText(ar.Projects.noHandover)).toBeVisible();
    await expect(page.getByText(ar.Projects.status.planned, { exact: true }).first()).toBeVisible();
  });

  test("the lead page explains a saved recommendation", async ({ page }) => {
    const a = ar.Ai;
    await page.goto(`/ar/leads/${fixture().leadId}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: a.explainRecommendation, exact: true }).click();
    await expect(page.getByRole("region", { name: a.answer })).toContainText("[E2E Arabic]");
  });
});

test.describe("technician and settings", () => {
  test.describe("technician", () => {
    test.use({ storageState: authFile("technician") });

    test("summarises a ticket (French) but cannot draft customer messages", async ({ page }) => {
      const a = fr.Ai;
      await page.goto(`/fr/tickets/${fixture().ticketId}`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: a.summarizeTicket, exact: true }).click();
      await expect(
        page
          .getByRole("region", { name: a.answer })
          .getByText(/\[E2E French\] Summarise this support ticket/),
      ).toBeVisible();
      await axe(page);

      await page.goto(`/fr/customers/${fixture().customerId}`);
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByRole("button", { name: a.summarizeCustomer, exact: true }),
      ).toBeVisible();
      // Writing to customers needs crm:write, which technicians do not have.
      await expect(page.getByRole("button", { name: a.draftFollowUp, exact: true })).toHaveCount(0);
    });
  });

  test.describe("owner", () => {
    test.use({ storageState: authFile("owner") });

    test("settings show the provider and model but never the key", async ({ page }) => {
      await page.goto("/ar/settings");
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(ar.Ai.settingsOn)).toBeVisible();
      await expect(page.getByText("openai_compatible")).toBeVisible();
      await expect(page.getByText("e2e-model")).toBeVisible();
      expect(await page.content()).not.toContain(E2E_AI_KEY);
      await axe(page);
    });
  });

  test.describe("viewer", () => {
    test.use({ storageState: authFile("viewer") });

    test("has no assistant: the customer pages are not even available", async ({ page }) => {
      const response = await page.goto(`/ar/customers/${fixture().customerId}`);
      expect(response?.status()).toBe(404);
    });
  });
});
