import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { redirect } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { getCurrentSession } from "@/server/auth/current";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function LoginPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  if (await getCurrentSession()) redirect({ href: "/dashboard", locale });

  const t = await getTranslations("Auth");
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <h1 className="text-2xl leading-none font-semibold">{t("loginTitle")}</h1>
          <CardDescription>{t("loginSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
