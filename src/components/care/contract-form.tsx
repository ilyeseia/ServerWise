"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { createContractAction, updateContractAction } from "@/app/[locale]/(app)/care-actions";
import { useAction } from "@/components/projects/use-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";

export interface ContractFormValues {
  title: string;
  startsAt: string;
  endsAt: string;
  monthlyFeeDzd: string;
  notes: string;
  assetIds: string[];
}

interface Props {
  contractId?: string;
  customerId: string;
  customers: { id: string; name: string }[];
  /** Assets of the chosen customer. */
  assets: { id: string; name: string }[];
  initial: ContractFormValues;
}

export function ContractForm({ contractId, customerId, customers, assets, initial }: Props) {
  const t = useTranslations("Maintenance");
  const tc = useTranslations("Common");
  const router = useRouter();
  const action = useAction();
  const [v, setV] = useState(initial);
  const set = <K extends keyof ContractFormValues>(key: K, value: ContractFormValues[K]) =>
    setV((current) => ({ ...current, [key]: value }));

  return (
    <form
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        action.run(async () => {
          const input = { customerId, ...v };
          if (contractId) return updateContractAction(contractId, input);
          const result = await createContractAction(input);
          if (result.ok) router.push(`/maintenance/${result.id}`);
          return result;
        });
      }}
    >
      {action.error ? <Alert variant="danger">{action.error}</Alert> : null}
      <Field id="contract-customer" label={t("customer")}>
        <Select
          id="contract-customer"
          required
          value={customerId}
          disabled={Boolean(contractId)}
          onChange={(e) => router.replace(`/maintenance/new?customerId=${e.target.value}`)}
        >
          <option value="">{t("chooseCustomer")}</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="contract-title" label={t("titleLabel")}>
        <Input
          id="contract-title"
          required
          maxLength={200}
          value={v.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="contract-start" label={t("startsAt")}>
          <Input
            id="contract-start"
            type="date"
            dir="ltr"
            required
            value={v.startsAt}
            onChange={(e) => set("startsAt", e.target.value)}
          />
        </Field>
        <Field id="contract-end" label={t("endsAt")}>
          <Input
            id="contract-end"
            type="date"
            dir="ltr"
            required
            value={v.endsAt}
            onChange={(e) => set("endsAt", e.target.value)}
          />
        </Field>
        <Field id="contract-fee" label={t("monthlyFee")} hint={t("monthlyFeeHint")}>
          <Input
            id="contract-fee"
            dir="ltr"
            inputMode="decimal"
            value={v.monthlyFeeDzd}
            onChange={(e) => set("monthlyFeeDzd", e.target.value)}
          />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t("coveredAssets")}</legend>
        {assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {customerId ? t("noAssetsForCustomer") : t("chooseCustomerFirst")}
          </p>
        ) : (
          assets.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={v.assetIds.includes(a.id)}
                onChange={(e) =>
                  set(
                    "assetIds",
                    e.target.checked ? [...v.assetIds, a.id] : v.assetIds.filter((x) => x !== a.id),
                  )
                }
              />
              {a.name}
            </label>
          ))
        )}
      </fieldset>
      <Field id="contract-notes" label={t("notes")}>
        <Textarea
          id="contract-notes"
          maxLength={1000}
          value={v.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>
      <div>
        <Button
          type="submit"
          disabled={action.pending || !customerId || !v.title.trim() || !v.startsAt || !v.endsAt}
        >
          {tc("save")}
        </Button>
      </div>
    </form>
  );
}
