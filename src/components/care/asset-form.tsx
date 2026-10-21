"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { createAssetAction, updateAssetAction } from "@/app/[locale]/(app)/care-actions";
import { useAction } from "@/components/projects/use-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { ASSET_KINDS, ASSET_STATUSES } from "@/modules/careops/schemas";
import type { AssetFormValues } from "./asset-values";

interface Props {
  assetId?: string;
  initial: AssetFormValues;
  customers: { id: string; name: string }[];
  /** An existing asset keeps its customer for life. */
  customerLocked: boolean;
}

export function AssetForm({ assetId, initial, customers, customerLocked }: Props) {
  const t = useTranslations("Assets");
  const tKind = useTranslations("Assets.kind");
  const tStatus = useTranslations("Assets.status");
  const tc = useTranslations("Common");
  const router = useRouter();
  const action = useAction();
  const [v, setV] = useState(initial);
  const set = <K extends keyof AssetFormValues>(key: K, value: AssetFormValues[K]) =>
    setV((current) => ({ ...current, [key]: value }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    action.run(async () => {
      if (assetId) return updateAssetAction(assetId, v);
      const result = await createAssetAction(v);
      if (result.ok) router.push(`/assets/${result.id}`);
      return result;
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-4">
      {action.error ? <Alert variant="danger">{action.error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="asset-customer" label={t("customer")}>
          <Select
            id="asset-customer"
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
        <Field id="asset-kind" label={t("kindLabel")}>
          <Select
            id="asset-kind"
            value={v.kind}
            onChange={(e) => set("kind", e.target.value as AssetFormValues["kind"])}
          >
            {ASSET_KINDS.map((k) => (
              <option key={k} value={k}>
                {tKind(k)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field id="asset-name" label={t("name")}>
        <Input
          id="asset-name"
          required
          maxLength={160}
          value={v.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="asset-brand" label={t("brand")}>
          <Input
            id="asset-brand"
            maxLength={80}
            value={v.brand}
            onChange={(e) => set("brand", e.target.value)}
          />
        </Field>
        <Field id="asset-model" label={t("model")}>
          <Input
            id="asset-model"
            maxLength={120}
            value={v.model}
            onChange={(e) => set("model", e.target.value)}
          />
        </Field>
        <Field id="asset-serial" label={t("serial")}>
          <Input
            id="asset-serial"
            dir="ltr"
            maxLength={120}
            value={v.serialNumber}
            onChange={(e) => set("serialNumber", e.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="asset-os" label={t("os")}>
          <Input
            id="asset-os"
            maxLength={120}
            value={v.os}
            onChange={(e) => set("os", e.target.value)}
          />
        </Field>
        <Field id="asset-version" label={t("version")}>
          <Input
            id="asset-version"
            dir="ltr"
            maxLength={60}
            value={v.version}
            onChange={(e) => set("version", e.target.value)}
          />
        </Field>
        <Field id="asset-location" label={t("location")}>
          <Input
            id="asset-location"
            maxLength={200}
            value={v.location}
            onChange={(e) => set("location", e.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="asset-installed" label={t("installedAt")}>
          <Input
            id="asset-installed"
            type="date"
            dir="ltr"
            value={v.installedAt}
            onChange={(e) => set("installedAt", e.target.value)}
          />
        </Field>
        <Field id="asset-warranty" label={t("warrantyUntil")}>
          <Input
            id="asset-warranty"
            type="date"
            dir="ltr"
            value={v.warrantyUntil}
            onChange={(e) => set("warrantyUntil", e.target.value)}
          />
        </Field>
        <Field id="asset-renews" label={t("renewsAt")}>
          <Input
            id="asset-renews"
            type="date"
            dir="ltr"
            value={v.renewsAt}
            onChange={(e) => set("renewsAt", e.target.value)}
          />
        </Field>
      </div>
      <Field id="asset-status" label={t("statusLabel")}>
        <Select
          id="asset-status"
          value={v.status}
          onChange={(e) => set("status", e.target.value as AssetFormValues["status"])}
        >
          {ASSET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus(s)}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="asset-credentials" label={t("credentialsRef")} hint={t("credentialsHint")}>
        <Input
          id="asset-credentials"
          maxLength={300}
          value={v.credentialsRef}
          onChange={(e) => set("credentialsRef", e.target.value)}
        />
      </Field>
      <Field id="asset-notes" label={t("notes")}>
        <Textarea
          id="asset-notes"
          maxLength={1000}
          value={v.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>
      <div>
        <Button type="submit" disabled={action.pending || !v.customerId || !v.name.trim()}>
          {tc("save")}
        </Button>
      </div>
    </form>
  );
}
