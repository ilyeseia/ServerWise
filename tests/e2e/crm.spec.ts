import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import { E2E_DATA_PREFIX, authFile, type E2EFixture } from "./env";

const fixture = (): E2EFixture => JSON.parse(process.env.E2E_FIXTURE ?? "{}");

// Sign-in state is prepared by the seed; CRM flows run on the desktop project.
test.skip(({ isMobile }) => isMobile, "CRM flows are covered on the desktop project");

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe("sales: the whole customer journey (Arabic, RTL)", () => {
  test.use({ storageState: authFile("sales") });

  test("customer -> contact -> lead -> follow-up -> conversation -> requirements -> pipeline", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const name = `${E2E_DATA_PREFIX} Flow ${Date.now()}`;

    // --- customer: validation first, then create -------------------------------------------
    await page.goto("/ar/customers/new");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(page.getByText(ar.Crm.customerForm.nameRequired)).toBeVisible();

    await page.getByLabel(ar.Crm.customerForm.type).selectOption("business");
    await page.getByLabel(ar.Crm.customerForm.name, { exact: true }).fill(name);
    await page.getByLabel(ar.Crm.customerForm.legalName).fill("SARL Flow");
    await page.getByLabel(ar.Crm.customerForm.phone).fill("not a phone");
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(page.getByText(ar.Crm.customerForm.invalidPhone)).toBeVisible();

    await page.getByLabel(ar.Crm.customerForm.phone).fill("0555 12 34 56");
    await page.getByLabel(ar.Crm.customerForm.wilaya).selectOption("19");
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(page).toHaveURL(/\/ar\/customers\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByText("19 · سطيف")).toBeVisible(); // wilaya shown in Arabic
    await expect(page.getByText(ar.Crm.customerStatus.prospect).first()).toBeVisible();

    // --- contact ---------------------------------------------------------------------------
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: ar.Crm.contacts.add }).click();
    await page.getByLabel(ar.Crm.contacts.name, { exact: true }).fill("سارة بن علي");
    await page.getByLabel(ar.Crm.contacts.phone).fill("0661 22 33 44");
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    const contact = page.getByRole("listitem").filter({ hasText: "سارة بن علي" });
    await expect(contact).toBeVisible();
    await expect(contact.getByText(ar.Crm.contacts.primary)).toBeVisible(); // first contact is primary

    // --- lead --------------------------------------------------------------------------------
    await page.getByRole("link", { name: ar.Crm.leads.add }).click();
    await expect(page).toHaveURL(/\/ar\/leads\/new\?customerId=/);
    await page.waitForLoadState("networkidle");
    await page.getByLabel(ar.Crm.leads.titleField, { exact: true }).fill("خادم منزلي مع مراقبة");
    await page.getByLabel(ar.Crm.leads.budgetMin).fill("200000");
    await page.getByLabel(ar.Crm.leads.budgetMax).fill("100000");
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(page.getByText(ar.Crm.leads.budgetRange)).toBeVisible(); // max < min is refused
    await page.getByLabel(ar.Crm.leads.budgetMax).fill("350000");
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(page).toHaveURL(/\/ar\/leads\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("خادم منزلي مع مراقبة");

    // --- follow-up (past due -> flagged overdue) ---------------------------------------------
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: ar.Crm.followUps.add }).click();
    await page.getByLabel(ar.Crm.followUps.titleField, { exact: true }).fill("اتصال لمناقشة العرض");
    await page.getByLabel(ar.Crm.followUps.due, { exact: true }).fill("2020-01-01T09:00");
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    const followUp = page.getByRole("listitem").filter({ hasText: "اتصال لمناقشة العرض" });
    await expect(followUp).toBeVisible();
    await expect(followUp.getByText(ar.Crm.followUps.overdue)).toBeVisible();

    // --- conversation log --------------------------------------------------------------------
    await page.getByRole("button", { name: ar.Crm.communications.log }).click();
    await page.getByLabel(ar.Crm.communications.channel).selectOption("whatsapp");
    await page.getByLabel(ar.Crm.communications.summary).fill("طلب العميل ثلاثة عروض أسعار");
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    const entry = page.getByRole("listitem").filter({ hasText: "طلب العميل ثلاثة عروض أسعار" });
    await expect(entry).toBeVisible();
    await expect(entry.getByText(ar.Crm.channel.whatsapp)).toBeVisible();

    // --- requirements questionnaire: conditional questions ------------------------------------
    await expect(page.getByRole("heading", { name: ar.Requirements.title })).toBeVisible();
    const cameras = page.getByLabel(/عدد كاميرات المراقبة/);
    await expect(cameras).toHaveCount(0);
    await page.getByLabel(ar.Requirements.o.workloads.surveillance).check();
    await expect(cameras).toBeVisible();
    await page.getByLabel(ar.Requirements.o.workloads.surveillance).uncheck();
    await expect(cameras).toHaveCount(0);
    await page.getByLabel(ar.Requirements.o.workloads.surveillance).check();
    await page.getByLabel(ar.Requirements.o.workloads.file_storage).check();

    // Completing with gaps shows what is missing and saves nothing.
    await page.getByRole("button", { name: ar.Requirements.markComplete }).click();
    await expect(page.getByText(ar.Requirements.incomplete)).toBeVisible();
    await expect(page.getByText(ar.Requirements.errors.required).first()).toBeVisible();

    await page.getByLabel(/عدد المستخدمين المتزامنين/).fill("4");
    await cameras.fill("6");
    await page.getByLabel(/الحد الأقصى للميزانية/).fill("350000");
    await page.getByLabel(/أولوية المعالج/).selectOption("balanced");
    await expect(page.getByLabel(/مستوى الحماية من تعطل الأقراص/)).toHaveCount(0);
    await page.getByLabel(/سعة التخزين المطلوبة/).fill("2");
    await expect(page.getByLabel(/مستوى الحماية من تعطل الأقراص/)).toBeVisible(); // storage > 0
    await page
      .getByRole("group", { name: /على مدار الساعة/ })
      .getByLabel(ar.Requirements.no, { exact: true })
      .check();
    await page.getByLabel(/مستوى الضجيج المقبول/).selectOption("quiet");
    const remote = page.getByRole("group", { name: /هل تحتاج إلى وصول عن بُعد/ });
    await remote.getByLabel(ar.Requirements.yes, { exact: true }).check();
    await expect(page.getByLabel(/طريقة الوصول عن بُعد المفضلة/)).toBeVisible();
    await page.getByLabel(/طريقة الوصول عن بُعد المفضلة/).selectOption("tailscale");
    await remote.getByLabel(ar.Requirements.no, { exact: true }).check();
    await expect(page.getByLabel(/طريقة الوصول عن بُعد المفضلة/)).toHaveCount(0); // hidden again
    await page
      .getByRole("group", { name: /هل تحتاج إلى نسخ احتياطي/ })
      .getByLabel(ar.Requirements.no, { exact: true })
      .check();
    await page.getByLabel(/النمو المتوقع خلال سنتين/).selectOption("some");

    await page.getByRole("button", { name: ar.Requirements.markComplete }).click();
    await expect(page.getByText(ar.Requirements.savedComplete)).toBeVisible();
    await expect(page.getByText(ar.Requirements.statusComplete)).toBeVisible();

    // Persisted: a reload shows the saved answers, and the hidden answer was dropped.
    await page.reload();
    await expect(page.getByLabel(/عدد المستخدمين المتزامنين/)).toHaveValue("4");
    await expect(page.getByLabel(/عدد كاميرات المراقبة/)).toHaveValue("6");
    await expect(page.getByLabel(/طريقة الوصول عن بُعد المفضلة/)).toHaveCount(0);

    // --- pipeline: only legal moves are offered ------------------------------------------------
    await page.waitForLoadState("networkidle");
    const moves = page.getByRole("group", { name: ar.Crm.leads.moveTo });
    await expect(moves.getByRole("button", { name: ar.Crm.leadStatus.won })).toHaveCount(0);
    await expect(moves.getByRole("button", { name: ar.Crm.leadStatus.proposal })).toHaveCount(0);

    await moves.getByRole("button", { name: ar.Crm.leadStatus.contacted }).click();
    await expect(moves.getByRole("button", { name: ar.Crm.leadStatus.proposal })).toBeVisible();
    await moves.getByRole("button", { name: ar.Crm.leadStatus.qualified }).click();
    await moves.getByRole("button", { name: ar.Crm.leadStatus.proposal }).click();
    await expect(moves.getByRole("button", { name: ar.Crm.leadStatus.won })).toBeVisible();
    await moves.getByRole("button", { name: ar.Crm.leadStatus.won }).click();

    // Won is final; requirements become read-only.
    await expect(page.getByText(ar.Crm.leads.noNext)).toBeVisible();
    await expect(page.getByText(ar.Requirements.readOnly)).toBeVisible();

    // --- the customer became active; the dashboard reflects real data -------------------------
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await expect(page.getByText(ar.Crm.customerStatus.active).first()).toBeVisible();

    await page.goto("/ar/dashboard");
    await expect(page.getByTestId("crm-stats")).toBeVisible();
    expect(Number(await page.getByTestId("stat-active").innerText())).toBeGreaterThanOrEqual(1);
    expect(Number(await page.getByTestId("stat-overdue").innerText())).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("stage-won")).toContainText(/[1-9]/);

    // --- follow-ups page: overdue badge, then complete it --------------------------------------
    await page.goto("/ar/follow-ups");
    const item = page.getByRole("listitem").filter({ hasText: "اتصال لمناقشة العرض" });
    await expect(item.getByText(ar.Crm.followUps.overdue)).toBeVisible();
    await page.waitForLoadState("networkidle");
    await item.getByRole("button", { name: ar.Crm.followUps.complete }).click();
    await expect(item).toHaveCount(0);
  });

  test("losing a lead needs a reason, and a lost lead can be reopened", async ({ page }) => {
    const { customerId } = fixture();
    await page.goto(`/ar/leads/new?customerId=${customerId}`);
    await page.waitForLoadState("networkidle");
    await page
      .getByLabel(ar.Crm.leads.titleField, { exact: true })
      .fill(`${E2E_DATA_PREFIX} lost lead`);
    await page.getByRole("button", { name: ar.Common.save, exact: true }).click();
    await expect(page).toHaveURL(/\/ar\/leads\/[0-9a-f-]{36}$/);
    await page.waitForLoadState("networkidle");

    const moves = page.getByRole("group", { name: ar.Crm.leads.moveTo });
    await moves.getByRole("button", { name: ar.Crm.leadStatus.lost }).click();
    const confirm = page.getByRole("button", { name: ar.Crm.leads.confirmLost });
    await expect(confirm).toBeDisabled(); // no reason yet
    await page.getByLabel(ar.Crm.leads.lostReason).fill("الميزانية أقل من المطلوب");
    await confirm.click();
    await expect(page.getByText("الميزانية أقل من المطلوب")).toBeVisible();

    await moves.getByRole("button", { name: ar.Crm.leadStatus.contacted }).click();
    await expect(page.getByText("الميزانية أقل من المطلوب")).toHaveCount(0);
  });
});

