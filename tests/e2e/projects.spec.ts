import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import { E2E_DATA_PREFIX, authFile, type E2EFixture } from "./env";

const fixture = (): E2EFixture => JSON.parse(process.env.E2E_FIXTURE ?? "{}");

test.skip(({ isMobile }) => isMobile, "project flows are covered on the desktop project");

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

/** Creates an issued and accepted quotation through the UI and returns its page URL. */
async function acceptedQuote(page: Page, title: string): Promise<string> {
  const q = ar.Quotes;
  await page.goto(`/ar/leads/${fixture().advisorLeadId}`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel(q.quoteTitle, { exact: true }).fill(title);
  await page.getByRole("button", { name: q.create, exact: true }).click();
  await expect(page).toHaveURL(/\/ar\/quotes\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: q.addLine, exact: true }).click();
  await page.getByLabel(`${q.lineN.replace("{n}", "1")}: ${q.col.description}`).fill("تركيب خادم");
  await page.getByLabel(`${q.lineN.replace("{n}", "1")}: ${q.col.unitPrice}`).fill("40000");
  await page.getByRole("button", { name: q.saveAndIssue, exact: true }).click();
  await expect(page.getByText(q.status.issued, { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: q.markAccepted, exact: true }).click();
  await expect(page.getByText(q.status.accepted, { exact: true }).first()).toBeVisible();
  return page.url();
}

test.describe("sales runs a project from an accepted quotation (Arabic)", () => {
  test.use({ storageState: authFile("sales") });

  test("quote -> project -> plan -> tasks -> handover -> completion", async ({ page }) => {
    test.setTimeout(300_000);
    const p = ar.Projects;
    const quoteUrl = await acceptedQuote(page, `${E2E_DATA_PREFIX} Project flow`);

    // --- creating the project is idempotent ----------------------------------------------------
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: p.createFromQuote, exact: true }).click();
    await expect(page).toHaveURL(/\/ar\/projects\/[0-9a-f-]{36}$/);
    const projectUrl = page.url();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/P-\d{4}-\d{4}/);
    await expect(page.getByText(p.status.planned, { exact: true }).first()).toBeVisible();

    await page.goto(quoteUrl);
    await expect(page.getByRole("link", { name: /فتح المشروع P-/ })).toBeVisible();
    await expect(page.getByRole("button", { name: p.createFromQuote })).toHaveCount(0);
    await page.goto(projectUrl);
    await page.waitForLoadState("networkidle");

    // The standard tasks were generated: survey, rollback plan, work, test, handover.
    const tasks = page
      .getByRole("list")
      .filter({ has: page.getByRole("heading", { level: 4 }) })
      .first();
    await expect(tasks.getByRole("heading", { level: 4 })).toHaveCount(5);
    await expect(page.getByRole("heading", { level: 4, name: /تنفيذ: تركيب خادم/ })).toBeVisible();
    await axe(page);

    // --- the project cannot start without a rollback plan --------------------------------------
    const start = page.getByRole("button", {
      name: p.moveTo.replace("{status}", p.status.in_progress),
      exact: true,
    });
    await expect(start).toBeDisabled();
    await expect(page.getByText(p.blockers.ROLLBACK_PLAN_REQUIRED)).toBeVisible();
    await page
      .getByLabel(p.rollbackPlan, { exact: true })
      .fill("استعادة الصورة المأخوذة قبل التنفيذ");
    await page.getByRole("button", { name: p.savePlan, exact: true }).click();
    await expect(page.getByText(p.saved)).toBeVisible();
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("button", {
        name: p.moveTo.replace("{status}", p.status.in_progress),
        exact: true,
      })
      .click();
    await expect(page.getByText(p.status.in_progress, { exact: true }).first()).toBeVisible();

    // --- tasks respect their prerequisites and checklists --------------------------------------
    const work = page.getByRole("heading", { level: 4, name: /تنفيذ: تركيب خادم/ });
    const workCard = page.getByRole("listitem").filter({ has: work });
    await expect(workCard.getByText(p.blockers.DEPENDENCY_OPEN)).toBeVisible();
    await expect(
      workCard.getByRole("button", {
        name: new RegExp(`${p.moveTo.replace("{status}", p.taskStatus.in_progress)}$`),
      }),
    ).toBeDisabled();

    // Finish the survey and the rollback task: their checklist items first.
    for (const name of [/معاينة الموقع/, /خطة التراجع واعتمادها/]) {
      const card = page
        .getByRole("listitem")
        .filter({ has: page.getByRole("heading", { level: 4, name }) });
      await card.getByRole("button", { name: new RegExp(`${p.taskStatus.in_progress}$`) }).click();
      await expect(card.getByText(p.taskStatus.in_progress, { exact: true }).first()).toBeVisible();
      // Done is refused while the checklist has unchecked items.
      await expect(card.getByText(p.blockers.CHECKLIST_OPEN).first()).toBeVisible();
      await expect(
        card.getByRole("button", { name: new RegExp(`${p.taskStatus.done}$`) }),
      ).toBeDisabled();
      const boxes = card.getByRole("checkbox");
      const count = await boxes.count();
      for (let i = 0; i < count; i++) {
        await boxes.nth(i).check();
        await expect(boxes.nth(i)).toBeChecked();
      }
      await card.getByRole("button", { name: new RegExp(`${p.taskStatus.done}$`) }).click();
      await expect(card.getByText(p.taskStatus.done, { exact: true }).first()).toBeVisible();
    }
    await expect(
      workCard.getByRole("button", {
        name: new RegExp(`${p.moveTo.replace("{status}", p.taskStatus.in_progress)}$`),
      }),
    ).toBeEnabled();

    // --- a cycle is refused with a clear message -----------------------------------------------
    const survey = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { level: 4, name: /معاينة الموقع/ }) });
    // (done tasks are read-only for dependencies in practice; cycles are covered by integration tests)
    await expect(survey.getByText(p.taskStatus.done, { exact: true }).first()).toBeVisible();

    // --- finish everything else, record the handover, complete --------------------------------
    for (const name of [/تنفيذ: تركيب خادم/, /اختبار التركيب/, /التسليم وتدريب العميل/]) {
      const card = page
        .getByRole("listitem")
        .filter({ has: page.getByRole("heading", { level: 4, name }) });
      await card.getByRole("button", { name: new RegExp(`${p.taskStatus.in_progress}$`) }).click();
      await expect(card.getByText(p.taskStatus.in_progress, { exact: true }).first()).toBeVisible();
      const boxes = card.getByRole("checkbox");
      const count = await boxes.count();
      for (let i = 0; i < count; i++) {
        await boxes.nth(i).check();
        await expect(boxes.nth(i)).toBeChecked();
      }
      await card.getByRole("button", { name: new RegExp(`${p.taskStatus.done}$`) }).click();
      await expect(card.getByText(p.taskStatus.done, { exact: true }).first()).toBeVisible();
    }

    const complete = page.getByRole("button", {
      name: p.moveTo.replace("{status}", p.status.completed),
      exact: true,
    });
    await expect(complete).toBeDisabled();
    await expect(page.getByText(p.blockers.HANDOVER_REQUIRED)).toBeVisible();
    await page
      .getByLabel(p.handoverNotes, { exact: true })
      .fill("سُلّم الخادم للعميل. بيانات الدخول في مدير كلمات المرور لدى العميل.");
    await page.getByRole("button", { name: p.recordHandover, exact: true }).click();
    // The form is replaced by the saved note only once the server has stored the handover.
    await expect(page.getByLabel(p.handoverNotes, { exact: true })).toHaveCount(0);
    await expect(page.getByText(/سُلّم الخادم للعميل/)).toBeVisible();
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("button", { name: p.moveTo.replace("{status}", p.status.completed), exact: true })
      .click();
    await expect(page.getByText(p.status.completed, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(p.closedNotice)).toBeVisible();
    await expect(page.getByRole("button", { name: p.addTask })).toHaveCount(0);
    await axe(page);

    // --- French shows the same project, and the list contains it -------------------------------
    await page.goto(projectUrl.replace("/ar/", "/fr/"));
    await expect(
      page.getByText(fr.Projects.status.completed, { exact: true }).first(),
    ).toBeVisible();
    await page.goto("/fr/projects");
    await expect(page.getByRole("heading", { level: 1, name: fr.Projects.title })).toBeVisible();
    await expect(page.getByRole("link", { name: /P-\d{4}-\d{4}/ }).first()).toBeVisible();
    await axe(page);
  });

  test("a custom task, a cycle attempt and a cancellation need their reasons (French)", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const p = fr.Projects;
    await acceptedQuote(page, `${E2E_DATA_PREFIX} Custom flow`);
    await page.getByRole("button", { name: ar.Projects.createFromQuote, exact: true }).click();
    await expect(page).toHaveURL(/\/ar\/projects\/[0-9a-f-]{36}$/);
    await page.goto(page.url().replace("/ar/", "/fr/"));
    await page.waitForLoadState("networkidle");

    // Two custom tasks; B depends on A; making A depend on B is refused.
    for (const name of ["Tâche A", "Tâche B"]) {
      await page.getByRole("button", { name: p.addTask, exact: true }).click();
      await page.getByLabel(p.taskTitle, { exact: true }).fill(name);
      await page.getByRole("button", { name: p.createTask, exact: true }).click();
      await expect(page.getByRole("heading", { level: 4, name: new RegExp(name) })).toBeVisible();
    }
    const cardB = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { level: 4, name: /Tâche B/ }) });
    await cardB.getByLabel(/Ajouter une dépendance/).selectOption({ label: "Tâche A" });
    await cardB.getByRole("button", { name: /Lier/ }).click();
    await expect(cardB.getByText("Tâche A").first()).toBeVisible();

    const cardA = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { level: 4, name: /Tâche A/ }) });
    await cardA.getByLabel(/Ajouter une dépendance/).selectOption({ label: "Tâche B" });
    await cardA.getByRole("button", { name: /Lier/ }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: fr.Crm.errors.DEPENDENCY_CYCLE }),
    ).toBeVisible();

    // Cancelling needs a reason.
    const cancel = page.getByRole("button", {
      name: p.moveTo.replace("{status}", p.status.cancelled),
      exact: true,
    });
    await expect(cancel).toBeDisabled();
    await page.getByLabel(p.cancelReason, { exact: true }).fill("Le client a reporté");
    await cancel.click();
    await expect(page.getByText(p.status.cancelled, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Le client a reporté/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: p.addTask })).toHaveCount(0);
  });
});

test.describe("who can see projects", () => {
  test.describe("viewer", () => {
    test.use({ storageState: authFile("viewer") });
    test("gets the 404 page and no navigation entry", async ({ page }) => {
      const response = await page.goto("/ar/projects");
      expect(response?.status()).toBe(404);
      await page.goto("/ar/dashboard");
      await expect(page.getByRole("link", { name: ar.Nav.projects })).toHaveCount(0);
    });
  });

  test.describe("technician", () => {
    test.use({ storageState: authFile("technician") });
    test("reads projects and works on tasks but cannot manage the plan", async ({ page }) => {
      await page.goto("/ar/projects");
      await expect(page.getByRole("heading", { level: 1, name: ar.Projects.title })).toBeVisible();
      await page.goto(`/ar/projects/${fixture().projectId}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByLabel(ar.Projects.rollbackPlan, { exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: ar.Projects.savePlan })).toHaveCount(0);
      await expect(page.getByRole("button", { name: ar.Projects.addTask })).toBeVisible();
    });
  });
});
