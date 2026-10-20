import { getTranslations, setRequestLocale } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { getCompanySettings } from "@/modules/settings/service";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function SettingsPage({ params }: Props) {
  setRequestLocale(resolveLocale((await params).locale));

  const session = await requirePagePermission("settings:read");
  const [t, company] = await Promise.all([
    getTranslations("Settings"),
    getCompanySettings(session.actor),
  ]);

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      <SettingsForm initial={company} canEdit={can(session.actor.role, "settings:update")} />
    </div>
  );
}
