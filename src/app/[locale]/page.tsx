import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { getCurrentSession } from "@/server/auth/current";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

/** Entry point: signed-in users go to the dashboard, everyone else to the login form. */
export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const session = await getCurrentSession();
  redirect({ href: session ? "/dashboard" : "/login", locale });
}