test.describe("search and filters (French, LTR)", () => {
  test.use({ storageState: authFile("sales") });

  test("finds the seeded customer by name, phone and e-mail, and filters by type", async ({
    page,
  }) => {
    const { customerName } = fixture();
    await page.goto("/fr/customers");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.Crm.customers.title);

    const search = async (q: string) => {
      await page.getByLabel(fr.Crm.customers.searchPlaceholder).fill(q);
      await page.getByRole("button", { name: fr.Crm.common.search }).click();
    };
    const cell = page.getByRole("link", { name: customerName });

    await search(customerName.toLowerCase());
    await expect(cell).toBeVisible();
    await search("0555 00 11");
    await expect(cell).toBeVisible();
    await search("fixture@example");
    await expect(cell).toBeVisible();
    await search("no-such-customer-xyz");
    await expect(page.getByText(fr.Crm.customers.noMatches)).toBeVisible();

    await page.goto(`/fr/customers?q=${encodeURIComponent(customerName)}&type=individual`);
    await expect(page.getByText(fr.Crm.customers.noMatches)).toBeVisible();
    await page.goto(`/fr/customers?q=${encodeURIComponent(customerName)}&type=business`);
    await expect(cell).toBeVisible();
  });

  test("the customer page shows the fixture's wilaya in French and its history", async ({
    page,
  }) => {
    const { customerId } = fixture();
    await page.goto(`/fr/customers/${customerId}`);
    await expect(page.getByText("19 · Sétif")).toBeVisible();
    await expect(page.getByText("Contact Fixture")).toBeVisible();
    await expect(page.getByText("Initial enquiry about a home server")).toBeVisible();
    await expect(page.getByText(fr.Crm.followUps.overdue).first()).toBeVisible();
  });
});

