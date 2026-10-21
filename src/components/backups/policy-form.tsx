"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { createPolicyAction, updatePolicyAction } from "@/app/[locale]/(app)/backup-actions";
import { useAction } from "@/components/projects/use-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { BACKUP_KINDS } from "@/modules/backups/schemas";
import type { PolicyFormValues } from "./policy-values";

interface Props {
  policyId?: string;
  initial: PolicyFormValues;
  customers: { id: string; name: string }[];
  /** Assets of the chosen customer. */
  assets: { id: string; name: string }[];
  /** An existing policy keeps its customer for life. */
  customerLocked: boolean;
  /** The recovery procedure is kept as is when editing; it has its own editor. */
  recoveryProcedure?: string;
}

export function PolicyForm({
  policyId,
  initial,
  customers,
  assets,
  customerLocked,
  recoveryProcedure,
}: Props) {
  const t = useTranslations("Backups");
  const tKind = useTranslations("Backups.kind");
  const tc = useTranslations("Common");
  const router = useRouter();
  const action = useAction();
  const [v, setV] = useState(initial);
  const set = <K extends keyof PolicyFormValues>(key: K, value: PolicyFormValues[K]) =>
    setV((current) => ({ ...current, [key]: value }));

  return (
    <form
      className="flex max-w-3xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        action.run(async () => {
          const input = { ...v, recoveryProcedure };
          if (policyId) return updatePolicyAction(policyId, input);
          const result = await createPolicyAction(input);
          if (result.ok) router.push(`/backups/${result.id}`);
          return result;
        });
      }}
    >
      {action.error ? <Alert variant="danger">{action.error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="policy-customer" label={t("customer")}>
          <Select
            id="policy-customer"
            required
            value={v.customerId}
            disabled={customerLocked}
            onChange={(e) => router.replace(`/backups/new?customerId=${e.target.value}`)}
          >
            <option value="">{t("chooseCustomer")}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="policy-asset" label={t("asset")}>
          <Select
            id="policy-asset"
            value={v.assetId}
            onChange={(e) => set("assetId", e.target.value)}
          >
            <option value="">{t("noAsset")}</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field id="policy-name" label={t("name")}>
        <Input
          id="policy-name"
          required
          maxLength={200}
          value={v.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="policy-kind" label={t("kindLabel")}>
          <Select
            id="policy-kind"
            value={v.kind}
            onChange={(e) => set("kind", e.target.value as PolicyFormValues["kind"])}
          >
            {BACKUP_KINDS.map((k) => (
              <option key={k} value={k}>
                {tKind(k)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="policy-frequency" label={t("frequencyDays")} hint={t("frequencyHint")}>
          <Input
            id="policy-frequency"
            dir="ltr"
            inputMode="numeric"
            required
            value={v.frequencyDays}
            onChange={(e) => set("frequencyDays", e.target.value)}
          />
        </Field>
        <Field id="policy-retention" label={t("retentionDays")}>
          <Input
            id="policy-retention"
            dir="ltr"
            inputMode="numeric"
            value={v.retentionDays}
            onChange={(e) => set("retentionDays", e.target.value)}
          />
        </Field>
      </div>
      <Field id="policy-destination" label={t("destination")} hint={t("destinationHint")}>
        <Input
          id="policy-destination"
          required
          maxLength={300}
          value={v.destination}
          onChange={(e) => set("destination", e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="policy-encrypted" label={t("encrypted")}>
          <Select
            id="policy-encrypted"
            value={v.encrypted}
            onChange={(e) => set("encrypted", e.target.value)}
          >
            <option value="">{t("unknown")}</option>
            <option value="true">{t("yes")}</option>
            <option value="false">{t("no")}</option>
          </Select>
        </Field>
        <Field id="policy-offsite" label={t("offsite")}>
          <Select
            id="policy-offsite"
            value={v.offsite}
            onChange={(e) => set("offsite", e.target.value)}
          >
            <option value="">{t("unknown")}</option>
            <option value="true">{t("yes")}</option>
            <option value="false">{t("no")}</option>
          </Select>
        </Field>
        <Field id="policy-restore-every" label={t("restoreEveryDays")} hint={t("restoreEveryHint")}>
          <Input
            id="policy-restore-every"
            dir="ltr"
            inputMode="numeric"
            required
            value={v.restoreTestEveryDays}
            onChange={(e) => set("restoreTestEveryDays", e.target.value)}
          />
        </Field>
      </div>
      <Field id="policy-key-ref" label={t("keyRef")} hint={t("keyRefHint")}>
        <Input
          id="policy-key-ref"
          maxLength={300}
          value={v.encryptionKeyRef}
          onChange={(e) => set("encryptionKeyRef", e.target.value)}
        />
      </Field>
      <Field id="policy-notes" label={t("notes")}>
        <Textarea
          id="policy-notes"
          maxLength={1000}
          value={v.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={v.active}
          onChange={(e) => set("active", e.target.checked)}
        />
        {t("active")}
      </label>
      <div>
        <Button
          type="submit"
          disabled={action.pending || !v.customerId || !v.name.trim() || !v.destination.trim()}
        >
          {tc("save")}
        </Button>
      </div>
    </form>
  );
}
