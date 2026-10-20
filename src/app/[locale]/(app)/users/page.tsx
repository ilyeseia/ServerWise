import { setRequestLocale } from "next-intl/server";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { listUsers } from "@/modules/users/service";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";
import { headers } from "next/headers";
import { UsersManager } from "./users-manager";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function UsersPage({ params }: Props) {
  setRequestLocale(resolveLocale((await params).locale));

  const session = await requirePagePermission("user:read");
  const [users, format] = await Promise.all([
    listUsers({ actor: session.actor, headers: await headers() }),
    getAppFormatter(),
  ]);

  const rows = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    banned: u.banned,
    twoFactorEnabled: u.twoFactorEnabled,
    mustChangePassword: u.mustChangePassword,
    locked: u.lockedUntil !== null && u.lockedUntil > new Date(),
    created: format.dateTime(u.createdAt, { dateStyle: "medium" }),
  }));

  return (
    <UsersManager
      users={rows}
      currentUserId={session.actor.id}
      canManage={can(session.actor.role, "user:manage")}
    />
  );
}
