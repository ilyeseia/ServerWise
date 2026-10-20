"use client";

import { useTranslations } from "next-intl";

const KNOWN = [
  "NOT_FOUND",
  "CUSTOMER_ARCHIVED",
  "HAS_OPEN_LEADS",
  "INVALID_TRANSITION",
  "LOST_REASON_REQUIRED",
  "INVALID_OWNER",
  "INVALID_ASSIGNEE",
  "LEAD_CLOSED",
  "LEAD_CUSTOMER_MISMATCH",
  "FUTURE_DATE",
  "UNKNOWN_QUESTIONNAIRE_VERSION",
  "VALIDATION",
  "FORBIDDEN",
  "UNAUTHORIZED",
  "UNKNOWN",
] as const;
type Known = (typeof KNOWN)[number];

/** Returns a function that turns a server error code into a translated message. */
export function useErrorText() {
  const t = useTranslations("Crm.errors");
  return (code: string) =>
    t(((KNOWN as readonly string[]).includes(code) ? code : "UNKNOWN") as Known);
}
