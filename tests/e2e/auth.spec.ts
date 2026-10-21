import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { authFile, type E2EUsers } from "./env";

const users = (): E2EUsers => JSON.parse(process.env.E2E_USERS ?? "{}");

// Sign-in rate limits are per IP; auth flows run on the desktop project only.
test.skip(({ isMobile }) => isMobile, "auth flows are covered on the desktop project");

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe("anonymous visitors", () => {
  for (const [path, login] of [
    ["/ar/dashboard", /\/ar\/login$/],
    ["/fr/users", /\/fr\/login$/],
    ["/ar/audit", /\/ar\/login$/],
    ["/fr/settings", /\/fr\/login$/],
    ["/ar/account", /\/ar\/login$/],
  ] as const) {
    test(`${path} redirects to the login page`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(login);
    });
  }

  test("a wrong password shows a generic error and stays on the login page", async ({ page }) => {
    await page.goto("/ar/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("البريد الإلكتروني").fill("nobody@e2e.example.test");
    await page.getByLabel("كلمة المرور").fill("not-the-password-123");
    await page.getByRole("button", { name: "دخول" }).click();
    // (Next.js adds its own role=alert route announcer, so filter by text.)
    await expect(
      page.getByRole("alert").filter({ hasText: "البريد الإلكتروني أو كلمة المرور غير صحيحة" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/ar\/login$/);
  });

  test("form validation messages are localized", async ({ page }) => {
    await page.goto("/fr/login");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByText("Saisissez une adresse e-mail valide.")).toBeVisible();
    await expect(page.getByText("Le mot de passe est obligatoire.")).toBeVisible();
  });

  test("the auth API refuses self-registration", async ({ request }) => {
    const response = await request.post("/api/auth/sign-up/email", {
      data: { email: "x@e2e.example.test", password: "a-long-enough-password-1", name: "X" },
    });
    expect(response.status()).toBe(404);
  });
});

test.describe("signing in through the form", () => {
  test("a sales user signs in, sees the dashboard in Arabic, and signs out", async ({ page }) => {
    const { sales } = users();
    await page.goto("/ar/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("البريد الإلكتروني").fill(sales.email);
    await page.getByLabel("كلمة المرور").fill(sales.password);
    await page.getByRole("button", { name: "دخول" }).click();

    await expect(page).toHaveURL(/\/ar\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("مرحبًا");
    await expect(page.getByTestId("status-database")).toContainText("يعمل");

    await page.getByRole("button", { name: "تسجيل الخروج" }).click();
    await expect(page).toHaveURL(/\/ar\/login$/);
    await page.goto("/ar/dashboard");
    await expect(page).toHaveURL(/\/ar\/login$/);
  });

  test("an account with a temporary password must change it before anything else", async ({
    page,
  }) => {
    const { forced } = users();
    await page.goto("/fr/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Adresse e-mail").fill(forced.email);
    await page.getByLabel("Mot de passe").fill(forced.password);
    await page.getByRole("button", { name: "Se connecter" }).click();

    await expect(page).toHaveURL(/\/fr\/account\?required=change-password$/);
    await expect(page.getByText("Vous devez changer le mot de passe temporaire")).toBeVisible();

    // The app pages are closed until the password is changed.
    await page.goto("/fr/dashboard");
    await expect(page).toHaveURL(/\/fr\/account\?required=change-password$/);

    await page.waitForLoadState("networkidle");
    await page.getByLabel("Mot de passe actuel").fill(forced.password);
    await page
      .getByLabel("Nouveau mot de passe", { exact: true })
      .fill("Another-long-passphrase-42");
    await page.getByLabel("Confirmer le nouveau mot de passe").fill("Another-long-passphrase-42");
    await page.getByRole("button", { name: "Changer le mot de passe" }).click();
    await expect(page).toHaveURL(/\/fr\/dashboard$/);
  });

  test("the password form rejects short and mismatched passwords", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("viewer") });
    const page = await context.newPage();
    await page.goto("/ar/account");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("كلمة المرور الحالية").fill("whatever-current");
    await page.getByLabel("كلمة المرور الجديدة", { exact: true }).fill("short");
    await page.getByLabel("تأكيد كلمة المرور الجديدة").fill("different");
    await page.getByRole("button", { name: "تغيير كلمة المرور" }).click();
    await expect(page.getByText("كلمة المرور يجب ألا تقل عن 12 حرفًا.")).toBeVisible();
    await expect(page.getByText("تأكيد كلمة المرور غير مطابق.")).toBeVisible();
    await context.close();
  });
});

