import { expect, test } from "@playwright/test";
import { authFile } from "./env";

test.skip(({ isMobile }) => isMobile, "headers do not depend on the viewport");

const PAGES = [
  "dashboard",
  "customers",
  "leads",
  "follow-ups",
  "catalog",
  "suppliers",
  "quotes",
  "projects",
  "assets",
  "tickets",
  "maintenance",
  "backups",
  "remote",
  "reports",
  "audit",
  "settings",
  "users",
  "account",
];

test.describe("content security policy", () => {
  test.use({ storageState: authFile("owner") });
  test.setTimeout(180_000); // 36 full page loads

  test("every page carries a fresh nonce and runs without a single violation", async ({ page }) => {
    const violations: string[] = [];
    await page.exposeFunction("reportViolation", (text: string) => violations.push(text));
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) => {
        (window as unknown as { reportViolation: (t: string) => void }).reportViolation(
          `${location.pathname}: ${e.violatedDirective} ${e.blockedURI} ${e.sample}`,
        );
      });
    });

    const nonces = new Set<string>();
    for (const locale of ["ar", "fr"]) {
      for (const path of PAGES) {
        const response = await page.goto(`/${locale}/${path}`);
        expect(response?.status(), `${locale}/${path}`).toBe(200);
        const csp = response?.headers()["content-security-policy"] ?? "";
        const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
        expect(nonce, `${locale}/${path} has a nonce`).toBeTruthy();
        nonces.add(nonce!);
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).toContain("object-src 'none'");
        expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
        await page.waitForLoadState("networkidle");
      }
    }
    expect(nonces.size).toBe(PAGES.length * 2); // never reused between requests
    expect(violations).toEqual([]);
  });

  test("Next.js scripts are stamped with the request nonce and an injected inline script is blocked", async ({
    page,
  }) => {
    // Browsers hide the nonce attribute from the DOM once parsed, so read the raw HTML.
    const raw = await page.request.get("/fr/dashboard");
    const nonce = /'nonce-([^']+)'/.exec(raw.headers()["content-security-policy"] ?? "")?.[1];
    const tags = [...(await raw.text()).matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag, tag).toContain(`nonce="${nonce}"`);

    // What an XSS payload would try: markup with an inline event handler, parsed by the browser.
    await page.goto("/fr/dashboard");
    const executed = await page.evaluate(async () => {
      const w = window as unknown as { pwned?: boolean };
      w.pwned = false;
      const div = document.createElement("div");
      div.innerHTML = `<img src="data:," onerror="window.pwned = true">`;
      document.body.appendChild(div);
      await new Promise((r) => setTimeout(r, 300));
      return w.pwned;
    });
    expect(executed).toBe(false);
  });
});
