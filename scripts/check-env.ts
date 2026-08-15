import "dotenv/config";

import { checkProductionEnv, hasErrors } from "../src/lib/env";

/**
 * Pre-start environment check (`npm run check:env`).
 *
 * A thin runner over `src/lib/env.ts`, following the same split as
 * `run-job.ts` and `bootstrap-org.ts`: the rules are in the module, the
 * argument handling and output are here.
 *
 * Intended to run once before the process starts serving — in a deployment
 * pipeline, or from the container entrypoint. It reports what is wrong and
 * exits non-zero, so a misconfigured deployment fails at the point where
 * somebody is watching rather than at the first sign-in attempt.
 *
 * It never prints a value, only the name of the variable and what is wrong
 * with it. A check that echoes `DATABASE_URL` into a build log to prove it is
 * set has leaked the credential it was verifying.
 */
function main(): void {
  const findings = checkProductionEnv(process.env);

  if (findings.length === 0) {
    console.log("Environment looks correct for production.");
    process.exit(0);
  }

  for (const finding of findings) {
    const label = finding.severity === "error" ? "ERROR  " : "warning";
    console.error(`  ${label}  ${finding.message}`);
  }

  if (hasErrors(findings)) {
    console.error("\nRefusing to report a healthy environment.");
    process.exit(1);
  }

  console.log("\nNo errors — warnings above are advisory.");
  process.exit(0);
}

main();
