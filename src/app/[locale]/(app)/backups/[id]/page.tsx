import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  BackupStatusBadge,
  DocStateBadge,
  HealthBadge,
  OutcomeBadge,
  RestoreStatusBadge,
} from "@/components/backups/badges";
import {
  RecordBackup,
  RecordRestoreTest,
  RecoveryEditor,
} from "@/components/backups/policy-controls";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { getAppFormatter } from "@/i18n/format";
import { resolveLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { getPolicy } from "@/modules/backups/service";
import { actionContext } from "@/server/actions";
import { orNotFound, requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/authz/permissions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function PolicyPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(resolveLocale(locale));
  const session = await requirePagePermission("backup:read");
  const role = session.actor.role;
  const [policy, t, tKind, format] = await Promise.all([
    orNotFound(getPolicy(await actionContext(), id)),
    getTranslations("Backups"),
    getTranslations("Backups.kind"),
    getAppFormatter(),
  ]);
  const day = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "medium" }) : t("never"));
  const yesNo = (v: boolean | null) => (v === null ? t("unknown") : v ? t("yes") : t("no"));
  const canWrite = can(role, "backup:write");
  const canRecord = can(role, "backup:record") && policy.active;

  const facts: [string, React.ReactNode][] = [
    [t("kindLabel"), tKind(policy.kind as "files")],
    [
      t("frequencyDays"),
      <span key="f" dir="ltr">
        {policy.frequencyDays}
      </span>,
    ],
    [
      t("retentionDays"),
      <span key="r" dir="ltr">
        {policy.retentionDays ?? t("unknown")}
      </span>,
    ],
    [t("destination"), policy.destination],
    [t("encrypted"), yesNo(policy.encrypted)],
    [t("offsite"), yesNo(policy.offsite)],
    [t("keyRef"), policy.encryptionKeyRef ?? t("unknown")],
    [
      t("restoreEveryDays"),
      <span key="e" dir="ltr">
        {policy.restoreTestEveryDays}
      </span>,
    ],
    [t("lastSuccess"), day(policy.lastSuccessAt)],
    [t("nextExpected"), policy.nextExpected ? day(policy.nextExpected) : "—"],
    [t("lastRestore"), day(policy.lastRestoreSuccessAt)],
  ];

  return (
    <div className="flex flex-col gap-6">
      <Link href="/backups" className="text-sm text-primary hover:underline">
        ← {t("title")}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">{policy.name}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <HealthBadge health={policy.health} />
            <BackupStatusBadge status={policy.backup} />
            <RestoreStatusBadge status={policy.restore} />
            <Link href={`/customers/${policy.customer.id}`} className="hover:underline">
              {policy.customer.name}
            </Link>
            {policy.asset ? (
              <Link href={`/assets/${policy.asset.id}`} className="text-primary hover:underline">
                {policy.asset.name}
              </Link>
            ) : null}
          </div>
        </div>
        {canWrite ? (
          <Link
            href={`/backups/${id}/edit`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("editPolicy")}
          </Link>
        ) : null}
      </header>

      {policy.restore === "never_tested" && policy.active ? (
        <Alert>{t("neverTestedNotice")}</Alert>
      ) : null}
      {policy.restore === "failed" ? (
        <Alert variant="danger">{t("restoreFailedNotice")}</Alert>
      ) : null}
      {policy.backup === "failed" ? (
        <Alert variant="danger">{t("backupFailedNotice")}</Alert>
      ) : null}
      {!policy.active ? <Alert>{t("inactiveNotice")}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("details")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-sm">{value}</dd>
              </div>
            ))}
          </dl>
          {policy.notes ? <p className="mt-4 text-sm whitespace-pre-wrap">{policy.notes}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3">
            {t("recovery")} <DocStateBadge state={policy.recoveryDoc} />
          </CardTitle>
          {policy.recoveryReviewedAt ? (
            <p className="text-xs text-muted-foreground">
              {t("reviewedOn", { date: day(policy.recoveryReviewedAt) })}
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          <RecoveryEditor
            key={`${policy.recoveryProcedure ?? ""}-${policy.recoveryReviewedAt?.toISOString() ?? ""}`}
            policyId={id}
            initial={policy.recoveryProcedure ?? ""}
            canEdit={canWrite}
            hasProcedure={Boolean(policy.recoveryProcedure?.trim())}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("backupRuns")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {canRecord ? <RecordBackup key={policy.records.length} policyId={id} /> : null}
          {policy.records.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noRuns")}</p>
          ) : (
            <Table caption={t("runsTable")}>
              <thead>
                <tr>
                  <Th>{t("ranAt")}</Th>
                  <Th>{t("outcomeLabel")}</Th>
                  <Th>{t("sizeMb")}</Th>
                  <Th>{t("notes")}</Th>
                </tr>
              </thead>
              <tbody>
                {policy.records.map((r) => (
                  <tr key={r.id}>
                    <Td>{day(r.ranAt)}</Td>
                    <Td>
                      <OutcomeBadge outcome={r.outcome} />
                    </Td>
                    <Td dir="ltr">{r.sizeMb === null ? "—" : format.number(r.sizeMb)}</Td>
                    <Td>{r.notes ?? ""}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("restoreTests")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {canRecord ? <RecordRestoreTest key={policy.restoreTests.length} policyId={id} /> : null}
          {policy.restoreTests.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noRestoreTests")}</p>
          ) : (
            <Table caption={t("restoreTable")}>
              <thead>
                <tr>
                  <Th>{t("testedAt")}</Th>
                  <Th>{t("outcomeLabel")}</Th>
                  <Th>{t("durationMinutes")}</Th>
                  <Th>{t("notes")}</Th>
                </tr>
              </thead>
              <tbody>
                {policy.restoreTests.map((r) => (
                  <tr key={r.id}>
                    <Td>{day(r.testedAt)}</Td>
                    <Td>
                      <OutcomeBadge outcome={r.outcome} />
                    </Td>
                    <Td dir="ltr">
                      {r.durationMinutes === null ? "—" : format.number(r.durationMinutes)}
                    </Td>
                    <Td>{r.notes ?? ""}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
