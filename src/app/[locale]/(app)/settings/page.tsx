import { getTranslations, setRequestLocale } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { describeAiConfig, getAiConfig } from "@/modules/ai/config";
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
  const [t, tp, tAi, company, pricing] = await Promise.all([
    getTranslations("Settings"),
    getTranslations("Pricing"),
    getTranslations("Ai"),
    getCompanySettings(session.actor),
    getPricing(await actionContext()),
  ]);

  const ai = describeAiConfig(getAiConfig());

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      <SettingsForm initial={company} canEdit={can(session.actor.role, "settings:update")} />
      <h2 className="mt-4 text-xl font-bold">{tp("title")}</h2>
      <PricingForm initial={pricing} canEdit={can(session.actor.role, "settings:update")} />
      <h2 className="mt-4 text-xl font-bold">{tAi("settingsTitle")}</h2>
      <section aria-label={tAi("settingsTitle")} className="flex flex-col gap-2 text-sm">
        {ai.enabled ? (
          <>
            <p className="font-medium text-success">{tAi("settingsOn")}</p>
            <p>
              {tAi("settingsProvider")}: <span dir="ltr">{ai.provider}</span> ·{" "}
              {tAi("settingsModel")}: <span dir="ltr">{ai.model}</span> ·{" "}
              {tAi("settingsLimit", { count: ai.dailyLimitPerUser })}
            </p>
          </>
        ) : (
          <>
            <p className="font-medium">{tAi("settingsOff")}</p>
            <p className="text-muted-foreground">{tAi(`settingsReason.${ai.reason}`)}</p>
            {ai.problems.length > 0 ? (
              <p dir="ltr" className="text-muted-foreground">
                {ai.problems.join(", ")}
              </p>
            ) : null}
          </>
        )}
        <p className="text-muted-foreground">{tAi("settingsHelp")}</p>
      </section>
    </div>
  );
}
