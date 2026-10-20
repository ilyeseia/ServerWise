import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/alert";
import type { DisplayStatus } from "@/modules/quotes/service";

export function QuoteStatusBadge({ status }: { status: DisplayStatus }) {
  const t = useTranslations("Quotes.status");
  const tone = status === "accepted" ? "success" : status === "rejected" ? "danger" : "neutral";
  return <Badge tone={tone}>{t(status)}</Badge>;
}
