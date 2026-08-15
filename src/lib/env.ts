/**
 * Production environment checks (Phase 15).
 *
 * Pure: it takes an environment and returns findings. No `process.env` access,
 * no exiting, no logging — so every rule is testable and the same function
 * serves the CLI and anything else that wants to ask.
 *
 * The point is *when* the failure happens. Without this, a missing
 * `AUTH_SECRET` is discovered by the first person who tries to sign in, and a
 * wrong `AUTH_URL` presents as an endless redirect back to the login page
 * rather than as an error. Both are cheap to detect before the process starts
 * serving.
 *
 * It is a pre-start check, deliberately not a module-load assertion: a hard
 * throw at import time would take down a running instance on a configuration
 * change that a human could otherwise fix.
 */

export type Severity = "error" | "warning";

export interface EnvFinding {
  variable: string;
  severity: Severity;
  message: string;
}

/** Everything the application genuinely reads. Verified against the source. */
export const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_URL",
] as const;

/**
 * A development `AUTH_SECRET` that also works in production means a
 * development token is a production session, so obviously-placeholder values
 * are refused rather than merely noted.
 */
const PLACEHOLDER_SECRETS = new Set([
  "secret",
  "changeme",
  "change-me",
  "development",
  "dev",
  "test",
  "coreworks",
  "please-change",
]);

/** Below this, a signing key is guessable rather than secret. */
const MIN_SECRET_LENGTH = 32;

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

/**
 * Checks an environment as it would be used in production.
 *
 * Returns findings rather than throwing; the caller decides what an `error`
 * means for it.
 */
export function checkProductionEnv(
  env: Record<string, string | undefined>,
): EnvFinding[] {
  const findings: EnvFinding[] = [];

  for (const variable of REQUIRED_IN_PRODUCTION) {
    if (isBlank(env[variable])) {
      findings.push({
        variable,
        severity: "error",
        message: `${variable} is not set.`,
      });
    }
  }

  const secret = env.AUTH_SECRET;
  if (!isBlank(secret)) {
    const value = secret!.trim();
    if (PLACEHOLDER_SECRETS.has(value.toLowerCase())) {
      findings.push({
        variable: "AUTH_SECRET",
        severity: "error",
        message:
          "AUTH_SECRET is a placeholder value. Generate one with: openssl rand -base64 32",
      });
    } else if (value.length < MIN_SECRET_LENGTH) {
      findings.push({
        variable: "AUTH_SECRET",
        severity: "error",
        message: `AUTH_SECRET is ${value.length} characters; use at least ${MIN_SECRET_LENGTH}.`,
      });
    }
  }

  const authUrl = env.AUTH_URL;
  if (!isBlank(authUrl)) {
    const value = authUrl!.trim();
    let parsed: URL | null = null;
    try {
      parsed = new URL(value);
    } catch {
      findings.push({
        variable: "AUTH_URL",
        severity: "error",
        message: `AUTH_URL is not a valid URL: "${value}".`,
      });
    }

    if (parsed) {
      // Sessions are cookie-borne and sign-in posts a password. Over plain
      // HTTP both are readable in transit, and Auth.js will not mark its
      // cookies Secure for a non-https origin.
      if (parsed.protocol !== "https:" && !isLoopback(parsed.hostname)) {
        findings.push({
          variable: "AUTH_URL",
          severity: "error",
          message: `AUTH_URL must be https in production (got "${parsed.protocol}//").`,
        });
      }
      // A trailing slash produces callback URLs with a doubled slash, which
      // some providers reject and which makes logs harder to read.
      if (value.endsWith("/")) {
        findings.push({
          variable: "AUTH_URL",
          severity: "warning",
          message: "AUTH_URL has a trailing slash; drop it.",
        });
      }
    }
  }

  const databaseUrl = env.DATABASE_URL;
  if (!isBlank(databaseUrl) && !/^postgres(ql)?:\/\//.test(databaseUrl!.trim())) {
    findings.push({
      variable: "DATABASE_URL",
      severity: "error",
      message: "DATABASE_URL must be a postgresql:// connection string.",
    });
  }

  if (env.NODE_ENV !== "production") {
    findings.push({
      variable: "NODE_ENV",
      severity: "warning",
      message: `NODE_ENV is "${env.NODE_ENV ?? "unset"}", not "production".`,
    });
  }

  // Anything with this prefix is compiled into the browser bundle. A secret
  // that acquires it is public, and nothing warns you.
  for (const key of Object.keys(env)) {
    if (!key.startsWith("NEXT_PUBLIC_")) continue;
    if (/SECRET|PASSWORD|TOKEN|PRIVATE|DATABASE_URL/i.test(key)) {
      findings.push({
        variable: key,
        severity: "error",
        message: `${key} is exposed to the browser by its NEXT_PUBLIC_ prefix. Rename it.`,
      });
    }
  }

  return findings;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

export function hasErrors(findings: EnvFinding[]): boolean {
  return findings.some((finding) => finding.severity === "error");
}