test.describe("permissions", () => {
  test.describe("technician: read-only", () => {
    test.use({ storageState: authFile("technician") });

    test("can browse customers and leads but has no way to change anything", async ({ page }) => {
      const { customerId, leadId } = fixture();
      await page.goto("/ar/customers");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(ar.Crm.customers.title);
      await expect(page.getByRole("link", { name: ar.Crm.customers.add })).toHaveCount(0);

      await page.goto(`/ar/customers/${customerId}`);
      await expect(page.getByRole("link", { name: ar.Common.save, exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: ar.Crm.contacts.add })).toHaveCount(0);
      await expect(page.getByRole("button", { name: ar.Crm.communications.log })).toHaveCount(0);
      await expect(page.getByRole("button", { name: ar.Crm.customer.archive })).toHaveCount(0);

      await page.goto(`/ar/leads/${leadId}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("group", { name: ar.Crm.leads.moveTo })).toHaveCount(0);
      await expect(page.getByRole("button", { name: ar.Requirements.markComplete })).toHaveCount(0);

      for (const path of [
        "/ar/customers/new",
        "/ar/leads/new",
        `/ar/customers/${customerId}/edit`,
        `/ar/leads/${leadId}/edit`,
      ]) {
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(404);
      }
    });
  });

  test.describe("sales cannot archive", () => {
    test.use({ storageState: authFile("sales") });

    test("the archive control is owner-only", async ({ page }) => {
      await page.goto(`/ar/customers/${fixture().customerId}`);
      await expect(page.getByRole("button", { name: ar.Crm.customer.archive })).toHaveCount(0);
    });
  });

  test.describe("viewer: no CRM access at all", () => {
    test.use({ storageState: authFile("viewer") });

    test("every CRM page is a 404 and absent from the navigation", async ({ page }) => {
      const { customerId, leadId } = fixture();
      await page.goto("/ar/dashboard");
      const nav = page.getByRole("navigation", { name: ar.Header.mainNav });
      for (const label of [ar.Nav.customers, ar.Nav.leads, ar.Nav.followUps]) {
        await expect(nav.getByRole("link", { name: label })).toHaveCount(0);
      }
      await expect(page.getByTestId("crm-stats")).toHaveCount(0);

      for (const path of [
        "/ar/customers",
        `/ar/customers/${customerId}`,
        "/ar/leads",
        `/ar/leads/${leadId}`,
        "/ar/follow-ups",
      ]) {
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(404);
      }
    });
  });

  test.describe("owner: archives and restores", () => {
    test.use({ storageState: authFile("owner") });

    test("an archived customer is hidden from the list and read-only until restored", async ({
      page,
    }) => {
      // A dedicated customer, so the shared fixture stays intact for the other tests.
      const name = `${E2E_DATA_PREFIX} Archive ${Date.now()}`;
      await page.goto("/fr/customers/new");
      await page.waitForLoadState("networkidle");
      await page.getByLabel(fr.Crm.customerForm.name, { exact: true }).fill(name);
      await page.getByRole("button", { name: fr.Common.save, exact: true }).click();
      await expect(page).toHaveURL(/\/fr\/customers\/[0-9a-f-]{36}$/);
      await page.waitForLoadState("networkidle");

      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: fr.Crm.customer.archive }).click();
      await expect(page.getByText(fr.Crm.customer.archivedNotice)).toBeVisible();
      await expect(page.getByRole("button", { name: fr.Crm.contacts.add })).toHaveCount(0);

      await page.goto(`/fr/customers?q=${encodeURIComponent(name)}`);
      await expect(page.getByText(fr.Crm.customers.noMatches)).toBeVisible();
      await page.goto(`/fr/customers?q=${encodeURIComponent(name)}&status=archived`);
      await expect(page.getByRole("link", { name })).toBeVisible();

      await page.getByRole("link", { name }).click();
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: fr.Crm.customer.restore }).click();
      await expect(page.getByText(fr.Crm.customer.archivedNotice)).toHaveCount(0);
      await expect(page.getByRole("button", { name: fr.Crm.contacts.add })).toBeVisible();
    });
  });
});

test.describe("accessibility (axe) — CRM pages", () => {
  test.use({ storageState: authFile("owner") });

  for (const locale of ["ar", "fr"] as const) {
    const paths = (f: E2EFixture) => [
      "customers",
      "customers/new",
      `customers/${f.customerId}`,
      `customers/${f.customerId}/edit`,
      "leads",
      "leads/new",
      `leads/${f.leadId}`,
      `leads/${f.leadId}/edit`,
      "follow-ups",
    ];
    for (const index of paths({
      customerId: "",
      customerName: "",
      leadId: "",
      leadTitle: "",
    }).keys()) {
      test(`${locale}: page #${index} has no detectable violations`, async ({ page }) => {
        const path = paths(fixture())[index]!;
        await page.goto(`/${locale}/${path}`);
        await page.waitForLoadState("networkidle");
        await axe(page);
      });
    }

    test(`${locale}: dashboard with CRM figures has no detectable violations`, async ({ page }) => {
      await page.goto(`/${locale}/dashboard`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("crm-stats")).toBeVisible();
      await axe(page);
    });
  }
});
