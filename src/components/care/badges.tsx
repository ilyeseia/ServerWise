import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/alert";
import type {
  ContractState,
  RenewalState,
  ScheduleState,
  TicketPriority,
  TicketStatus,
} from "@/modules/careops/rules";

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const t = useTranslations("Tickets.status");
  const tone = status === "resolved" || status === "closed" ? "success" : "neutral";
  return <Badge tone={tone}>{t(status)}</Badge>;
}

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  const t = useTranslations("Tickets.priority");
  const tone = priority === "urgent" || priority === "high" ? "danger" : "neutral";
  return <Badge tone={tone}>{t(priority)}</Badge>;
}

export function ContractStateBadge({ state }: { state: ContractState }) {
  const t = useTranslations("Maintenance.contractState");
  const tone = state === "active" ? "success" : state === "cancelled" ? "danger" : "neutral";
  return <Badge tone={tone}>{t(state)}</Badge>;
}

export function ScheduleStateBadge({ state }: { state: ScheduleState }) {
  const t = useTranslations("Maintenance.scheduleState");
  const tone = state === "overdue" ? "danger" : "neutral";
  return <Badge tone={tone}>{t(state)}</Badge>;
}

/** Warranty / subscription cover. "unknown" is shown as such, never guessed. */
export function RenewalBadge({ state }: { state: RenewalState }) {
  const t = useTranslations("Assets.renewal");
  const tone = state === "expired" ? "danger" : state === "ok" ? "success" : "neutral";
  return <Badge tone={tone}>{t(state)}</Badge>;
}
