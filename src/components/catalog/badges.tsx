import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/alert";
import type { OfferState } from "@/modules/catalog/freshness";

export function OfferStateBadge({ state }: { state: OfferState }) {
  const t = useTranslations("Catalog.offer.states");
  const tone =
    state === "fresh"
      ? "success"
      : state === "expired" || state === "rejected"
        ? "danger"
        : "neutral";
  return <Badge tone={tone}>{t(state)}</Badge>;
}
