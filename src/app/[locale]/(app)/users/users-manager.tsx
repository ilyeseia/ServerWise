"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { Alert, Badge } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { ROLES, type Role } from "@/server/authz/permissions";
import {
  createUserAction,
  resetPasswordAction,
  setActiveAction,
  setRoleAction,
  type ActionResult,
} from "./actions";

export interface UserView {
  id: string;
  name: string;
  email: string;
  role: Role | null;
  banned: boolean;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  locked: boolean;
  created: string;
}

const ERROR_CODES = [
  "EMAIL_TAKEN",
  "LAST_OWNER",
  "SELF_CHANGE",
  "USER_NOT_FOUND",
  "INVALID_ROLE",
  "VALIDATION",
  "FORBIDDEN",
  "UNAUTHORIZED",
  "UNKNOWN",
] as const;
type ErrorCode = (typeof ERROR_CODES)[number];

export function UsersManager({
  users,
  currentUserId,
  canManage,
}: {
  users: UserView[];
  currentUserId: string;
  canManage: boolean;
}) {
  const t = useTranslations("Users");
  const tr = useTranslations("Roles");
  const tc = useTranslations("Common");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ErrorCode | null>(null);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "viewer" as Role });

  function handle(result: ActionResult) {
    if (result.ok) {
      setError(null);
      if (result.temporaryPassword && result.email) {
        setSecret({ email: result.email, password: result.temporaryPassword });
        setCopied(false);
      }
    } else {
      setError(
        (ERROR_CODES as readonly string[]).includes(result.code)
          ? (result.code as ErrorCode)
          : "UNKNOWN",
      );
    }
  }

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => handle(await action()));
  }

  function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createUserAction(form);
      handle(result);
      if (result.ok) {
        dialogRef.current?.close();
        setForm({ name: "", email: "", role: "viewer" });
      }
    });
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => dialogRef.current?.showModal()}>
            {t("add")}
          </Button>
        ) : null}
      </header>

      {error ? <Alert variant="danger">{t(`errors.${error}`)}</Alert> : null}

      {secret ? (
        <Alert variant="success" className="flex flex-col gap-2">
          <p className="font-semibold">
            {t("tempPasswordTitle")} — <span dir="ltr">{secret.email}</span>
          </p>
          <p className="text-foreground">{t("tempPasswordNote")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <code className="rounded bg-muted px-2 py-1 text-foreground select-all" dir="ltr">
              {secret.password}
            </code>
            <Button type="button" size="sm" variant="outline" onClick={copySecret}>
              {copied ? tc("copied") : tc("copy")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSecret(null)}>
              {tc("close")}
            </Button>
          </div>
        </Alert>
      ) : null}

      {users.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table caption={t("table")}>
          <thead>
            <tr>
              <Th>{t("name")}</Th>
              <Th>{t("role")}</Th>
              <Th>{t("status")}</Th>
              <Th>{t("twoFactor")}</Th>
              <Th>{t("created")}</Th>
              {canManage ? <Th>{t("actions")}</Th> : null}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === currentUserId;
              return (
                <tr key={u.id}>
                  <Td>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">
                      {u.email}
                    </div>
                  </Td>
                  <Td>
                    {canManage && !self ? (
                      <Select
                        aria-label={t("changeRole", { name: u.name })}
                        value={u.role ?? ""}
                        disabled={pending}
                        onChange={(e) => run(() => setRoleAction(u.id, e.target.value))}
                      >
                        {u.role === null ? <option value="" /> : null}
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {tr(r)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span>{u.role ? tr(u.role) : "—"}</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={u.banned ? "danger" : "success"}>
                        {u.banned ? t("inactive") : t("active")}
                      </Badge>
                      {u.locked ? <Badge tone="danger">{t("locked")}</Badge> : null}
                      {u.mustChangePassword ? <Badge>{t("mustChange")}</Badge> : null}
                    </div>
                  </Td>
                  <Td>{u.twoFactorEnabled ? "✓" : "—"}</Td>
                  <Td className="whitespace-nowrap">{u.created}</Td>
                  {canManage ? (
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => run(() => resetPasswordAction(u.id, u.email))}
                        >
                          {t("resetPassword")}
                        </Button>
                        {!self ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => run(() => setActiveAction(u.id, u.banned))}
                          >
                            {u.banned ? t("reactivate") : t("deactivate")}
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby="create-user-title"
        className="m-auto w-full max-w-md rounded-xl border border-border bg-card p-6 text-card-foreground backdrop:bg-black/50"
      >
        <form onSubmit={submitCreate} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="create-user-title" className="text-lg font-semibold">
              {t("createTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("createDescription")}</p>
          </div>
          <Field id="new-name" label={t("name")}>
            <Input
              id="new-name"
              required
              minLength={2}
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field id="new-email" label={t("email")}>
            <Input
              id="new-email"
              type="email"
              required
              dir="ltr"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field id="new-role" label={t("role")}>
            <Select
              id="new-role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {tr(r)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {tc("create")}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
