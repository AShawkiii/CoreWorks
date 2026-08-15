import "dotenv/config";

import { createInterface } from "node:readline/promises";

import { prisma } from "../src/lib/db";
import { organizationSlugSchema } from "../src/lib/validation/organization";
import { slugifyOrganizationName } from "../src/lib/validation/bootstrap";
import {
  BootstrapError,
  bootstrapOrganization,
} from "../src/server/services/bootstrap";

/**
 * First-organization bootstrap (`npm run bootstrap`).
 *
 * A thin runner over `src/server/services/bootstrap.ts`, exactly as
 * `run-job.ts` is a thin runner over `src/server/jobs/scheduled.ts`: argument
 * handling and output live here, every rule lives in the service, and the
 * tests exercise the service rather than the CLI.
 *
 *   npm run bootstrap -- --name "Meridian Advisory" \
 *                        --owner-name "Amara Okafor" \
 *                        --owner-email amara@meridian.example
 *
 * ---------------------------------------------------------------------------
 * The password is deliberately not a flag
 * ---------------------------------------------------------------------------
 *
 * Anything on `argv` is visible to every other process on the machine through
 * `ps`, and lands in shell history. So the password comes from one of two
 * places instead:
 *
 *   - `COREWORKS_OWNER_PASSWORD`, for automated provisioning; or
 *   - an interactive prompt with the echo suppressed, asked twice.
 *
 * It is never echoed, never logged, and never included in the success output.
 * A wrong password here is expensive to recover from — this deployment has no
 * mail transport, so there is no self-service reset — which is why the prompt
 * asks for confirmation.
 */

const PASSWORD_ENV = "COREWORKS_OWNER_PASSWORD";

interface Args {
  name?: string;
  ownerName?: string;
  ownerEmail?: string;
  slug?: string;
}

function usage(): never {
  console.error(
    [
      "Usage: npm run bootstrap -- --name <organization> --owner-name <name> --owner-email <email> [--slug <slug>]",
      "",
      "  --name         Organization name, e.g. \"Meridian Advisory\"",
      "  --owner-name   Full name of the first Owner",
      "  --owner-email  Email address of the first Owner",
      "  --slug         URL slug. Derived from --name when omitted.",
      "",
      `The password is read from ${PASSWORD_ENV} if set, otherwise prompted for.`,
      "It is never accepted as a command-line argument: argv is visible to",
      "other processes and is recorded in shell history.",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];

    // A missing value, or a value that is itself a flag, is a typo rather
    // than an empty string the operator meant.
    const take = (): string => {
      if (!value || value.startsWith("--")) {
        console.error(`Missing value for ${flag}.`);
        usage();
      }
      i += 1;
      return value;
    };

    switch (flag) {
      case "--name":
        args.name = take();
        break;
      case "--owner-name":
        args.ownerName = take();
        break;
      case "--owner-email":
        args.ownerEmail = take();
        break;
      case "--slug":
        args.slug = take();
        break;
      case "--password":
      case "--owner-password":
        console.error(
          `The password cannot be passed as an argument — argv is visible to other processes.\n` +
            `Set ${PASSWORD_ENV} or let the script prompt for it.`,
        );
        process.exit(2);
        break;
      default:
        console.error(`Unknown argument: ${flag}`);
        usage();
    }
  }

  return args;
}

/** Reads a line from the terminal without echoing what is typed. */
async function promptHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // `readline` writes the prompt through this hook; suppressing everything
  // after it is what stops the typed characters appearing on screen.
  let muted = false;
  const output = rl as unknown as {
    output: NodeJS.WriteStream;
    _writeToOutput: (text: string) => void;
  };
  output._writeToOutput = (text: string) => {
    if (!muted) output.output.write(text);
  };

  try {
    const answer = rl.question(question);
    muted = true;
    const value = await answer;
    process.stdout.write("\n");
    return value;
  } finally {
    muted = false;
    rl.close();
  }
}

async function resolvePassword(): Promise<string> {
  const fromEnv = process.env[PASSWORD_ENV];
  if (fromEnv) return fromEnv;

  if (!process.stdin.isTTY) {
    console.error(
      `No terminal to prompt on. Set ${PASSWORD_ENV} for non-interactive use.`,
    );
    process.exit(2);
  }

  const password = await promptHidden("Owner password (min 12 characters): ");
  const confirm = await promptHidden("Confirm password: ");

  if (password !== confirm) {
    console.error("Passwords do not match.");
    process.exit(2);
  }

  return password;
}

function resolveSlug(args: Args): string {
  const candidate = args.slug ?? slugifyOrganizationName(args.name ?? "");
  const parsed = organizationSlugSchema.safeParse(candidate);

  if (!parsed.success) {
    const reason = parsed.error.issues[0]?.message ?? "Invalid slug.";
    console.error(
      args.slug
        ? `--slug "${args.slug}": ${reason}`
        : `Could not derive a usable slug from "${args.name}": ${reason}\n` +
            "Pass one explicitly with --slug.",
    );
    process.exit(2);
  }

  return parsed.data;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.name || !args.ownerName || !args.ownerEmail) {
    console.error("--name, --owner-name, and --owner-email are all required.");
    usage();
  }

  const slug = resolveSlug(args);
  const ownerPassword = await resolvePassword();

  const result = await bootstrapOrganization({
    organizationName: args.name,
    slug,
    ownerName: args.ownerName,
    ownerEmail: args.ownerEmail,
    ownerPassword,
  });

  // Everything here is safe to appear in a deployment log. The password is
  // not among it, by construction.
  console.log("");
  console.log(`Created organization "${args.name}"`);
  console.log(`  slug          ${result.organizationSlug}`);
  console.log(`  organization  ${result.organizationId}`);
  console.log(`  owner         ${args.ownerEmail} (${result.ownerDisplayId})`);
  console.log("");
  console.log("Sign in with that address and the password you just set.");

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  // A BootstrapError is a condition the operator can fix — a taken slug, an
  // address already in use — so it prints as a sentence. Anything else is a
  // bug or an outage and prints in full.
  if (error instanceof BootstrapError) {
    console.error(`\n${error.message}`);
  } else {
    console.error(error);
  }
  await prisma.$disconnect();
  process.exit(1);
});
