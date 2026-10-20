import { execFileSync } from "node:child_process";

function seed(command: "setup" | "teardown"): string {
  return execFileSync(process.execPath, ["--import", "tsx", "tests/e2e/seed.ts", command], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
  });
}

export default async function globalSetup() {
  const output = seed("setup");
  const line = output.split("\n").find((l) => l.startsWith("E2E_USERS="));
  if (!line) throw new Error("e2e seed did not return users");
  // Inherited by the test workers started after global setup.
  process.env.E2E_USERS = line.slice("E2E_USERS=".length);

  return async () => {
    seed("teardown");
  };
}
