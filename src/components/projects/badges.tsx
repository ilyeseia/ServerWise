import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/alert";
import type { ProjectStatus, TaskStatus } from "@/modules/projects/rules";

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const t = useTranslations("Projects.status");
  const tone = status === "completed" ? "success" : status === "cancelled" ? "danger" : "neutral";
  return <Badge tone={tone}>{t(status)}</Badge>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const t = useTranslations("Projects.taskStatus");
  const tone = status === "done" ? "success" : status === "blocked" ? "danger" : "neutral";
  return <Badge tone={tone}>{t(status)}</Badge>;
}
