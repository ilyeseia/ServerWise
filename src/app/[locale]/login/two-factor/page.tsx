import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { isLocale } from "@/i18n/routing";
import { TwoFactorForm } from "./two-factor-form";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function TwoFactorPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Auth");
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <h1 className="text-2xl leading-none font-semibold">{t("twoFactorTitle")}</h1>
        </CardHeader>
        <CardContent>
          <TwoFactorForm />
        </CardContent>
      </Card>
    </div>
  );
}
