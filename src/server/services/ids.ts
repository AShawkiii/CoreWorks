import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { formatDisplayId, type IdEntity } from "@/lib/domain/ids";

/**
 * Display-ID allocation.
 *
 * Legacy generated IDs by reading every existing row, finding the highest
 * suffix, and adding one (audit §4). That is correct under Apps Script's
 * single-threaded execution but races under a concurrent web backend: two
 * simultaneous creates read the same maximum and mint the same ID
 * (audit defect D3).
 *
 * The format is unchanged; only the mechanism differs. A single atomic
 * `UPDATE ... RETURNING` per allocation makes concurrent callers serialize on
 * the counter row, so two requests can never receive the same value.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Allocates the next display ID for an entity within an organization.
 *
 * Pass the surrounding transaction when creating a record, so a rolled-back
 * create does not leave the counter advanced.
 */
export async function nextDisplayId(
  organizationId: string,
  entity: IdEntity,
  db: Db = prisma,
): Promise<string> {
  const record = await db.idSequence.upsert({
    where: { organizationId_entity: { organizationId, entity } },
    create: { organizationId, entity, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
    select: { lastValue: true },
  });

  return formatDisplayId(entity, record.lastValue);
}

/**
 * Raises a counter's floor without ever lowering it.
 *
 * Used after a CSV import so newly created records continue the imported
 * series instead of colliding with it (migration-plan §3.5). Safe to call with
 * a value below the current one — it is a no-op in that case.
 */
export async function ensureSequenceAtLeast(
  organizationId: string,
  entity: IdEntity,
  minimum: number,
  db: Db = prisma,
): Promise<void> {
  if (!Number.isSafeInteger(minimum) || minimum < 0) {
    throw new Error(
      `ensureSequenceAtLeast(): invalid minimum ${String(minimum)}`,
    );
  }

  const existing = await db.idSequence.findUnique({
    where: { organizationId_entity: { organizationId, entity } },
    select: { lastValue: true },
  });

  if (!existing) {
    await db.idSequence.create({
      data: { organizationId, entity, lastValue: minimum },
    });
    return;
  }

  if (existing.lastValue >= minimum) return;

  await db.idSequence.update({
    where: { organizationId_entity: { organizationId, entity } },
    data: { lastValue: minimum },
  });
}
