import { getTranslations, setRequestLocale } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { getPricing } from "@/modules/quotes/pricing";
import { getCompanySettings } from "@/modules/settings/service";
import { actionContext } from "@/server/actions";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";
import { PricingForm } from "./pricing-form";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function SettingsPage({ params }: Props) {
  setRequestLocale(resolveLocale((await params).locale));

  const session = await requirePagePermission("settings:read");
  const [t, tp, company, pricing] = await Promise.all([
    getTranslations("Settings"),
    getTranslations("Pricing"),
    getCompanySettings(session.actor),
    getPricing(await actionContext()),
  ]);

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      <SettingsForm initial={company} canEdit={can(session.actor.role, "settings:update")} />
      <h2 className="mt-4 text-xl font-bold">{tp("title")}</h2>
      <PricingForm initial={pricing} canEdit={can(session.actor.role, "settings:update")} />
    </div>
  );
}
