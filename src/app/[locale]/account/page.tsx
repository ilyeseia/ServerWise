import { getTranslations, setRequestLocale } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { redirectTo, resolveLocale } from "@/i18n/locale";
import { getCurrentSession } from "@/server/auth/current";
import { AccountSecurity } from "./account-security";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ required?: string }>;
};

/** Reachable even while the access gate is active: this is where the user fixes it. */
export default async function AccountPage({ params, searchParams }: Props) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);

  const session = await getCurrentSession();
  if (!session) redirectTo("/login", locale);

  const { required } = await searchParams;
  const t = await getTranslations("Account");

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {session.mustChangePassword || required === "change-password" ? (
        <Alert variant="danger">{t("mustChangeNotice")}</Alert>
      ) : null}
      {required === "enroll-2fa" && !session.twoFactorEnabled ? (
        <Alert variant="danger">{t("required2faNotice")}</Alert>
      ) : null}

      <AccountSecurity twoFactorEnabled={session.twoFactorEnabled} />
    </div>
  );
}
