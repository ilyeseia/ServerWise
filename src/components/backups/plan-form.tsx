"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  approvePlanAction,
  createPlanAction,
  retirePlanAction,
  updatePlanAction,
} from "@/app/[locale]/(app)/backup-actions";
import { useAction } from "@/components/projects/use-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { SAFEGUARDS, TAILNET_OWNERS, type Safeguard } from "@/modules/backups/rules";
import type { PlanFormValues } from "./policy-values";

interface Props {
  planId?: string;
  initial: PlanFormValues;
  customers: { id: string; name: string }[];
  customerLocked: boolean;
  /** A plan that is not a draft is shown but cannot be edited. */
  readOnly: boolean;
}

/** The plan's text and safeguards. Safeguards default to "in place": opting out needs a reason. */
export function PlanForm({ planId, initial, customers, customerLocked, readOnly }: Props) {
  const t = useTranslations("Remote");
  const tSafe = useTranslations("Remote.safeguard");
  const tOwner = useTranslations("Remote.owner");
  const tc = useTranslations("Common");
  const router = useRouter();
  const action = useAction();
  const [v, setV] = useState(initial);
  const set = <K extends keyof PlanFormValues>(key: K, value: PlanFormValues[K]) =>
    setV((current) => ({ ...current, [key]: value }));
  const departs =
    v.tailnetOwner !== "customer" || SAFEGUARDS.some((s) => !v[s as Safeguard & keyof PlanFormValues]);

  return (
    <form
      className="flex max-w-3xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        action.run(async () => {
          if (planId) return updatePlanAction(planId, v);
          const result = await createPlanAction(v);
          if (result.ok) router.push(`/remote/${result.id}`);
          return result;
        });
      }}
    >
      {action.error ? <Alert variant="danger">{action.error}</Alert> : null}
      <Alert>{t("documentationOnly")}</Alert>
      <Field id="plan-customer" label={t("customer")}>
        <Select
          id="plan-customer"
          required
          value={v.customerId}
          disabled={customerLocked}
          onChange={(e) => set("customerId", e.target.value)}
        >
          <option value="">{t("chooseCustomer")}</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="plan-title" label={t("titleLabel")}>
        <Input
          id="plan-title"
          required
          maxLength={200}
          value={v.title}
          disabled={readOnly}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>
      <Field id="plan-owner" label={t("tailnetOwner")} hint={t("tailnetOwnerHint")}>
        <Select
          id="plan-owner"
          value={v.tailnetOwner}
          disabled={readOnly}
          onChange={(e) => set("tailnetOwner", e.target.value as PlanFormValues["tailnetOwner"])}
        >
          {TAILNET_OWNERS.map((o) => (
            <option key={o} value={o}>
              {tOwner(o)}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="plan-devices" label={t("devices")}>
        <Textarea
          id="plan-devices"
          maxLength={2000}
          value={v.devices}
          disabled={readOnly}
          onChange={(e) => set("devices", e.target.value)}
        />
      </Field>
      <Field id="plan-acl" label={t("aclNotes")} hint={t("aclHint")}>
        <Textarea
          id="plan-acl"
          maxLength={4000}
          className="min-h-32"
          value={v.aclNotes}
          disabled={readOnly}
          onChange={(e) => set("aclNotes", e.target.value)}
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t("safeguards")}</legend>
        {SAFEGUARDS.map((s) => (
          <label key={s} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={v[s]}
              disabled={readOnly}
              onChange={(e) => set(s, e.target.checked)}
            />
            {tSafe(s)}
          </label>
        ))}
      </fieldset>
      <Field
        id="plan-exceptions"
        label={t("exceptions")}
        hint={departs && !v.exceptions.trim() ? t("exceptionsNeeded") : t("exceptionsHint")}
      >
        <Textarea
          id="plan-exceptions"
          maxLength={2000}
          value={v.exceptions}
          disabled={readOnly}
          onChange={(e) => set("exceptions", e.target.value)}
        />
      </Field>
      {!readOnly ? (
        <div>
          <Button type="submit" disabled={action.pending || !v.customerId || !v.title.trim()}>
            {tc("save")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

/** Approve (owner) and retire. Approved plans are replaced, not edited. */
export function PlanControls({
  planId,
  status,
  canApprove,
  canRetire,
  approvable,
}: {
  planId: string;
  status: "draft" | "approved" | "retired";
  canApprove: boolean;
  canRetire: boolean;
  approvable: boolean;
}) {
  const t = useTranslations("Remote");
  const approve = useAction();
  const retire = useAction();
  return (
    <div className="flex flex-col gap-3">
      {approve.error ? <Alert variant="danger">{approve.error}</Alert> : null}
      {retire.error ? <Alert variant="danger">{retire.error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        {status === "draft" && canApprove ? (
          <Button
            type="button"
            disabled={approve.pending || !approvable}
            onClick={() => approve.run(() => approvePlanAction(planId))}
          >
            {t("approve")}
          </Button>
        ) : null}
        {status !== "retired" && canRetire ? (
          <Button
            type="button"
            variant="outline"
            disabled={retire.pending}
            onClick={() => retire.run(() => retirePlanAction(planId))}
          >
            {t("retire")}
          </Button>
        ) : null}
      </div>
      {status === "draft" && canApprove && !approvable ? (
        <p className="text-xs text-muted-foreground">{t("cannotApproveYet")}</p>
      ) : null}
    </div>
  );
}
