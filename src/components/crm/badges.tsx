import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/alert";
import type { LeadStatus } from "@/modules/crm/lead-status";

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const t = useTranslations("Crm.leadStatus");
  const tone = status === "won" ? "success" : status === "lost" ? "danger" : "neutral";
  return <Badge tone={tone}>{t(status)}</Badge>;
}

export function CustomerStatusBadge({ status }: { status: "prospect" | "active" | "archived" }) {
  const t = useTranslations("Crm.customerStatus");
  return <Badge tone={status === "active" ? "success" : "neutral"}>{t(status)}</Badge>;
}
