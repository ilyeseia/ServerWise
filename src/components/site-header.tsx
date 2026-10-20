import { Server } from "lucide-react";
import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Link } from "@/i18n/navigation";
import { can, type Permission, type Role } from "@/server/authz/permissions";

export interface HeaderUser {
  name: string;
  role: Role;
}

type NavKey = "dashboard" | "customers" | "leads" | "followUps" | "users" | "audit" | "settings";

const NAV: {
  href: "/dashboard" | "/customers" | "/leads" | "/follow-ups" | "/users" | "/audit" | "/settings";
  key: NavKey;
  permission: Permission;
}[] = [
  { href: "/dashboard", key: "dashboard", permission: "dashboard:view" },
  { href: "/customers", key: "customers", permission: "crm:read" },
  { href: "/leads", key: "leads", permission: "crm:read" },
  { href: "/follow-ups", key: "followUps", permission: "crm:read" },
  { href: "/users", key: "users", permission: "user:read" },
  { href: "/audit", key: "audit", permission: "audit:read" },
  { href: "/settings", key: "settings", permission: "settings:read" },
];

/**
 * `gated` is true while the user must still change a temporary password or enrol 2FA: the app
 * pages would redirect anyway, so we only show account actions.
 */
export function SiteHeader({ user, gated = false }: { user: HeaderUser | null; gated?: boolean }) {
  const t = useTranslations("Common");
  const tn = useTranslations("Nav");
  const th = useTranslations("Header");
  const tr = useTranslations("Roles");

  const items = user && !gated ? NAV.filter((i) => can(user.role, i.permission)) : [];

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-6">
          <Link
            href={user ? "/dashboard" : "/login"}
            className="flex items-center gap-2 font-semibold"
          >
            <Server aria-hidden="true" className="size-5 text-primary" />
            <span>{t("appName")}</span>
          </Link>
          {items.length > 0 ? (
            <nav aria-label={th("mainNav")}>
              <ul className="flex flex-wrap items-center gap-4 text-sm">
                {items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="font-medium hover:text-primary">
                      {tn(item.key)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <LocaleSwitcher />
          <ThemeToggle />
          {user ? (
            <>
              <Link href="/account" className="text-sm font-medium hover:underline">
                {th("account")}
                <span className="ms-2 text-xs text-muted-foreground">({tr(user.role)})</span>
              </Link>
              <SignOutButton />
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
