"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { createTicketAction } from "@/app/[locale]/(app)/care-actions";
import { useAction } from "@/components/projects/use-action";
import type { StaffVM } from "@/components/projects/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { TICKET_PRIORITIES } from "@/modules/careops/rules";

interface Props {
  customers: { id: string; name: string }[];
  /** The customer whose assets are offered; changing the customer reloads the page. */
  customerId: string;
  assets: { id: string; name: string }[];
  staff: StaffVM[];
}

export function TicketForm({ customers, customerId, assets, staff }: Props) {
  const t = useTranslations("Tickets");
  const tPriority = useTranslations("Tickets.priority");
  const router = useRouter();
  const action = useAction();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assetId, setAssetId] = useState("");
  const [priority, setPriority] = useState<(typeof TICKET_PRIORITIES)[number]>("normal");
  const [assigneeId, setAssigneeId] = useState("");

  return (
    <form
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        action.run(async () => {
          const result = await createTicketAction({
            customerId,
            assetId,
            title,
            description,
            priority,
            assigneeId,
          });
          if (result.ok) router.push(`/tickets/${result.id}`);
          return result;
        });
      }}
    >
      {action.error ? <Alert variant="danger">{action.error}</Alert> : null}
      <Field id="ticket-customer" label={t("customer")}>
        <Select
          id="ticket-customer"
          required
          value={customerId}
          onChange={(e) => router.replace(`/tickets/new?customerId=${e.target.value}`)}
        >
          <option value="">{t("chooseCustomer")}</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="ticket-title" label={t("titleLabel")}>
        <Input
          id="ticket-title"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <Field id="ticket-description" label={t("description")}>
        <Textarea
          id="ticket-description"
          maxLength={4000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="ticket-priority" label={t("priorityLabel")}>
          <Select
            id="ticket-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as typeof priority)}
          >
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {tPriority(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ticket-asset" label={t("asset")}>
          <Select id="ticket-asset" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">{t("noAsset")}</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ticket-assignee" label={t("assignee")}>
          <Select
            id="ticket-assignee"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
          >
            <option value="">{t("unassigned")}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={action.pending || !customerId || !title.trim()}>
          {t("open")}
        </Button>
      </div>
    </form>
  );
}
