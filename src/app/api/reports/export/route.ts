import { getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/routing";
import { actionContext } from "@/server/actions";
import { getCurrentSession } from "@/server/auth/current";
import { accessGate } from "@/server/auth/session";
import { ForbiddenError, UnauthorizedError } from "@/server/authz/guard";
import { isOwner2faRequired } from "@/server/config/env";
import { exportReport, isExportSection } from "@/modules/reports/service";
import { parseRange } from "@/modules/reports/rules";
import { logger } from "@/server/logging/logger";

export const dynamic = "force-dynamic";

const json = (status: number, code: string) =>
  Response.json({ error: code }, { status, headers: { "cache-control": "no-store" } });

/**
 * GET /api/reports/export?section=tickets&range=90d&locale=fr  ->  a CSV file.
 * Same rules as the pages: signed in, access gate passed, `report:export` held. The permission is
 * checked again inside the service, and every export is written to the audit log.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const section = params.get("section");
  if (!isExportSection(section)) return json(400, "UNKNOWN_SECTION");
  const range = parseRange(params.get("range"));
  const localeParam = params.get("locale");
  const locale = localeParam && isLocale(localeParam) ? localeParam : "ar";

  const session = await getCurrentSession();
  if (!session) return json(401, "UNAUTHORIZED");
  if (accessGate(session, { require2faForOwner: isOwner2faRequired() }) !== "ok") {
    return json(403, "FORBIDDEN");
  }

  try {
    const t = await getTranslations({ locale, namespace: "Reports.csv" });
    const label = (s: string, column: string) =>
      (t as unknown as (key: string) => string)(`${s}.${column}`);
    const result = await exportReport(await actionContext(), section, { range }, label);
    return new Response(result.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${result.filename}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return json(401, "UNAUTHORIZED");
    if (error instanceof ForbiddenError) return json(403, "FORBIDDEN");
    logger.error(
      { errorName: error instanceof Error ? error.name : typeof error },
      "report export failed",
    );
    return json(500, "UNKNOWN");
  }
}
