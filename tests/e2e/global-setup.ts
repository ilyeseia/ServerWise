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
  for (const key of ["E2E_USERS", "E2E_FIXTURE"]) {
    const line = output.split("\n").find((l) => l.startsWith(`${key}=`));
    if (!line) throw new Error(`e2e seed did not return ${key}`);
    // Inherited by the test workers started after global setup.
    process.env[key] = line.slice(key.length + 1);
  }

  return async () => {
    seed("teardown");
  };
}
