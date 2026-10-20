/**
 * Environment shared by the Playwright web server and the seed script, so cookies signed by the
 * seed are accepted by the server. The secret below is a test-only literal, not a real secret.
 */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_URL = `http://localhost:${E2E_PORT}`;
export const E2E_AUTH_SECRET = "e2e-only-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
export const E2E_EMAIL_DOMAIN = "e2e.example.test";

export const serverEnv = {
  APP_URL: E2E_URL,
  AUTH_SECRET: E2E_AUTH_SECRET,
  // The e2e owner has no authenticator; the 2FA gate itself is covered by unit/integration tests.
  REQUIRE_OWNER_2FA: "false",
};

export type E2ERole = "owner" | "sales" | "viewer" | "forced";
export interface E2EUser {
  email: string;
  password: string;
}
export type E2EUsers = Record<E2ERole, E2EUser>;

/** Where the seed writes each role's signed-in browser state. */
export const authFile = (role: E2ERole) => `tests/e2e/.auth/${role}.json`;