test.describe("owner", () => {
  test.use({ storageState: authFile("owner") });

  test("sees every section and can open each one", async ({ page }) => {
    await page.goto("/ar/dashboard");
    const nav = page.getByRole("navigation", { name: "التنقل الرئيسي" });
    for (const name of ["لوحة التحكم", "المستخدمون", "سجل التدقيق", "الإعدادات"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
    await page.goto("/ar/users");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("المستخدمون");
    await page.goto("/ar/audit");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("سجل التدقيق");
    await page.goto("/fr/settings");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Paramètres");
  });

  test("creates a user and shows the temporary password exactly once", async ({ page }) => {
    await page.goto("/ar/users");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "إضافة مستخدم" }).click();

    const email = `created-${Date.now()}@e2e.example.test`;
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("الاسم").fill("مستخدم تجريبي");
    await dialog.getByLabel("البريد الإلكتروني").fill(email);
    await dialog.getByLabel("الدور").selectOption("technician");
    await dialog.getByRole("button", { name: "إنشاء" }).click();

    const secret = page.getByRole("status").filter({ hasText: "كلمة المرور المؤقتة" });
    await expect(secret).toBeVisible();
    await expect(secret.locator("code")).toHaveText(/^\S{16}$/);
    const table = page.getByRole("region", { name: "قائمة المستخدمين" });
    await expect(table.getByText(email)).toBeVisible();

    await page.reload();
    await expect(page.getByText("كلمة المرور المؤقتة")).toHaveCount(0);
    await expect(table.getByText(email)).toBeVisible();
  });

  test("duplicate emails are refused with a clear message", async ({ page }) => {
    const { sales } = users();
    await page.goto("/fr/users");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Ajouter un utilisateur" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nom").fill("Doublon");
    await dialog.getByLabel("Adresse e-mail").fill(sales.email);
    await dialog.getByRole("button", { name: "Créer" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "existe déjà" })).toBeVisible();
  });

  test("the audit log records the sign-ins and uses localized labels", async ({ page }) => {
    await page.goto("/fr/audit");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(
      page.getByRole("cell", { name: /Connexion réussie|Utilisateur créé/ }).first(),
    ).toBeVisible();
  });

  for (const locale of ["ar", "fr"]) {
    for (const path of ["dashboard", "users", "audit", "settings", "account"]) {
      test(`axe: /${locale}/${path} has no detectable violations`, async ({ page }) => {
        await page.goto(`/${locale}/${path}`);
        await page.waitForLoadState("networkidle");
        await axe(page);
      });
    }
  }
});

test.describe("sales (read-only settings)", () => {
  test.use({ storageState: authFile("sales") });

  test("cannot see or open owner-only sections", async ({ page }) => {
    await page.goto("/ar/dashboard");
    const nav = page.getByRole("navigation", { name: "التنقل الرئيسي" });
    await expect(nav.getByRole("link", { name: "المستخدمون" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "سجل التدقيق" })).toHaveCount(0);

    for (const path of ["/ar/users", "/ar/audit"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("الصفحة غير موجودة");
    }
  });

  test("settings are visible but locked", async ({ page }) => {
    await page.goto("/fr/settings");
    await expect(page.getByText("accès en lecture seule")).toBeVisible();
    await expect(page.getByLabel("Nom de l'entreprise")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Enregistrer" })).toHaveCount(0);
  });
});

test.describe("viewer", () => {
  test.use({ storageState: authFile("viewer") });

  test("only the dashboard and the reports are available", async ({ page }) => {
    await page.goto("/fr/dashboard");
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(nav.getByRole("link")).toHaveCount(2);
    for (const path of ["/fr/users", "/fr/audit", "/fr/settings"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
    }
  });

  test("cross-origin state-changing requests are rejected and keep the session", async ({
    page,
  }) => {
    await page.goto("/fr/dashboard");
    const evil = await page.context().request.post("/api/auth/sign-out", {
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      data: {},
    });
    expect(evil.status()).toBeGreaterThanOrEqual(400);
    await page.goto("/fr/dashboard");
    await expect(page).toHaveURL(/\/fr\/dashboard$/); // still signed in
  });

  test("server actions cannot be used to escalate privileges", async ({ page, request }) => {
    // Even a direct call to the auth admin API with the viewer's cookie is refused.
    await page.goto("/fr/dashboard");
    const cookies = await page.context().cookies();
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const response = await request.post("/api/auth/admin/set-role", {
      headers: { cookie, origin: "http://localhost:3100" },
      data: { userId: "anyone", role: "owner" },
    });
    expect([401, 403]).toContain(response.status());
  });
});
