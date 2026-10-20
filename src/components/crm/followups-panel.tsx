"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  cancelFollowUpAction,
  completeFollowUpAction,
  createFollowUpAction,
  reopenFollowUpAction,
} from "@/app/[locale]/(app)/follow-ups/actions";
import { Alert, Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import type { FollowUpRow, PersonOption } from "./types";
import { useErrorText } from "./use-error-text";

export interface FollowUpCreateTarget {
  customerId: string;
  leadId?: string;
  assignees: PersonOption[];
  defaultAssigneeId: string;
}

export function FollowUpsPanel({
  items,
  canWrite,
  showCustomer = false,
  create,
}: {
  items: FollowUpRow[];
  canWrite: boolean;
  showCustomer?: boolean;
  create?: FollowUpCreateTarget;
}) {
  const t = useTranslations("Crm.followUps");
  const tc = useTranslations("Common");
  const errorText = useErrorText();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    dueAt: "",
    assignedToId: create?.defaultAssigneeId ?? "",
    notes: "",
  });

  function act(action: () => Promise<{ ok: boolean; code?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(errorText(result.code ?? "UNKNOWN"));
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!create) return;
    setError(null);
    const due = new Date(form.dueAt);
    if (!form.dueAt || Number.isNaN(due.getTime())) {
      setError(t("dueAtRequired"));
      return;
    }
    startTransition(async () => {
      const result = await createFollowUpAction({
        customerId: create.customerId,
        leadId: create.leadId,
        title: form.title,
        dueAt: due.toISOString(),
        assignedToId: form.assignedToId,
        notes: form.notes,
      });
      if (result.ok) {
        setForm({ title: "", dueAt: "", assignedToId: create.defaultAssigneeId, notes: "" });
        setOpen(false);
      } else setError(errorText(result.code));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t("table")}>
          {items.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {f.title}
                  {f.overdue ? <Badge tone="danger">{t("overdue")}</Badge> : null}
                  {f.status !== "open" ? <Badge>{t(f.status)}</Badge> : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("due")}: <time dir="ltr">{f.dueLabel}</time>
                  {f.assignedToName ? ` · ${t("assignedTo")}: ${f.assignedToName}` : ""}
                </span>
                {showCustomer ? (
                  <span className="text-xs">
                    {t("customer")}:{" "}
                    <Link
                      href={`/customers/${f.customerId}`}
                      className="text-primary hover:underline"
                    >
                      {f.customerName}
                    </Link>
                    {f.leadId && f.leadTitle ? (
                      <>
                        {" · "}
                        <Link href={`/leads/${f.leadId}`} className="text-primary hover:underline">
                          {f.leadTitle}
                        </Link>
                      </>
                    ) : null}
                  </span>
                ) : null}
                {f.notes ? <span className="text-sm">{f.notes}</span> : null}
              </div>
              {canWrite ? (
                <div className="flex flex-wrap gap-2">
                  {f.status === "open" ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        disabled={pending}
                        onClick={() => act(() => completeFollowUpAction(f.id))}
                      >
                        {t("complete")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => act(() => cancelFollowUpAction(f.id))}
                      >
                        {t("cancel")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => act(() => reopenFollowUpAction(f.id))}
                    >
                      {t("reopen")}
                    </Button>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite && create ? (
        open ? (
          <form
            onSubmit={submit}
            noValidate
            className="flex max-w-xl flex-col gap-3 rounded-md border border-border p-4"
          >
            <Field id="fu-title" label={t("titleField")}>
              <Input
                id="fu-title"
                required
                minLength={2}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="fu-due" label={t("due")}>
                <Input
                  id="fu-due"
                  type="datetime-local"
                  dir="ltr"
                  value={form.dueAt}
                  onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
                />
              </Field>
              <Field id="fu-assignee" label={t("assignedTo")}>
                <Select
                  id="fu-assignee"
                  value={form.assignedToId}
                  onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}
                >
                  {create.assignees.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field id="fu-notes" label={t("notes")}>
              <Textarea
                id="fu-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {tc("save")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {tc("cancel")}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
              {t("add")}
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}
