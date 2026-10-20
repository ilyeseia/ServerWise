"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { logCommunicationAction } from "@/app/[locale]/(app)/customers/actions";
import { Alert, Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { COMMUNICATION_CHANNELS } from "@/modules/crm/schemas";
import type { CommunicationRow, LeadOption } from "./types";
import { useErrorText } from "./use-error-text";

export function CommunicationsPanel({
  customerId,
  leadId,
  leadOptions = [],
  items,
  canWrite,
}: {
  customerId: string;
  /** Fixed lead (on a lead page). Otherwise the user may pick one of `leadOptions`. */
  leadId?: string;
  leadOptions?: LeadOption[];
  items: CommunicationRow[];
  canWrite: boolean;
}) {
  const t = useTranslations("Crm.communications");
  const tChannel = useTranslations("Crm.channel");
  const tDir = useTranslations("Crm.direction");
  const tc = useTranslations("Common");
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    channel: "call",
    direction: "outbound",
    occurredAt: "",
    summary: "",
    leadId: leadId ?? "",
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    // Empty "when" means "now" (avoids a server/browser clock mismatch in the initial value).
    const when = form.occurredAt ? new Date(form.occurredAt) : new Date();
    startTransition(async () => {
      const result = await logCommunicationAction({
        customerId,
        leadId: form.leadId || undefined,
        channel: form.channel as (typeof COMMUNICATION_CHANNELS)[number],
        direction: form.direction as "inbound" | "outbound",
        occurredAt: when.toISOString(),
        summary: form.summary,
      });
      if (result.ok) {
        setForm({ ...form, occurredAt: "", summary: "" });
        setOpen(false);
      } else setError(errorText(result.code));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {canWrite ? (
        open ? (
          <form
            onSubmit={submit}
            className="flex max-w-xl flex-col gap-3 rounded-md border border-border p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="comm-channel" label={t("channel")}>
                <Select
                  id="comm-channel"
                  value={form.channel}
                  onChange={(e) => setForm({ ...form, channel: e.target.value })}
                >
                  {COMMUNICATION_CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {tChannel(c)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="comm-direction" label={t("direction")}>
                <Select
                  id="comm-direction"
                  value={form.direction}
                  onChange={(e) => setForm({ ...form, direction: e.target.value })}
                >
                  <option value="outbound">{tDir("outbound")}</option>
                  <option value="inbound">{tDir("inbound")}</option>
                </Select>
              </Field>
            </div>
            <Field id="comm-when" label={t("when")} hint={t("whenHint")}>
              <Input
                id="comm-when"
                type="datetime-local"
                dir="ltr"
                value={form.occurredAt}
                onChange={(e) => setForm({ ...form, occurredAt: e.target.value })}
              />
            </Field>
            {!leadId && leadOptions.length > 0 ? (
              <Field id="comm-lead" label={t("lead")}>
                <Select
                  id="comm-lead"
                  value={form.leadId}
                  onChange={(e) => setForm({ ...form, leadId: e.target.value })}
                >
                  <option value="">—</option>
                  {leadOptions.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field id="comm-summary" label={t("summary")}>
              <Textarea
                id="comm-summary"
                required
                minLength={2}
                maxLength={2000}
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
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
              {t("log")}
            </Button>
          </div>
        )
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {items.map((c) => (
            <li key={c.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge>{tChannel(c.channel as (typeof COMMUNICATION_CHANNELS)[number])}</Badge>
                <Badge tone={c.direction === "inbound" ? "success" : "neutral"}>
                  {tDir(c.direction)}
                </Badge>
                <time dir="ltr" className="text-muted-foreground">
                  {c.whenLabel}
                </time>
                {c.authorName ? (
                  <span className="text-muted-foreground">· {t("by", { name: c.authorName })}</span>
                ) : null}
                {!leadId && c.leadId && c.leadTitle ? (
                  <Link href={`/leads/${c.leadId}`} className="text-primary hover:underline">
                    {c.leadTitle}
                  </Link>
                ) : null}
              </div>
              <p className="mt-2 text-sm whitespace-pre-wrap">{c.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
