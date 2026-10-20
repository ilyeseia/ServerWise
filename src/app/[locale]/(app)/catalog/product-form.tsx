"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useErrorText } from "@/components/crm/use-error-text";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import {
  GPU_CLASSES,
  NOISE_CLASSES,
  PRODUCT_CATEGORIES,
  productInput,
} from "@/modules/catalog/schemas";
import { createProductAction, updateProductAction } from "./actions";

export type ProductFormValues = {
  category: (typeof PRODUCT_CATEGORIES)[number];
  brand: string;
  model: string;
  cpuModel: string;
  cpuCores: string;
  cpuBenchmark: string;
  cpuBenchmarkSource: string;
  ramGb: string;
  ramMaxGb: string;
  storageSlots: string;
  storageMaxTb: string;
  lanPorts: string;
  lanSpeedMbps: string;
  hasWifi: string; // "", "true", "false"
  gpuClass: string;
  noiseClass: string;
  idleWatts: string;
  maxWatts: string;
  ecc: string;
  specsSource: string;
  notes: string;
};

export const EMPTY_PRODUCT: ProductFormValues = {
  category: "mini_pc",
  brand: "",
  model: "",
  cpuModel: "",
  cpuCores: "",
  cpuBenchmark: "",
  cpuBenchmarkSource: "",
  ramGb: "",
  ramMaxGb: "",
  storageSlots: "",
  storageMaxTb: "",
  lanPorts: "",
  lanSpeedMbps: "",
  hasWifi: "",
  gpuClass: "",
  noiseClass: "",
  idleWatts: "",
  maxWatts: "",
  ecc: "",
  specsSource: "",
  notes: "",
};

type Key = keyof ProductFormValues;
const NUMBER_KEYS: Key[] = [
  "cpuCores",
  "cpuBenchmark",
  "ramGb",
  "ramMaxGb",
  "storageSlots",
  "storageMaxTb",
  "lanPorts",
  "lanSpeedMbps",
  "idleWatts",
  "maxWatts",
];
const URL_KEYS: Key[] = ["cpuBenchmarkSource", "specsSource"];

export function ProductForm({
  productId,
  initial = EMPTY_PRODUCT,
}: {
  productId?: string;
  initial?: ProductFormValues;
}) {
  const t = useTranslations("Catalog");
  const tc = useTranslations("Common");
  const tSpec = useTranslations("Catalog.spec");
  const tForm = useTranslations("Catalog.form");
  const tCat = useTranslations("Catalog.categories");
  const tGpu = useTranslations("Catalog.gpu");
  const tNoise = useTranslations("Catalog.noise");
  const errorText = useErrorText();
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Key, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (key: Key, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const label = (key: Key) => tSpec(key);

  function messageFor(key: string, code: string): string {
    if (key === "brand" || key === "model") return tForm("brandRequired");
    if (URL_KEYS.includes(key as Key) || code === "invalid_url") return tForm("invalidUrl");
    if (key === "ramMaxGb") return tForm("ramMax");
    if (key === "maxWatts" && code === "power_range") return tForm("powerRange");
    return tForm("invalidNumber");
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = productInput.safeParse(values);
    if (!parsed.success) {
      const errors: Partial<Record<Key, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]) as Key;
        errors[key] ??= messageFor(key, issue.message);
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    startTransition(async () => {
      const result = productId
        ? await updateProductAction(productId, values)
        : await createProductAction(values);
      if (!result.ok) {
        setError(errorText(result.code));
        return;
      }
      const target = productId ?? ("id" in result ? String(result.id) : "");
      router.push(target ? `/catalog/${target}` : "/catalog");
      router.refresh();
    });
  }

  const text = (key: Key, props: { dir?: "ltr"; type?: string } = {}) => (
    <Field id={key} label={label(key)} error={fieldErrors[key]}>
      <Input
        id={key}
        dir={props.dir}
        type={props.type}
        inputMode={NUMBER_KEYS.includes(key) ? "decimal" : undefined}
        value={values[key]}
        aria-invalid={!!fieldErrors[key]}
        onChange={(e) => set(key, e.target.value)}
      />
    </Field>
  );

  const tri = (key: "hasWifi" | "ecc") => (
    <Field id={key} label={label(key)}>
      <Select id={key} value={values[key]} onChange={(e) => set(key, e.target.value)}>
        <option value="">{t("unknown")}</option>
        <option value="true">{t("yes")}</option>
        <option value="false">{t("no")}</option>
      </Select>
    </Field>
  );

  const section = (title: string, children: React.ReactNode) => (
    <fieldset className="flex flex-col gap-4 rounded-md border border-border p-4">
      <legend className="px-2 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-5">
      <Alert>{tForm("unknownHint")}</Alert>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {section(
        tForm("identity"),
        <>
          <Field id="category" label={label("category")}>
            <Select
              id="category"
              value={values.category}
              onChange={(e) => set("category", e.target.value)}
            >
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {tCat(c)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("brand")}
            {text("model")}
          </div>
        </>,
      )}

      {section(
        tForm("processor"),
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {text("cpuModel")}
            {text("cpuCores", { dir: "ltr" })}
            {text("cpuBenchmark", { dir: "ltr" })}
          </div>
          {text("cpuBenchmarkSource", { dir: "ltr", type: "url" })}
        </>,
      )}

      {section(
        tForm("memory"),
        <div className="grid gap-4 sm:grid-cols-3">
          {text("ramGb", { dir: "ltr" })}
          {text("ramMaxGb", { dir: "ltr" })}
          {tri("ecc")}
        </div>,
      )}

      {section(
        tForm("storageSection"),
        <div className="grid gap-4 sm:grid-cols-2">
          {text("storageSlots", { dir: "ltr" })}
          {text("storageMaxTb", { dir: "ltr" })}
        </div>,
      )}

      {section(
        tForm("network"),
        <div className="grid gap-4 sm:grid-cols-3">
          {text("lanPorts", { dir: "ltr" })}
          {text("lanSpeedMbps", { dir: "ltr" })}
          {tri("hasWifi")}
        </div>,
      )}

      {section(
        tForm("power"),
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("idleWatts", { dir: "ltr" })}
            {text("maxWatts", { dir: "ltr" })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="gpuClass" label={label("gpuClass")}>
              <Select
                id="gpuClass"
                value={values.gpuClass}
                onChange={(e) => set("gpuClass", e.target.value)}
              >
                <option value="">{t("unknown")}</option>
                {GPU_CLASSES.map((g) => (
                  <option key={g} value={g}>
                    {tGpu(g)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="noiseClass" label={label("noiseClass")}>
              <Select
                id="noiseClass"
                value={values.noiseClass}
                onChange={(e) => set("noiseClass", e.target.value)}
              >
                <option value="">{t("unknown")}</option>
                {NOISE_CLASSES.map((n) => (
                  <option key={n} value={n}>
                    {tNoise(n)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </>,
      )}

      {section(
        tForm("sources"),
        <>
          {text("specsSource", { dir: "ltr", type: "url" })}
          <Field id="notes" label={label("notes")}>
            <Textarea
              id="notes"
              maxLength={2000}
              value={values.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </>,
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {tc("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          {tc("cancel")}
        </Button>
      </div>
    </form>
  );
}
