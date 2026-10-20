import { z } from "zod";
import { assertCan, type Actor } from "@/server/authz/guard";
import { getDb } from "@/server/db/client";

export const COMPANY_KEY = "company";

export const companySchema = z.object({
  name: z.string().trim().max(120),
  phone: z.string().trim().max(40),
  address: z.string().trim().max(300),
});
export type CompanySettings = z.infer<typeof companySchema>;

export const DEFAULT_COMPANY: CompanySettings = { name: "", phone: "", address: "" };

export async function getCompanySettings(
  actor: Actor | null | undefined,
): Promise<CompanySettings> {
  assertCan(actor, "settings:read");
  const row = await getDb().appSetting.findUnique({ where: { key: COMPANY_KEY } });
  const parsed = companySchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_COMPANY;
}

/** Validates, stores and audits in one transaction: a setting never changes without a trail. */
export async function updateCompanySettings(
  actor: Actor | null | undefined,
  input: unknown,
  client: { ip?: string | null; userAgent?: string | null } = {},
): Promise<CompanySettings> {
  assertCan(actor, "settings:update");
  const next = companySchema.parse(input);
  const db = getDb();

  const before = await getCompanySettings(actor);
  const changed = (Object.keys(next) as (keyof CompanySettings)[]).filter(
    (k) => next[k] !== before[k],
  );

  await db.$transaction([
    db.appSetting.upsert({
      where: { key: COMPANY_KEY },
      create: { key: COMPANY_KEY, value: next },
      update: { value: next },
    }),
    db.auditLog.create({
      data: {
        action: "settings.updated",
        actorId: actor.id,
        actorEmail: actor.email,
        entityType: "setting",
        entityId: COMPANY_KEY,
        ip: client.ip ?? null,
        userAgent: client.userAgent ?? null,
        metadata: { changed },
      },
    }),
  ]);
  return next;
}
