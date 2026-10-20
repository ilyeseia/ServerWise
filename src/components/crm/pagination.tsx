import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Server-side pagination that keeps the other filters in the query string. */
export function Pagination({
  pathname,
  params,
  page,
  pageSize,
  total,
}: {
  pathname: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const t = useTranslations("Crm.common");
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const href = (target: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    if (target > 1) query.set("page", String(target));
    const qs = query.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <nav
      aria-label={t("pageOf", { page, pages })}
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-muted-foreground">
        {t("total", { count: total })} · {t("pageOf", { page, pages })}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={href(page - 1)}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            {t("previous")}
          </Link>
        ) : null}
        {page < pages ? (
          <Link
            href={href(page + 1)}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            {t("next")}
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
