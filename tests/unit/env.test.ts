import { describe, expect, it } from "vitest";

import {
  REQUIRED_IN_PRODUCTION,
  checkProductionEnv,
  hasErrors,
  type EnvFinding,
} from "@/lib/env";

/**
 * Production environment checks (Phase 15).
 *
 * Each rule here exists because of a specific failure that is otherwise
 * discovered late and diagnosed slowly — a missing signing key found by the
 * first person to sign in, an `AUTH_URL` mismatch that presents as a redirect
 * loop rather than an error.
 */

const VALID = {
  DATABASE_URL: "postgresql://user:pw@db.internal:5432/coreworks",
  AUTH_SECRET: "S8kZ2q4Xv7Lp0Rt3Yw6Nb9Mc1Fd5Hj8KgTz4Vx7Qa2Ws=",
  AUTH_URL: "https://coreworks.example.com",
  NODE_ENV: "production",
};

const messagesFor = (findings: EnvFinding[], variable: string) =>
  findings.filter((f) => f.variable === variable).map((f) => f.message);

describe("checkProductionEnv", () => {
  it("passes a correct production environment with no findings at all", () => {
    expect(checkProductionEnv(VALID)).toEqual([]);
  });

  it("reports every required variable that is missing", () => {
    const findings = checkProductionEnv({ NODE_ENV: "production" });

    for (const variable of REQUIRED_IN_PRODUCTION) {
      expect(
        findings.some((f) => f.variable === variable && f.severity === "error"),
        `${variable} should be reported`,
      ).toBe(true);
    }
    expect(hasErrors(findings)).toBe(true);
  });

  it("treats an empty or whitespace value as missing", () => {
    // `AUTH_SECRET=` in a .env file sets it to the empty string, which is not
    // "set" in any sense that matters.
    for (const blank of ["", "   "]) {
      const findings = checkProductionEnv({ ...VALID, AUTH_SECRET: blank });
      expect(messagesFor(findings, "AUTH_SECRET")).toContainEqual(
        expect.stringContaining("not set"),
      );
    }
  });
});

describe("AUTH_SECRET", () => {
  it("refuses an obvious placeholder", () => {
    for (const placeholder of ["secret", "changeme", "CHANGE-ME", "dev"]) {
      const findings = checkProductionEnv({
        ...VALID,
        AUTH_SECRET: placeholder,
      });
      expect(
        hasErrors(findings),
        `"${placeholder}" should be refused`,
      ).toBe(true);
    }
  });

  it("refuses a secret that is too short to be one", () => {
    const findings = checkProductionEnv({ ...VALID, AUTH_SECRET: "abc123" });
    expect(messagesFor(findings, "AUTH_SECRET")).toContainEqual(
      expect.stringContaining("at least 32"),
    );
  });

  it("accepts the output of the documented generator", () => {
    // openssl rand -base64 32 → 44 characters.
    const findings = checkProductionEnv({
      ...VALID,
      AUTH_SECRET: "a".repeat(43) + "=",
    });
    expect(messagesFor(findings, "AUTH_SECRET")).toEqual([]);
  });
});

describe("AUTH_URL", () => {
  it("requires https for a real origin", () => {
    const findings = checkProductionEnv({
      ...VALID,
      AUTH_URL: "http://coreworks.example.com",
    });
    expect(messagesFor(findings, "AUTH_URL")).toContainEqual(
      expect.stringContaining("https"),
    );
  });

  it("allows plain http on loopback, which is how the app runs locally", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
      const findings = checkProductionEnv({ ...VALID, AUTH_URL: url });
      expect(messagesFor(findings, "AUTH_URL")).toEqual([]);
    }
  });

  it("rejects a value that is not a URL", () => {
    const findings = checkProductionEnv({ ...VALID, AUTH_URL: "coreworks" });
    expect(hasErrors(findings)).toBe(true);
  });

  it("warns about a trailing slash without failing the check", () => {
    const findings = checkProductionEnv({
      ...VALID,
      AUTH_URL: "https://coreworks.example.com/",
    });
    expect(messagesFor(findings, "AUTH_URL")).toContainEqual(
      expect.stringContaining("trailing slash"),
    );
    expect(hasErrors(findings)).toBe(false);
  });
});

describe("DATABASE_URL", () => {
  it("accepts both accepted PostgreSQL schemes", () => {
    for (const scheme of ["postgresql", "postgres"]) {
      const findings = checkProductionEnv({
        ...VALID,
        DATABASE_URL: `${scheme}://u:p@h:5432/db`,
      });
      expect(messagesFor(findings, "DATABASE_URL")).toEqual([]);
    }
  });

  it("rejects a connection string for a different database", () => {
    const findings = checkProductionEnv({
      ...VALID,
      DATABASE_URL: "mysql://u:p@h:3306/db",
    });
    expect(hasErrors(findings)).toBe(true);
  });
});

describe("NEXT_PUBLIC_ exposure", () => {
  it("refuses a secret that would be compiled into the browser bundle", () => {
    // The prefix is the whole mechanism: anything carrying it is public, and
    // nothing else in the toolchain warns about it.
    const findings = checkProductionEnv({
      ...VALID,
      NEXT_PUBLIC_AUTH_SECRET: "anything",
    });

    expect(hasErrors(findings)).toBe(true);
    expect(messagesFor(findings, "NEXT_PUBLIC_AUTH_SECRET")).toContainEqual(
      expect.stringContaining("exposed to the browser"),
    );
  });

  it("catches the other dangerous names too", () => {
    for (const name of [
      "NEXT_PUBLIC_DATABASE_URL",
      "NEXT_PUBLIC_API_TOKEN",
      "NEXT_PUBLIC_DB_PASSWORD",
      "NEXT_PUBLIC_PRIVATE_KEY",
    ]) {
      expect(
        hasErrors(checkProductionEnv({ ...VALID, [name]: "x" })),
        `${name} should be refused`,
      ).toBe(true);
    }
  });

  it("leaves a legitimate public variable alone", () => {
    const findings = checkProductionEnv({
      ...VALID,
      NEXT_PUBLIC_APP_URL: "https://coreworks.example.com",
    });
    expect(findings).toEqual([]);
  });
});

describe("NODE_ENV", () => {
  it("warns rather than fails when it is not production", () => {
    // Running the check locally is useful; it should not pretend that is an
    // error, or nobody will run it.
    const findings = checkProductionEnv({ ...VALID, NODE_ENV: "development" });

    expect(messagesFor(findings, "NODE_ENV")).toHaveLength(1);
    expect(hasErrors(findings)).toBe(false);
  });
});

describe("what the check never does", () => {
  it("never puts a value in a message", () => {
    // The output goes into deployment logs. A check that echoes DATABASE_URL
    // to prove it is set has leaked the credential it was verifying.
    const secret = "S3cr3t-Value-That-Must-Not-Appear-Anywhere";
    const findings = checkProductionEnv({
      DATABASE_URL: `postgresql://user:${secret}@h:5432/db`,
      AUTH_SECRET: secret,
      AUTH_URL: `https://x.example.com/?token=${secret}`,
      NODE_ENV: "production",
    });

    const printed = findings.map((f) => f.message).join(" ");
    expect(printed).not.toContain(secret);
  });
});
