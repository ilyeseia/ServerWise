"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { useErrorText } from "@/components/crm/use-error-text";
import { Alert, Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { SUPPLIER_KINDS, supplierInput } from "@/modules/catalog/schemas";
import { WILAYAS } from "@/modules/crm/wilayas";
import { createSupplierAction, setSupplierActiveAction, updateSupplierAction } from "./actions";

export interface SupplierRow {
  id: string;
  name: string;
  kind: (typeof SUPPLIER_KINDS)[number];
  wilayaCode: number | null;
  phone: string | null;
  url: string | null;
  notes: string | null;
  active: boolean;
  observations: number;
}

type Form = {
  name: string;
  kind: (typeof SUPPLIER_KINDS)[number];
  wilayaCode: string;
  phone: string;
  url: string;
  notes: string;
};
const EMPTY: Form = { name: "", kind: "retailer", wilayaCode: "", phone: "", url: "", notes: "" };

export function SuppliersManager({
  suppliers,
  canWrite,
}: {
  suppliers: SupplierRow[];
  canWrite: boolean;
}) {
  const t = useTranslations("Suppliers");
  const tc = useTranslations("Common");
  const tCommon = useTranslations("Crm.common");
  const tForm = useTranslations("Catalog.form");
  const tCrm = useTranslations("Crm.customerForm");
  const errorText = useErrorText();
  const locale = useLocale() as "ar" | "fr";
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // Errors from actions outside the dialog (activate / deactivate) are shown above the table.
  const [listError, setListError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY);
    setFieldErrors({});
    setError(null);
    dialogRef.current?.showModal();
  }

  function openEdit(s: SupplierRow) {
    setEditingId(s.id);
    setForm({
      name: s.name,
      kind: s.kind,
      wilayaCode: s.wilayaCode?.toString() ?? "",
      phone: s.phone ?? "",
      url: s.url ?? "",
      notes: s.notes ?? "",
    });
    setFieldErrors({});
    setError(null);
    dialogRef.current?.showModal();
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = supplierInput.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        next[key] ??=
          key === "name"
            ? t("nameRequired")
            : key === "phone"
              ? tCrm("invalidPhone")
              : key === "url"
                ? tForm("invalidUrl")
                : errorText("VALIDATION");
      }
      setFieldErrors(next);
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      const result = editingId
        ? await updateSupplierAction(editingId, form)
        : await createSupplierAction(form);
      if (result.ok) dialogRef.current?.close();
      else setError(errorText(result.code));
    });
  }

  function toggle(s: SupplierRow) {
    setListError(null);
    startTransition(async () => {
      const result = await setSupplierActiveAction(s.id, !s.active);
      if (!result.ok) setListError(errorText(result.code));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canWrite ? (
          <Button type="button" onClick={openCreate}>
            {t("add")}
          </Button>
        ) : null}
      </header>

      {listError ? <Alert variant="danger">{listError}</Alert> : null}

      {suppliers.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table caption={t("table")}>
          <thead>
            <tr>
              <Th>{t("name")}</Th>
              <Th>{t("kind")}</Th>
              <Th>{t("wilaya")}</Th>
              <Th>{t("phone")}</Th>
              <Th>{t("observations")}</Th>
              {canWrite ? <Th>{tCommon("actions")}</Th> : null}
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id}>
                <Td>
                  <div className="font-medium">{s.name}</div>
                  {s.url ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline"
                      dir="ltr"
                    >
                      {new URL(s.url).hostname}
                    </a>
                  ) : null}
                  {!s.active ? (
                    <Badge tone="danger" className="ms-2">
                      {t("inactive")}
                    </Badge>
                  ) : null}
                </Td>
                <Td>{t(`kinds.${s.kind}`)}</Td>
                <Td>
                  {s.wilayaCode
                    ? (WILAYAS.find((w) => w.code === s.wilayaCode)?.[locale] ?? "—")
                    : "—"}
                </Td>
                <Td dir="ltr">{s.phone ?? "—"}</Td>
                <Td>{s.observations}</Td>
                {canWrite ? (
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => openEdit(s)}>
                        {t("edit")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => toggle(s)}
                      >
                        {s.active ? t("deactivate") : t("reactivate")}
                      </Button>
                    </div>
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby="supplier-dialog-title"
        className="m-auto w-full max-w-lg rounded-xl border border-border bg-card p-6 text-card-foreground backdrop:bg-black/50"
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <h2 id="supplier-dialog-title" className="text-lg font-semibold">
            {editingId ? t("editTitle") : t("createTitle")}
          </h2>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <Field id="sup-name" label={t("name")} error={fieldErrors.name}>
            <Input
              id="sup-name"
              value={form.name}
              aria-invalid={!!fieldErrors.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="sup-kind" label={t("kind")}>
              <Select
                id="sup-kind"
                value={form.kind}
                onChange={(e) => set("kind", e.target.value as Form["kind"])}
              >
                {SUPPLIER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="sup-wilaya" label={t("wilaya")}>
              <Select
                id="sup-wilaya"
                value={form.wilayaCode}
                onChange={(e) => set("wilayaCode", e.target.value)}
              >
                <option value="">—</option>
                {WILAYAS.map((w) => (
                  <option key={w.code} value={String(w.code)}>
                    {w.code} · {w[locale]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="sup-phone" label={t("phone")} error={fieldErrors.phone}>
              <Input
                id="sup-phone"
                type="tel"
                dir="ltr"
                value={form.phone}
                aria-invalid={!!fieldErrors.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </Field>
            <Field id="sup-url" label={t("url")} error={fieldErrors.url}>
              <Input
                id="sup-url"
                type="url"
                dir="ltr"
                value={form.url}
                aria-invalid={!!fieldErrors.url}
                onChange={(e) => set("url", e.target.value)}
              />
            </Field>
          </div>
          <Field id="sup-notes" label={t("notes")}>
            <Textarea
              id="sup-notes"
              maxLength={1000}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {tc("save")}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
