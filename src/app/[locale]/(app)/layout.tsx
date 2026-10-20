import { setRequestLocale } from "next-intl/server";
import { redirectTo, resolveLocale } from "@/i18n/locale";
import { getCurrentSession } from "@/server/auth/current";
import { accessGate } from "@/server/auth/session";
import { isOwner2faRequired } from "@/server/config/env";

export const dynamic = "force-dynamic";

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

/**
 * Every page in this group requires a signed-in, active user who has completed the mandatory
 * security steps. The real authorization check still happens in each service.
 */
export default async function AppLayout({ children, params }: Props) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);

  const session = await getCurrentSession();
  if (!session) redirectTo("/login", locale);

  const gate = accessGate(session, { require2faForOwner: isOwner2faRequired() });
  if (gate !== "ok") redirectTo(`/account?required=${gate}`, locale);

  return <>{children}</>;
}
