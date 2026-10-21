import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/alert";
import type {
  BackupOutcome,
  BackupStatus,
  Health,
  RecoveryDocState,
  RemotePlanStatus,
  RestoreOutcome,
  RestoreStatus,
} from "@/modules/backups/rules";

export function HealthBadge({ health }: { health: Health }) {
  const t = useTranslations("Backups.health");
  const tone = health === "critical" ? "danger" : health === "ok" ? "success" : "neutral";
  return <Badge tone={tone}>{t(health)}</Badge>;
}

export function BackupStatusBadge({ status }: { status: BackupStatus }) {
  const t = useTranslations("Backups.backupStatus");
  const tone = status === "failed" ? "danger" : status === "ok" ? "success" : "neutral";
  return <Badge tone={tone}>{t(status)}</Badge>;
}

export function RestoreStatusBadge({ status }: { status: RestoreStatus }) {
  const t = useTranslations("Backups.restoreStatus");
  const tone = status === "failed" ? "danger" : status === "ok" ? "success" : "neutral";
  return <Badge tone={tone}>{t(status)}</Badge>;
}

export function DocStateBadge({ state }: { state: RecoveryDocState }) {
  const t = useTranslations("Backups.docState");
  const tone = state === "ok" ? "success" : "neutral";
  return <Badge tone={tone}>{t(state)}</Badge>;
}

export function OutcomeBadge({ outcome }: { outcome: BackupOutcome | RestoreOutcome }) {
  const t = useTranslations("Backups.outcome");
  const tone = outcome === "success" ? "success" : outcome === "failed" ? "danger" : "neutral";
  return <Badge tone={tone}>{t(outcome)}</Badge>;
}

export function PlanStatusBadge({ status }: { status: RemotePlanStatus }) {
  const t = useTranslations("Remote.status");
  const tone = status === "approved" ? "success" : "neutral";
  return <Badge tone={tone}>{t(status)}</Badge>;
}
