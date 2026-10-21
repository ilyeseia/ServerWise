import { getTranslations, setRequestLocale } from "next-intl/server";
import { ProjectStatusBadge } from "@/components/projects/badges";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { isProjectClosed } from "@/modules/projects/rules";
import { getProject, listProjectStaff } from "@/modules/projects/service";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";
import { AiAssist } from "@/components/ai/ai-assist";
import { canRunTool } from "@/modules/ai/tools";
import { ProjectPanel } from "./project-panel";
import { TasksBoard } from "./tasks-board";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

export default async function ProjectPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(resolveLocale(locale));
  const session = await requirePagePermission("project:read");
  const ctx = await actionContext();
  const role = session.actor.role;

  const [project, staff, t, format] = await Promise.all([
    orNotFound(getProject(ctx, id)),
    listProjectStaff(ctx),
    getTranslations("Projects"),
    getAppFormatter(),
  ]);
  const tAi = await getTranslations("Ai");

  const closed = isProjectClosed(project.status);
  const canManage = can(role, "project:manage");
  const canWrite = can(role, "project:write");

  return (
    <div className="flex flex-col gap-6">
      <Link href="/projects" className="text-sm text-primary hover:underline">
        ← {t("title")}
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">
          <span dir="ltr">{project.number}</span> — {project.title}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <ProjectStatusBadge status={project.status} />
          <Link href={`/customers/${project.lead.customer.id}`} className="hover:underline">
            {project.lead.customer.name}
          </Link>
          <Link href={`/quotes/${project.quote.id}`} className="text-primary hover:underline">
            {t("fromQuote", { number: project.quote.number })}
          </Link>
          <Link href={`/leads/${project.lead.id}`} className="text-primary hover:underline">
            {project.lead.title}
          </Link>
        </div>
        <div className="flex max-w-md items-center gap-3 text-sm">
          <div
            role="progressbar"
            aria-label={t("progress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={project.progress.percent}
            className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full bg-primary" style={{ width: `${project.progress.percent}%` }} />
          </div>
          <span dir="ltr" className="whitespace-nowrap text-muted-foreground">
            {format.number(project.progress.done)} / {format.number(project.progress.total)}
          </span>
        </div>
        {project.completedAt ? (
          <p className="text-xs text-muted-foreground">
            {t("completedOn", {
              date: format.dateTime(project.completedAt, { dateStyle: "medium" }),
            })}
          </p>
        ) : null}
        {project.cancelReason ? (
          <p className="text-sm text-danger">
            {t("cancelledBecause")}: {project.cancelReason}
          </p>
        ) : null}
      </header>

      {project.status === "on_hold" ? <Alert>{t("onHoldNotice")}</Alert> : null}
      {closed ? <Alert>{t("closedNotice")}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("planAndStatus")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectPanel
            // Remount after a server-side change so the form shows the stored values.
            key={`${project.status}-${project.handoverAt?.toISOString() ?? "none"}`}
            projectId={project.id}
            status={project.status}
            title={project.title}
            managerId={project.managerId}
            startDate={day(project.startDate) ?? ""}
            targetDate={day(project.targetDate) ?? ""}
            rollbackPlan={project.rollbackPlan ?? ""}
            handoverNotes={project.handoverNotes}
            staff={staff}
            canManage={canManage}
            nextStatuses={[...project.nextStatuses]}
            blockers={project.blockersFor}
            closed={closed}
          />
        </CardContent>
      </Card>

      {canRunTool(role, "draft_handover_notes") && !closed ? (
        <Card>
          <CardHeader>
            <CardTitle>{tAi("title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{tAi("handoverHint")}</p>
          </CardHeader>
          <CardContent>
            <AiAssist
              tool="draft_handover_notes"
              input={{ projectId: project.id }}
              label={tAi("draftHandover")}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("work")}</CardTitle>
        </CardHeader>
        <CardContent>
          <TasksBoard
            projectId={project.id}
            staff={staff}
            editable={canWrite && !closed}
            milestones={project.milestones.map((m) => ({
              id: m.id,
              title: m.title,
              dueDate: day(m.dueDate),
              done: m.doneAt !== null,
            }))}
            tasks={project.tasks.map((task) => ({
              id: task.id,
              kind: task.kind,
              title: task.title,
              description: task.description,
              status: task.status,
              assigneeId: task.assigneeId,
              assigneeName: task.assigneeName,
              milestoneId: task.milestoneId,
              dueDate: day(task.dueDate),
              dependsOn: task.dependsOn,
              checklist: task.checklist.map(({ id: itemId, text, done }) => ({
                id: itemId,
                text,
                done,
              })),
              blockers: task.blockers,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
